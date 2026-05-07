import * as XLSX from 'xlsx';
import type { AwsCredentials } from '@wafr-portal/shared';

const ACCESS_KEY_PATTERNS = ['access key', 'accesskeyid', 'access_key_id', 'accesskey'];
const SECRET_KEY_PATTERNS = ['secret key', 'secretaccesskey', 'secret_access_key', 'secretkey'];

/**
 * Extracts AWS credentials from a base64-encoded Excel file.
 * Looks for Access Key / Secret Key patterns in cell values,
 * or falls back to a row-based layout (key in column A, value in column B).
 */
export function extractCredentials(fileBase64: string, fileName: string): AwsCredentials {
  if (!fileName.toLowerCase().endsWith('.xlsx')) {
    throw new Error('Invalid file format: only .xlsx files are accepted');
  }

  const buffer = Buffer.from(fileBase64, 'base64');
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new Error('Failed to parse Excel file: the file may be corrupted or not a valid .xlsx');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel file contains no sheets');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  let accessKeyId: string | undefined;
  let secretAccessKey: string | undefined;

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;

    const label = String(row[0] ?? '').toLowerCase().trim();
    const value = String(row[1] ?? '').trim();

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
      'Could not find AWS credentials in the Excel file. ' +
        'Expected rows with "Access Key" / "Secret Key" labels in column A and values in column B.',
    );
  }

  return { accessKeyId, secretAccessKey };
}
