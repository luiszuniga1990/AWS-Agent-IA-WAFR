import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createScan, getScanHistory, getScan } from './form-handler';
import type { APIGatewayProxyEvent } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
    requestContext: {
      authorizer: {
        claims: { sub: 'user-123' },
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

const validFormBody = JSON.stringify({
  formData: {
    partnerName: 'Acme Corp',
    partnerEmail: 'partner@acme.com',
    country: 'US',
    clientName: 'Client Inc',
    awsAccountNumber: '123456789012',
    awsRegion: 'us-east-1',
  },
});

beforeEach(() => {
  ddbMock.reset();
});

describe('createScan', () => {
  it('returns 401 when no userId in JWT', async () => {
    const event = makeEvent({
      body: validFormBody,
      requestContext: { authorizer: {} } as unknown as APIGatewayProxyEvent['requestContext'],
    });
    const res = await createScan(event);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = makeEvent({ body: 'not-json' });
    const res = await createScan(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Invalid JSON body');
  });

  it('returns 400 for missing form fields', async () => {
    const event = makeEvent({ body: JSON.stringify({ formData: {} }) });
    const res = await createScan(event);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.fieldErrors).toBeDefined();
  });

  it('returns 400 for invalid email', async () => {
    const event = makeEvent({
      body: JSON.stringify({
        formData: {
          partnerName: 'A',
          partnerEmail: 'bad',
          country: 'US',
          clientName: 'C',
          awsAccountNumber: '123',
          awsRegion: 'us-east-1',
        },
      }),
    });
    const res = await createScan(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).fieldErrors.partnerEmail).toBe('Invalid email format');
  });

  it('creates scan and returns scanId on valid input', async () => {
    ddbMock.on(PutCommand).resolves({});
    const event = makeEvent({ body: validFormBody, httpMethod: 'POST' });
    const res = await createScan(event);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.scanId).toBeDefined();
    expect(typeof body.scanId).toBe('string');

    // Verify DynamoDB was called with correct item
    const putCalls = ddbMock.commandCalls(PutCommand);
    expect(putCalls).toHaveLength(1);
    const item = putCalls[0].args[0].input.Item;
    expect(item?.userId).toBe('user-123');
    expect(item?.status).toBe('form_submitted');
    expect(item?.partnerName).toBe('Acme Corp');
  });
});

describe('getScanHistory', () => {
  it('returns 401 when no userId', async () => {
    const event = makeEvent({
      requestContext: { authorizer: {} } as unknown as APIGatewayProxyEvent['requestContext'],
    });
    const res = await getScanHistory(event);
    expect(res.statusCode).toBe(401);
  });

  it('returns scans for the user', async () => {
    const scans = [
      { scanId: 's1', userId: 'user-123', clientName: 'Client A' },
      { scanId: 's2', userId: 'user-123', clientName: 'Client B' },
    ];
    ddbMock.on(QueryCommand).resolves({ Items: scans });

    const event = makeEvent();
    const res = await getScanHistory(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.scans).toHaveLength(2);
  });

  it('returns empty array when no scans', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const event = makeEvent();
    const res = await getScanHistory(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).scans).toEqual([]);
  });
});

describe('getScan', () => {
  it('returns 400 when scanId is missing', async () => {
    const event = makeEvent({ pathParameters: null });
    const res = await getScan(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when scan not found', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const event = makeEvent({ pathParameters: { scanId: 'nonexistent' } });
    const res = await getScan(event);
    expect(res.statusCode).toBe(404);
  });

  it('returns scan when found via GSI', async () => {
    const scan = { scanId: 'scan-1', userId: 'user-123', clientName: 'Client' };
    ddbMock.on(QueryCommand).resolves({ Items: [scan] });

    const event = makeEvent({ pathParameters: { scanId: 'scan-1' } });
    const res = await getScan(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).scanId).toBe('scan-1');

    // Verify GSI was used
    const queryCalls = ddbMock.commandCalls(QueryCommand);
    expect(queryCalls[0].args[0].input.IndexName).toBe('scanId-index');
  });
});
