import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  IAMClient,
  SimulatePrincipalPolicyCommand,
  ListAttachedUserPoliciesCommand,
  GetUserCommand,
} from '@aws-sdk/client-iam';
import type { AwsCredentials, ConnectionResult, PermissionResult, MissingPermission } from '@wafr-portal/shared';

// Write actions that MUST be denied (excluding allowed exceptions)
const WRITE_ACTIONS_TO_DENY = [
  'ec2:TerminateInstances',
  's3:DeleteBucket',
  'iam:CreateUser',
  'rds:DeleteDBInstance',
];

// Allowed write exceptions for the assessment workflow
const ALLOWED_WRITE_ACTIONS = [
  'wellarchitected:CreateWorkload',
  'wellarchitected:UpdateAnswer',
  'wellarchitected:AssociateLenses',
  'securityhub:BatchImportFindings',
];

// Managed policy ARNs required by Prowler
const REQUIRED_MANAGED_POLICIES = [
  'arn:aws:iam::aws:policy/SecurityAudit',
  'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess',
];

// Prowler-additions-policy permissions grouped by service
const PROWLER_ADDITIONS: Record<string, string[]> = {
  account: ['account:Get*'],
  appstream: ['appstream:Describe*'],
  backup: ['backup:List*', 'backup:Get*'],
  bedrock: ['bedrock:List*', 'bedrock:Get*'],
  cloudtrail: ['cloudtrail:GetInsightSelectors'],
  'cognito-idp': ['cognito-idp:GetUserPoolMfaConfig'],
  ec2: ['ec2:GetEbsEncryptionByDefault', 'ec2:GetSnapshotBlockPublicAccessState'],
  ecr: ['ecr:Describe*', 'ecr:GetRegistryScanningConfiguration'],
  elasticfilesystem: ['elasticfilesystem:DescribeBackupPolicy'],
  glue: ['glue:GetConnections', 'glue:GetSecurityConfiguration*'],
  lambda: ['lambda:GetFunction*'],
  logs: ['logs:FilterLogEvents'],
  macie2: ['macie2:GetMacieSession'],
  s3: ['s3:GetAccountPublicAccessBlock'],
  shield: ['shield:DescribeProtection', 'shield:GetSubscriptionState'],
  securityhub: ['securityhub:BatchImportFindings', 'securityhub:GetFindings'],
  ssm: ['ssm:GetDocument'],
  support: ['support:Describe*'],
  tag: ['tag:GetTagKeys'],
  wellarchitected: ['wellarchitected:List*'],
  apigateway: ['apigateway:GET'],
};

// Well-Architected write permissions required for assessment
const WA_WRITE_ACTIONS = [
  'wellarchitected:CreateWorkload',
  'wellarchitected:UpdateAnswer',
  'wellarchitected:AssociateLenses',
];

function createStsClient(credentials: AwsCredentials, region: string): STSClient {
  return new STSClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
}

function createIamClient(credentials: AwsCredentials): IAMClient {
  return new IAMClient({
    region: 'us-east-1', // IAM is global, use us-east-1
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
}

/**
 * Clears credential values from memory by overwriting with empty strings.
 */
function clearCredentials(credentials: AwsCredentials): void {
  credentials.accessKeyId = '';
  credentials.secretAccessKey = '';
}

/**
 * Test connection to AWS using STS GetCallerIdentity.
 */
export async function testConnection(
  credentials: AwsCredentials,
  region: string,
): Promise<ConnectionResult> {
  const client = createStsClient(credentials, region);
  try {
    const response = await client.send(new GetCallerIdentityCommand({}));
    return { success: true, accountId: response.Account };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown connection error';
    return { success: false, error: message };
  } finally {
    client.destroy();
  }
}

/**
 * Validate that credentials do NOT have dangerous write permissions.
 * Allowed write exceptions: wellarchitected:* and securityhub:BatchImportFindings.
 */
export async function validateReadOnly(credentials: AwsCredentials): Promise<PermissionResult> {
  const client = createIamClient(credentials);
  try {
    // Get the caller ARN for simulation
    const stsClient = createStsClient(credentials, 'us-east-1');
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    stsClient.destroy();
    const callerArn = identity.Arn!;

    const response = await client.send(
      new SimulatePrincipalPolicyCommand({
        PolicySourceArn: callerArn,
        ActionNames: WRITE_ACTIONS_TO_DENY,
      }),
    );

    const allowedWriteActions: string[] = [];
    for (const result of response.EvaluationResults ?? []) {
      if (result.EvalDecision !== 'implicitDeny' && result.EvalDecision !== 'explicitDeny') {
        allowedWriteActions.push(result.EvalActionName!);
      }
    }

    if (allowedWriteActions.length > 0) {
      return {
        valid: false,
        hasWriteAccess: true,
        writeActions: allowedWriteActions,
      };
    }

    return { valid: true, hasWriteAccess: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Permission validation failed';
    return { valid: false, hasWriteAccess: undefined, missingPermissions: [{ service: 'iam', actions: [message] }] };
  } finally {
    client.destroy();
  }
}

/**
 * Validate that credentials have the minimum required permissions:
 * - SecurityAudit and ViewOnlyAccess managed policies
 * - Prowler-additions-policy permissions
 * - Well-Architected Tool write permissions
 */
export async function validateMinimumPermissions(
  credentials: AwsCredentials,
): Promise<PermissionResult> {
  const client = createIamClient(credentials);
  try {
    const stsClient = createStsClient(credentials, 'us-east-1');
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    stsClient.destroy();
    const callerArn = identity.Arn!;

    // Extract username from ARN (arn:aws:iam::123456789012:user/username)
    const arnParts = callerArn.split('/');
    const userName = arnParts[arnParts.length - 1];

    // Check attached managed policies
    const attachedPolicies = await client.send(
      new ListAttachedUserPoliciesCommand({ UserName: userName }),
    );

    const attachedArns = (attachedPolicies.AttachedPolicies ?? []).map((p) => p.PolicyArn ?? '');
    const missingPolicies: string[] = [];
    for (const required of REQUIRED_MANAGED_POLICIES) {
      if (!attachedArns.some((arn) => arn.includes(required.replace('arn:aws:iam::aws:policy/', '')))) {
        missingPolicies.push(required);
      }
    }

    // Collect all actions to simulate (prowler-additions + WA write)
    const allActionsToCheck: string[] = [];
    for (const actions of Object.values(PROWLER_ADDITIONS)) {
      // For wildcard actions like account:Get*, use a concrete representative action
      for (const action of actions) {
        allActionsToCheck.push(action.replace('*', 'All'));
      }
    }
    allActionsToCheck.push(...WA_WRITE_ACTIONS);

    // Simulate in batches (API limit is ~100 actions per call)
    const BATCH_SIZE = 50;
    const missingByService: Record<string, string[]> = {};

    for (let i = 0; i < allActionsToCheck.length; i += BATCH_SIZE) {
      const batch = allActionsToCheck.slice(i, i + BATCH_SIZE);
      const simResult = await client.send(
        new SimulatePrincipalPolicyCommand({
          PolicySourceArn: callerArn,
          ActionNames: batch,
        }),
      );

      for (const evalResult of simResult.EvaluationResults ?? []) {
        if (evalResult.EvalDecision !== 'allowed') {
          const actionName = evalResult.EvalActionName!;
          const service = actionName.split(':')[0];
          if (!missingByService[service]) {
            missingByService[service] = [];
          }
          missingByService[service].push(actionName);
        }
      }
    }

    // Build missing permissions list
    const missingPermissions: MissingPermission[] = [];

    if (missingPolicies.length > 0) {
      missingPermissions.push({
        service: 'iam-managed-policies',
        actions: missingPolicies,
      });
    }

    for (const [service, actions] of Object.entries(missingByService)) {
      missingPermissions.push({ service, actions });
    }

    if (missingPermissions.length > 0) {
      return { valid: false, missingPermissions };
    }

    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Permission validation failed';
    return { valid: false, missingPermissions: [{ service: 'general', actions: [message] }] };
  } finally {
    client.destroy();
    clearCredentials(credentials);
  }
}
