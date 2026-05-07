import type {
  AssessmentResult,
  ScanInfo,
  PillarResult,
  Finding,
} from '@wafr-portal/shared';
import {
  generateReadyPdf,
  generateDetailPdf,
  sortFindingsBySeverity,
} from './pdf-generator';

// ─── Test helpers ───────────────────────────────────────────────────────────

const NO_COMPRESS = { compress: false };

/**
 * Extract readable text from an uncompressed PDFKit buffer.
 * PDFKit encodes text as hex strings like <48656c6c6f> in TJ operators.
 * This extracts and decodes all hex strings to reconstruct the text.
 */
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const hexPattern = /<([0-9a-fA-F]+)>/g;
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = hexPattern.exec(raw)) !== null) {
    const hex = match[1];
    let text = '';
    for (let i = 0; i < hex.length; i += 2) {
      text += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
    }
    parts.push(text);
  }
  return parts.join('');
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    findingId: 'f-1',
    resourceArn: 'arn:aws:ec2:us-east-1:123456789012:instance/i-abc',
    description: 'Security group allows unrestricted SSH access',
    severity: 'high',
    pillar: 'security',
    remediationSteps: ['Restrict SSH to known IPs'],
    ...overrides,
  };
}

function makePillar(overrides: Partial<PillarResult> = {}): PillarResult {
  return {
    pillarName: 'security',
    score: 75,
    findings: [makeFinding()],
    estimatedRemediationHours: 2,
    status: 'completed',
    ...overrides,
  };
}

const scanInfo: ScanInfo = {
  partnerName: 'Acme Partner',
  clientName: 'Client Corp',
  awsAccountNumber: '123456789012',
  awsRegion: 'us-east-1',
  createdAt: '2024-01-15T10:00:00Z',
};

const assessment: AssessmentResult = {
  overallScore: 72,
  pillarResults: [
    makePillar({ pillarName: 'security', score: 60 }),
    makePillar({
      pillarName: 'reliability',
      score: 85,
      findings: [],
      estimatedRemediationHours: 0,
    }),
  ],
};

// ─── sortFindingsBySeverity ─────────────────────────────────────────────────

describe('sortFindingsBySeverity', () => {
  it('should sort critical before high before medium', () => {
    const findings: Finding[] = [
      makeFinding({ findingId: 'f-med', severity: 'medium' }),
      makeFinding({ findingId: 'f-crit', severity: 'critical' }),
      makeFinding({ findingId: 'f-high', severity: 'high' }),
    ];
    const sorted = sortFindingsBySeverity(findings);
    expect(sorted.map((f) => f.severity)).toEqual(['critical', 'high', 'medium']);
  });

  it('should handle empty array', () => {
    expect(sortFindingsBySeverity([])).toEqual([]);
  });

  it('should not mutate the original array', () => {
    const findings: Finding[] = [
      makeFinding({ findingId: 'f-med', severity: 'medium' }),
      makeFinding({ findingId: 'f-crit', severity: 'critical' }),
    ];
    sortFindingsBySeverity(findings);
    expect(findings[0].severity).toBe('medium');
  });
});

// ─── generateReadyPdf ───────────────────────────────────────────────────────

describe('generateReadyPdf', () => {
  it('should return a valid PDF buffer starting with %PDF-', async () => {
    const buffer = await generateReadyPdf(assessment, scanInfo, NO_COMPRESS);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('should contain header info (partner, client, console, region, date)', async () => {
    const buffer = await generateReadyPdf(assessment, scanInfo, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('Acme Partner');
    expect(text).toContain('Client Corp');
    expect(text).toContain('123456789012');
    expect(text).toContain('us-east-1');
    expect(text).toContain('2024-01-15');
  });

  it('should contain overall score', async () => {
    const buffer = await generateReadyPdf(assessment, scanInfo, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('Overall Score');
    expect(text).toContain('72');
  });

  it('should contain pillar names and scores', async () => {
    const buffer = await generateReadyPdf(assessment, scanInfo, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('Security');
    expect(text).toContain('Reliability');
    expect(text).toContain('60/100');
    expect(text).toContain('85/100');
  });

  it('should contain estimated remediation hours', async () => {
    const buffer = await generateReadyPdf(assessment, scanInfo, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('Estimated Remediation Hours');
  });

  it('should NOT contain Workload ARN', async () => {
    const buffer = await generateReadyPdf(assessment, scanInfo, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).not.toContain('Workload ARN');
  });

  it('should contain finding severity labels', async () => {
    const buffer = await generateReadyPdf(assessment, scanInfo, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('[HIGH]');
  });
});

// ─── generateDetailPdf ──────────────────────────────────────────────────────

describe('generateDetailPdf', () => {
  const workloadArn = 'arn:aws:wellarchitected:us-east-1:123456789012:workload/abc123';

  it('should return a valid PDF buffer', async () => {
    const buffer = await generateDetailPdf(assessment, scanInfo, workloadArn, NO_COMPRESS);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('should contain Workload ARN in the header', async () => {
    const buffer = await generateDetailPdf(assessment, scanInfo, workloadArn, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('Workload ARN');
    expect(text).toContain(workloadArn);
  });

  it('should contain finding resource ARN and severity', async () => {
    const buffer = await generateDetailPdf(assessment, scanInfo, workloadArn, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('Resource ARN');
    expect(text).toContain('Severity');
    expect(text).toContain('high');
  });

  it('should contain remediation steps', async () => {
    const buffer = await generateDetailPdf(assessment, scanInfo, workloadArn, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('Remediation Steps');
    expect(text).toContain('Restrict SSH to known IPs');
  });

  it('should contain remediation checklist section', async () => {
    const buffer = await generateDetailPdf(assessment, scanInfo, workloadArn, NO_COMPRESS);
    const text = extractPdfText(buffer);
    expect(text).toContain('Remediation Checklist');
  });

  it('should handle assessment with no findings gracefully', async () => {
    const emptyAssessment: AssessmentResult = {
      overallScore: 100,
      pillarResults: [
        makePillar({ findings: [], estimatedRemediationHours: 0 }),
      ],
    };
    const buffer = await generateDetailPdf(emptyAssessment, scanInfo, workloadArn, NO_COMPRESS);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const text = extractPdfText(buffer);
    expect(text).toContain('No findings for this pillar');
  });
});
