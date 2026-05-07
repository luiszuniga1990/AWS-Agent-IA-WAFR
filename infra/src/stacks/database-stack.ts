import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly scansTable: dynamodb.Table;
  public readonly assessmentsTable: dynamodb.Table;
  public readonly auditLogTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Scans table
    // PK: userId, SK: scanId
    // GSI: scanId-index (PK: scanId) for direct lookups by scanId
    this.scansTable = new dynamodb.Table(this, 'ScansTable', {
      tableName: 'wafr-scans',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scanId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    this.scansTable.addGlobalSecondaryIndex({
      indexName: 'scanId-index',
      partitionKey: { name: 'scanId', type: dynamodb.AttributeType.STRING },
    });

    // Assessments table
    // PK: scanId, SK: assessmentId
    // GSI: assessmentId-index (PK: assessmentId)
    this.assessmentsTable = new dynamodb.Table(this, 'AssessmentsTable', {
      tableName: 'wafr-assessments',
      partitionKey: { name: 'scanId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'assessmentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    this.assessmentsTable.addGlobalSecondaryIndex({
      indexName: 'assessmentId-index',
      partitionKey: { name: 'assessmentId', type: dynamodb.AttributeType.STRING },
    });

    // AuditLog table
    // PK: userId, SK: timestamp (ISO 8601)
    this.auditLogTable = new dynamodb.Table(this, 'AuditLogTable', {
      tableName: 'wafr-audit-log',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ScansTableName', {
      value: this.scansTable.tableName,
    });

    new cdk.CfnOutput(this, 'ScansTableArn', {
      value: this.scansTable.tableArn,
    });

    new cdk.CfnOutput(this, 'AssessmentsTableName', {
      value: this.assessmentsTable.tableName,
    });

    new cdk.CfnOutput(this, 'AssessmentsTableArn', {
      value: this.assessmentsTable.tableArn,
    });

    new cdk.CfnOutput(this, 'AuditLogTableName', {
      value: this.auditLogTable.tableName,
    });

    new cdk.CfnOutput(this, 'AuditLogTableArn', {
      value: this.auditLogTable.tableArn,
    });
  }
}
