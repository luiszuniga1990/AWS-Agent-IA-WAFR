import type { IamPolicyDocument } from '@wafr-portal/shared';

/**
 * Generates the minimum IAM policy document required for the WAFR assessment.
 * Includes:
 * - SecurityAudit and ViewOnlyAccess managed policy references (as comments)
 * - Prowler-additions-policy actions
 * - Well-Architected Tool write permissions
 */
export function generateMinimumIamPolicy(): IamPolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          // Prowler-additions-policy
          'account:Get*',
          'appstream:Describe*',
          'backup:List*',
          'backup:Get*',
          'bedrock:List*',
          'bedrock:Get*',
          'cloudtrail:GetInsightSelectors',
          'cognito-idp:GetUserPoolMfaConfig',
          'ec2:GetEbsEncryptionByDefault',
          'ec2:GetSnapshotBlockPublicAccessState',
          'ecr:Describe*',
          'ecr:GetRegistryScanningConfiguration',
          'elasticfilesystem:DescribeBackupPolicy',
          'glue:GetConnections',
          'glue:GetSecurityConfiguration*',
          'lambda:GetFunction*',
          'logs:FilterLogEvents',
          'macie2:GetMacieSession',
          's3:GetAccountPublicAccessBlock',
          'shield:DescribeProtection',
          'shield:GetSubscriptionState',
          'securityhub:BatchImportFindings',
          'securityhub:GetFindings',
          'ssm:GetDocument',
          'support:Describe*',
          'tag:GetTagKeys',
          'wellarchitected:List*',
          'apigateway:GET',
          // Well-Architected Tool write permissions
          'wellarchitected:CreateWorkload',
          'wellarchitected:UpdateAnswer',
          'wellarchitected:AssociateLenses',
        ],
        Resource: '*',
      },
    ],
  };
}
