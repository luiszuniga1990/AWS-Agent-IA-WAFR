import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  /** Optional Lambda functions — when provided, real integrations replace mocks */
  formHandler?: lambda.IFunction;
  credentialValidator?: lambda.IFunction;
  prerequisiteChecker?: lambda.IFunction;
  assessmentOrchestrator?: lambda.IFunction;
  pdfGenerator?: lambda.IFunction;
  emailSender?: lambda.IFunction;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // REST API
    this.api = new apigateway.RestApi(this, 'WafrApi', {
      restApiName: 'wafr-scan-portal-api',
      description: 'WAFR Scan Portal REST API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
      deployOptions: {
        stageName: 'prod',
      },
    });

    // Cognito Authorizer
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'wafr-cognito-authorizer',
    });

    const authMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // Helper: create a Lambda proxy integration or fall back to a mock
    const integrationFor = (fn?: lambda.IFunction): apigateway.Integration => {
      if (fn) {
        return new apigateway.LambdaIntegration(fn, { proxy: true });
      }
      return new apigateway.MockIntegration({
        integrationResponses: [{ statusCode: '200' }],
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        requestTemplates: { 'application/json': '{"statusCode": 200}' },
      });
    };

    // --- /scans ---
    const scans = this.api.root.addResource('scans');

    // POST /scans — create scan (FormHandler)
    scans.addMethod('POST', integrationFor(props.formHandler), authMethodOptions);

    // GET /scans — history (FormHandler)
    scans.addMethod('GET', integrationFor(props.formHandler), authMethodOptions);

    // --- /scans/{scanId} ---
    const scanById = scans.addResource('{scanId}');

    // GET /scans/{scanId} — get single scan (FormHandler)
    scanById.addMethod('GET', integrationFor(props.formHandler), authMethodOptions);

    // POST /scans/{scanId}/credentials (CredentialValidator)
    const credentials = scanById.addResource('credentials');
    credentials.addMethod('POST', integrationFor(props.credentialValidator), authMethodOptions);

    // GET /scans/{scanId}/permissions (CredentialValidator)
    const permissions = scanById.addResource('permissions');
    permissions.addMethod('GET', integrationFor(props.credentialValidator), authMethodOptions);

    // GET /scans/{scanId}/prerequisites (PrerequisiteChecker)
    const prerequisites = scanById.addResource('prerequisites');
    prerequisites.addMethod('GET', integrationFor(props.prerequisiteChecker), authMethodOptions);

    // GET /scans/{scanId}/iam-policy (CredentialValidator)
    const iamPolicy = scanById.addResource('iam-policy');
    iamPolicy.addMethod('GET', integrationFor(props.credentialValidator), authMethodOptions);

    // POST /scans/{scanId}/assessment (AssessmentOrchestrator)
    const assessment = scanById.addResource('assessment');
    assessment.addMethod('POST', integrationFor(props.assessmentOrchestrator), authMethodOptions);

    // GET /scans/{scanId}/prowler-link (AssessmentOrchestrator)
    const prowlerLink = scanById.addResource('prowler-link');
    prowlerLink.addMethod('GET', integrationFor(props.assessmentOrchestrator), authMethodOptions);

    // --- /assessments ---
    const assessments = this.api.root.addResource('assessments');
    const assessmentById = assessments.addResource('{assessmentId}');

    // GET /assessments/{assessmentId}/status (AssessmentOrchestrator)
    const status = assessmentById.addResource('status');
    status.addMethod('GET', integrationFor(props.assessmentOrchestrator), authMethodOptions);

    // GET /assessments/{assessmentId}/pdf/{type} (PDFGenerator)
    const pdf = assessmentById.addResource('pdf');
    const pdfType = pdf.addResource('{type}');
    pdfType.addMethod('GET', integrationFor(props.pdfGenerator), authMethodOptions);

    // POST /assessments/{assessmentId}/emails (EmailSender)
    const emails = assessmentById.addResource('emails');
    emails.addMethod('POST', integrationFor(props.emailSender), authMethodOptions);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'WAFR Scan Portal API URL',
    });
  }
}
