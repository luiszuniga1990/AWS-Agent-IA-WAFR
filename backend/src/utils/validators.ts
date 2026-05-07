import type { ScanFormData, ApiErrorResponse } from '@wafr-portal/shared';
import { isValidRegion } from './aws-regions';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function validateRegion(region: string): boolean {
  return isValidRegion(region);
}

/**
 * Validates all fields in a ScanFormData object.
 * Returns null if valid, or an ApiErrorResponse with field-level errors.
 */
export function validateScanForm(
  data: Partial<ScanFormData> | undefined
): ApiErrorResponse | null {
  const fieldErrors: Record<string, string> = {};

  if (!data) {
    return {
      statusCode: 400,
      message: 'Request body is required',
    };
  }

  if (!data.partnerName?.trim()) {
    fieldErrors.partnerName = 'Partner name is required';
  }

  if (!data.partnerEmail?.trim()) {
    fieldErrors.partnerEmail = 'Partner email is required';
  } else if (!validateEmail(data.partnerEmail)) {
    fieldErrors.partnerEmail = 'Invalid email format';
  }

  if (!data.country?.trim()) {
    fieldErrors.country = 'Country is required';
  }

  if (!data.clientName?.trim()) {
    fieldErrors.clientName = 'Client name is required';
  }

  if (!data.awsAccountNumber?.trim()) {
    fieldErrors.awsAccountNumber = 'AWS account number is required';
  }

  if (!data.awsRegion?.trim()) {
    fieldErrors.awsRegion = 'AWS region is required';
  } else if (!validateRegion(data.awsRegion)) {
    fieldErrors.awsRegion = 'Invalid AWS region';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      statusCode: 400,
      message: 'Validation failed',
      fieldErrors,
    };
  }

  return null;
}
