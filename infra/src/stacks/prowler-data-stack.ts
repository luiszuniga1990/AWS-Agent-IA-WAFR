import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';

export interface ProwlerDataStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  rdsSg: ec2.ISecurityGroup;
  redisSg: ec2.ISecurityGroup;
}

export class ProwlerDataStack extends cdk.Stack {
  public readonly rdsInstance: rds.DatabaseInstance;
  public readonly rdsEndpoint: string;
  public readonly redisEndpoint: string;

  constructor(scope: Construct, id: string, props: ProwlerDataStackProps) {
    super(scope, id, props);

    const { vpc, rdsSg, redisSg } = props;

    // Amazon RDS PostgreSQL 15 — Single-AZ, db.t3.medium, 20GB gp3
    this.rdsInstance = new rds.DatabaseInstance(this, 'ProwlerDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [rdsSg],
      databaseName: 'prowler',
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      multiAz: false,
      credentials: rds.Credentials.fromGeneratedSecret('prowler_admin'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // Amazon ElastiCache Redis 7 — Single-AZ, cache.t3.small
    const privateSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Prowler Redis',
      subnetIds: privateSubnets.subnetIds,
    });

    const redisCluster = new elasticache.CfnCacheCluster(this, 'ProwlerRedis', {
      engine: 'redis',
      engineVersion: '7.0',
      cacheNodeType: 'cache.t3.small',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [redisSg.securityGroupId],
    });

    this.rdsEndpoint = this.rdsInstance.dbInstanceEndpointAddress;
    this.redisEndpoint = redisCluster.attrRedisEndpointAddress;

    // Outputs
    new cdk.CfnOutput(this, 'RdsEndpoint', { value: this.rdsEndpoint });
    new cdk.CfnOutput(this, 'RedisEndpoint', { value: this.redisEndpoint });
  }
}
