import { testConnection, validateReadOnly, validateMinimumPermissions } from './credential-validator';
import { mockClient } from 'aws-sdk-client-mock';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  IAMClient,
  SimulatePrincipalPolicyCommand,
  ListAttachedUserPoliciesCommand,
} from '@aws-sdk/client-iam';
import type { AwsCredentials } from '@wafr-portal/shared';

const stsMock = mockClient(STSClient);
const iamMock = mockClient(IAMClient);

const testCreds: AwsCredentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

beforeEach(() => {
  stsMock.reset();
  iamMock.reset();
});

describe('testConnection', () => {
  it('returns success with accountId when STS call succeeds', async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({
      Account: '123456789012',
      Arn: 'arn:aws:iam::123456789012:user/testuser',
    });

    const result = await testConnection({ ...testCreds }, 'us-east-1');
    expect(result.success).toBe(true);
    expect(result.accountId).toBe('123456789012');
    expect(result.error).toBeUndefined();
  });

  it('returns failure with error message when STS call fails', async () => {
    stsMock.on(GetCallerIdentityCommand).rejects(new Error('Invalid credentials'));

    const result = await testConnection({ ...testCreds }, 'us-east-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid credentials');
    expect(result.accountId).toBeUndefined();
  });
});

describe('validateReadOnly', () => {
  it('returns valid when all write actions are implicitly denied', async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({
      Arn: 'arn:aws:iam::123456789012:user/testuser',
    });

    iamMock.on(SimulatePrincipalPolicyCommand).resolves({
      EvaluationResults: [
        { EvalActionName: 'ec2:TerminateInstances', EvalDecision: 'implicitDeny' },
        { EvalActionName: 's3:DeleteBucket', EvalDecision: 'implicitDeny' },
        { EvalActionName: 'iam:CreateUser', EvalDecision: 'implicitDeny' },
        { EvalActionName: 'rds:DeleteDBInstance', EvalDecision: 'implicitDeny' },
      ],
    });

    const result = await validateReadOnly({ ...testCreds });
    expect(result.valid).toBe(true);
    expect(result.hasWriteAccess).toBe(false);
  });

  it('returns invalid when write actions are allowed', async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({
      Arn: 'arn:aws:iam::123456789012:user/testuser',
    });

    iamMock.on(SimulatePrincipalPolicyCommand).resolves({
      EvaluationResults: [
        { EvalActionName: 'ec2:TerminateInstances', EvalDecision: 'allowed' },
        { EvalActionName: 's3:DeleteBucket', EvalDecision: 'implicitDeny' },
        { EvalActionName: 'iam:CreateUser', EvalDecision: 'allowed' },
        { EvalActionName: 'rds:DeleteDBInstance', EvalDecision: 'implicitDeny' },
      ],
    });

    const result = await validateReadOnly({ ...testCreds });
    expect(result.valid).toBe(false);
    expect(result.hasWriteAccess).toBe(true);
    expect(result.writeActions).toEqual(['ec2:TerminateInstances', 'iam:CreateUser']);
  });
});

describe('validateMinimumPermissions', () => {
  it('returns valid when all policies and permissions are present', async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({
      Arn: 'arn:aws:iam::123456789012:user/testuser',
    });

    iamMock.on(ListAttachedUserPoliciesCommand).resolves({
      AttachedPolicies: [
        { PolicyArn: 'arn:aws:iam::aws:policy/SecurityAudit', PolicyName: 'SecurityAudit' },
        { PolicyArn: 'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess', PolicyName: 'ViewOnlyAccess' },
      ],
    });

    iamMock.on(SimulatePrincipalPolicyCommand).resolves({
      EvaluationResults: [], // Will be populated per batch — mock returns all allowed
    });

    // Mock all simulate calls to return allowed
    iamMock.on(SimulatePrincipalPolicyCommand).callsFake((input) => {
      const results = (input.ActionNames ?? []).map((action: string) => ({
        EvalActionName: action,
        EvalDecision: 'allowed',
      }));
      return { EvaluationResults: results };
    });

    const creds = { ...testCreds };
    const result = await validateMinimumPermissions(creds);
    expect(result.valid).toBe(true);
    expect(result.missingPermissions).toBeUndefined();
    // Verify credentials were cleared
    expect(creds.accessKeyId).toBe('');
    expect(creds.secretAccessKey).toBe('');
  });

  it('reports missing managed policies', async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({
      Arn: 'arn:aws:iam::123456789012:user/testuser',
    });

    iamMock.on(ListAttachedUserPoliciesCommand).resolves({
      AttachedPolicies: [], // No policies attached
    });

    iamMock.on(SimulatePrincipalPolicyCommand).callsFake((input) => {
      const results = (input.ActionNames ?? []).map((action: string) => ({
        EvalActionName: action,
        EvalDecision: 'allowed',
      }));
      return { EvaluationResults: results };
    });

    const creds = { ...testCreds };
    const result = await validateMinimumPermissions(creds);
    expect(result.valid).toBe(false);
    expect(result.missingPermissions).toBeDefined();
    const policyMissing = result.missingPermissions!.find((m) => m.service === 'iam-managed-policies');
    expect(policyMissing).toBeDefined();
    expect(policyMissing!.actions).toHaveLength(2);
  });
});
