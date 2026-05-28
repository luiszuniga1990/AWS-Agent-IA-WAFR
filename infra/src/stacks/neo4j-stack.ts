import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface Neo4jStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  ecsSg: ec2.ISecurityGroup;
}

export class Neo4jStack extends cdk.Stack {
  public readonly neo4jHost: string;

  constructor(scope: Construct, id: string, props: Neo4jStackProps) {
    super(scope, id, props);

    const { vpc, ecsSg } = props;

    // Security group for Neo4j
    const neo4jSg = new ec2.SecurityGroup(this, 'Neo4jSg', {
      vpc,
      description: 'Security group for Neo4j ECS task',
      allowAllOutbound: true,
    });
    neo4jSg.addIngressRule(ecsSg, ec2.Port.tcp(7474), 'Allow HTTP from ECS tasks');
    neo4jSg.addIngressRule(ecsSg, ec2.Port.tcp(7687), 'Allow Bolt from ECS tasks');

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Neo4jCluster', {
      vpc,
      clusterName: 'wafr-neo4j-cluster',
    });

    // Service Discovery namespace
    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'Neo4jNamespace', {
      name: 'wafr.local',
      vpc,
    });

    // Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'Neo4jTaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    taskDef.addContainer('neo4j', {
      image: ecs.ContainerImage.fromRegistry('neo4j:5-community'),
      environment: {
        NEO4J_AUTH: 'neo4j/prowler-neo4j-2026',
        NEO4J_PLUGINS: '[]',
        NEO4J_server_memory_heap_initial__size: '512m',
        NEO4J_server_memory_heap_max__size: '1024m',
      },
      portMappings: [
        { containerPort: 7474 },
        { containerPort: 7687 },
      ],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'neo4j',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
    });

    // ECS Service with Service Discovery
    new ecs.FargateService(this, 'Neo4jService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      securityGroups: [neo4jSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        name: 'neo4j',
        cloudMapNamespace: namespace,
      },
    });

    this.neo4jHost = 'neo4j.wafr.local';

    new cdk.CfnOutput(this, 'Neo4jHost', { value: this.neo4jHost });
    new cdk.CfnOutput(this, 'Neo4jSgId', { value: neo4jSg.securityGroupId });
  }
}
