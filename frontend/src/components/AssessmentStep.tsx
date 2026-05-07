import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  StartAssessmentResponse,
  AssessmentStatus,
  PillarResult,
  PillarName,
  PdfType,
  Scan,
  ApiErrorResponse,
} from '@wafr-portal/shared';
import axios from 'axios';
import api from '../services/api';

// --- Constants ---

const POLL_INTERVAL_MS = 5000;
const EMAIL_POLL_INTERVAL_MS = 10_000;
const EMAIL_POLL_MAX_ATTEMPTS = 6;

const PILLAR_LABELS: Record<PillarName, string> = {
  operational_excellence: 'Excelencia Operacional',
  security: 'Seguridad',
  reliability: 'Fiabilidad',
  performance_efficiency: 'Eficiencia de Rendimiento',
  cost_optimization: 'Optimización de Costos',
  sustainability: 'Sostenibilidad',
};

// --- Component ---

interface AssessmentStepProps {
  scanId: string;
  onBack: () => void;
}

type Phase = 'starting' | 'running' | 'completed' | 'partial_failure' | 'failed';
type EmailStatus = 'pending' | 'sent' | 'failed' | 'unknown';

export default function AssessmentStep({ scanId, onBack }: AssessmentStepProps) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [assessmentData, setAssessmentData] = useState<AssessmentStatus | null>(null);
  const [apiError, setApiError] = useState('');
  const [copied, setCopied] = useState(false);

  // PDF download state
  const [downloadingReady, setDownloadingReady] = useState(false);
  const [downloadingDetail, setDownloadingDetail] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // Email status state
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('pending');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const emailPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Cleanup polling on unmount ---
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (emailPollRef.current) {
        clearInterval(emailPollRef.current);
        emailPollRef.current = null;
      }
    };
  }, []);

  // --- Poll scan status for email delivery ---
  const startEmailPolling = useCallback(() => {
    if (emailPollRef.current) {
      clearInterval(emailPollRef.current);
    }

    let attempts = 0;

    const pollEmail = async () => {
      attempts += 1;

      try {
        const { data } = await api.get<Scan>(`/scans/${scanId}`);

        if (data.status === 'emails_sent') {
          setEmailStatus('sent');
          if (emailPollRef.current) {
            clearInterval(emailPollRef.current);
            emailPollRef.current = null;
          }
          return;
        }

        if (data.status === 'emails_failed') {
          setEmailStatus('failed');
          if (emailPollRef.current) {
            clearInterval(emailPollRef.current);
            emailPollRef.current = null;
          }
          return;
        }
      } catch {
        // Transient error — keep polling
      }

      if (attempts >= EMAIL_POLL_MAX_ATTEMPTS) {
        setEmailStatus('unknown');
        if (emailPollRef.current) {
          clearInterval(emailPollRef.current);
          emailPollRef.current = null;
        }
      }
    };

    // First poll immediately
    pollEmail();
    emailPollRef.current = setInterval(pollEmail, EMAIL_POLL_INTERVAL_MS);
  }, [scanId]);

  // --- Poll assessment status ---
  const startPolling = useCallback((id: string) => {
    // Clear any existing interval
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    const poll = async () => {
      try {
        const { data } = await api.get<AssessmentStatus>(
          `/assessments/${id}/status`,
        );
        setAssessmentData(data);

        if (data.status === 'completed') {
          setPhase('completed');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          startEmailPolling();
        } else if (data.status === 'partial_failure') {
          setPhase('partial_failure');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          startEmailPolling();
        } else if (data.status === 'failed') {
          setPhase('failed');
          setApiError('La evaluación falló. Puede reintentar.');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } else {
          // still running
          setPhase('running');
        }
      } catch (err: unknown) {
        // Don't stop polling on transient errors — just log
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          // Assessment not found yet, keep polling
        }
      }
    };

    // First poll immediately
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [startEmailPolling]);

  // --- Start assessment on mount ---
  useEffect(() => {
    let cancelled = false;

    const startAssessment = async () => {
      setPhase('starting');
      setApiError('');

      try {
        const { data } = await api.post<StartAssessmentResponse>(
          `/scans/${scanId}/assessment`,
        );

        if (cancelled) return;

        setAssessmentId(data.assessmentId);
        setPhase('running');
        startPolling(data.assessmentId);
      } catch (err: unknown) {
        if (cancelled) return;

        setPhase('failed');
        if (axios.isAxiosError(err) && err.response?.data) {
          const apiErr = err.response.data as ApiErrorResponse;
          setApiError(apiErr.message || 'Error al iniciar la evaluación');
        } else {
          setApiError('Error de conexión. Intente nuevamente.');
        }
      }
    };

    startAssessment();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId]);

  // --- Retry handler ---
  const handleRetry = async () => {
    setPhase('starting');
    setApiError('');
    setAssessmentData(null);
    setCopied(false);
    setPdfError('');
    setEmailStatus('pending');
    setDownloadingReady(false);
    setDownloadingDetail(false);

    if (emailPollRef.current) {
      clearInterval(emailPollRef.current);
      emailPollRef.current = null;
    }

    try {
      const { data } = await api.post<StartAssessmentResponse>(
        `/scans/${scanId}/assessment`,
      );
      setAssessmentId(data.assessmentId);
      setPhase('running');
      startPolling(data.assessmentId);
    } catch (err: unknown) {
      setPhase('failed');
      if (axios.isAxiosError(err) && err.response?.data) {
        const apiErr = err.response.data as ApiErrorResponse;
        setApiError(apiErr.message || 'Error al iniciar la evaluación');
      } else {
        setApiError('Error de conexión. Intente nuevamente.');
      }
    }
  };

  // --- Copy Workload ARN ---
  const handleCopyArn = async () => {
    if (!assessmentData?.workloadArn) return;
    try {
      await navigator.clipboard.writeText(assessmentData.workloadArn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: silently fail
    }
  };

  // --- Download PDF ---
  const handleDownloadPdf = async (type: PdfType) => {
    if (!assessmentId) return;

    const setLoading = type === 'ready' ? setDownloadingReady : setDownloadingDetail;
    setLoading(true);
    setPdfError('');

    try {
      const { data } = await api.get(`/assessments/${assessmentId}/pdf/${type}`, {
        responseType: 'blob',
      });

      const fileName = type === 'ready' ? 'wafr-ready-report.pdf' : 'wafr-detail-report.pdf';
      const url = URL.createObjectURL(data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setPdfError(`Error al descargar el PDF ${type === 'ready' ? 'WAFR Ready' : 'WAFR Detail'}. Intente nuevamente.`);
    } finally {
      setLoading(false);
    }
  };

  // --- Score color helper ---
  const scoreColor = (score: number): string => {
    if (score >= 70) return '#4caf50';
    if (score >= 40) return '#ff9900';
    return '#d32f2f';
  };

  // --- Render ---

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Evaluación WAFR</h1>
      <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>
        Scan ID: {scanId}
        {assessmentId && <> — Assessment ID: {assessmentId}</>}
      </p>

      {/* --- Starting phase --- */}
      {phase === 'starting' && (
        <div
          role="status"
          aria-label="Iniciando evaluación"
          aria-live="polite"
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 32,
            backgroundColor: '#fafafa',
            textAlign: 'center',
          }}
        >
          <Spinner label="Iniciando evaluación WAFR..." />
        </div>
      )}

      {/* --- Running phase --- */}
      {phase === 'running' && (
        <div
          role="status"
          aria-label="Evaluación en progreso"
          aria-live="polite"
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 32,
            backgroundColor: '#fafafa',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 500, color: '#232f3e', marginBottom: 16 }}>
            Evaluación en progreso...
          </p>
          <ProgressBar />
          <p style={{ fontSize: 13, color: '#888', marginTop: 16 }}>
            Esto puede tomar varios minutos. No cierre esta página.
          </p>
        </div>
      )}

      {/* --- Failed phase --- */}
      {phase === 'failed' && (
        <div
          role="alert"
          style={{
            border: '1px solid #d32f2f',
            borderRadius: 6,
            padding: 24,
            backgroundColor: '#fdecea',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 500, color: '#d32f2f', marginBottom: 8 }}>
            Error en la evaluación
          </p>
          {apiError && (
            <p style={{ fontSize: 14, color: '#d32f2f', marginBottom: 16 }}>
              {apiError}
            </p>
          )}
          <button
            type="button"
            onClick={handleRetry}
            style={{
              padding: '8px 24px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              backgroundColor: '#ff9900',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* --- Completed / Partial Failure phase --- */}
      {(phase === 'completed' || phase === 'partial_failure') && assessmentData && (
        <div aria-live="polite">
          {/* Warning for partial failure */}
          {phase === 'partial_failure' && (
            <div
              role="alert"
              style={{
                backgroundColor: '#fff3e0',
                border: '1px solid #ff9900',
                borderRadius: 6,
                padding: '12px 16px',
                marginBottom: 16,
                fontSize: 14,
                color: '#e65100',
              }}
            >
              ⚠ Algunos pilares presentaron errores durante la evaluación. Los
              resultados parciales se muestran a continuación.
            </div>
          )}

          {/* Overall score */}
          {assessmentData.overallScore != null && (
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: 24,
                backgroundColor: '#fafafa',
                textAlign: 'center',
                marginBottom: 16,
              }}
            >
              <p style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                Calificación General
              </p>
              <p
                style={{
                  fontSize: 56,
                  fontWeight: 700,
                  color: scoreColor(assessmentData.overallScore),
                  lineHeight: 1,
                  marginBottom: 4,
                }}
              >
                {assessmentData.overallScore}
              </p>
              <p style={{ fontSize: 13, color: '#888' }}>de 100</p>
            </div>
          )}

          {/* Workload ARN */}
          {assessmentData.workloadArn && (
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: 16,
                backgroundColor: '#fafafa',
                marginBottom: 16,
              }}
            >
              <p style={{ fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 500 }}>
                Workload ARN
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code
                  style={{
                    flex: 1,
                    fontSize: 12,
                    backgroundColor: '#fff',
                    border: '1px solid #e0e0e0',
                    borderRadius: 4,
                    padding: '8px 12px',
                    wordBreak: 'break-all',
                    color: '#232f3e',
                  }}
                >
                  {assessmentData.workloadArn}
                </code>
                <button
                  type="button"
                  onClick={handleCopyArn}
                  aria-label="Copiar Workload ARN"
                  style={{
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#fff',
                    backgroundColor: copied ? '#4caf50' : '#232f3e',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'background-color 0.2s',
                  }}
                >
                  {copied ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
          )}

          {/* Per-pillar scores */}
          {assessmentData.pillarResults && assessmentData.pillarResults.length > 0 && (
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: 20,
                backgroundColor: '#fafafa',
                marginBottom: 16,
              }}
            >
              <p style={{ fontSize: 14, fontWeight: 600, color: '#232f3e', marginBottom: 16 }}>
                Resultados por Pilar
              </p>
              {assessmentData.pillarResults.map((pillar) => (
                <PillarScoreRow key={pillar.pillarName} pillar={pillar} />
              ))}
            </div>
          )}

          {/* Prowler UI link */}
          {assessmentData.prowlerUiLink && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <a
                href={assessmentData.prowlerUiLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  backgroundColor: '#232f3e',
                  borderRadius: 4,
                  textDecoration: 'none',
                }}
              >
                Ver resultados en Prowler UI ↗
              </a>
            </div>
          )}

          {/* PDF Download Buttons */}
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: 20,
              backgroundColor: '#fafafa',
              marginBottom: 16,
            }}
          >
            <p style={{ fontSize: 14, fontWeight: 600, color: '#232f3e', marginBottom: 12 }}>
              Descargar Reportes PDF
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={() => handleDownloadPdf('ready')}
                disabled={downloadingReady}
                aria-busy={downloadingReady}
                aria-label="Descargar PDF WAFR Ready"
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  backgroundColor: downloadingReady ? '#ccc' : '#ff9900',
                  border: 'none',
                  borderRadius: 4,
                  cursor: downloadingReady ? 'not-allowed' : 'pointer',
                }}
              >
                {downloadingReady ? 'Descargando...' : 'Descargar PDF WAFR Ready'}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadPdf('detail')}
                disabled={downloadingDetail}
                aria-busy={downloadingDetail}
                aria-label="Descargar PDF WAFR Detail"
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  backgroundColor: downloadingDetail ? '#ccc' : '#ff9900',
                  border: 'none',
                  borderRadius: 4,
                  cursor: downloadingDetail ? 'not-allowed' : 'pointer',
                }}
              >
                {downloadingDetail ? 'Descargando...' : 'Descargar PDF WAFR Detail'}
              </button>
            </div>
            {pdfError && (
              <p role="alert" style={{ fontSize: 13, color: '#d32f2f', marginTop: 8 }}>
                {pdfError}
              </p>
            )}
          </div>

          {/* Email Status Section */}
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: 16,
              backgroundColor: '#fafafa',
              marginBottom: 16,
            }}
          >
            <p style={{ fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 500 }}>
              Estado del envío de correos
            </p>
            <EmailStatusDisplay emailStatus={emailStatus} onDownloadPdf={handleDownloadPdf} />
          </div>
        </div>
      )}

      {/* --- Back link --- */}
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'block',
          margin: '24px auto 0',
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
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 20,
          height: 20,
          border: '3px solid #ddd',
          borderTopColor: '#ff9900',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <span style={{ fontSize: 15, color: '#555' }}>{label}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ProgressBar() {
  return (
    <div
      role="progressbar"
      aria-label="Progreso de la evaluación"
      aria-valuetext="En progreso"
      style={{
        width: '100%',
        height: 8,
        backgroundColor: '#e0e0e0',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '40%',
          height: '100%',
          backgroundColor: '#ff9900',
          borderRadius: 4,
          animation: 'progress-slide 1.5s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}

function PillarScoreRow({ pillar }: { pillar: PillarResult }) {
  const label = PILLAR_LABELS[pillar.pillarName] || pillar.pillarName;
  const isError = pillar.status === 'error';

  const scoreColor = (score: number): string => {
    if (score >= 70) return '#4caf50';
    if (score >= 40) return '#ff9900';
    return '#d32f2f';
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 14, color: isError ? '#d32f2f' : '#333' }}>
          {label}
          {isError && (
            <span style={{ fontSize: 12, color: '#d32f2f', marginLeft: 8 }}>
              (Error{pillar.errorMessage ? `: ${pillar.errorMessage}` : ''})
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: isError ? '#d32f2f' : scoreColor(pillar.score),
          }}
        >
          {isError ? '—' : `${pillar.score}/100`}
        </span>
      </div>

      {/* Score bar */}
      <div
        style={{
          width: '100%',
          height: 6,
          backgroundColor: '#e0e0e0',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        {!isError && (
          <div
            style={{
              width: `${Math.max(0, Math.min(100, pillar.score))}%`,
              height: '100%',
              backgroundColor: scoreColor(pillar.score),
              borderRadius: 3,
              transition: 'width 0.5s ease',
            }}
          />
        )}
      </div>

      {/* Estimated remediation hours */}
      {!isError && pillar.estimatedRemediationHours > 0 && (
        <p style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
          ~{pillar.estimatedRemediationHours}h estimadas de remediación
        </p>
      )}
    </div>
  );
}

function EmailStatusDisplay({
  emailStatus,
  onDownloadPdf,
}: {
  emailStatus: 'pending' | 'sent' | 'failed' | 'unknown';
  onDownloadPdf: (type: PdfType) => void;
}) {
  if (emailStatus === 'sent') {
    return (
      <div
        role="status"
        aria-label="Correos enviados exitosamente"
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span style={{ color: '#4caf50', fontSize: 18 }} aria-hidden="true">✓</span>
        <span style={{ fontSize: 14, color: '#4caf50' }}>
          Correos enviados exitosamente
        </span>
      </div>
    );
  }

  if (emailStatus === 'failed') {
    return (
      <div>
        <div
          role="alert"
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}
        >
          <span style={{ color: '#d32f2f', fontSize: 18 }} aria-hidden="true">✗</span>
          <span style={{ fontSize: 14, color: '#d32f2f' }}>
            Error al enviar correos
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          Puede descargar los reportes PDF directamente:
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => onDownloadPdf('ready')}
            aria-label="Descargar PDF WAFR Ready"
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 500,
              color: '#fff',
              backgroundColor: '#ff9900',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            PDF WAFR Ready
          </button>
          <button
            type="button"
            onClick={() => onDownloadPdf('detail')}
            aria-label="Descargar PDF WAFR Detail"
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 500,
              color: '#fff',
              backgroundColor: '#ff9900',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            PDF WAFR Detail
          </button>
        </div>
      </div>
    );
  }

  if (emailStatus === 'unknown') {
    return (
      <div
        role="status"
        aria-label="Estado de correos desconocido"
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span style={{ color: '#888', fontSize: 18 }} aria-hidden="true">?</span>
        <span style={{ fontSize: 14, color: '#888' }}>
          No se pudo determinar el estado del envío de correos. Puede descargar los PDFs directamente.
        </span>
      </div>
    );
  }

  // pending
  return (
    <div role="status" aria-label="Enviando correos" aria-live="polite">
      <Spinner label="Enviando correos..." />
    </div>
  );
}
