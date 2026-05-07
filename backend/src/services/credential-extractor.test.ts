import * as XLSX from 'xlsx';
import { extractCredentials } from './credential-extractor';

/** Helper: creates a base64-encoded .xlsx buffer from rows */
function makeExcelBase64(rows: unknown[][]): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Credentials');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return buf.toString('base64');
}

describe('extractCredentials', () => {
  describe('file format validation', () => {
    it('rejects .csv files', () => {
      expect(() => extractCredentials('', 'creds.csv')).toThrow('only .xlsx files are accepted');
    });

    it('rejects .xls files', () => {
      expect(() => extractCredentials('', 'creds.xls')).toThrow('only .xlsx files are accepted');
    });

    it('rejects .txt files', () => {
      expect(() => extractCredentials('', 'data.txt')).toThrow('only .xlsx files are accepted');
    });

    it('rejects files with no extension', () => {
      expect(() => extractCredentials('', 'credentials')).toThrow('only .xlsx files are accepted');
    });

    it('accepts .xlsx (case-insensitive)', () => {
      const base64 = makeExcelBase64([
        ['Access Key', 'AKIAIOSFODNN7EXAMPLE'],
        ['Secret Key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
      ]);
      const result = extractCredentials(base64, 'Creds.XLSX');
      expect(result.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
    });
  });

  describe('credential extraction from valid Excel', () => {
    it('extracts credentials with "Access Key" / "Secret Key" labels', () => {
      const base64 = makeExcelBase64([
        ['Access Key', 'AKIAIOSFODNN7EXAMPLE'],
        ['Secret Key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
      ]);
      const result = extractCredentials(base64, 'creds.xlsx');
      expect(result.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });

    it('extracts credentials with "AccessKeyId" / "SecretAccessKey" labels', () => {
      const base64 = makeExcelBase64([
        ['AccessKeyId', 'AKIAI44QH8DHBEXAMPLE'],
        ['SecretAccessKey', 'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY'],
      ]);
      const result = extractCredentials(base64, 'keys.xlsx');
      expect(result.accessKeyId).toBe('AKIAI44QH8DHBEXAMPLE');
      expect(result.secretAccessKey).toBe('je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY');
    });

    it('handles extra rows around the credential rows', () => {
      const base64 = makeExcelBase64([
        ['Title', 'AWS Credentials'],
        [''],
        ['Access Key', 'AKIAIOSFODNN7EXAMPLE'],
        ['Secret Key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
        ['Notes', 'Do not share'],
      ]);
      const result = extractCredentials(base64, 'creds.xlsx');
      expect(result.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });
  });

  describe('error when credentials not found', () => {
    it('throws when Excel has no credential rows', () => {
      const base64 = makeExcelBase64([
        ['Name', 'John'],
        ['Email', 'john@example.com'],
      ]);
      expect(() => extractCredentials(base64, 'data.xlsx')).toThrow(
        'Could not find AWS credentials',
      );
    });

    it('throws when only access key is present', () => {
      const base64 = makeExcelBase64([['Access Key', 'AKIAIOSFODNN7EXAMPLE']]);
      expect(() => extractCredentials(base64, 'partial.xlsx')).toThrow(
        'Could not find AWS credentials',
      );
    });

    it('throws when Excel file is empty (no sheets)', () => {
      // An empty buffer that xlsx can't interpret as a valid workbook
      const emptyBase64 = Buffer.from([]).toString('base64');
      expect(() => extractCredentials(emptyBase64, 'empty.xlsx')).toThrow();
    });
  });
});
