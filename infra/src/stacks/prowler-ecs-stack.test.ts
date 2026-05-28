import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ProwlerEcsStack } from './prowler-ecs-stack';
import { ProwlerAlbStack } from './prowler-alb-stack';

describe('ProwlerEcsStack', () => {
  let app: cdk.App;
  let ecsStack: ProwlerEcsStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();

    // Mock dependency stack
    const depStack = new cdk.Stack(app, 'DepStack');
    const vpc = new ec2.Vpc(depStack, 'Vpc', { maxAzs: 2 });
    const ecsSg = new ec2.SecurityGroup(depStack, 'EcsSg', { vpc });
    const rdsSecret = new secretsmanager.Secret(depStack, 'Secret');

    ecsStack = new ProwlerEcsStack(app, 'TestProwlerEcsStack', {
      vpc,
      ecsSg,
      rdsEndpoint: 'test-rds.cluster.us-west-2.rds.amazonaws.com',
      redisEndpoint: 'test-redis.cache.amazonaws.com',
      rdsSecret,
      neo4jHost: 'neo4j.wafr.local',
    });

    template = Template.fromStack(ecsStack);
  });

  test('creates ECS cluster', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
  });

  test('creates 3 Fargate services (API, Worker, UI)', () => {
    template.resourceCountIs('AWS::ECS::Service', 3);
  });

  test('creates 3 task definitions', () => {
    template.resourceCountIs('AWS::ECS::TaskDefinition', 3);
  });

  test('API task has correct CPU/memory (2048/4096)', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '2048',
      Memory: '4096',
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'prowler-api',
          PortMappings: [{ ContainerPort: 8080 }],
        }),
      ]),
    });
  });

  test('Worker task has correct CPU/memory (4096/8192)', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '4096',
      Memory: '8192',
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Name: 'prowler-worker' }),
      ]),
    });
  });

  test('UI task has correct CPU/memory (1024/2048)', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '1024',
      Memory: '2048',
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'prowler-ui',
          PortMappings: [{ ContainerPort: 3000 }],
        }),
      ]),
    });
  });

  test('Worker service uses FARGATE_SPOT capacity provider', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      CapacityProviderStrategy: [
        { CapacityProvider: 'FARGATE_SPOT', Weight: 1 },
      ],
    });
  });

  test('all containers have environment variables for RDS and Redis', () => {
    const envVars = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'VALKEY_HOST', 'VALKEY_PORT'];
    for (const envVar of envVars) {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Environment: Match.arrayWith([
              Match.objectLike({ Name: envVar }),
            ]),
          }),
        ]),
      });
    }
  });

  test('API and Worker containers have RDS secrets', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'prowler-api',
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'POSTGRES_USER' }),
          ]),
        }),
      ]),
    });

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'prowler-worker',
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: 'POSTGRES_USER' }),
          ]),
        }),
      ]),
    });
  });

  test('services use private subnets (DISABLED public IP)', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({
          AssignPublicIp: 'DISABLED',
        }),
      },
    });
  });

  test('cluster has Fargate capacity providers enabled', () => {
    template.hasResourceProperties('AWS::ECS::ClusterCapacityProviderAssociations', {
      CapacityProviders: Match.arrayWith(['FARGATE', 'FARGATE_SPOT']),
    });
  });

  test('log groups have 7-day retention', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 7,
    });
  });
});

describe('ProwlerEcsStack + AlbStack integration', () => {
  test('ECS services can register with ALB target groups', () => {
    const app = new cdk.App();

    const depStack = new cdk.Stack(app, 'DepStack2');
    const vpc = new ec2.Vpc(depStack, 'Vpc', { maxAzs: 2 });
    const ecsSg = new ec2.SecurityGroup(depStack, 'EcsSg', { vpc });
    const albSg = new ec2.SecurityGroup(depStack, 'AlbSg', { vpc });
    const rdsSecret = new secretsmanager.Secret(depStack, 'Secret');

    const ecsStack = new ProwlerEcsStack(app, 'IntegEcsStack', {
      vpc,
      ecsSg,
      rdsEndpoint: 'test-rds.us-west-2.rds.amazonaws.com',
      redisEndpoint: 'test-redis.cache.amazonaws.com',
      rdsSecret,
      neo4jHost: 'neo4j.wafr.local',
    });

    // This validates the ALB stack can consume ECS services without errors
    const albStack = new ProwlerAlbStack(app, 'IntegAlbStack', {
      vpc,
      albSg,
      apiService: ecsStack.apiService,
      uiService: ecsStack.uiService,
    });

    const albTemplate = Template.fromStack(albStack);

    // ALB creates target groups pointing to correct ports
    albTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 8080,
      Protocol: 'HTTP',
    });

    albTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 3000,
      Protocol: 'HTTP',
    });

    // Health checks configured
    albTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/api/v1/healthcheck',
    });
  });
});
