import { uploadCredentials, getIamPolicy } from './credential-handler';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const ddbMock = mockClient(DynamoDBDocumentClient);
const stsMock = mockClient(STSClient);

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/scans/scan-123/credentials',
    pathParameters: { scanId: 'scan-123' },
    body: null,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {
      authorizer: { claims: { sub: 'user-1' } },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    resource: '',
    ...overrides,
  };
}

beforeEach(() => {
  ddbMock.reset();
  stsMock.reset();
});

describe('uploadCredentials', () => {
  it('returns 400 when scanId is missing', async () => {
    const event = makeEvent({ pathParameters: {} });
    const result = await uploadCredentials(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when body is missing fileBase64', async () => {
    const event = makeEvent({ body: JSON.stringify({ fileName: 'creds.xlsx' }) });
    ddbMock.on(QueryCommand).resolves({ Items: [{ scanId: 'scan-123', userId: 'user-1', awsRegion: 'us-east-1' }] });

    const result = await uploadCredentials(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when scan is not found', async () => {
    const event = makeEvent({
      body: JSON.stringify({ fileBase64: 'abc', fileName: 'creds.xlsx' }),
    });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await uploadCredentials(event);
    expect(result.statusCode).toBe(404);
  });

  it('returns 400 when file format is invalid', async () => {
    const event = makeEvent({
      body: JSON.stringify({ fileBase64: 'abc', fileName: 'creds.csv' }),
    });
    ddbMock.on(QueryCommand).resolves({ Items: [{ scanId: 'scan-123', userId: 'user-1', awsRegion: 'us-east-1' }] });

    const result = await uploadCredentials(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('.xlsx');
  });
});

describe('getIamPolicy', () => {
  it('returns 400 when scanId is missing', async () => {
    const event = makeEvent({ pathParameters: {}, httpMethod: 'GET' });
    const result = await getIamPolicy(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns a valid IAM policy JSON with Content-Disposition header', async () => {
    const event = makeEvent({ httpMethod: 'GET' });
    const result = await getIamPolicy(event);
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Disposition']).toContain('attachment');

    const policy = JSON.parse(result.body);
    expect(policy.Version).toBe('2012-10-17');
    expect(policy.Statement).toHaveLength(1);
    expect(policy.Statement[0].Action).toContain('wellarchitected:CreateWorkload');
  });
});
