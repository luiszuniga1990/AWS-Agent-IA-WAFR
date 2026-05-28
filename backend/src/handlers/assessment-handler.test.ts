import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'Put' })),
  QueryCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'Query' })),
  UpdateCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'Update' })),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));
jest.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

const mockCreateProvider = jest.fn();
const mockStartScan = jest.fn();
const mockGetScanStatus = jest.fn();
const mockGetFindings = jest.fn();
jest.mock('../services/prowler-client', () => ({
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
  startScan: (...args: unknown[]) => mockStartScan(...args),
  getScanStatus: (...args: unknown[]) => mockGetScanStatus(...args),
  getFindings: (...args: unknown[]) => mockGetFindings(...args),
}));

const mockCreateWorkload = jest.fn();
const mockAssociateLenses = jest.fn();
jest.mock('../services/wa-tool-client', () => ({
  createWorkload: (...args: unknown[]) => mockCreateWorkload(...args),
  associateLenses: (...args: unknown[]) => mockAssociateLenses(...args),
}));

const mockMapFindingsToPillars = jest.fn();
const mockCalculateOverallScore = jest.fn();
jest.mock('../services/pillar-mapper', () => ({
  mapFindingsToPillars: (...args: unknown[]) => mockMapFindingsToPillars(...args),
  calculateOverallScore: (...args: unknown[]) => mockCalculateOverallScore(...args),
}));

import { handler, startAssessment, getAssessmentStatus, getProwlerLink } from './assessment-handler';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    resource: '/scans/{scanId}/assessment',
    pathParameters: { scanId: 'scan-001' },
    body: null,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as never,
    ...overrides,
  } as APIGatewayProxyEvent;
}

const scanRecord = {
  scanId: 'scan-001',
  userId: 'user-1',
  clientName: 'TestClient',
  awsAccountNumber: '123456789012',
  awsRegion: 'us-east-1',
  prowlerScanId: 'prowler-scan-1',
  prowlerUiLink: 'https://prowler.local/scans/prowler-scan-1',
};

beforeEach(() => jest.clearAllMocks());

describe('startAssessment', () => {
  it('returns 400 if scanId is missing', async () => {
    const event = makeEvent({ pathParameters: {} });
    const res = await startAssessment(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toContain('scanId');
  });

  it('returns 404 if scan not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await startAssessment(makeEvent());
    expect(res.statusCode).toBe(404);
  });

  it('returns 201 on successful assessment start', async () => {
    mockSend.mockResolvedValueOnce({ Items: [scanRecord] }); // fetchScan
    mockCreateWorkload.mockResolvedValueOnce({ workloadArn: 'arn:wa:1', workloadId: 'wl-1' });
    mockAssociateLenses.mockResolvedValueOnce(undefined);
    mockCreateProvider.mockResolvedValueOnce({ providerId: 'prov-1' });
    mockStartScan.mockResolvedValueOnce({ scanId: 'prowler-scan-1' });
    mockSend.mockResolvedValueOnce({}); // updateScanWithProwlerInfo
    mockSend.mockResolvedValueOnce({}); // PutCommand assessment

    const res = await startAssessment(makeEvent());
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).assessmentId).toBe('test-uuid-1234');
  });

  it('returns 500 on prowler error', async () => {
    mockSend.mockResolvedValueOnce({ Items: [scanRecord] });
    mockCreateWorkload.mockRejectedValueOnce(new Error('WA Tool down'));

    const res = await startAssessment(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toContain('WA Tool down');
  });
});

describe('getAssessmentStatus', () => {
  it('returns 400 if assessmentId is missing', async () => {
    const event = makeEvent({
      httpMethod: 'GET',
      resource: '/assessments/{assessmentId}/status',
      pathParameters: {},
    });
    const res = await getAssessmentStatus(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 if assessment not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const event = makeEvent({
      httpMethod: 'GET',
      resource: '/assessments/{assessmentId}/status',
      pathParameters: { assessmentId: 'a-1' },
    });
    const res = await getAssessmentStatus(event);
    expect(res.statusCode).toBe(404);
  });

  it('returns cached result for completed assessment', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ assessmentId: 'a-1', scanId: 'scan-001', status: 'completed', overallScore: 85, pillarResults: [], workloadArn: 'arn:1' }],
    });
    const event = makeEvent({
      httpMethod: 'GET',
      resource: '/assessments/{assessmentId}/status',
      pathParameters: { assessmentId: 'a-1' },
    });
    const res = await getAssessmentStatus(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('completed');
    expect(JSON.parse(res.body).overallScore).toBe(85);
  });
});

describe('getProwlerLink', () => {
  it('returns 400 if scanId missing', async () => {
    const event = makeEvent({ httpMethod: 'GET', resource: '/scans/{scanId}/prowler-link', pathParameters: {} });
    const res = await getProwlerLink(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 if scan not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const event = makeEvent({ httpMethod: 'GET', resource: '/scans/{scanId}/prowler-link', pathParameters: { scanId: 'x' } });
    const res = await getProwlerLink(event);
    expect(res.statusCode).toBe(404);
  });

  it('returns prowlerUiLink when available', async () => {
    mockSend.mockResolvedValueOnce({ Items: [scanRecord] });
    const event = makeEvent({ httpMethod: 'GET', resource: '/scans/{scanId}/prowler-link', pathParameters: { scanId: 'scan-001' } });
    const res = await getProwlerLink(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).prowlerUiLink).toContain('prowler');
  });
});

describe('handler router', () => {
  it('routes POST /assessment to startAssessment', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const event = makeEvent({ httpMethod: 'POST', resource: '/scans/{scanId}/assessment' });
    const res = await handler(event);
    expect(res.statusCode).toBe(404); // scan not found
  });

  it('routes GET /status to getAssessmentStatus', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const event = makeEvent({ httpMethod: 'GET', resource: '/assessments/{assessmentId}/status', pathParameters: { assessmentId: 'a-1' } });
    const res = await handler(event);
    expect(res.statusCode).toBe(404);
  });

  it('returns 405 for unknown routes', async () => {
    const event = makeEvent({ httpMethod: 'DELETE', resource: '/unknown' });
    const res = await handler(event);
    expect(res.statusCode).toBe(405);
  });
});
