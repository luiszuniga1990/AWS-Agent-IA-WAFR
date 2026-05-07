import { useState, type FormEvent, type ChangeEvent } from 'react';
import type {
  ScanFormData,
  CreateScanRequest,
  CreateScanResponse,
  ApiErrorResponse,
} from '@wafr-portal/shared';
import axios from 'axios';
import api from '../services/api';
import { VALID_AWS_REGIONS } from '../utils/aws-regions';
import { validateScanForm } from '../utils/validators';
import CredentialStep from '../components/CredentialStep';
import AssessmentStep from '../components/AssessmentStep';

// --- Multi-step flow states ---
type ScanStep = 'form' | 'credentials' | 'assessment';

const EMPTY_FORM: ScanFormData = {
  partnerName: '',
  partnerEmail: '',
  country: '',
  clientName: '',
  awsAccountNumber: '',
  awsRegion: '',
};

export default function ScanPage() {
  // Step state machine
  const [step, setStep] = useState<ScanStep>('form');
  const [scanId, setScanId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<ScanFormData>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  // --- Helpers ---

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    const updated = { ...formData, [name]: value };
    setFormData(updated);

    // Re-validate touched fields on change
    if (touched[name]) {
      const errors = validateScanForm(updated);
      setFieldErrors((prev) => {
        const next = { ...prev };
        if (errors?.[name]) {
          next[name] = errors[name];
        } else {
          delete next[name];
        }
        return next;
      });
    }
  };

  const handleBlur = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));

    // Validate this field
    const errors = validateScanForm(formData);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (errors?.[name]) {
        next[name] = errors[name];
      } else {
        delete next[name];
      }
      return next;
    });
  };

  const isFormValid = validateScanForm(formData) === null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setApiError('');

    // Mark all fields as touched and validate
    const allTouched: Record<string, boolean> = {};
    for (const key of Object.keys(formData)) {
      allTouched[key] = true;
    }
    setTouched(allTouched);

    const errors = validateScanForm(formData);
    if (errors) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const body: CreateScanRequest = { formData };
      const { data } = await api.post<CreateScanResponse>('/scans', body);
      setScanId(data.scanId);
      setStep('credentials');
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const apiErr = err.response.data as ApiErrorResponse;
        if (apiErr.fieldErrors) {
          setFieldErrors(apiErr.fieldErrors);
        } else {
          setApiError(apiErr.message || 'Error al crear el scan');
        }
      } else {
        setApiError('Error de conexión. Intente nuevamente.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // --- Render per step ---

  if (step === 'credentials' && scanId) {
    return (
      <CredentialStep
        scanId={scanId}
        onBack={() => setStep('form')}
        onStartAssessment={() => setStep('assessment')}
      />
    );
  }

  if (step === 'assessment' && scanId) {
    return (
      <AssessmentStep scanId={scanId} onBack={() => setStep('form')} />
    );
  }

  // step === 'form'
  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Nuevo Scan WAFR</h1>
      <p style={{ color: '#555', marginBottom: 24 }}>
        Complete la información del partner y del cliente para iniciar la
        evaluación.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        {/* Partner Name */}
        <FormField
          id="partnerName"
          label="Nombre del Partner"
          value={formData.partnerName}
          error={touched.partnerName ? fieldErrors.partnerName : undefined}
          disabled={submitting}
          onChange={handleChange}
          onBlur={handleBlur}
        />

        {/* Partner Email */}
        <FormField
          id="partnerEmail"
          label="Correo del Partner"
          type="email"
          autoComplete="email"
          value={formData.partnerEmail}
          error={touched.partnerEmail ? fieldErrors.partnerEmail : undefined}
          disabled={submitting}
          onChange={handleChange}
          onBlur={handleBlur}
        />

        {/* Country */}
        <FormField
          id="country"
          label="País"
          value={formData.country}
          error={touched.country ? fieldErrors.country : undefined}
          disabled={submitting}
          onChange={handleChange}
          onBlur={handleBlur}
        />

        {/* Client Name */}
        <FormField
          id="clientName"
          label="Cliente Final"
          value={formData.clientName}
          error={touched.clientName ? fieldErrors.clientName : undefined}
          disabled={submitting}
          onChange={handleChange}
          onBlur={handleBlur}
        />

        {/* AWS Account Number */}
        <FormField
          id="awsAccountNumber"
          label="Número de Consola AWS"
          value={formData.awsAccountNumber}
          error={
            touched.awsAccountNumber
              ? fieldErrors.awsAccountNumber
              : undefined
          }
          disabled={submitting}
          onChange={handleChange}
          onBlur={handleBlur}
        />

        {/* AWS Region (select) */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="awsRegion"
            style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}
          >
            Región AWS
          </label>
          <select
            id="awsRegion"
            name="awsRegion"
            required
            aria-required="true"
            aria-invalid={
              touched.awsRegion && !!fieldErrors.awsRegion ? 'true' : undefined
            }
            aria-describedby={
              touched.awsRegion && fieldErrors.awsRegion
                ? 'awsRegion-error'
                : undefined
            }
            value={formData.awsRegion}
            disabled={submitting}
            onChange={handleChange}
            onBlur={handleBlur}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 14,
              border: `1px solid ${
                touched.awsRegion && fieldErrors.awsRegion ? '#d32f2f' : '#ccc'
              }`,
              borderRadius: 4,
              boxSizing: 'border-box',
              backgroundColor: '#fff',
            }}
          >
            <option value="" disabled>
              Seleccione una región
            </option>
            {VALID_AWS_REGIONS.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
          {touched.awsRegion && fieldErrors.awsRegion && (
            <FieldError id="awsRegion-error" message={fieldErrors.awsRegion} />
          )}
        </div>

        {/* API-level error */}
        {apiError && (
          <div
            role="alert"
            style={{
              color: '#d32f2f',
              backgroundColor: '#fdecea',
              padding: '8px 12px',
              borderRadius: 4,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {apiError}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !isFormValid}
          aria-busy={submitting}
          style={{
            width: '100%',
            padding: '10px 0',
            fontSize: 16,
            fontWeight: 600,
            color: '#fff',
            backgroundColor:
              submitting || !isFormValid ? '#999' : '#ff9900',
            border: 'none',
            borderRadius: 4,
            cursor:
              submitting || !isFormValid ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Enviando…' : 'Crear Scan'}
        </button>
      </form>
    </div>
  );
}

// ─── Reusable sub-components (co-located) ────────────────────────────

interface FormFieldProps {
  id: string;
  label: string;
  value: string;
  error?: string;
  disabled: boolean;
  type?: string;
  autoComplete?: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur: (e: ChangeEvent<HTMLInputElement>) => void;
}

function FormField({
  id,
  label,
  value,
  error,
  disabled,
  type = 'text',
  autoComplete,
  onChange,
  onBlur,
}: FormFieldProps) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        htmlFor={id}
        style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required
        aria-required="true"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onBlur={onBlur}
        style={{
          width: '100%',
          padding: '8px 12px',
          fontSize: 14,
          border: `1px solid ${error ? '#d32f2f' : '#ccc'}`,
          borderRadius: 4,
          boxSizing: 'border-box',
        }}
      />
      {error && <FieldError id={`${id}-error`} message={error} />}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <div
      id={id}
      role="alert"
      style={{ color: '#d32f2f', fontSize: 13, marginTop: 4 }}
    >
      {message}
    </div>
  );
}
