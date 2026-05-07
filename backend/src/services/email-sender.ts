import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import type { SendResult } from '@wafr-portal/shared';

const ses = new SESClient({});

const FROM_EMAIL = process.env.SES_FROM_EMAIL ?? process.env.FROM_EMAIL ?? 'noreply@wafr-portal.example.com';
const DETAIL_RECIPIENT = process.env.TECHNICAL_TEAM_EMAIL ?? process.env.DETAIL_RECIPIENT ?? 'luis.zuniga@tdsynnex.com';

const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 30_000;

/** Build email subject in the required format. */
export function buildSubject(clientName: string, date: string): string {
  return `[WAFR] ${clientName} - ${date}`;
}

/** Sleep helper for retry intervals. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a raw MIME message with a PDF attachment.
 */
function buildRawEmail(
  from: string,
  to: string,
  subject: string,
  pdfBuffer: Buffer,
  pdfFilename: string,
): Buffer {
  const boundary = `----=_Part_${Date.now()}`;
  const base64Pdf = pdfBuffer.toString('base64');

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    `Please find the attached WAFR report.`,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${pdfFilename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${pdfFilename}"`,
    '',
    base64Pdf,
    '',
    `--${boundary}--`,
  ];

  return Buffer.from(lines.join('\r\n'));
}


/**
 * Send a raw email with retry logic (up to 3 attempts, 30s intervals).
 */
async function sendWithRetry(
  from: string,
  to: string,
  subject: string,
  pdfBuffer: Buffer,
  pdfFilename: string,
): Promise<SendResult> {
  const rawMessage = buildRawEmail(from, to, subject, pdfBuffer, pdfFilename);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await ses.send(
        new SendRawEmailCommand({
          RawMessage: { Data: rawMessage },
        }),
      );
      return { success: true, messageId: result.MessageId };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_INTERVAL_MS);
      } else {
        const message = error instanceof Error ? error.message : 'Unknown SES error';
        return { success: false, error: `Failed after ${MAX_RETRIES} attempts: ${message}` };
      }
    }
  }

  // Unreachable, but satisfies TypeScript
  return { success: false, error: 'Unexpected retry loop exit' };
}

/**
 * Send the WAFR Ready PDF to the VDM user who initiated the scan.
 */
export async function sendReadyReport(
  recipientEmail: string,
  pdfBuffer: Buffer,
  clientName: string,
  date: string,
): Promise<SendResult> {
  const subject = buildSubject(clientName, date);
  return sendWithRetry(FROM_EMAIL, recipientEmail, subject, pdfBuffer, `wafr-ready-${clientName}.pdf`);
}

/**
 * Send the WAFR Detail PDF to the fixed technical team email.
 */
export async function sendDetailReport(
  pdfBuffer: Buffer,
  clientName: string,
  date: string,
): Promise<SendResult> {
  const subject = buildSubject(clientName, date);
  return sendWithRetry(FROM_EMAIL, DETAIL_RECIPIENT, subject, pdfBuffer, `wafr-detail-${clientName}.pdf`);
}
