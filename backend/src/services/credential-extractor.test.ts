import { extractCredentials } from './credential-extractor';

/** Helper: creates a base64-encoded CSV from rows */
function makeCsvBase64(rows: string[][]): string {
  const csv = rows.map((r) => r.join(',')).join('\n');
  return Buffer.from(csv, 'utf-8').toString('base64');
}

describe('extractCredentials', () => {
  describe('file format validation', () => {
    it('rejects .xlsx files', () => {
      expect(() => extractCredentials('', 'creds.xlsx')).toThrow('only .csv files are accepted');
    });

    it('rejects .xls files', () => {
      expect(() => extractCredentials('', 'creds.xls')).toThrow('only .csv files are accepted');
    });

    it('rejects .txt files', () => {
      expect(() => extractCredentials('', 'data.txt')).toThrow('only .csv files are accepted');
    });

    it('rejects files with no extension', () => {
      expect(() => extractCredentials('', 'credentials')).toThrow('only .csv files are accepted');
    });

    it('accepts .csv (case-insensitive)', () => {
      const base64 = makeCsvBase64([
        ['Access Key', 'AKIAIOSFODNN7EXAMPLE'],
        ['Secret Key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
      ]);
      const result = extractCredentials(base64, 'Creds.CSV');
      expect(result.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
    });
  });

  describe('credential extraction from valid CSV', () => {
    it('extracts credentials in AWS IAM format (header + data row)', () => {
      const base64 = makeCsvBase64([
        ['Access key ID', 'Secret access key'],
        ['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
      ]);
      const result = extractCredentials(base64, 'creds.csv');
      expect(result.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });

    it('extracts credentials with "Access Key" / "Secret Key" labels', () => {
      const base64 = makeCsvBase64([
        ['Access Key', 'AKIAIOSFODNN7EXAMPLE'],
        ['Secret Key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
      ]);
      const result = extractCredentials(base64, 'creds.csv');
      expect(result.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });

    it('extracts credentials with "AccessKeyId" / "SecretAccessKey" labels', () => {
      const base64 = makeCsvBase64([
        ['AccessKeyId', 'AKIAI44QH8DHBEXAMPLE'],
        ['SecretAccessKey', 'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY'],
      ]);
      const result = extractCredentials(base64, 'keys.csv');
      expect(result.accessKeyId).toBe('AKIAI44QH8DHBEXAMPLE');
      expect(result.secretAccessKey).toBe('je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY');
    });

    it('handles extra rows around the credential rows', () => {
      const base64 = makeCsvBase64([
        ['Title', 'AWS Credentials'],
        [''],
        ['Access Key', 'AKIAIOSFODNN7EXAMPLE'],
        ['Secret Key', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
        ['Notes', 'Do not share'],
      ]);
      const result = extractCredentials(base64, 'creds.csv');
      expect(result.accessKeyId).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });
  });

  describe('error when credentials not found', () => {
    it('throws when CSV has no credential rows', () => {
      const base64 = makeCsvBase64([
        ['Name', 'John'],
        ['Email', 'john@example.com'],
      ]);
      expect(() => extractCredentials(base64, 'data.csv')).toThrow(
        'Could not find AWS credentials',
      );
    });

    it('throws when only access key is present', () => {
      const base64 = makeCsvBase64([['Access Key', 'AKIAIOSFODNN7EXAMPLE']]);
      expect(() => extractCredentials(base64, 'partial.csv')).toThrow(
        'Could not find AWS credentials',
      );
    });

    it('throws when CSV file is empty', () => {
      const emptyBase64 = Buffer.from('').toString('base64');
      expect(() => extractCredentials(emptyBase64, 'empty.csv')).toThrow('CSV file is empty');
    });
  });
});
