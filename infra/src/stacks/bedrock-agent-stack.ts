import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface BedrockAgentStackProps extends cdk.StackProps {
  /** Lambda that validates credentials and permissions */
  credentialValidatorArn: string;
  /** Lambda that checks prerequisites (Config + Security Hub) */
  prerequisiteCheckerArn: string;
  /** Lambda that orchestrates the assessment */
  assessmentOrchestratorArn: string;
  /** Lambda that generates PDFs */
  pdfGeneratorArn: string;
  /** Lambda that sends emails */
  emailSenderArn: string;
}

export class BedrockAgentStack extends cdk.Stack {
  public readonly agentId: string;

  constructor(scope: Construct, id: string, props: BedrockAgentStackProps) {
    super(scope, id, props);

    // IAM role for the Bedrock Agent
    const agentRole = new iam.Role(this, 'WafrAgentRole', {
      roleName: 'wafr-bedrock-agent-role',
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'IAM role for WAFR Scan Portal Bedrock Agent Core',
    });

    // Allow the agent to invoke the foundation model
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
        ],
      }),
    );

    // Allow the agent to invoke the backend Lambda functions (action groups)
    const lambdaArns = [
      props.credentialValidatorArn,
      props.prerequisiteCheckerArn,
      props.assessmentOrchestratorArn,
      props.pdfGeneratorArn,
      props.emailSenderArn,
    ];

    agentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: lambdaArns,
      }),
    );

    // Well-Architected Tool permissions for the agent
    agentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'wellarchitected:CreateWorkload',
          'wellarchitected:UpdateAnswer',
          'wellarchitected:AssociateLenses',
          'wellarchitected:ListLensReviews',
        ],
        resources: ['*'],
      }),
    );

    // Bedrock Agent — Amazon Nova Pro
    const agent = new bedrock.CfnAgent(this, 'WafrAgent', {
      agentName: 'wafr-assessment-agent',
      description:
        'WAFR Scan Portal agent that orchestrates credential validation, Prowler assessment, PDF generation, and email delivery',
      foundationModel: 'amazon.nova-pro-v1:0',
      agentResourceRoleArn: agentRole.roleArn,
      idleSessionTtlInSeconds: 1800, // 30 minutes
      instruction: [
        'You are the WAFR Assessment Agent. Your job is to orchestrate AWS Well-Architected Framework Reviews.',
        'You validate AWS credentials and IAM permissions, check prerequisites (AWS Config and Security Hub),',
        'invoke Prowler App to run security assessments, parse findings into the 6 WAFR pillars,',
        'calculate scores, create workloads in the Well-Architected Tool, generate PDF reports,',
        'and send them via email. Always follow the validation sequence: connection → permissions → prerequisites → assessment.',
      ].join(' '),
      actionGroups: [
        {
          actionGroupName: 'CredentialValidation',
          description:
            'Validates AWS credentials: tests connection via STS, checks read-only permissions, verifies minimum IAM policies',
          actionGroupExecutor: {
            lambda: props.credentialValidatorArn,
          },
          apiSchema: {
            payload: JSON.stringify({
              openapi: '3.0.0',
              info: { title: 'Credential Validation', version: '1.0.0' },
              paths: {
                '/validate-credentials': {
                  post: {
                    operationId: 'validateCredentials',
                    description: 'Validate AWS credentials from uploaded Excel file',
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { type: 'object', properties: { scanId: { type: 'string', description: 'The scan identifier' } }, required: ['scanId'] } } },
                    },
                    responses: { '200': { description: 'Validation result' } },
                  },
                },
                '/validate-permissions': {
                  post: {
                    operationId: 'validatePermissions',
                    description: 'Validate IAM permissions are read-only with minimum required policies',
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { type: 'object', properties: { scanId: { type: 'string', description: 'The scan identifier' } }, required: ['scanId'] } } },
                    },
                    responses: { '200': { description: 'Permission validation result' } },
                  },
                },
                '/generate-iam-policy/{scanId}': {
                  get: {
                    operationId: 'generateIamPolicy',
                    description: 'Generate minimum IAM policy JSON for download',
                    parameters: [
                      { name: 'scanId', in: 'path', required: true, schema: { type: 'string' }, description: 'The scan identifier' },
                    ],
                    responses: { '200': { description: 'IAM policy document' } },
                  },
                },
              },
            }),
          },
        },
        {
          actionGroupName: 'PrerequisiteChecking',
          description:
            'Checks that AWS Config and Security Hub are enabled with required standards in the target account',
          actionGroupExecutor: {
            lambda: props.prerequisiteCheckerArn,
          },
          apiSchema: {
            payload: JSON.stringify({
              openapi: '3.0.0',
              info: { title: 'Prerequisite Checking', version: '1.0.0' },
              paths: {
                '/check-prerequisites': {
                  post: {
                    operationId: 'checkPrerequisites',
                    description: 'Check AWS Config and Security Hub prerequisites',
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { type: 'object', properties: { scanId: { type: 'string', description: 'The scan identifier' } }, required: ['scanId'] } } },
                    },
                    responses: { '200': { description: 'Prerequisite check result' } },
                  },
                },
              },
            }),
          },
        },
        {
          actionGroupName: 'AssessmentOrchestration',
          description:
            'Orchestrates the WAFR assessment: invokes Prowler for security scans, parses findings, calculates scores, registers in WA Tool',
          actionGroupExecutor: {
            lambda: props.assessmentOrchestratorArn,
          },
          apiSchema: {
            payload: JSON.stringify({
              openapi: '3.0.0',
              info: { title: 'Assessment Orchestration', version: '1.0.0' },
              paths: {
                '/start-assessment': {
                  post: {
                    operationId: 'startAssessment',
                    description: 'Start a WAFR assessment using Prowler and WA Tool',
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { type: 'object', properties: { scanId: { type: 'string', description: 'The scan identifier' } }, required: ['scanId'] } } },
                    },
                    responses: { '200': { description: 'Assessment started' } },
                  },
                },
                '/get-assessment-status/{assessmentId}': {
                  get: {
                    operationId: 'getAssessmentStatus',
                    description: 'Get the current status of a running assessment',
                    parameters: [
                      { name: 'assessmentId', in: 'path', required: true, schema: { type: 'string' }, description: 'The assessment identifier' },
                    ],
                    responses: { '200': { description: 'Assessment status' } },
                  },
                },
              },
            }),
          },
        },
        {
          actionGroupName: 'PDFGeneration',
          description:
            'Generates WAFR Ready and WAFR Detail PDF reports from assessment results',
          actionGroupExecutor: {
            lambda: props.pdfGeneratorArn,
          },
          apiSchema: {
            payload: JSON.stringify({
              openapi: '3.0.0',
              info: { title: 'PDF Generation', version: '1.0.0' },
              paths: {
                '/generate-pdf': {
                  post: {
                    operationId: 'generatePdf',
                    description: 'Generate a WAFR PDF report (ready or detail)',
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { type: 'object', properties: { assessmentId: { type: 'string', description: 'The assessment identifier' }, type: { type: 'string', enum: ['ready', 'detail'], description: 'Report type' } }, required: ['assessmentId', 'type'] } } },
                    },
                    responses: { '200': { description: 'PDF generated' } },
                  },
                },
              },
            }),
          },
        },
        {
          actionGroupName: 'EmailDelivery',
          description:
            'Sends WAFR report PDFs via Amazon SES to the VDM user and technical team',
          actionGroupExecutor: {
            lambda: props.emailSenderArn,
          },
          apiSchema: {
            payload: JSON.stringify({
              openapi: '3.0.0',
              info: { title: 'Email Delivery', version: '1.0.0' },
              paths: {
                '/send-emails': {
                  post: {
                    operationId: 'sendEmails',
                    description: 'Send WAFR report emails (Ready to VDM, Detail to tech team)',
                    requestBody: {
                      required: true,
                      content: { 'application/json': { schema: { type: 'object', properties: { assessmentId: { type: 'string', description: 'The assessment identifier' } }, required: ['assessmentId'] } } },
                    },
                    responses: { '200': { description: 'Emails sent' } },
                  },
                },
              },
            }),
          },
        },
      ],
    });

    // Grant Bedrock permission to invoke each Lambda
    const fnNames = ['CredentialValidator', 'PrerequisiteChecker', 'AssessmentOrchestrator', 'PdfGenerator', 'EmailSender'];
    lambdaArns.forEach((arn, i) => {
      const fn = lambda.Function.fromFunctionAttributes(this, `Import-${fnNames[i]}`, {
        functionArn: arn,
        sameEnvironment: true,
      });
      fn.grantInvoke(agentRole);
    });

    this.agentId = agent.attrAgentId;

    // Outputs
    new cdk.CfnOutput(this, 'BedrockAgentId', {
      value: agent.attrAgentId,
      description: 'Bedrock Agent ID for the WAFR assessment agent',
    });

    new cdk.CfnOutput(this, 'BedrockAgentRoleArn', {
      value: agentRole.roleArn,
      description: 'IAM role ARN for the Bedrock Agent',
    });
  }
}
