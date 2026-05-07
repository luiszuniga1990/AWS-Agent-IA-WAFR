import { validateEmail, validateRegion, validateScanForm } from './validators';
import { VALID_AWS_REGIONS } from './aws-regions';
import { validateXlsxFile } from './validators';

describe('validateEmail', () => {
  it('accepts valid email addresses', () => {
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('a@b.co')).toBe(true);
    expect(validateEmail('name+tag@domain.org')).toBe(true);
  });

  it('rejects invalid email addresses', () => {
    expect(validateEmail('')).toBe(false);
    expect(validateEmail('noatsign')).toBe(false);
    expect(validateEmail('missing@domain')).toBe(false);
    expect(validateEmail('@nodomain.com')).toBe(false);
    expect(validateEmail('has space@domain.com')).toBe(false);
  });
});

describe('validateRegion', () => {
  it('accepts all valid AWS regions', () => {
    for (const region of VALID_AWS_REGIONS) {
      expect(validateRegion(region)).toBe(true);
    }
  });

  it('rejects invalid regions', () => {
    expect(validateRegion('')).toBe(false);
    expect(validateRegion('us-east-99')).toBe(false);
    expect(validateRegion('invalid-region')).toBe(false);
  });
});

describe('validateScanForm', () => {
  const validForm = {
    partnerName: 'Acme Corp',
    partnerEmail: 'partner@acme.com',
    country: 'Colombia',
    clientName: 'Client Inc',
    awsAccountNumber: '123456789012',
    awsRegion: 'us-east-1',
  };

  it('returns null for a fully valid form', () => {
    expect(validateScanForm(validForm)).toBeNull();
  });

  it('returns error for empty partnerName', () => {
    const errors = validateScanForm({ ...validForm, partnerName: '' });
    expect(errors).not.toBeNull();
    expect(errors!.partnerName).toBe('El nombre del partner es obligatorio');
  });

  it('returns error for empty partnerEmail', () => {
    const errors = validateScanForm({ ...validForm, partnerEmail: '' });
    expect(errors).not.toBeNull();
    expect(errors!.partnerEmail).toBe('El correo del partner es obligatorio');
  });

  it('returns error for invalid email format', () => {
    const errors = validateScanForm({ ...validForm, partnerEmail: 'bad-email' });
    expect(errors).not.toBeNull();
    expect(errors!.partnerEmail).toBe(
      'El formato del correo electrónico es incorrecto',
    );
  });

  it('returns error for empty country', () => {
    const errors = validateScanForm({ ...validForm, country: '' });
    expect(errors).not.toBeNull();
    expect(errors!.country).toBe('El país es obligatorio');
  });

  it('returns error for empty clientName', () => {
    const errors = validateScanForm({ ...validForm, clientName: '' });
    expect(errors).not.toBeNull();
    expect(errors!.clientName).toBe('El nombre del cliente es obligatorio');
  });

  it('returns error for empty awsAccountNumber', () => {
    const errors = validateScanForm({ ...validForm, awsAccountNumber: '' });
    expect(errors).not.toBeNull();
    expect(errors!.awsAccountNumber).toBe(
      'El número de consola AWS es obligatorio',
    );
  });

  it('returns error for empty awsRegion', () => {
    const errors = validateScanForm({ ...validForm, awsRegion: '' });
    expect(errors).not.toBeNull();
    expect(errors!.awsRegion).toBe('La región AWS es obligatoria');
  });

  it('returns error for invalid awsRegion', () => {
    const errors = validateScanForm({ ...validForm, awsRegion: 'invalid-region' });
    expect(errors).not.toBeNull();
    expect(errors!.awsRegion).toBe('La región AWS seleccionada no es válida');
  });

  it('returns multiple errors when multiple fields are invalid', () => {
    const errors = validateScanForm({
      partnerName: '',
      partnerEmail: 'bad',
      country: '',
      clientName: '',
      awsAccountNumber: '',
      awsRegion: '',
    });
    expect(errors).not.toBeNull();
    expect(Object.keys(errors!).length).toBe(6);
  });

  it('trims whitespace-only values as empty', () => {
    const errors = validateScanForm({ ...validForm, partnerName: '   ' });
    expect(errors).not.toBeNull();
    expect(errors!.partnerName).toBe('El nombre del partner es obligatorio');
  });
});

describe('validateXlsxFile', () => {
  it('accepts .xlsx files', () => {
    expect(validateXlsxFile('credentials.xlsx')).toBe(true);
    expect(validateXlsxFile('my-file.XLSX')).toBe(true);
    expect(validateXlsxFile('CREDS.Xlsx')).toBe(true);
  });

  it('rejects non-.xlsx files', () => {
    expect(validateXlsxFile('file.csv')).toBe(false);
    expect(validateXlsxFile('file.xls')).toBe(false);
    expect(validateXlsxFile('file.txt')).toBe(false);
    expect(validateXlsxFile('file.xlsx.exe')).toBe(false);
    expect(validateXlsxFile('')).toBe(false);
    expect(validateXlsxFile('noextension')).toBe(false);
  });
});
