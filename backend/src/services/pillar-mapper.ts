import type {
  ProwlerFinding,
  PillarResult,
  PillarName,
  Finding,
  FindingSeverity,
} from '@wafr-portal/shared';

/** Pillar names in canonical order. */
export const ALL_PILLARS: PillarName[] = [
  'operational_excellence',
  'security',
  'reliability',
  'performance_efficiency',
  'cost_optimization',
  'sustainability',
];

/**
 * Keywords in the Prowler compliance field that map to each WAFR pillar.
 * Prowler findings include a `compliance` map where keys are framework names
 * and values are arrays of control identifiers. We match against both keys
 * and values (case-insensitive).
 */
const PILLAR_KEYWORDS: Record<PillarName, string[]> = {
  operational_excellence: ['operational-excellence', 'operational_excellence', 'operationalexcellence'],
  security: ['security', 'securityhub', 'cis', 'pci', 'fsbp', 'foundational'],
  reliability: ['reliability', 'reliable'],
  performance_efficiency: ['performance', 'performance-efficiency', 'performance_efficiency'],
  cost_optimization: ['cost', 'cost-optimization', 'cost_optimization'],
  sustainability: ['sustainability'],
};

/** Weights for the overall score calculation (equal weight per pillar). */
const PILLAR_WEIGHTS: Record<PillarName, number> = {
  operational_excellence: 1,
  security: 1,
  reliability: 1,
  performance_efficiency: 1,
  cost_optimization: 1,
  sustainability: 1,
};

/** Estimated remediation hours per finding by severity. */
const HOURS_PER_SEVERITY: Record<FindingSeverity, number> = {
  critical: 4,
  high: 2,
  medium: 1,
};

const RELEVANT_SEVERITIES = new Set<string>(['critical', 'high', 'medium']);

/**
 * Determine which pillar a Prowler finding belongs to based on its compliance field.
 * Returns 'security' as default if no specific pillar can be determined.
 */
export function classifyPillar(finding: ProwlerFinding): PillarName {
  const complianceText = JSON.stringify(finding.compliance).toLowerCase();

  for (const pillar of ALL_PILLARS) {
    for (const keyword of PILLAR_KEYWORDS[pillar]) {
      if (complianceText.includes(keyword)) {
        return pillar;
      }
    }
  }

  // Default to security if no pillar keyword matched
  return 'security';
}

/**
 * Map Prowler findings to the 6 WAFR pillar results.
 *
 * - Filters only FAIL findings with severity critical, high, or medium.
 * - Calculates score per pillar: (passedChecks / totalChecks) * 100.
 * - Estimates remediation hours based on finding count and severity.
 */
export function mapFindingsToPillars(prowlerFindings: ProwlerFinding[]): PillarResult[] {
  // Group all findings (PASS + FAIL) by pillar for score calculation
  const pillarTotals: Record<PillarName, { total: number; passed: number }> = {} as any;
  const pillarFailFindings: Record<PillarName, Finding[]> = {} as any;

  for (const pillar of ALL_PILLARS) {
    pillarTotals[pillar] = { total: 0, passed: 0 };
    pillarFailFindings[pillar] = [];
  }

  for (const finding of prowlerFindings) {
    const pillar = classifyPillar(finding);

    // Count all findings for score (PASS, FAIL, etc.)
    if (finding.status === 'PASS' || finding.status === 'FAIL') {
      pillarTotals[pillar].total += 1;
      if (finding.status === 'PASS') {
        pillarTotals[pillar].passed += 1;
      }
    }

    // Collect only FAIL findings with relevant severity
    if (finding.status === 'FAIL' && RELEVANT_SEVERITIES.has(finding.severity)) {
      pillarFailFindings[pillar].push({
        findingId: finding.checkId,
        resourceArn: finding.resourceArn,
        description: finding.description,
        severity: finding.severity as FindingSeverity,
        pillar,
        remediationSteps: finding.remediation ? [finding.remediation] : [],
      });
    }
  }

  return ALL_PILLARS.map((pillar) => {
    const { total, passed } = pillarTotals[pillar];
    const score = total > 0 ? Math.round((passed / total) * 100) : 100;
    const findings = pillarFailFindings[pillar];

    let estimatedRemediationHours = 0;
    for (const f of findings) {
      estimatedRemediationHours += HOURS_PER_SEVERITY[f.severity] ?? 1;
    }

    return {
      pillarName: pillar,
      score,
      findings,
      estimatedRemediationHours,
      status: 'completed' as const,
    };
  });
}

/**
 * Calculate the overall score as a weighted average of the 6 pillar scores.
 */
export function calculateOverallScore(pillarResults: PillarResult[]): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const result of pillarResults) {
    const weight = PILLAR_WEIGHTS[result.pillarName] ?? 1;
    weightedSum += result.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round(weightedSum / totalWeight);
}
