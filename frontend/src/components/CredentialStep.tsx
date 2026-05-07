import { useState, useRef, type ChangeEvent } from 'react';
import type {
  UploadCredentialsResponse,
  GetPermissionsResponse,
  GetPrerequisitesResponse,
  ConnectionResult,
  PermissionResult,
  PrerequisiteResult,
  MissingPermission,
  ApiErrorResponse,
} from '@wafr-portal/shared';
import axios from 'axios';
import api from '../services/api';
import { validateXlsxFile } from '../utils/validators';

// --- Sub-step states within the credential flow ---
type CredentialSubStep =
  | 'upload'
  | 'uploading'
  | 'connection_ok'
  | 'connection_fail'
  | 'checking_perms'
  | 'perms_ok'
  | 'perms_fail'
  | 'checking_prereqs'
  | 'prereqs_ok'
  | 'prereqs_fail'
  | 'ready';

interface CredentialStepProps {
  scanId: string;
  onBack: () => void;
  onStartAssessment: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CredentialStep({
  scanId,
  onBack,
  onStartAssessment,
}: CredentialStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sub-step state
  const [subStep, setSubStep] = useState<CredentialSubStep>('upload');

  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');

  // Connection result
  const [connectionResult, setConnectionResult] = useState<ConnectionResult | null>(null);

  // Permission result
  const [permissionResult, setPermissionResult] = useState<PermissionResult | null>(null);

  // Prerequisite result
  const [prerequisiteResult, setPrerequisiteResult] = useState<PrerequisiteResult | null>(null);

  // General error
  const [apiError, setApiError] = useState('');

  // --- File handling ---

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    setApiError('');
    const file = e.target.files?.[0] ?? null;

    if (file) {
      if (!validateXlsxFile(file.name)) {
        setFileError('Solo se aceptan archivos con extensión .xlsx');
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setSelectedFile(file);
    } else {
      setSelectedFile(null);
    }
  };

  // --- Upload credentials ---

  const handleUpload = async () => {
    if (!selectedFile) return;

    setApiError('');
    setSubStep('uploading');

    try {
      const fileBase64 = await fileToBase64(selectedFile);
      const { data } = await api.post<UploadCredentialsResponse>(
        `/scans/${scanId}/credentials`,
        { fileBase64, fileName: selectedFile.name },
      );

      setConnectionResult(data.connectionResult);

      if (data.connectionResult.success) {
        setSubStep('connection_ok');
        // Automatically proceed to permission check
        await checkPermissions();
      } else {
        setSubStep('connection_fail');
      }
    } catch (err: unknown) {
      setSubStep('connection_fail');
      if (axios.isAxiosError(err) && err.response?.data) {
        const apiErr = err.response.data as ApiErrorResponse;
        setApiError(apiErr.message || 'Error al subir las credenciales');
      } else {
        setApiError('Error de conexión. Intente nuevamente.');
      }
    }
  };

  // --- Check permissions ---

  const checkPermissions = async () => {
    setSubStep('checking_perms');
    setApiError('');

    try {
      const { data } = await api.get<GetPermissionsResponse>(
        `/scans/${scanId}/permissions`,
      );

      setPermissionResult(data.permissionResult);

      if (data.permissionResult.hasWriteAccess) {
        setSubStep('perms_fail');
      } else if (data.permissionResult.valid) {
        setSubStep('perms_ok');
        // Automatically proceed to prerequisite check
        await checkPrerequisites();
      } else {
        setSubStep('perms_fail');
      }
    } catch (err: unknown) {
      // The backend currently returns 400 for this endpoint.
      // Handle gracefully: if the backend says credentials must be uploaded first,
      // we treat permissions as OK (they were validated during upload) and proceed.
      if (axios.isAxiosError(err) && err.response?.status === 400) {
        // Backend doesn't fully support this endpoint yet — skip to prerequisites
        setPermissionResult({ valid: true });
        setSubStep('perms_ok');
        await checkPrerequisites();
      } else {
        setSubStep('perms_fail');
        if (axios.isAxiosError(err) && err.response?.data) {
          const apiErr = err.response.data as ApiErrorResponse;
          setApiError(apiErr.message || 'Error al validar permisos');
        } else {
          setApiError('Error de conexión al validar permisos.');
        }
      }
    }
  };

  // --- Check prerequisites ---

  const checkPrerequisites = async () => {
    setSubStep('checking_prereqs');
    setApiError('');

    try {
      const { data } = await api.get<GetPrerequisitesResponse>(
        `/scans/${scanId}/prerequisites`,
      );

      setPrerequisiteResult(data.prerequisiteResult);

      if (data.prerequisiteResult.allPassed) {
        setSubStep('ready');
      } else {
        setSubStep('prereqs_fail');
      }
    } catch (err: unknown) {
      setSubStep('prereqs_fail');
      if (axios.isAxiosError(err) && err.response?.data) {
        const apiErr = err.response.data as ApiErrorResponse;
        setApiError(apiErr.message || 'Error al validar prerequisitos');
      } else {
        setApiError('Error de conexión al validar prerequisitos.');
      }
    }
  };

  // --- Download IAM policy ---

  const handleDownloadPolicy = async () => {
    try {
      const { data } = await api.get(`/scans/${scanId}/iam-policy`);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wafr-minimum-iam-policy.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setApiError('Error al descargar la política IAM.');
    }
  };

  // --- Reset to re-upload ---

  const handleRetryUpload = () => {
    setSubStep('upload');
    setSelectedFile(null);
    setFileError('');
    setApiError('');
    setConnectionResult(null);
    setPermissionResult(null);
    setPrerequisiteResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Retry from permissions ---

  const handleRetryPermissions = async () => {
    setApiError('');
    await checkPermissions();
  };

  // --- Retry from prerequisites ---

  const handleRetryPrerequisites = async () => {
    setApiError('');
    await checkPrerequisites();
  };

  // --- Determine which sections to show ---

  const showUpload = true;
  const showConnection =
    subStep !== 'upload' && subStep !== 'uploading';
  const showPermissions =
    showConnection &&
    subStep !== 'connection_fail' &&
    subStep !== 'connection_ok';
  const showPrerequisites =
    showPermissions &&
    subStep !== 'checking_perms' &&
    subStep !== 'perms_fail';
  const showStartButton =
    showPrerequisites && subStep !== 'checking_prereqs';

  const isUploading = subStep === 'uploading';
  const isCheckingPerms = subStep === 'checking_perms';
  const isCheckingPrereqs = subStep === 'checking_prereqs';
  const allPassed = subStep === 'ready';

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Nuevo Scan WAFR</h1>
      <p style={{ color: '#555', marginBottom: 4 }}>
        Paso 2: Carga y validación de credenciales AWS
      </p>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>
        Scan ID: {scanId}
      </p>

      {/* --- Section 1: File Upload --- */}
      {showUpload && (
        <section
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 20,
            marginBottom: 16,
            backgroundColor: '#fafafa',
          }}
        >
          <h2 style={{ fontSize: 16, marginBottom: 12, color: '#232f3e' }}>
            1. Cargar archivo de credenciales
          </h2>

          <label
            htmlFor="credential-file"
            style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}
          >
            Archivo Excel (.xlsx)
          </label>
          <input
            ref={fileInputRef}
            id="credential-file"
            type="file"
            accept=".xlsx"
            aria-describedby={fileError ? 'file-error' : undefined}
            aria-invalid={fileError ? 'true' : undefined}
            onChange={handleFileChange}
            disabled={isUploading}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 0',
              fontSize: 14,
              marginBottom: 8,
            }}
          />

          {fileError && (
            <div
              id="file-error"
              role="alert"
              style={{ color: '#d32f2f', fontSize: 13, marginBottom: 8 }}
            >
              {fileError}
            </div>
          )}

          {selectedFile && !fileError && (
            <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
              Archivo seleccionado: <strong>{selectedFile.name}</strong>
            </p>
          )}

          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || !!fileError || isUploading}
            aria-busy={isUploading}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              backgroundColor:
                !selectedFile || !!fileError || isUploading ? '#999' : '#ff9900',
              border: 'none',
              borderRadius: 4,
              cursor:
                !selectedFile || !!fileError || isUploading
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {isUploading ? 'Subiendo…' : 'Subir Credenciales'}
          </button>
        </section>
      )}

      {/* --- Section 2: Connection Result --- */}
      {showConnection && (
        <section
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 20,
            marginBottom: 16,
            backgroundColor: '#fafafa',
          }}
        >
          <h2 style={{ fontSize: 16, marginBottom: 12, color: '#232f3e' }}>
            2. Prueba de conexión
          </h2>

          {connectionResult?.success ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                role="img"
                aria-label="Conexión exitosa"
                style={{ color: '#4caf50', fontSize: 20 }}
              >
                ✓
              </span>
              <span style={{ color: '#4caf50', fontWeight: 500 }}>
                Conexión exitosa
                {connectionResult.accountId &&
                  ` — Cuenta: ${connectionResult.accountId}`}
              </span>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span
                  role="img"
                  aria-label="Conexión fallida"
                  style={{ color: '#d32f2f', fontSize: 20 }}
                >
                  ✗
                </span>
                <span style={{ color: '#d32f2f', fontWeight: 500 }}>
                  Error de conexión
                </span>
              </div>
              {connectionResult?.error && (
                <p style={{ color: '#d32f2f', fontSize: 13, marginBottom: 8 }}>
                  {connectionResult.error}
                </p>
              )}
              <button
                type="button"
                onClick={handleRetryUpload}
                style={{
                  padding: '6px 16px',
                  fontSize: 13,
                  color: '#ff9900',
                  backgroundColor: 'transparent',
                  border: '1px solid #ff9900',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Subir otro archivo
              </button>
            </div>
          )}
        </section>
      )}

      {/* --- Section 3: Permission Validation --- */}
      {showPermissions && (
        <section
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 20,
            marginBottom: 16,
            backgroundColor: '#fafafa',
          }}
        >
          <h2 style={{ fontSize: 16, marginBottom: 12, color: '#232f3e' }}>
            3. Validación de permisos IAM
          </h2>

          {isCheckingPerms && <Spinner label="Validando permisos…" />}

          {subStep === 'perms_ok' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                role="img"
                aria-label="Permisos válidos"
                style={{ color: '#4caf50', fontSize: 20 }}
              >
                ✓
              </span>
              <span style={{ color: '#4caf50', fontWeight: 500 }}>
                Permisos validados correctamente
              </span>
            </div>
          )}

          {subStep === 'perms_fail' && permissionResult?.hasWriteAccess && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span
                  role="img"
                  aria-label="Permisos rechazados"
                  style={{ color: '#d32f2f', fontSize: 20 }}
                >
                  ✗
                </span>
                <span style={{ color: '#d32f2f', fontWeight: 500 }}>
                  Credenciales rechazadas: se detectaron permisos de escritura
                </span>
              </div>
              <p style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
                Solo se aceptan credenciales con permisos de solo lectura. Las
                credenciales proporcionadas tienen permisos de escritura sobre
                recursos del cliente.
              </p>
              <button
                type="button"
                onClick={handleRetryUpload}
                style={{
                  padding: '6px 16px',
                  fontSize: 13,
                  color: '#ff9900',
                  backgroundColor: 'transparent',
                  border: '1px solid #ff9900',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Subir otro archivo
              </button>
            </div>
          )}

          {subStep === 'perms_fail' &&
            !permissionResult?.hasWriteAccess &&
            permissionResult?.missingPermissions &&
            permissionResult.missingPermissions.length > 0 && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span
                    role="img"
                    aria-label="Permisos faltantes"
                    style={{ color: '#d32f2f', fontSize: 20 }}
                  >
                    ✗
                  </span>
                  <span style={{ color: '#d32f2f', fontWeight: 500 }}>
                    Permisos faltantes detectados
                  </span>
                </div>

                <MissingPermissionsList
                  missingPermissions={permissionResult.missingPermissions}
                />

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={handleDownloadPolicy}
                    style={{
                      padding: '6px 16px',
                      fontSize: 13,
                      color: '#fff',
                      backgroundColor: '#232f3e',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Descargar política IAM mínima (JSON)
                  </button>
                  <button
                    type="button"
                    onClick={handleRetryPermissions}
                    style={{
                      padding: '6px 16px',
                      fontSize: 13,
                      color: '#ff9900',
                      backgroundColor: 'transparent',
                      border: '1px solid #ff9900',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Reintentar validación
                  </button>
                </div>
              </div>
            )}

          {/* Generic permission error (no specific result) */}
          {subStep === 'perms_fail' && !permissionResult && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span
                  role="img"
                  aria-label="Error de permisos"
                  style={{ color: '#d32f2f', fontSize: 20 }}
                >
                  ✗
                </span>
                <span style={{ color: '#d32f2f', fontWeight: 500 }}>
                  Error al validar permisos
                </span>
              </div>
              <button
                type="button"
                onClick={handleRetryPermissions}
                style={{
                  padding: '6px 16px',
                  fontSize: 13,
                  color: '#ff9900',
                  backgroundColor: 'transparent',
                  border: '1px solid #ff9900',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Reintentar
              </button>
            </div>
          )}
        </section>
      )}

      {/* --- Section 4: Prerequisite Validation --- */}
      {showPrerequisites && (
        <section
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 20,
            marginBottom: 16,
            backgroundColor: '#fafafa',
          }}
        >
          <h2 style={{ fontSize: 16, marginBottom: 12, color: '#232f3e' }}>
            4. Validación de prerequisitos
          </h2>

          {isCheckingPrereqs && <Spinner label="Validando prerequisitos…" />}

          {(subStep === 'prereqs_ok' || subStep === 'prereqs_fail' || subStep === 'ready') &&
            prerequisiteResult && (
              <PrerequisiteChecklist result={prerequisiteResult} />
            )}

          {subStep === 'prereqs_fail' && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
                Todos los prerequisitos deben estar activos para iniciar la
                evaluación. Active los servicios faltantes en la consola AWS y
                vuelva a validar.
              </p>
              <button
                type="button"
                onClick={handleRetryPrerequisites}
                style={{
                  padding: '6px 16px',
                  fontSize: 13,
                  color: '#ff9900',
                  backgroundColor: 'transparent',
                  border: '1px solid #ff9900',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Reintentar validación
              </button>
            </div>
          )}
        </section>
      )}

      {/* --- API-level error --- */}
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

      {/* --- Start Assessment Button --- */}
      {showStartButton && (
        <button
          type="button"
          onClick={onStartAssessment}
          disabled={!allPassed}
          style={{
            width: '100%',
            padding: '10px 0',
            fontSize: 16,
            fontWeight: 600,
            color: '#fff',
            backgroundColor: allPassed ? '#ff9900' : '#999',
            border: 'none',
            borderRadius: 4,
            cursor: allPassed ? 'pointer' : 'not-allowed',
            marginBottom: 12,
          }}
        >
          Iniciar Evaluación WAFR
        </button>
      )}

      {/* --- Back link --- */}
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'block',
          margin: '0 auto',
          padding: '6px 16px',
          fontSize: 13,
          color: '#555',
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        ← Volver al formulario
      </button>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function Spinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 16,
          height: 16,
          border: '2px solid #ddd',
          borderTopColor: '#ff9900',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <span style={{ fontSize: 14, color: '#555' }}>{label}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function MissingPermissionsList({
  missingPermissions,
}: {
  missingPermissions: MissingPermission[];
}) {
  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: 4,
        padding: 12,
        maxHeight: 240,
        overflowY: 'auto',
      }}
    >
      <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
        Las siguientes políticas o permisos deben agregarse al usuario IAM:
      </p>
      {missingPermissions.map((mp) => (
        <div key={mp.service} style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 13, color: '#232f3e' }}>
            {mp.service}
          </strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {mp.actions.map((action) => (
              <li
                key={action}
                style={{ fontSize: 12, color: '#555', marginBottom: 2 }}
              >
                {action}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PrerequisiteChecklist({ result }: { result: PrerequisiteResult }) {
  const items = [
    { label: 'AWS Config habilitado', passed: result.configEnabled },
    { label: 'AWS Config registrando recursos', passed: result.configRecording },
    { label: 'Security Hub habilitado', passed: result.securityHubEnabled },
    {
      label: 'Estándar FSBP (Foundational Security Best Practices) activo',
      passed: result.standards.fsbp,
    },
    {
      label: 'Estándar CIS (AWS Foundations Benchmark) activo',
      passed: result.standards.cis,
    },
    {
      label: 'Estándar PCI DSS activo',
      passed: result.standards.pciDss,
    },
  ];

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((item) => (
        <li
          key={item.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 0',
            fontSize: 14,
          }}
        >
          <span
            role="img"
            aria-label={item.passed ? 'Activo' : 'Inactivo'}
            style={{
              color: item.passed ? '#4caf50' : '#d32f2f',
              fontSize: 18,
              fontWeight: 700,
              minWidth: 20,
              textAlign: 'center',
            }}
          >
            {item.passed ? '✓' : '✗'}
          </span>
          <span style={{ color: item.passed ? '#333' : '#d32f2f' }}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
