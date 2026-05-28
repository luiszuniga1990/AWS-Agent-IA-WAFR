import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'Query' })),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));

const mockGenerateReadyPdf = jest.fn();
const mockGenerateDetailPdf = jest.fn();
jest.mock('../services/pdf-generator', () => ({
  generateReadyPdf: (...args: unknown[]) => mockGenerateReadyPdf(...args),
  generateDetailPdf: (...args: unknown[]) => mockGenerateDetailPdf(...args),
}));

import { handler, generatePdf } from './pdf-handler';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/assessments/{assessmentId}/pdf/{type}',
    pathParameters: { assessmentId: 'a-1', type: 'ready' },
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

const assessment = { assessmentId: 'a-1', scanId: 'scan-001', status: 'completed', overallScore: 75, pillarResults: [], workloadArn: 'arn:1' };
const scan = { scanId: 'scan-001', userId: 'u1', partnerName: 'P', clientName: 'C', awsAccountNumber: '123', awsRegion: 'us-east-1', createdAt: '2026-01-01T00:00:00Z' };

beforeEach(() => jest.clearAllMocks());

describe('generatePdf', () => {
  it('returns 400 if assessmentId missing', async () => {
    const res = await generatePdf(makeEvent({ pathParameters: { type: 'ready' } }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 if type is invalid', async () => {
    const res = await generatePdf(makeEvent({ pathParameters: { assessmentId: 'a-1', type: 'invalid' } }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toContain('ready');
  });

  it('returns 404 if assessment not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await generatePdf(makeEvent());
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 if assessment still running', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ ...assessment, status: 'running' }] });
    const res = await generatePdf(makeEvent());
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 if scan not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [assessment] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await generatePdf(makeEvent());
    expect(res.statusCode).toBe(404);
  });

  it('returns base64 PDF for ready type', async () => {
    mockSend.mockResolvedValueOnce({ Items: [assessment] });
    mockSend.mockResolvedValueOnce({ Items: [scan] });
    mockGenerateReadyPdf.mockResolvedValueOnce(Buffer.from('pdf-content'));

    const res = await generatePdf(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(res.headers!['Content-Type']).toBe('application/pdf');
  });

  it('returns base64 PDF for detail type', async () => {
    mockSend.mockResolvedValueOnce({ Items: [assessment] });
    mockSend.mockResolvedValueOnce({ Items: [scan] });
    mockGenerateDetailPdf.mockResolvedValueOnce(Buffer.from('detail-pdf'));

    const res = await generatePdf(makeEvent({ pathParameters: { assessmentId: 'a-1', type: 'detail' } }));
    expect(res.statusCode).toBe(200);
    expect(mockGenerateDetailPdf).toHaveBeenCalled();
  });

  it('returns 500 on PDF generation error', async () => {
    mockSend.mockResolvedValueOnce({ Items: [assessment] });
    mockSend.mockResolvedValueOnce({ Items: [scan] });
    mockGenerateReadyPdf.mockRejectedValueOnce(new Error('PDF lib error'));

    const res = await generatePdf(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toContain('PDF lib error');
  });
});

describe('handler', () => {
  it('delegates to generatePdf', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
  });
});
