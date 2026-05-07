import {
  WellArchitectedClient,
  CreateWorkloadCommand,
  AssociateLensesCommand,
  UpdateAnswerCommand,
} from '@aws-sdk/client-wellarchitected';

const client = new WellArchitectedClient({});

/** The 6 WAFR pillar lens aliases used by the Well-Architected Tool. */
const WAFR_LENSES = [
  'wellarchitected',
  'serverless',
  'saas',
  'foundationaltechnicalreview',
  'softwareasaservice',
  'arn:aws:wellarchitected::aws:lens/wellarchitected',
];

/**
 * Create a workload in the AWS Well-Architected Tool.
 */
export async function createWorkload(
  clientName: string,
  awsAccountNumber: string,
  awsRegion: string,
): Promise<{ workloadArn: string; workloadId: string }> {
  const result = await client.send(
    new CreateWorkloadCommand({
      WorkloadName: `WAFR-${clientName}-${Date.now()}`,
      Description: `WAFR assessment for ${clientName} (account ${awsAccountNumber})`,
      Environment: 'PRODUCTION',
      AwsRegions: [awsRegion],
      AccountIds: [awsAccountNumber],
      Lenses: ['wellarchitected'],
      ReviewOwner: 'wafr-scan-portal',
    }),
  );

  if (!result.WorkloadArn || !result.WorkloadId) {
    throw new Error('CreateWorkload did not return WorkloadArn or WorkloadId');
  }

  return {
    workloadArn: result.WorkloadArn,
    workloadId: result.WorkloadId,
  };
}

/**
 * Associate the WAFR lenses with a workload.
 */
export async function associateLenses(workloadId: string): Promise<void> {
  await client.send(
    new AssociateLensesCommand({
      WorkloadId: workloadId,
      LensAliases: WAFR_LENSES,
    }),
  );
}

/**
 * Register an answer for a specific question in a workload lens.
 */
export async function updateAnswer(
  workloadId: string,
  lensAlias: string,
  questionId: string,
  selectedChoices: string[],
): Promise<void> {
  await client.send(
    new UpdateAnswerCommand({
      WorkloadId: workloadId,
      LensAlias: lensAlias,
      QuestionId: questionId,
      SelectedChoices: selectedChoices,
    }),
  );
}
