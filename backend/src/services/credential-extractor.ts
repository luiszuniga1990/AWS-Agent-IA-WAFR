import type { AwsCredentials } from '@wafr-portal/shared';

const ACCESS_KEY_PATTERNS = ['access key', 'accesskeyid', 'access_key_id', 'accesskey', 'access key id'];
const SECRET_KEY_PATTERNS = ['secret key', 'secretaccesskey', 'secret_access_key', 'secretkey', 'secret access key'];

/**
 * Parses CSV content into rows of string arrays.
 */
function parseCsv(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

/**
 * Extracts AWS credentials from a base64-encoded CSV file.
 *
 * Supports two formats:
 * 1. AWS IAM format (header + data row):
 *    Access key ID,Secret access key
 *    AKIA...,wJalr...
 *
 * 2. Label-value format (label in col A, value in col B):
 *    Access Key,AKIA...
 *    Secret Key,wJalr...
 */
export function extractCredentials(fileBase64: string, fileName: string): AwsCredentials {
  if (!fileName.toLowerCase().endsWith('.csv')) {
    throw new Error('Invalid file format: only .csv files are accepted');
  }

  const buffer = Buffer.from(fileBase64, 'base64');
  const content = buffer.toString('utf-8');

  if (!content.trim()) {
    throw new Error('CSV file is empty');
  }

  const rows = parseCsv(content);

  // Try AWS IAM format: first row is headers, second row is values
  if (rows.length >= 2) {
    const headers = rows[0].map((h) => h.toLowerCase());
    let accessKeyCol = -1;
    let secretKeyCol = -1;

    for (let i = 0; i < headers.length; i++) {
      if (accessKeyCol === -1 && ACCESS_KEY_PATTERNS.some((p) => headers[i].includes(p))) {
        accessKeyCol = i;
      }
      if (secretKeyCol === -1 && SECRET_KEY_PATTERNS.some((p) => headers[i].includes(p))) {
        secretKeyCol = i;
      }
    }

    if (accessKeyCol !== -1 && secretKeyCol !== -1) {
      const dataRow = rows[1];
      const accessKeyId = dataRow[accessKeyCol]?.trim();
      const secretAccessKey = dataRow[secretKeyCol]?.trim();
      if (accessKeyId && secretAccessKey) {
        return { accessKeyId, secretAccessKey };
      }
    }
  }

  // Fallback: label-value format (label in col A, value in col B)
  let accessKeyId: string | undefined;
  let secretAccessKey: string | undefined;

  for (const row of rows) {
    if (row.length < 2) continue;

    const label = row[0].toLowerCase().trim();
    const value = row[1].trim();

    if (!value) continue;

    if (!accessKeyId && ACCESS_KEY_PATTERNS.some((p) => label.includes(p))) {
      accessKeyId = value;
    }
    if (!secretAccessKey && SECRET_KEY_PATTERNS.some((p) => label.includes(p))) {
      secretAccessKey = value;
    }

    if (accessKeyId && secretAccessKey) break;
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Could not find AWS credentials in the CSV file. ' +
        'Expected rows with "Access Key" / "Secret Key" labels in column A and values in column B.',
    );
  }

  return { accessKeyId, secretAccessKey };
}
