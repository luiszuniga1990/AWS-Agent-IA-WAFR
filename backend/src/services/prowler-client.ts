import axios, { AxiosInstance } from 'axios';
import type { AwsCredentials, ProwlerFinding, ProwlerScanStatus } from '@wafr-portal/shared';

const PROWLER_API_URL = process.env.PROWLER_API_URL ?? 'http://localhost:8080';

function createHttpClient(): AxiosInstance {
  return axios.create({
    baseURL: PROWLER_API_URL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create a provider in Prowler with the given AWS credentials.
 */
export async function createProvider(
  credentials: AwsCredentials,
  region: string,
): Promise<{ providerId: string }> {
  const client = createHttpClient();
  const response = await client.post('/api/v1/providers', {
    provider: 'aws',
    uid: credentials.accessKeyId,
    credentials: {
      aws_access_key_id: credentials.accessKeyId,
      aws_secret_access_key: credentials.secretAccessKey,
    },
    region,
  });
  return { providerId: response.data.id };
}

/**
 * Start a scan in Prowler for the given provider and frameworks.
 */
export async function startScan(
  providerId: string,
  frameworks: string[],
): Promise<{ scanId: string }> {
  const client = createHttpClient();
  const response = await client.post('/api/v1/scans', {
    providerId,
    scannerArgs: {
      checksToExecute: [],
      frameworksToScan: frameworks,
    },
  });
  return { scanId: response.data.id };
}

/**
 * Poll the status of a running Prowler scan.
 */
export async function getScanStatus(scanId: string): Promise<ProwlerScanStatus> {
  const client = createHttpClient();
  const response = await client.get(`/api/v1/scans/${scanId}`);
  return {
    scanId: response.data.id,
    status: response.data.state ?? response.data.status,
  };
}

/**
 * Retrieve findings from a completed Prowler scan.
 */
export async function getFindings(scanId: string): Promise<ProwlerFinding[]> {
  const client = createHttpClient();
  const findings: ProwlerFinding[] = [];
  let nextUrl: string | null = `/api/v1/findings?scanId=${scanId}`;

  while (nextUrl) {
    const url: string = nextUrl;
    const response = await client.get<{
      results?: Record<string, unknown>[];
      data?: Record<string, unknown>[];
      next?: string | null;
    }>(url);
    const data = response.data;

    for (const item of data.results ?? data.data ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = item as any;
      findings.push({
        checkId: String(raw.checkId ?? raw.check_id ?? ''),
        resourceArn: String(raw.resourceArn ?? raw.resource_arn ?? ''),
        status: raw.status ?? 'INFO',
        severity: String(raw.severity ?? 'informational').toLowerCase() as ProwlerFinding['severity'],
        description: String(raw.description ?? raw.statusExtended ?? ''),
        remediation: String(raw.remediation ?? raw.remediationRecommendation ?? ''),
        compliance: (raw.compliance ?? {}) as Record<string, string[]>,
        service: String(raw.service ?? ''),
        region: String(raw.region ?? ''),
      });
    }

    nextUrl = data.next ?? null;
  }

  return findings;
}
