import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ProwlerEcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  ecsSg: ec2.ISecurityGroup;
  rdsEndpoint: string;
  redisEndpoint: string;
  rdsSecret: secretsmanager.ISecret;
}

export class ProwlerEcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly apiService: ecs.FargateService;
  public readonly workerService: ecs.FargateService;
  public readonly uiService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ProwlerEcsStackProps) {
    super(scope, id, props);

    const { vpc, ecsSg, rdsEndpoint, redisEndpoint, rdsSecret } = props;

    // ECS Cluster with Fargate capacity providers
    this.cluster = new ecs.Cluster(this, 'ProwlerCluster', {
      vpc,
      enableFargateCapacityProviders: true,
    });

    const sharedEnv: Record<string, string> = {
      POSTGRES_HOST: rdsEndpoint,
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'prowler',
      REDIS_HOST: redisEndpoint,
      REDIS_PORT: '6379',
    };

    const privateSubnets: ec2.SubnetSelection = {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };

    // --- Prowler API: 2 vCPU, 4GB RAM, port 8080 ---
    const apiTaskDef = new ecs.FargateTaskDefinition(this, 'ProwlerApiTaskDef', {
      cpu: 2048,
      memoryLimitMiB: 4096,
    });

    apiTaskDef.addContainer('prowler-api', {
      image: ecs.ContainerImage.fromRegistry('prowlercloud/prowler:latest'),
      environment: sharedEnv,
      secrets: {
        RDS_SECRET_ARN: ecs.Secret.fromSecretsManager(rdsSecret),
      },
      portMappings: [{ containerPort: 8080 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'prowler-api',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
    });

    this.apiService = new ecs.FargateService(this, 'ProwlerApiService', {
      cluster: this.cluster,
      taskDefinition: apiTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: privateSubnets,
    });

    // --- Prowler Worker: 4 vCPU, 8GB RAM, Fargate Spot ---
    const workerTaskDef = new ecs.FargateTaskDefinition(this, 'ProwlerWorkerTaskDef', {
      cpu: 4096,
      memoryLimitMiB: 8192,
    });

    workerTaskDef.addContainer('prowler-worker', {
      image: ecs.ContainerImage.fromRegistry('prowlercloud/prowler:latest'),
      environment: sharedEnv,
      secrets: {
        RDS_SECRET_ARN: ecs.Secret.fromSecretsManager(rdsSecret),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'prowler-worker',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
    });

    this.workerService = new ecs.FargateService(this, 'ProwlerWorkerService', {
      cluster: this.cluster,
      taskDefinition: workerTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: privateSubnets,
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE_SPOT', weight: 1 },
      ],
    });

    // --- Prowler UI: 1 vCPU, 2GB RAM, port 3000 ---
    const uiTaskDef = new ecs.FargateTaskDefinition(this, 'ProwlerUiTaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
    });

    uiTaskDef.addContainer('prowler-ui', {
      image: ecs.ContainerImage.fromRegistry('prowlercloud/prowler-ui:latest'),
      environment: sharedEnv,
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'prowler-ui',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
    });

    this.uiService = new ecs.FargateService(this, 'ProwlerUiService', {
      cluster: this.cluster,
      taskDefinition: uiTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: privateSubnets,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ClusterArn', { value: this.cluster.clusterArn });
  }
}
