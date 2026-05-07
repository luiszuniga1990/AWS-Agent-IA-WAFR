import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly lambdaSg: ec2.SecurityGroup;
  public readonly ecsSg: ec2.SecurityGroup;
  public readonly albSg: ec2.SecurityGroup;
  public readonly rdsSg: ec2.SecurityGroup;
  public readonly redisSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC with 2 AZs, public + private subnets, 1 NAT Gateway
    this.vpc = new ec2.Vpc(this, 'WafrVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Security Group: ALB (public-facing)
    this.albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });
    this.albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');
    this.albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP (redirects to HTTPS)');

    // Security Group: ECS tasks (Prowler API, Worker, UI)
    this.ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc: this.vpc,
      description: 'Security group for ECS Fargate tasks',
      allowAllOutbound: true,
    });
    this.ecsSg.addIngressRule(this.albSg, ec2.Port.tcp(8080), 'Allow traffic from ALB to API');
    this.ecsSg.addIngressRule(this.albSg, ec2.Port.tcp(3000), 'Allow traffic from ALB to UI');

    // Security Group: Lambda functions
    this.lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    // Allow Lambda to reach Prowler API on port 8080 via ECS SG
    this.ecsSg.addIngressRule(this.lambdaSg, ec2.Port.tcp(8080), 'Allow traffic from Lambda to Prowler API');

    // Security Group: RDS (PostgreSQL)
    this.rdsSg = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: false,
    });
    this.rdsSg.addIngressRule(this.ecsSg, ec2.Port.tcp(5432), 'Allow PostgreSQL from ECS');

    // Security Group: ElastiCache (Redis)
    this.redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc: this.vpc,
      description: 'Security group for ElastiCache Redis',
      allowAllOutbound: false,
    });
    this.redisSg.addIngressRule(this.ecsSg, ec2.Port.tcp(6379), 'Allow Redis from ECS');

    // Outputs for cross-stack references
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'LambdaSgId', { value: this.lambdaSg.securityGroupId });
    new cdk.CfnOutput(this, 'EcsSgId', { value: this.ecsSg.securityGroupId });
    new cdk.CfnOutput(this, 'AlbSgId', { value: this.albSg.securityGroupId });
    new cdk.CfnOutput(this, 'RdsSgId', { value: this.rdsSg.securityGroupId });
    new cdk.CfnOutput(this, 'RedisSgId', { value: this.redisSg.securityGroupId });
  }
}
