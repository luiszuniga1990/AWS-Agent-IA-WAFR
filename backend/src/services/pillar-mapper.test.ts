import type { ProwlerFinding, PillarResult } from '@wafr-portal/shared';
import {
  mapFindingsToPillars,
  calculateOverallScore,
  classifyPillar,
  ALL_PILLARS,
} from './pillar-mapper';

function makeFinding(overrides: Partial<ProwlerFinding> = {}): ProwlerFinding {
  return {
    checkId: 'check-001',
    resourceArn: 'arn:aws:ec2:us-east-1:123456789012:instance/i-abc',
    status: 'FAIL',
    severity: 'high',
    description: 'Test finding',
    remediation: 'Fix it',
    compliance: { 'aws-well-architected-security': ['SEC-01'] },
    service: 'ec2',
    region: 'us-east-1',
    ...overrides,
  };
}

describe('classifyPillar', () => {
  it('maps security compliance to security pillar', () => {
    const finding = makeFinding({ compliance: { 'aws-well-architected-security': ['SEC-01'] } });
    expect(classifyPillar(finding)).toBe('security');
  });

  it('maps reliability compliance to reliability pillar', () => {
    const finding = makeFinding({ compliance: { 'aws-well-architected-reliability': ['REL-01'] } });
    expect(classifyPillar(finding)).toBe('reliability');
  });

  it('maps performance compliance to performance_efficiency pillar', () => {
    const finding = makeFinding({ compliance: { 'performance-efficiency': ['PERF-01'] } });
    expect(classifyPillar(finding)).toBe('performance_efficiency');
  });

  it('maps cost compliance to cost_optimization pillar', () => {
    const finding = makeFinding({ compliance: { 'cost-optimization': ['COST-01'] } });
    expect(classifyPillar(finding)).toBe('cost_optimization');
  });

  it('maps operational-excellence compliance to operational_excellence pillar', () => {
    const finding = makeFinding({ compliance: { 'operational-excellence': ['OPS-01'] } });
    expect(classifyPillar(finding)).toBe('operational_excellence');
  });

  it('maps sustainability compliance to sustainability pillar', () => {
    const finding = makeFinding({ compliance: { sustainability: ['SUS-01'] } });
    expect(classifyPillar(finding)).toBe('sustainability');
  });

  it('defaults to security when no pillar keyword matches', () => {
    const finding = makeFinding({ compliance: { 'unknown-framework': ['UNK-01'] } });
    expect(classifyPillar(finding)).toBe('security');
  });
});

describe('mapFindingsToPillars', () => {
  it('returns exactly 6 pillar results for empty input', () => {
    const results = mapFindingsToPillars([]);
    expect(results).toHaveLength(6);
    expect(results.map((r) => r.pillarName)).toEqual(ALL_PILLARS);
  });

  it('gives score 100 to pillars with no findings', () => {
    const results = mapFindingsToPillars([]);
    for (const r of results) {
      expect(r.score).toBe(100);
    }
  });

  it('calculates score based on passed/total checks', () => {
    const findings: ProwlerFinding[] = [
      makeFinding({ checkId: 'c1', status: 'PASS', compliance: { security: ['S1'] } }),
      makeFinding({ checkId: 'c2', status: 'PASS', compliance: { security: ['S2'] } }),
      makeFinding({ checkId: 'c3', status: 'FAIL', severity: 'high', compliance: { security: ['S3'] } }),
    ];
    const results = mapFindingsToPillars(findings);
    const securityPillar = results.find((r) => r.pillarName === 'security')!;
    // 2 passed out of 3 total = 67%
    expect(securityPillar.score).toBe(67);
  });

  it('filters only FAIL findings with critical/high/medium severity', () => {
    const findings: ProwlerFinding[] = [
      makeFinding({ checkId: 'c1', status: 'FAIL', severity: 'high' }),
      makeFinding({ checkId: 'c2', status: 'FAIL', severity: 'low' }),
      makeFinding({ checkId: 'c3', status: 'FAIL', severity: 'informational' }),
      makeFinding({ checkId: 'c4', status: 'PASS', severity: 'high' }),
      makeFinding({ checkId: 'c5', status: 'INFO', severity: 'high' }),
    ];
    const results = mapFindingsToPillars(findings);
    const securityPillar = results.find((r) => r.pillarName === 'security')!;
    // Only c1 is FAIL + high severity
    expect(securityPillar.findings).toHaveLength(1);
    expect(securityPillar.findings[0].findingId).toBe('c1');
  });

  it('estimates remediation hours based on severity', () => {
    const findings: ProwlerFinding[] = [
      makeFinding({ checkId: 'c1', status: 'FAIL', severity: 'critical' }), // 4h
      makeFinding({ checkId: 'c2', status: 'FAIL', severity: 'high' }),     // 2h
      makeFinding({ checkId: 'c3', status: 'FAIL', severity: 'medium' }),   // 1h
    ];
    const results = mapFindingsToPillars(findings);
    const securityPillar = results.find((r) => r.pillarName === 'security')!;
    expect(securityPillar.estimatedRemediationHours).toBe(7); // 4 + 2 + 1
  });

  it('distributes findings across multiple pillars', () => {
    const findings: ProwlerFinding[] = [
      makeFinding({ checkId: 'c1', status: 'FAIL', severity: 'high', compliance: { security: ['S1'] } }),
      makeFinding({ checkId: 'c2', status: 'FAIL', severity: 'high', compliance: { reliability: ['R1'] } }),
      makeFinding({ checkId: 'c3', status: 'FAIL', severity: 'medium', compliance: { 'cost-optimization': ['C1'] } }),
    ];
    const results = mapFindingsToPillars(findings);
    expect(results.find((r) => r.pillarName === 'security')!.findings).toHaveLength(1);
    expect(results.find((r) => r.pillarName === 'reliability')!.findings).toHaveLength(1);
    expect(results.find((r) => r.pillarName === 'cost_optimization')!.findings).toHaveLength(1);
  });

  it('sets status to completed for all pillars', () => {
    const results = mapFindingsToPillars([makeFinding()]);
    for (const r of results) {
      expect(r.status).toBe('completed');
    }
  });
});

describe('calculateOverallScore', () => {
  it('returns 0 when no pillar results are provided', () => {
    expect(calculateOverallScore([])).toBe(0);
  });

  it('returns the average of all pillar scores (equal weights)', () => {
    const pillarResults: PillarResult[] = ALL_PILLARS.map((pillarName, i) => ({
      pillarName,
      score: (i + 1) * 10, // 10, 20, 30, 40, 50, 60
      findings: [],
      estimatedRemediationHours: 0,
      status: 'completed' as const,
    }));
    // Average of 10+20+30+40+50+60 = 210/6 = 35
    expect(calculateOverallScore(pillarResults)).toBe(35);
  });

  it('returns 100 when all pillars score 100', () => {
    const pillarResults: PillarResult[] = ALL_PILLARS.map((pillarName) => ({
      pillarName,
      score: 100,
      findings: [],
      estimatedRemediationHours: 0,
      status: 'completed' as const,
    }));
    expect(calculateOverallScore(pillarResults)).toBe(100);
  });

  it('returns 0 when all pillars score 0', () => {
    const pillarResults: PillarResult[] = ALL_PILLARS.map((pillarName) => ({
      pillarName,
      score: 0,
      findings: [],
      estimatedRemediationHours: 0,
      status: 'completed' as const,
    }));
    expect(calculateOverallScore(pillarResults)).toBe(0);
  });
});
