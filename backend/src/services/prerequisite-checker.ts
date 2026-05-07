import {
  ConfigServiceClient,
  DescribeConfigurationRecordersCommand,
  DescribeConfigurationRecorderStatusCommand,
} from '@aws-sdk/client-config-service';
import {
  SecurityHubClient,
  GetEnabledStandardsCommand,
} from '@aws-sdk/client-securityhub';
import type {
  AwsCredentials,
  ConfigStatus,
  SecurityHubStatus,
  PrerequisiteResult,
} from '@wafr-portal/shared';

function createConfigClient(credentials: AwsCredentials, region: string): ConfigServiceClient {
  return new ConfigServiceClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
}

function createSecurityHubClient(credentials: AwsCredentials, region: string): SecurityHubClient {
  return new SecurityHubClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
}

/**
 * Check if AWS Config is enabled and recording in the given region.
 */
export async function checkAwsConfig(
  credentials: AwsCredentials,
  region: string,
): Promise<ConfigStatus> {
  const client = createConfigClient(credentials, region);
  try {
    const recorders = await client.send(new DescribeConfigurationRecordersCommand({}));
    const enabled = (recorders.ConfigurationRecorders ?? []).length > 0;

    if (!enabled) {
      return { enabled: false, recording: false };
    }

    const statusResp = await client.send(new DescribeConfigurationRecorderStatusCommand({}));
    const recording = (statusResp.ConfigurationRecordersStatus ?? []).some(
      (s) => s.recording === true,
    );

    return { enabled: true, recording };
  } catch {
    return { enabled: false, recording: false };
  } finally {
    client.destroy();
  }
}

// Standard ARN patterns for matching enabled Security Hub standards
const FSBP_PATTERN = 'aws-foundational-security-best-practices';
const CIS_PATTERN = 'cis-aws-foundations-benchmark';
const PCI_DSS_PATTERN = 'pci-dss';

/**
 * Check if Security Hub is enabled and which standards are active.
 */
export async function checkSecurityHub(
  credentials: AwsCredentials,
  region: string,
): Promise<SecurityHubStatus> {
  const client = createSecurityHubClient(credentials, region);
  try {
    const response = await client.send(new GetEnabledStandardsCommand({}));
    const subscriptions = response.StandardsSubscriptions ?? [];

    if (subscriptions.length === 0) {
      return {
        enabled: false,
        standards: { fsbp: false, cis: false, pciDss: false },
      };
    }

    const arnList = subscriptions.map((s) => s.StandardsArn ?? '').join(' ');

    return {
      enabled: true,
      standards: {
        fsbp: arnList.includes(FSBP_PATTERN),
        cis: arnList.includes(CIS_PATTERN),
        pciDss: arnList.includes(PCI_DSS_PATTERN),
      },
    };
  } catch {
    // If Security Hub is not enabled, the API throws an error
    return {
      enabled: false,
      standards: { fsbp: false, cis: false, pciDss: false },
    };
  } finally {
    client.destroy();
  }
}

/**
 * Run all prerequisite checks and return a combined result.
 */
export async function getPrerequisiteStatus(
  credentials: AwsCredentials,
  region: string,
): Promise<PrerequisiteResult> {
  const [configStatus, securityHubStatus] = await Promise.all([
    checkAwsConfig(credentials, region),
    checkSecurityHub(credentials, region),
  ]);

  const allPassed =
    configStatus.enabled &&
    configStatus.recording &&
    securityHubStatus.enabled &&
    securityHubStatus.standards.fsbp &&
    securityHubStatus.standards.cis &&
    securityHubStatus.standards.pciDss;

  return {
    allPassed,
    configEnabled: configStatus.enabled,
    configRecording: configStatus.recording,
    securityHubEnabled: securityHubStatus.enabled,
    standards: securityHubStatus.standards,
  };
}
