import { useState, useEffect, useCallback } from 'react';
import type {
  GetScanHistoryResponse,
  AssessmentSummary,
  AssessmentExecutionStatus,
  PdfType,
  ApiErrorResponse,
} from '@wafr-portal/shared';
import axios from 'axios';
import api from '../services/api';

// --- Status display config ---

const STATUS_CONFIG: Record<
  AssessmentExecutionStatus,
  { label: string; color: string; bg: string }
> = {
  running: { label: 'En progreso', color: '#1565c0', bg: '#e3f2fd' },
  completed: { label: 'Completado', color: '#2e7d32', bg: '#e8f5e9' },
  partial_failure: { label: 'Parcial', color: '#e65100', bg: '#fff3e0' },
  failed: { label: 'Fallido', color: '#c62828', bg: '#fdecea' },
};

// --- Helpers ---

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function scoreColor(score: number): string {
  if (score >= 70) return '#4caf50';
  if (score >= 40) return '#ff9900';
  return '#d32f2f';
}

function scoreBg(score: number): string {
  if (score >= 70) return '#e8f5e9';
  if (score >= 40) return '#fff3e0';
  return '#fdecea';
}

// --- Component ---

export default function HistoryPage() {
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<GetScanHistoryResponse>('/scans');
      const sorted = [...data.scans].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setAssessments(sorted);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const apiErr = err.response.data as ApiErrorResponse;
        setError(apiErr.message || 'Error al cargar el historial');
      } else {
        setError('Error de conexión. Intente nuevamente.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // --- Loading state ---
  if (loading) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 24 }}>Historial de Evaluaciones</h1>
        <div
          role="status"
          aria-label="Cargando historial"
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 32,
            backgroundColor: '#fafafa',
            textAlign: 'center',
          }}
        >
          <Spinner label="Cargando historial..." />
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 24 }}>Historial de Evaluaciones</h1>
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
            {error}
          </p>
          <button
            type="button"
            onClick={fetchHistory}
            aria-label="Reintentar carga del historial"
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
      </div>
    );
  }

  // --- Empty state ---
  if (assessments.length === 0) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ marginBottom: 24 }}>Historial de Evaluaciones</h1>
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 32,
            backgroundColor: '#fafafa',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 16, color: '#555' }}>No hay evaluaciones previas</p>
        </div>
      </div>
    );
  }

  // --- List state ---
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 24 }}>Historial de Evaluaciones</h1>
      <div role="list" aria-label="Lista de evaluaciones previas">
        {assessments.map((assessment) => (
          <AssessmentCard key={assessment.assessmentId} assessment={assessment} />
        ))}
      </div>
    </div>
  );
}

// ─── Assessment Card ─────────────────────────────────────────────────

function AssessmentCard({ assessment }: { assessment: AssessmentSummary }) {
  const [downloadingReady, setDownloadingReady] = useState(false);
  const [downloadingDetail, setDownloadingDetail] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [arnCopied, setArnCopied] = useState(false);

  const statusCfg = STATUS_CONFIG[assessment.status];
  const canDownloadPdf =
    assessment.status === 'completed' || assessment.status === 'partial_failure';

  const handleDownloadPdf = async (type: PdfType) => {
    const setLoading = type === 'ready' ? setDownloadingReady : setDownloadingDetail;
    setLoading(true);
    setPdfError('');

    try {
      const { data } = await api.get(
        `/assessments/${assessment.assessmentId}/pdf/${type}`,
        { responseType: 'blob' },
      );

      const fileName =
        type === 'ready' ? 'wafr-ready-report.pdf' : 'wafr-detail-report.pdf';
      const url = URL.createObjectURL(data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      setPdfError(
        `Error al descargar el PDF ${type === 'ready' ? 'Ready' : 'Detail'}. Intente nuevamente.`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopyArn = async () => {
    if (!assessment.workloadArn) return;
    try {
      await navigator.clipboard.writeText(assessment.workloadArn);
      setArnCopied(true);
      setTimeout(() => setArnCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  return (
    <div
      role="listitem"
      aria-label={`Evaluación de ${assessment.clientName}`}
      style={{
        border: '1px solid #ddd',
        borderRadius: 6,
        padding: 20,
        backgroundColor: '#fafafa',
        marginBottom: 16,
      }}
    >
      {/* Header row: client name + badges */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#232f3e', margin: 0 }}>
          {assessment.clientName}
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Score badge */}
          <span
            aria-label={`Puntuación: ${assessment.overallScore}`}
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              color: scoreColor(assessment.overallScore),
              backgroundColor: scoreBg(assessment.overallScore),
            }}
          >
            {assessment.overallScore}/100
          </span>
          {/* Status badge */}
          <span
            aria-label={`Estado: ${statusCfg.label}`}
            style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              color: statusCfg.color,
              backgroundColor: statusCfg.bg,
            }}
          >
            {statusCfg.label}
          </span>
        </div>
      </div>

      {/* Date */}
      <p style={{ fontSize: 14, color: '#555', margin: '0 0 12px 0' }}>
        {formatDate(assessment.createdAt)}
      </p>

      {/* Workload ARN */}
      {assessment.workloadArn && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Workload ARN</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code
              style={{
                flex: 1,
                fontSize: 11,
                backgroundColor: '#fff',
                border: '1px solid #e0e0e0',
                borderRadius: 4,
                padding: '6px 10px',
                wordBreak: 'break-all',
                color: '#232f3e',
              }}
            >
              {assessment.workloadArn}
            </code>
            <button
              type="button"
              onClick={handleCopyArn}
              aria-label="Copiar Workload ARN"
              style={{
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 500,
                color: '#fff',
                backgroundColor: arnCopied ? '#4caf50' : '#232f3e',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background-color 0.2s',
              }}
            >
              {arnCopied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {/* Actions row */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {canDownloadPdf && (
          <>
            <button
              type="button"
              onClick={() => handleDownloadPdf('ready')}
              disabled={downloadingReady}
              aria-busy={downloadingReady}
              aria-label="Descargar PDF Ready"
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                backgroundColor: downloadingReady ? '#ccc' : '#ff9900',
                border: 'none',
                borderRadius: 4,
                cursor: downloadingReady ? 'not-allowed' : 'pointer',
              }}
            >
              {downloadingReady ? 'Descargando...' : 'Descargar PDF Ready'}
            </button>
            <button
              type="button"
              onClick={() => handleDownloadPdf('detail')}
              disabled={downloadingDetail}
              aria-busy={downloadingDetail}
              aria-label="Descargar PDF Detail"
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                backgroundColor: downloadingDetail ? '#ccc' : '#ff9900',
                border: 'none',
                borderRadius: 4,
                cursor: downloadingDetail ? 'not-allowed' : 'pointer',
              }}
            >
              {downloadingDetail ? 'Descargando...' : 'Descargar PDF Detail'}
            </button>
          </>
        )}

        {assessment.prowlerUiLink && (
          <a
            href={assessment.prowlerUiLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ver en Prowler UI"
            style={{
              display: 'inline-block',
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              backgroundColor: '#232f3e',
              borderRadius: 4,
              textDecoration: 'none',
            }}
          >
            Ver en Prowler UI ↗
          </a>
        )}
      </div>

      {/* PDF error */}
      {pdfError && (
        <p role="alert" style={{ fontSize: 13, color: '#d32f2f', marginTop: 8 }}>
          {pdfError}
        </p>
      )}
    </div>
  );
}

// ─── Spinner ─────────────────────────────────────────────────────────

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
