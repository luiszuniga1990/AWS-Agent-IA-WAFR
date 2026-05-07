import { logAuditEvent, sanitizeDetails, AUDIT_LOG_TABLE } from './audit-logger';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('sanitizeDetails', () => {
  it('redacts AWS access keys (AKIA pattern)', () => {
    const details = { key: 'AKIAIOSFODNN7EXAMPLE', other: 'safe' };
    const result = sanitizeDetails(details);
    expect(result.key).toBe('[REDACTED_ACCESS_KEY]');
    expect(result.other).toBe('safe');
  });

  it('redacts secret keys (40+ char alphanumeric strings)', () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const details = { secretKey: secret, name: 'test' };
    const result = sanitizeDetails(details);
    expect(result.secretKey).toBe('[REDACTED_SECRET_KEY]');
    expect(result.name).toBe('test');
  });

  it('does not alter normal text', () => {
    const details = {
      message: 'Assessment started for client Acme Corp',
      region: 'us-east-1',
      count: 42,
    };
    const result = sanitizeDetails(details);
    expect(result.message).toBe('Assessment started for client Acme Corp');
    expect(result.region).toBe('us-east-1');
    expect(result.count).toBe(42);
  });

  it('redacts access keys embedded in longer strings', () => {
    const details = { log: 'User used key AKIAIOSFODNN7EXAMPLE to connect' };
    const result = sanitizeDetails(details);
    expect(result.log).toBe('User used key [REDACTED_ACCESS_KEY] to connect');
  });
});

describe('logAuditEvent', () => {
  it('writes an audit event to DynamoDB', async () => {
    ddbMock.on(PutCommand).resolves({});

    await logAuditEvent('user-1', 'assessment_started', 'scan-123', {
      region: 'us-east-1',
    });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);

    const item = calls[0].args[0].input.Item!;
    expect(item.userId).toBe('user-1');
    expect(item.eventType).toBe('assessment_started');
    expect(item.scanId).toBe('scan-123');
    expect(item.details).toEqual({ region: 'us-east-1' });
    expect(item.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(item.eventId).toBeDefined();
    expect(calls[0].args[0].input.TableName).toBe(AUDIT_LOG_TABLE);
  });

  it('sanitizes credentials before writing to DynamoDB', async () => {
    ddbMock.on(PutCommand).resolves({});

    await logAuditEvent('user-1', 'credentials_uploaded', 'scan-456', {
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      clientName: 'Acme Corp',
    });

    const calls = ddbMock.commandCalls(PutCommand);
    const item = calls[0].args[0].input.Item!;
    const details = item.details as Record<string, unknown>;
    expect(details.accessKey).toBe('[REDACTED_ACCESS_KEY]');
    expect(details.secretKey).toBe('[REDACTED_SECRET_KEY]');
    expect(details.clientName).toBe('Acme Corp');
  });
});
