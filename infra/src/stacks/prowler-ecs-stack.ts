import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
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
  neo4jHost?: string;
}

export class ProwlerEcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly apiService: ecs.FargateService;
  public readonly workerService: ecs.FargateService;
  public readonly uiService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ProwlerEcsStackProps) {
    super(scope, id, props);

    const { vpc, ecsSg, rdsEndpoint, redisEndpoint, rdsSecret } = props;
    const neo4jHost = props.neo4jHost ?? 'neo4j.wafr.local';

    // ECR repositories
    const apiRepo = ecr.Repository.fromRepositoryName(this, 'ApiRepo', 'prowler/api');
    const workerRepo = ecr.Repository.fromRepositoryName(this, 'WorkerRepo', 'prowler/worker');
    const uiRepo = ecr.Repository.fromRepositoryName(this, 'UiRepo', 'prowler/ui');

    // ECS Cluster with Fargate capacity providers
    this.cluster = new ecs.Cluster(this, 'ProwlerCluster', {
      vpc,
      enableFargateCapacityProviders: true,
    });

    const sharedEnv: Record<string, string> = {
      POSTGRES_HOST: rdsEndpoint,
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'prowler',
      VALKEY_HOST: redisEndpoint,
      VALKEY_PORT: '6379',
      NEO4J_HOST: neo4jHost,
      NEO4J_PORT: '7687',
      NEO4J_USER: 'neo4j',
      NEO4J_PASSWORD: 'prowler-neo4j-2026',
      NEO4J_DB: 'neo4j',
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
      image: ecs.ContainerImage.fromEcrRepository(apiRepo, 'latest'),
      environment: {
        ...sharedEnv,
        DJANGO_SECRETS_ENCRYPTION_KEY: 'cS0MdozKF9LKEku6mMI8w2wrbCQSywARLFjz7kRj5bI=',
        DJANGO_SETTINGS_MODULE: 'config.django.production',
        DJANGO_DEBUG: 'False',
        DJANGO_BIND_ADDRESS: '0.0.0.0',
        DJANGO_ALLOWED_HOSTS: '*',
      },
      secrets: {
        POSTGRES_USER: ecs.Secret.fromSecretsManager(rdsSecret, 'username'),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(rdsSecret, 'password'),
        POSTGRES_ADMIN_USER: ecs.Secret.fromSecretsManager(rdsSecret, 'username'),
        POSTGRES_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(rdsSecret, 'password'),
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
      image: ecs.ContainerImage.fromEcrRepository(workerRepo, 'latest'),
      environment: sharedEnv,
      secrets: {
        POSTGRES_USER: ecs.Secret.fromSecretsManager(rdsSecret, 'username'),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(rdsSecret, 'password'),
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
      image: ecs.ContainerImage.fromEcrRepository(uiRepo, 'latest'),
      environment: { ...sharedEnv, AUTH_TRUST_HOST: 'true', AUTH_SECRET: 'prowler-wafr-portal-secret-key-2026' },
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
