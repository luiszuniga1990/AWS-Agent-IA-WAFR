import * as cdk from 'aws-cdk-lib';
import { VpcStack } from './stacks/vpc-stack';
import { AuthStack } from './stacks/auth-stack';
import { ApiStack } from './stacks/api-stack';
import { DatabaseStack } from './stacks/database-stack';
import { LambdaStack } from './stacks/lambda-stack';
import { ProwlerDataStack } from './stacks/prowler-data-stack';
import { ProwlerEcsStack } from './stacks/prowler-ecs-stack';
import { ProwlerAlbStack } from './stacks/prowler-alb-stack';
import { FrontendStack } from './stacks/frontend-stack';
import { SesStack } from './stacks/ses-stack';
import { BedrockAgentStack } from './stacks/bedrock-agent-stack';

const app = new cdk.App();

const vpcStack = new VpcStack(app, 'WafrVpcStack', {
  description: 'WAFR Scan Portal — VPC, subnets, and base security groups',
});

const authStack = new AuthStack(app, 'WafrAuthStack', {
  description: 'WAFR Scan Portal — Cognito User Pool and App Client',
});

const databaseStack = new DatabaseStack(app, 'WafrDatabaseStack', {
  description: 'WAFR Scan Portal — DynamoDB tables (Scans, Assessments, AuditLog)',
});

const prowlerDataStack = new ProwlerDataStack(app, 'WafrProwlerDataStack', {
  description: 'WAFR Scan Portal — RDS PostgreSQL and ElastiCache Redis for Prowler',
  vpc: vpcStack.vpc,
  rdsSg: vpcStack.rdsSg,
  redisSg: vpcStack.redisSg,
});

const prowlerEcsStack = new ProwlerEcsStack(app, 'WafrProwlerEcsStack', {
  description: 'WAFR Scan Portal — ECS Fargate services for Prowler (API, Worker, UI)',
  vpc: vpcStack.vpc,
  ecsSg: vpcStack.ecsSg,
  rdsEndpoint: prowlerDataStack.rdsEndpoint,
  redisEndpoint: prowlerDataStack.redisEndpoint,
  rdsSecret: prowlerDataStack.rdsInstance.secret!,
});

const prowlerAlbStack = new ProwlerAlbStack(app, 'WafrProwlerAlbStack', {
  description: 'WAFR Scan Portal — ALB with HTTPS for Prowler UI and API',
  vpc: vpcStack.vpc,
  albSg: vpcStack.albSg,
  apiService: prowlerEcsStack.apiService,
  uiService: prowlerEcsStack.uiService,
});

// Lambda functions for all backend handlers
const lambdaStack = new LambdaStack(app, 'WafrLambdaStack', {
  description: 'WAFR Scan Portal — Lambda functions for backend handlers',
  vpc: vpcStack.vpc,
  lambdaSg: vpcStack.lambdaSg,
  scansTable: databaseStack.scansTable,
  assessmentsTable: databaseStack.assessmentsTable,
  auditLogTable: databaseStack.auditLogTable,
  prowlerApiUrl: prowlerAlbStack.prowlerApiUrl,
  albDnsName: prowlerAlbStack.albDnsName,
});

// API Gateway with real Lambda integrations
const apiStack = new ApiStack(app, 'WafrApiStack', {
  description: 'WAFR Scan Portal — API Gateway REST with Cognito Authorizer',
  userPool: authStack.userPool,
  formHandler: lambdaStack.formHandler,
  credentialValidator: lambdaStack.credentialValidator,
  prerequisiteChecker: lambdaStack.prerequisiteChecker,
  assessmentOrchestrator: lambdaStack.assessmentOrchestrator,
  pdfGenerator: lambdaStack.pdfGenerator,
  emailSender: lambdaStack.emailSender,
});

const frontendStack = new FrontendStack(app, 'WafrFrontendStack', {
  description: 'WAFR Scan Portal — S3 + CloudFront for React SPA',
});

// Amazon SES for sending report emails
const sesStack = new SesStack(app, 'WafrSesStack', {
  description: 'WAFR Scan Portal — Amazon SES email identity for report delivery',
});

// Bedrock Agent Core for WAFR assessment orchestration
const bedrockAgentStack = new BedrockAgentStack(app, 'WafrBedrockAgentStack', {
  description: 'WAFR Scan Portal — Bedrock Agent Core with Amazon Nova Pro',
  credentialValidatorArn: lambdaStack.credentialValidator.functionArn,
  prerequisiteCheckerArn: lambdaStack.prerequisiteChecker.functionArn,
  assessmentOrchestratorArn: lambdaStack.assessmentOrchestrator.functionArn,
  pdfGeneratorArn: lambdaStack.pdfGenerator.functionArn,
  emailSenderArn: lambdaStack.emailSender.functionArn,
});

app.synth();
