import type { APIGatewayProxyEvent } from 'aws-lambda';

const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'Query' })),
  UpdateCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'Update' })),
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));

const mockGenerateReadyPdf = jest.fn();
const mockGenerateDetailPdf = jest.fn();
jest.mock('../services/pdf-generator', () => ({
  generateReadyPdf: (...args: unknown[]) => mockGenerateReadyPdf(...args),
  generateDetailPdf: (...args: unknown[]) => mockGenerateDetailPdf(...args),
}));

const mockSendReadyReport = jest.fn();
const mockSendDetailReport = jest.fn();
jest.mock('../services/email-sender', () => ({
  sendReadyReport: (...args: unknown[]) => mockSendReadyReport(...args),
  sendDetailReport: (...args: unknown[]) => mockSendDetailReport(...args),
}));

import { handler, sendEmails } from './email-handler';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    resource: '/assessments/{assessmentId}/emails',
    pathParameters: { assessmentId: 'a-1' },
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

const assessment = {
  assessmentId: 'a-1',
  scanId: 'scan-001',
  status: 'completed',
  overallScore: 80,
  pillarResults: [],
  workloadArn: 'arn:wa:1',
};

const scan = {
  scanId: 'scan-001',
  userId: 'user-1',
  partnerName: 'Partner',
  partnerEmail: 'partner@test.com',
  clientName: 'Client',
  awsAccountNumber: '123456789012',
  awsRegion: 'us-east-1',
  createdAt: '2026-05-27T10:00:00Z',
};

beforeEach(() => jest.clearAllMocks());

describe('sendEmails', () => {
  it('returns 400 if assessmentId is missing', async () => {
    const res = await sendEmails(makeEvent({ pathParameters: {} }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 if assessment not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await sendEmails(makeEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).message).toContain('Assessment');
  });

  it('returns 409 if assessment is still running', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ ...assessment, status: 'running' }] });
    const res = await sendEmails(makeEvent());
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 if scan not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [assessment] }); // fetchAssessment
    mockSend.mockResolvedValueOnce({ Items: [] }); // fetchScan
    const res = await sendEmails(makeEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).message).toContain('Scan');
  });

  it('returns 200 and sends emails on success', async () => {
    mockSend.mockResolvedValueOnce({ Items: [assessment] });
    mockSend.mockResolvedValueOnce({ Items: [scan] });
    mockGenerateReadyPdf.mockResolvedValueOnce(Buffer.from('ready'));
    mockGenerateDetailPdf.mockResolvedValueOnce(Buffer.from('detail'));
    mockSendReadyReport.mockResolvedValueOnce({ success: true, messageId: 'msg-1' });
    mockSendDetailReport.mockResolvedValueOnce({ success: true, messageId: 'msg-2' });
    mockSend.mockResolvedValueOnce({}); // updateScanStatus

    const res = await sendEmails(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('emails_sent');
    expect(body.readyEmail.success).toBe(true);
  });

  it('returns 200 with emails_failed when email fails', async () => {
    mockSend.mockResolvedValueOnce({ Items: [assessment] });
    mockSend.mockResolvedValueOnce({ Items: [scan] });
    mockGenerateReadyPdf.mockResolvedValueOnce(Buffer.from('ready'));
    mockGenerateDetailPdf.mockResolvedValueOnce(Buffer.from('detail'));
    mockSendReadyReport.mockResolvedValueOnce({ success: false, error: 'SES error' });
    mockSendDetailReport.mockResolvedValueOnce({ success: true, messageId: 'msg-2' });
    mockSend.mockResolvedValueOnce({}); // updateScanStatus

    const res = await sendEmails(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('emails_failed');
  });

  it('returns 500 on unexpected error', async () => {
    mockSend.mockResolvedValueOnce({ Items: [assessment] });
    mockSend.mockResolvedValueOnce({ Items: [scan] });
    mockGenerateReadyPdf.mockRejectedValueOnce(new Error('PDF crash'));
    mockSend.mockResolvedValueOnce({}); // updateScanStatus

    const res = await sendEmails(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toContain('PDF crash');
  });
});

describe('handler router', () => {
  it('delegates to sendEmails', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
  });
});
