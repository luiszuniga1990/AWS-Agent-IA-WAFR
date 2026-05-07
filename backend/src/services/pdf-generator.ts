import PDFDocument from 'pdfkit';
import type {
  AssessmentResult,
  ScanInfo,
  PillarResult,
  Finding,
  FindingSeverity,
} from '@wafr-portal/shared';

/** Severity sort order: critical first, then high, then medium. */
const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

/** Human-readable pillar names. */
const PILLAR_LABELS: Record<string, string> = {
  operational_excellence: 'Operational Excellence',
  security: 'Security',
  reliability: 'Reliability',
  performance_efficiency: 'Performance Efficiency',
  cost_optimization: 'Cost Optimization',
  sustainability: 'Sustainability',
};

/** Sort findings by severity: critical → high → medium. */
export function sortFindingsBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

/** Collect PDF output into a Buffer. */
function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/** Render the common header block used by both PDFs. */
function renderHeader(
  doc: PDFKit.PDFDocument,
  scanInfo: ScanInfo,
  workloadArn?: string,
): void {
  doc.fontSize(18).text('WAFR Assessment Report', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text(`Partner: ${scanInfo.partnerName}`);
  doc.text(`Client: ${scanInfo.clientName}`);
  doc.text(`Console: ${scanInfo.awsAccountNumber}`);
  doc.text(`Region: ${scanInfo.awsRegion}`);
  doc.text(`Date: ${scanInfo.createdAt}`);
  if (workloadArn) {
    doc.text(`Workload ARN: ${workloadArn}`);
  }
  doc.moveDown();
}

// ─── PDF WAFR Ready (Task 10.1) ────────────────────────────────────────────

/**
 * Generate the WAFR Ready PDF.
 *
 * Content:
 * - Header: partner, client, console, region, date (NO Workload ARN)
 * - Overall score
 * - Per pillar: name, score, findings (name + severity) ordered by severity, remediation hours
 */
export async function generateReadyPdf(
  assessment: AssessmentResult,
  scanInfo: ScanInfo,
  options?: { compress?: boolean },
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, compress: options?.compress ?? true });
  const bufferPromise = pdfToBuffer(doc);

  // Header (no workloadArn)
  renderHeader(doc, scanInfo);

  // Overall score
  doc.fontSize(14).text(`Overall Score: ${assessment.overallScore}`, { underline: true });
  doc.moveDown();

  // Per-pillar sections
  for (const pillar of assessment.pillarResults) {
    renderReadyPillar(doc, pillar);
  }

  doc.end();
  return bufferPromise;
}

function renderReadyPillar(doc: PDFKit.PDFDocument, pillar: PillarResult): void {
  const label = PILLAR_LABELS[pillar.pillarName] ?? pillar.pillarName;

  doc.fontSize(12).text(label, { underline: true });
  doc.fontSize(10).text(`Score: ${pillar.score}/100`);
  doc.text(`Estimated Remediation Hours: ${pillar.estimatedRemediationHours}`);
  doc.moveDown(0.3);

  const sorted = sortFindingsBySeverity(pillar.findings);
  if (sorted.length === 0) {
    doc.text('No findings.');
  } else {
    for (const f of sorted) {
      doc.text(`  • [${f.severity.toUpperCase()}] ${f.description.slice(0, 120)}`);
    }
  }
  doc.moveDown();
}

// ─── PDF WAFR Detail (Task 10.2) ───────────────────────────────────────────

/**
 * Generate the WAFR Detail PDF.
 *
 * Content:
 * - Header: partner, client, console, region, date, Workload ARN
 * - Per pillar: name, then each finding with ARN, description, severity, remediation steps
 * - At end of each pillar: checklist section ordered by severity
 */
export async function generateDetailPdf(
  assessment: AssessmentResult,
  scanInfo: ScanInfo,
  workloadArn: string,
  options?: { compress?: boolean },
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, compress: options?.compress ?? true });
  const bufferPromise = pdfToBuffer(doc);

  // Header with Workload ARN
  renderHeader(doc, scanInfo, workloadArn);

  // Track page numbers for each finding so the checklist can reference them
  const findingPages: Map<string, number> = new Map();

  // Per-pillar detail sections
  for (const pillar of assessment.pillarResults) {
    renderDetailPillar(doc, pillar, findingPages);
  }

  doc.end();
  return bufferPromise;
}

function renderDetailPillar(
  doc: PDFKit.PDFDocument,
  pillar: PillarResult,
  findingPages: Map<string, number>,
): void {
  const label = PILLAR_LABELS[pillar.pillarName] ?? pillar.pillarName;

  // Pillar title
  doc.fontSize(14).text(label, { underline: true });
  doc.moveDown(0.3);

  const sorted = sortFindingsBySeverity(pillar.findings);

  if (sorted.length === 0) {
    doc.fontSize(10).text('No findings for this pillar.');
    doc.moveDown();
    return;
  }

  // Render each finding in detail
  for (const f of sorted) {
    // Record the page where this finding starts
    findingPages.set(f.findingId, doc.bufferedPageRange().count);

    doc.fontSize(11).text(`[${f.severity.toUpperCase()}] ${f.description.slice(0, 120)}`, {
      underline: true,
    });
    doc.fontSize(9);
    doc.text(`Resource ARN: ${f.resourceArn}`);
    doc.text(`Severity: ${f.severity}`);
    doc.text('Remediation Steps:');
    if (f.remediationSteps.length > 0) {
      for (const step of f.remediationSteps) {
        doc.text(`  → ${step}`);
      }
    } else {
      doc.text('  No remediation steps available.');
    }
    doc.moveDown(0.5);
  }

  // ── Checklist section at end of pillar ──
  doc.moveDown(0.3);
  doc.fontSize(12).text('Remediation Checklist', { underline: true });
  doc.fontSize(9);

  for (const f of sorted) {
    const page = findingPages.get(f.findingId) ?? '?';
    doc.text(
      `☐  [${f.severity.toUpperCase()}] ${f.description.slice(0, 80)}  |  ${f.resourceArn}  |  p.${page}`,
    );
  }
  doc.moveDown();
}
