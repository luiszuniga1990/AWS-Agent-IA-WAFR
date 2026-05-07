import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export interface ProwlerAlbStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  albSg: ec2.ISecurityGroup;
  apiService: ecs.FargateService;
  uiService: ecs.FargateService;
}

export class ProwlerAlbStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly albDnsName: string;
  public readonly prowlerApiUrl: string;

  constructor(scope: Construct, id: string, props: ProwlerAlbStackProps) {
    super(scope, id, props);

    const { vpc, albSg, apiService, uiService } = props;

    // Certificate ARN from context (pass via -c certificateArn=arn:...)
    const certificateArn = this.node.tryGetContext('certificateArn') as string;
    if (!certificateArn) {
      throw new Error('Context variable "certificateArn" is required. Pass it via -c certificateArn=<ARN>');
    }
    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn);

    // Application Load Balancer in public subnets
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ProwlerAlb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // HTTP listener → redirect to HTTPS
    this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // Target group: Prowler API (port 8080)
    const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ProwlerApiTg', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [apiService],
      healthCheck: {
        path: '/api/v1/healthcheck',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Target group: Prowler UI (port 3000)
    const uiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ProwlerUiTg', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [uiService],
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // HTTPS listener with routing rules
    const httpsListener = this.alb.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
      defaultTargetGroups: [uiTargetGroup],
    });

    // Route /api/* to prowler-api target group
    httpsListener.addTargetGroups('ProwlerApiRule', {
      targetGroups: [apiTargetGroup],
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*'])],
    });

    // Store DNS values
    this.albDnsName = this.alb.loadBalancerDnsName;
    this.prowlerApiUrl = `https://${this.albDnsName}/api`;

    // Outputs
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.albDnsName,
      description: 'Prowler ALB DNS name',
    });

    new cdk.CfnOutput(this, 'ProwlerApiUrl', {
      value: this.prowlerApiUrl,
      description: 'Prowler API base URL',
    });
  }
}
