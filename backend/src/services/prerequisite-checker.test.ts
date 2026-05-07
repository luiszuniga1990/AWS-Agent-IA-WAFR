import { checkAwsConfig, checkSecurityHub, getPrerequisiteStatus } from './prerequisite-checker';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ConfigServiceClient,
  DescribeConfigurationRecordersCommand,
  DescribeConfigurationRecorderStatusCommand,
} from '@aws-sdk/client-config-service';
import {
  SecurityHubClient,
  GetEnabledStandardsCommand,
} from '@aws-sdk/client-securityhub';
import type { AwsCredentials } from '@wafr-portal/shared';

const configMock = mockClient(ConfigServiceClient);
const securityHubMock = mockClient(SecurityHubClient as any);

const testCreds: AwsCredentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

beforeEach(() => {
  configMock.reset();
  securityHubMock.reset();
});

describe('checkAwsConfig', () => {
  it('returns enabled and recording when Config is active', async () => {
    configMock.on(DescribeConfigurationRecordersCommand).resolves({
      ConfigurationRecorders: [{ name: 'default', roleARN: 'arn:aws:iam::123:role/config' }],
    });
    configMock.on(DescribeConfigurationRecorderStatusCommand).resolves({
      ConfigurationRecordersStatus: [{ recording: true, name: 'default' }],
    });

    const result = await checkAwsConfig({ ...testCreds }, 'us-east-1');
    expect(result.enabled).toBe(true);
    expect(result.recording).toBe(true);
  });

  it('returns not enabled when no recorders exist', async () => {
    configMock.on(DescribeConfigurationRecordersCommand).resolves({
      ConfigurationRecorders: [],
    });

    const result = await checkAwsConfig({ ...testCreds }, 'us-east-1');
    expect(result.enabled).toBe(false);
    expect(result.recording).toBe(false);
  });

  it('returns enabled but not recording when recorder is paused', async () => {
    configMock.on(DescribeConfigurationRecordersCommand).resolves({
      ConfigurationRecorders: [{ name: 'default', roleARN: 'arn:aws:iam::123:role/config' }],
    });
    configMock.on(DescribeConfigurationRecorderStatusCommand).resolves({
      ConfigurationRecordersStatus: [{ recording: false, name: 'default' }],
    });

    const result = await checkAwsConfig({ ...testCreds }, 'us-east-1');
    expect(result.enabled).toBe(true);
    expect(result.recording).toBe(false);
  });

  it('returns not enabled when API call fails', async () => {
    configMock.on(DescribeConfigurationRecordersCommand).rejects(new Error('Access denied'));

    const result = await checkAwsConfig({ ...testCreds }, 'us-east-1');
    expect(result.enabled).toBe(false);
    expect(result.recording).toBe(false);
  });
});

describe('checkSecurityHub', () => {
  it('returns enabled with all standards when all are active', async () => {
    securityHubMock.on(GetEnabledStandardsCommand).resolves({
      StandardsSubscriptions: [
        { StandardsArn: 'arn:aws:securityhub:::standards/aws-foundational-security-best-practices/v/1.0.0', StandardsSubscriptionArn: 'sub1', StandardsInput: 'input1', StandardsStatus: 'READY' },
        { StandardsArn: 'arn:aws:securityhub:::standards/cis-aws-foundations-benchmark/v/1.4.0', StandardsSubscriptionArn: 'sub2', StandardsInput: 'input2', StandardsStatus: 'READY' },
        { StandardsArn: 'arn:aws:securityhub:::standards/pci-dss/v/3.2.1', StandardsSubscriptionArn: 'sub3', StandardsInput: 'input3', StandardsStatus: 'READY' },
      ],
    } as any);

    const result = await checkSecurityHub({ ...testCreds }, 'us-east-1');
    expect(result.enabled).toBe(true);
    expect(result.standards.fsbp).toBe(true);
    expect(result.standards.cis).toBe(true);
    expect(result.standards.pciDss).toBe(true);
  });

  it('returns enabled with partial standards', async () => {
    securityHubMock.on(GetEnabledStandardsCommand).resolves({
      StandardsSubscriptions: [
        { StandardsArn: 'arn:aws:securityhub:::standards/aws-foundational-security-best-practices/v/1.0.0', StandardsSubscriptionArn: 'sub1', StandardsInput: 'input1', StandardsStatus: 'READY' },
      ],
    } as any);

    const result = await checkSecurityHub({ ...testCreds }, 'us-east-1');
    expect(result.enabled).toBe(true);
    expect(result.standards.fsbp).toBe(true);
    expect(result.standards.cis).toBe(false);
    expect(result.standards.pciDss).toBe(false);
  });

  it('returns not enabled when no subscriptions exist', async () => {
    securityHubMock.on(GetEnabledStandardsCommand).resolves({
      StandardsSubscriptions: [],
    });

    const result = await checkSecurityHub({ ...testCreds }, 'us-east-1');
    expect(result.enabled).toBe(false);
    expect(result.standards.fsbp).toBe(false);
    expect(result.standards.cis).toBe(false);
    expect(result.standards.pciDss).toBe(false);
  });

  it('returns not enabled when Security Hub API throws', async () => {
    securityHubMock.on(GetEnabledStandardsCommand).rejects(
      new Error('Security Hub is not enabled'),
    );

    const result = await checkSecurityHub({ ...testCreds }, 'us-east-1');
    expect(result.enabled).toBe(false);
    expect(result.standards.fsbp).toBe(false);
  });
});

describe('getPrerequisiteStatus', () => {
  it('returns allPassed true when all prerequisites are met', async () => {
    configMock.on(DescribeConfigurationRecordersCommand).resolves({
      ConfigurationRecorders: [{ name: 'default' }],
    });
    configMock.on(DescribeConfigurationRecorderStatusCommand).resolves({
      ConfigurationRecordersStatus: [{ recording: true, name: 'default' }],
    });
    securityHubMock.on(GetEnabledStandardsCommand).resolves({
      StandardsSubscriptions: [
        { StandardsArn: 'arn:aws:securityhub:::standards/aws-foundational-security-best-practices/v/1.0.0', StandardsSubscriptionArn: 's1', StandardsInput: 'i1', StandardsStatus: 'READY' },
        { StandardsArn: 'arn:aws:securityhub:::standards/cis-aws-foundations-benchmark/v/1.4.0', StandardsSubscriptionArn: 's2', StandardsInput: 'i2', StandardsStatus: 'READY' },
        { StandardsArn: 'arn:aws:securityhub:::standards/pci-dss/v/3.2.1', StandardsSubscriptionArn: 's3', StandardsInput: 'i3', StandardsStatus: 'READY' },
      ],
    } as any);

    const result = await getPrerequisiteStatus({ ...testCreds }, 'us-east-1');
    expect(result.allPassed).toBe(true);
    expect(result.configEnabled).toBe(true);
    expect(result.configRecording).toBe(true);
    expect(result.securityHubEnabled).toBe(true);
    expect(result.standards.fsbp).toBe(true);
    expect(result.standards.cis).toBe(true);
    expect(result.standards.pciDss).toBe(true);
  });

  it('returns allPassed false when Config is not recording', async () => {
    configMock.on(DescribeConfigurationRecordersCommand).resolves({
      ConfigurationRecorders: [{ name: 'default' }],
    });
    configMock.on(DescribeConfigurationRecorderStatusCommand).resolves({
      ConfigurationRecordersStatus: [{ recording: false, name: 'default' }],
    });
    securityHubMock.on(GetEnabledStandardsCommand).resolves({
      StandardsSubscriptions: [
        { StandardsArn: 'arn:aws:securityhub:::standards/aws-foundational-security-best-practices/v/1.0.0', StandardsSubscriptionArn: 's1', StandardsInput: 'i1', StandardsStatus: 'READY' },
        { StandardsArn: 'arn:aws:securityhub:::standards/cis-aws-foundations-benchmark/v/1.4.0', StandardsSubscriptionArn: 's2', StandardsInput: 'i2', StandardsStatus: 'READY' },
        { StandardsArn: 'arn:aws:securityhub:::standards/pci-dss/v/3.2.1', StandardsSubscriptionArn: 's3', StandardsInput: 'i3', StandardsStatus: 'READY' },
      ],
    } as any);

    const result = await getPrerequisiteStatus({ ...testCreds }, 'us-east-1');
    expect(result.allPassed).toBe(false);
    expect(result.configEnabled).toBe(true);
    expect(result.configRecording).toBe(false);
  });

  it('returns allPassed false when a Security Hub standard is missing', async () => {
    configMock.on(DescribeConfigurationRecordersCommand).resolves({
      ConfigurationRecorders: [{ name: 'default' }],
    });
    configMock.on(DescribeConfigurationRecorderStatusCommand).resolves({
      ConfigurationRecordersStatus: [{ recording: true, name: 'default' }],
    });
    securityHubMock.on(GetEnabledStandardsCommand).resolves({
      StandardsSubscriptions: [
        { StandardsArn: 'arn:aws:securityhub:::standards/aws-foundational-security-best-practices/v/1.0.0', StandardsSubscriptionArn: 's1', StandardsInput: 'i1', StandardsStatus: 'READY' },
      ],
    } as any);

    const result = await getPrerequisiteStatus({ ...testCreds }, 'us-east-1');
    expect(result.allPassed).toBe(false);
    expect(result.securityHubEnabled).toBe(true);
    expect(result.standards.fsbp).toBe(true);
    expect(result.standards.cis).toBe(false);
    expect(result.standards.pciDss).toBe(false);
  });
});
