import axios from 'axios';

jest.mock('axios');
const mockAxios = axios as jest.Mocked<typeof axios>;

const mockGet = jest.fn();
const mockPost = jest.fn();
mockAxios.create.mockReturnValue({ get: mockGet, post: mockPost } as never);

import { createProvider, startScan, getScanStatus, getFindings } from './prowler-client';

beforeEach(() => jest.clearAllMocks());

describe('createProvider', () => {
  it('posts credentials and returns providerId', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'prov-123' } });

    const result = await createProvider(
      { accessKeyId: 'AKIA...', secretAccessKey: 'secret' },
      'us-east-1',
    );

    expect(result.providerId).toBe('prov-123');
    expect(mockPost).toHaveBeenCalledWith('/api/v1/providers', expect.objectContaining({ provider: 'aws' }));
  });
});

describe('startScan', () => {
  it('starts a scan and returns scanId', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'scan-456' } });

    const result = await startScan('prov-123', ['WAFR', 'CIS']);

    expect(result.scanId).toBe('scan-456');
    expect(mockPost).toHaveBeenCalledWith('/api/v1/scans', expect.objectContaining({ providerId: 'prov-123' }));
  });
});

describe('getScanStatus', () => {
  it('returns scan status', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'scan-1', state: 'completed' } });

    const result = await getScanStatus('scan-1');

    expect(result.scanId).toBe('scan-1');
    expect(result.status).toBe('completed');
  });

  it('falls back to status field if state is missing', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'scan-2', status: 'running' } });

    const result = await getScanStatus('scan-2');
    expect(result.status).toBe('running');
  });
});

describe('getFindings', () => {
  it('returns findings from single page', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        results: [
          { checkId: 'check-1', resourceArn: 'arn:1', status: 'FAIL', severity: 'high', description: 'desc', remediation: 'fix', compliance: {}, service: 's3', region: 'us-east-1' },
        ],
        next: null,
      },
    });

    const findings = await getFindings('scan-1');
    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe('check-1');
    expect(findings[0].severity).toBe('high');
  });

  it('paginates through multiple pages', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: {
          results: [{ checkId: 'c1', resourceArn: 'a1', status: 'PASS', severity: 'low', description: '', remediation: '', compliance: {}, service: 'ec2', region: 'us-east-1' }],
          next: '/api/v1/findings?scanId=scan-1&page=2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          results: [{ checkId: 'c2', resourceArn: 'a2', status: 'FAIL', severity: 'critical', description: '', remediation: '', compliance: {}, service: 'iam', region: 'us-east-1' }],
          next: null,
        },
      });

    const findings = await getFindings('scan-1');
    expect(findings).toHaveLength(2);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('handles data field instead of results', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        data: [{ check_id: 'c3', resource_arn: 'a3', status: 'INFO', severity: 'informational', description: 'd', remediationRecommendation: 'r', compliance: {}, service: 'rds', region: 'eu-west-1' }],
        next: null,
      },
    });

    const findings = await getFindings('scan-1');
    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe('c3');
  });
});
