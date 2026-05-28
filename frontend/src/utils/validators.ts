import type { ScanFormData } from '@wafr-portal/shared';
import { isValidRegion } from './aws-regions';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CSV_EXTENSION = '.csv';

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function validateRegion(region: string): boolean {
  return isValidRegion(region);
}

/** Field-level error messages in Spanish. Returns null when all fields are valid. */
export function validateScanForm(
  data: Partial<ScanFormData>,
): Record<string, string> | null {
  const errors: Record<string, string> = {};

  if (!data.partnerName?.trim()) {
    errors.partnerName = 'El nombre del partner es obligatorio';
  }

  if (!data.partnerEmail?.trim()) {
    errors.partnerEmail = 'El correo del partner es obligatorio';
  } else if (!validateEmail(data.partnerEmail)) {
    errors.partnerEmail = 'El formato del correo electrónico es incorrecto';
  }

  if (!data.country?.trim()) {
    errors.country = 'El país es obligatorio';
  }

  if (!data.clientName?.trim()) {
    errors.clientName = 'El nombre del cliente es obligatorio';
  }

  if (!data.awsAccountNumber?.trim()) {
    errors.awsAccountNumber = 'El número de consola AWS es obligatorio';
  }

  if (!data.awsRegion?.trim()) {
    errors.awsRegion = 'La región AWS es obligatoria';
  } else if (!validateRegion(data.awsRegion)) {
    errors.awsRegion = 'La región AWS seleccionada no es válida';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/** Validates that a filename has the .csv extension (case-insensitive). */
export function validateCsvFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(CSV_EXTENSION);
}
