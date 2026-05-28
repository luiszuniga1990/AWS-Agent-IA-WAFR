import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'Query' })),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));

const mockGetPrerequisiteStatus = jest.fn();
jest.mock('../services/prerequisite-checker', () => ({
  getPrerequisiteStatus: (...args: unknown[]) => mockGetPrerequisiteStatus(...args),
}));

import { handler } from './prerequisite-handler';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/scans/{scanId}/prerequisites',
    pathParameters: { scanId: 'scan-001' },
    body: JSON.stringify({ accessKeyId: 'AKIA123', secretAccessKey: 'secret123' }),
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

beforeEach(() => jest.clearAllMocks());

describe('prerequisite-handler', () => {
  it('returns 400 if scanId is missing', async () => {
    const res = await handler(makeEvent({ pathParameters: {} }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 if scan not found in DB', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 if credentials missing from body', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ scanId: 'scan-001', userId: 'u1', awsRegion: 'us-east-1' }],
    });
    const res = await handler(makeEvent({ body: JSON.stringify({}) }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toContain('accessKeyId');
  });

  it('returns 400 for invalid JSON body', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ scanId: 'scan-001', userId: 'u1', awsRegion: 'us-east-1' }],
    });
    const res = await handler(makeEvent({ body: 'not-json' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with prerequisite status on success', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ scanId: 'scan-001', userId: 'u1', awsRegion: 'us-east-1' }],
    });
    mockGetPrerequisiteStatus.mockResolvedValueOnce({
      configEnabled: true,
      securityHubEnabled: true,
      allPassed: true,
      checks: [],
    });

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.prerequisiteResult.allPassed).toBe(true);
  });

  it('returns 500 on service error', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ scanId: 'scan-001', userId: 'u1', awsRegion: 'us-east-1' }],
    });
    mockGetPrerequisiteStatus.mockRejectedValueOnce(new Error('Config API down'));

    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toContain('Config API down');
  });
});
