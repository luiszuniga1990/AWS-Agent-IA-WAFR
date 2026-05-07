import * as cdk from 'aws-cdk-lib';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';

export interface SesStackProps extends cdk.StackProps {
  /**
   * Domain to verify for sending emails (e.g. "example.com").
   * If not provided, falls back to CDK context variable "sesDomain".
   */
  sesDomain?: string;
}

export class SesStack extends cdk.Stack {
  /** The verified SES email identity (domain) */
  public readonly emailIdentity: ses.EmailIdentity;
  /** The verified domain name */
  public readonly verifiedDomain: string;

  constructor(scope: Construct, id: string, props?: SesStackProps) {
    super(scope, id, props);

    const domain =
      props?.sesDomain ??
      (this.node.tryGetContext('sesDomain') as string | undefined);

    if (!domain) {
      throw new Error(
        'Context variable "sesDomain" is required. Pass it via -c sesDomain=example.com',
      );
    }

    this.verifiedDomain = domain;

    // SES Email Identity — domain verification
    // CDK will create the necessary DNS verification records.
    // For production, add DKIM signing via configurationSet + DKIM identity.
    this.emailIdentity = new ses.EmailIdentity(this, 'WafrEmailIdentity', {
      identity: ses.Identity.domain(domain),
    });

    // Outputs
    new cdk.CfnOutput(this, 'SesVerifiedDomain', {
      value: domain,
      description: 'SES verified domain for sending WAFR report emails',
    });

    new cdk.CfnOutput(this, 'SesDkimRecords', {
      value: 'Check the SES console for DKIM CNAME records to add to your DNS',
      description: 'Reminder to configure DKIM DNS records',
    });
  }
}
