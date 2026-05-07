import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamodb';
import { v4 as uuidv4 } from 'uuid';

export const AUDIT_LOG_TABLE = process.env.AUDIT_LOG_TABLE ?? 'wafr-audit-log';

export type AuditEventType =
  | 'credentials_uploaded'
  | 'assessment_started'
  | 'assessment_completed'
  | 'emails_sent'
  | 'emails_failed';

const ACCESS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/g;
const SECRET_KEY_PATTERN = /(?<![a-zA-Z0-9/+=])[A-Za-z0-9/+=]{40,}(?![a-zA-Z0-9/+=])/g;

export function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(details);
  const redacted = json
    .replace(ACCESS_KEY_PATTERN, '[REDACTED_ACCESS_KEY]')
    .replace(SECRET_KEY_PATTERN, '[REDACTED_SECRET_KEY]');
  return JSON.parse(redacted) as Record<string, unknown>;
}

export async function logAuditEvent(
  userId: string,
  eventType: AuditEventType,
  scanId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const sanitized = sanitizeDetails(details);
  const timestamp = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: AUDIT_LOG_TABLE,
      Item: {
        userId,
        timestamp,
        eventType,
        scanId,
        details: sanitized,
        eventId: uuidv4(),
      },
    }),
  );
}
