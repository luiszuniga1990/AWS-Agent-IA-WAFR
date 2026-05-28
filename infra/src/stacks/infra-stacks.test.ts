import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { VpcStack } from './vpc-stack';
import { AuthStack } from './auth-stack';
import { DatabaseStack } from './database-stack';
import { SesStack } from './ses-stack';
import { FrontendStack } from './frontend-stack';

describe('VpcStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new VpcStack(app, 'TestVpcStack');
    template = Template.fromStack(stack);
  });

  it('creates a VPC', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
  });

  it('creates security groups', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', Match.anyValue());
  });
});

describe('AuthStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new AuthStack(app, 'TestAuthStack');
    template = Template.fromStack(stack);
  });

  it('creates a Cognito User Pool', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
  });

  it('creates a User Pool Client', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });
});

describe('DatabaseStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new DatabaseStack(app, 'TestDatabaseStack');
    template = Template.fromStack(stack);
  });

  it('creates 3 DynamoDB tables', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 3);
  });

  it('creates scans table with scanId GSI', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'scanId-index' }),
      ]),
    });
  });
});

describe('SesStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App({ context: { sesDomain: 'example.com' } });
    const stack = new SesStack(app, 'TestSesStack');
    template = Template.fromStack(stack);
  });

  it('creates an SES email identity', () => {
    template.resourceCountIs('AWS::SES::EmailIdentity', 1);
  });

  it('uses the provided domain', () => {
    template.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'example.com',
    });
  });
});

describe('FrontendStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new FrontendStack(app, 'TestFrontendStack');
    template = Template.fromStack(stack);
  });

  it('creates an S3 bucket', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  it('creates a CloudFront distribution', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });
});
