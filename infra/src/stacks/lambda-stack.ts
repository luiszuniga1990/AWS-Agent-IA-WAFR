import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';

export interface LambdaStackProps extends cdk.StackProps {
  /** VPC for Lambda functions that need VPC access */
  vpc: ec2.IVpc;
  /** Security group for Lambda functions */
  lambdaSg: ec2.ISecurityGroup;
  /** DynamoDB Scans table */
  scansTable: dynamodb.ITable;
  /** DynamoDB Assessments table */
  assessmentsTable: dynamodb.ITable;
  /** DynamoDB AuditLog table */
  auditLogTable: dynamodb.ITable;
  /** Prowler API URL (e.g. https://<alb-dns>/api) */
  prowlerApiUrl: string;
  /** Prowler ALB DNS name */
  albDnsName: string;
  /** SES verified sender email address */
  sesFromEmail?: string;
  /** Technical team email for detail reports */
  technicalTeamEmail?: string;
}

export class LambdaStack extends cdk.Stack {
  public readonly formHandler: lambda.Function;
  public readonly credentialValidator: lambda.Function;
  public readonly prerequisiteChecker: lambda.Function;
  public readonly assessmentOrchestrator: lambda.Function;
  public readonly pdfGenerator: lambda.Function;
  public readonly emailSender: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const {
      vpc,
      lambdaSg,
      scansTable,
      assessmentsTable,
      auditLogTable,
      prowlerApiUrl,
      albDnsName,
    } = props;

    const sesFromEmail = props.sesFromEmail
      ?? this.node.tryGetContext('sesFromEmail')
      ?? 'noreply@example.com';
    const technicalTeamEmail = props.technicalTeamEmail
      ?? this.node.tryGetContext('technicalTeamEmail')
      ?? 'tech-team@example.com';

    // Shared environment variables
    const sharedEnv: Record<string, string> = {
      SCANS_TABLE: scansTable.tableName,
      ASSESSMENTS_TABLE: assessmentsTable.tableName,
      AUDIT_LOG_TABLE: auditLogTable.tableName,
      PROWLER_API_URL: prowlerApiUrl,
      PROWLER_UI_BASE: `https://${albDnsName}`,
      SES_FROM_EMAIL: sesFromEmail,
      TECHNICAL_TEAM_EMAIL: technicalTeamEmail,
      NODE_OPTIONS: '--enable-source-maps',
    };

    const backendCodePath = path.join(__dirname, '..', '..', '..', 'backend');

    // Default Lambda props shared across all functions
    const defaultRuntime = lambda.Runtime.NODEJS_20_X;
    const defaultCode = lambda.Code.fromAsset(backendCodePath);
    const defaultTimeout = cdk.Duration.seconds(30);
    const defaultMemorySize = 512;

    // ---------------------------------------------------------------
    // 1. FormHandler — createScan, getScanHistory, getScan
    // ---------------------------------------------------------------
    this.formHandler = new lambda.Function(this, 'FormHandler', {
      runtime: defaultRuntime,
      code: defaultCode,
      timeout: defaultTimeout,
      memorySize: defaultMemorySize,
      environment: sharedEnv,
      functionName: 'wafr-form-handler',
      handler: 'dist/handlers/form-handler.handler',
      description: 'Handles scan form creation and history queries',
    });

    // FormHandler: DynamoDB read/write on Scans table + GSI
    scansTable.grantReadWriteData(this.formHandler);

    // ---------------------------------------------------------------
    // 2. CredentialValidator — uploadCredentials, getPermissions, getIamPolicy
    // ---------------------------------------------------------------
    this.credentialValidator = new lambda.Function(this, 'CredentialValidator', {
      runtime: defaultRuntime,
      code: defaultCode,
      timeout: defaultTimeout,
      memorySize: defaultMemorySize,
      environment: sharedEnv,
      functionName: 'wafr-credential-validator',
      handler: 'dist/handlers/credential-handler.handler',
      description: 'Validates AWS credentials from uploaded Excel files',
    });

    // CredentialValidator: DynamoDB read/write on Scans table + GSI
    scansTable.grantReadWriteData(this.credentialValidator);

    // STS AssumeRole and GetCallerIdentity for connection testing
    this.credentialValidator.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole', 'sts:GetCallerIdentity'],
        resources: ['*'],
      }),
    );

    // IAM SimulatePrincipalPolicy for permission validation
    this.credentialValidator.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:SimulatePrincipalPolicy'],
        resources: ['*'],
      }),
    );

    // ---------------------------------------------------------------
    // 3. PrerequisiteChecker — checkPrerequisites
    // ---------------------------------------------------------------
    this.prerequisiteChecker = new lambda.Function(this, 'PrerequisiteChecker', {
      runtime: defaultRuntime,
      code: defaultCode,
      timeout: defaultTimeout,
      memorySize: defaultMemorySize,
      environment: sharedEnv,
      functionName: 'wafr-prerequisite-checker',
      handler: 'dist/handlers/prerequisite-handler.handler',
      description: 'Checks AWS Config and Security Hub prerequisites',
    });

    // PrerequisiteChecker: DynamoDB read on Scans table + GSI
    scansTable.grantReadData(this.prerequisiteChecker);

    // Config DescribeConfigurationRecorders
    this.prerequisiteChecker.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['config:DescribeConfigurationRecorders'],
        resources: ['*'],
      }),
    );

    // SecurityHub GetEnabledStandards
    this.prerequisiteChecker.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['securityhub:GetEnabledStandards'],
        resources: ['*'],
      }),
    );

    // ---------------------------------------------------------------
    // 4. AssessmentOrchestrator — startAssessment, getAssessmentStatus
    //    Needs VPC access to reach Prowler API via ALB
    //    Timeout: 15 minutes, Memory: 1024 MB
    // ---------------------------------------------------------------
    this.assessmentOrchestrator = new lambda.Function(this, 'AssessmentOrchestrator', {
      runtime: defaultRuntime,
      code: defaultCode,
      environment: sharedEnv,
      functionName: 'wafr-assessment-orchestrator',
      handler: 'dist/handlers/assessment-handler.handler',
      description: 'Orchestrates WAFR assessment execution via Prowler and WA Tool',
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
    });

    // AssessmentOrchestrator: DynamoDB read/write on Scans + Assessments tables
    scansTable.grantReadWriteData(this.assessmentOrchestrator);
    assessmentsTable.grantReadWriteData(this.assessmentOrchestrator);

    // WellArchitected Tool API permissions
    this.assessmentOrchestrator.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'wellarchitected:CreateWorkload',
          'wellarchitected:UpdateAnswer',
          'wellarchitected:AssociateLenses',
        ],
        resources: ['*'],
      }),
    );

    // ---------------------------------------------------------------
    // 5. PDFGenerator — generatePdf
    //    Memory: 1024 MB (PDF generation is memory-intensive)
    // ---------------------------------------------------------------
    this.pdfGenerator = new lambda.Function(this, 'PDFGenerator', {
      runtime: defaultRuntime,
      code: defaultCode,
      timeout: defaultTimeout,
      environment: sharedEnv,
      functionName: 'wafr-pdf-generator',
      handler: 'dist/handlers/pdf-handler.handler',
      description: 'Generates WAFR Ready and Detail PDF reports',
      memorySize: 1024,
    });

    // PDFGenerator: DynamoDB read on Scans + Assessments tables
    scansTable.grantReadData(this.pdfGenerator);
    assessmentsTable.grantReadData(this.pdfGenerator);

    // ---------------------------------------------------------------
    // 6. EmailSender — sendEmails
    // ---------------------------------------------------------------
    this.emailSender = new lambda.Function(this, 'EmailSender', {
      runtime: defaultRuntime,
      code: defaultCode,
      timeout: defaultTimeout,
      memorySize: defaultMemorySize,
      environment: sharedEnv,
      functionName: 'wafr-email-sender',
      handler: 'dist/handlers/email-handler.handler',
      description: 'Sends WAFR report emails via Amazon SES',
    });

    // EmailSender: DynamoDB read/write on Scans, read on Assessments
    scansTable.grantReadWriteData(this.emailSender);
    assessmentsTable.grantReadData(this.emailSender);

    // SES SendEmail and SendRawEmail
    this.emailSender.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

    // AuditLog table: grant write to all Lambdas that log audit events
    auditLogTable.grantWriteData(this.formHandler);
    auditLogTable.grantWriteData(this.credentialValidator);
    auditLogTable.grantWriteData(this.prerequisiteChecker);
    auditLogTable.grantWriteData(this.assessmentOrchestrator);
    auditLogTable.grantWriteData(this.pdfGenerator);
    auditLogTable.grantWriteData(this.emailSender);

    // ---------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------
    new cdk.CfnOutput(this, 'FormHandlerArn', {
      value: this.formHandler.functionArn,
    });
    new cdk.CfnOutput(this, 'CredentialValidatorArn', {
      value: this.credentialValidator.functionArn,
    });
    new cdk.CfnOutput(this, 'PrerequisiteCheckerArn', {
      value: this.prerequisiteChecker.functionArn,
    });
    new cdk.CfnOutput(this, 'AssessmentOrchestratorArn', {
      value: this.assessmentOrchestrator.functionArn,
    });
    new cdk.CfnOutput(this, 'PDFGeneratorArn', {
      value: this.pdfGenerator.functionArn,
    });
    new cdk.CfnOutput(this, 'EmailSenderArn', {
      value: this.emailSender.functionArn,
    });
  }
}
