import { validateEmail, validateRegion, validateScanForm } from './validators';

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('a.b@domain.co')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(validateEmail('')).toBe(false);
    expect(validateEmail('noatsign')).toBe(false);
    expect(validateEmail('missing@domain')).toBe(false);
    expect(validateEmail('@nodomain.com')).toBe(false);
  });
});

describe('validateRegion', () => {
  it('accepts valid AWS regions', () => {
    expect(validateRegion('us-east-1')).toBe(true);
    expect(validateRegion('eu-west-1')).toBe(true);
    expect(validateRegion('sa-east-1')).toBe(true);
  });

  it('rejects invalid regions', () => {
    expect(validateRegion('')).toBe(false);
    expect(validateRegion('us-invalid-1')).toBe(false);
    expect(validateRegion('mars-west-1')).toBe(false);
  });
});

describe('validateScanForm', () => {
  const validForm = {
    partnerName: 'Acme Corp',
    partnerEmail: 'partner@acme.com',
    country: 'US',
    clientName: 'Client Inc',
    awsAccountNumber: '123456789012',
    awsRegion: 'us-east-1',
  };

  it('returns null for valid form data', () => {
    expect(validateScanForm(validForm)).toBeNull();
  });

  it('returns error when data is undefined', () => {
    const result = validateScanForm(undefined);
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(400);
  });

  it('returns field errors for empty fields', () => {
    const result = validateScanForm({
      partnerName: '',
      partnerEmail: '',
      country: '',
      clientName: '',
      awsAccountNumber: '',
      awsRegion: '',
    });
    expect(result).not.toBeNull();
    expect(result!.fieldErrors).toBeDefined();
    expect(Object.keys(result!.fieldErrors!).length).toBeGreaterThanOrEqual(6);
  });

  it('returns email format error for invalid email', () => {
    const result = validateScanForm({ ...validForm, partnerEmail: 'bad-email' });
    expect(result).not.toBeNull();
    expect(result!.fieldErrors!.partnerEmail).toBe('Invalid email format');
  });

  it('returns region error for invalid region', () => {
    const result = validateScanForm({ ...validForm, awsRegion: 'invalid-region' });
    expect(result).not.toBeNull();
    expect(result!.fieldErrors!.awsRegion).toBe('Invalid AWS region');
  });

  it('returns multiple field errors at once', () => {
    const result = validateScanForm({
      partnerName: '',
      partnerEmail: 'bad',
      country: 'US',
      clientName: 'Client',
      awsAccountNumber: '123',
      awsRegion: 'invalid',
    });
    expect(result).not.toBeNull();
    expect(result!.fieldErrors!.partnerName).toBeDefined();
    expect(result!.fieldErrors!.partnerEmail).toBeDefined();
    expect(result!.fieldErrors!.awsRegion).toBeDefined();
  });
});
