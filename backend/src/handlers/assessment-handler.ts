import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import type {
  Assessment,
  AssessmentStatus,
  AssessmentExecutionStatus,
  PillarResult,
  Scan,
  StartAssessmentResponse,
} from '@wafr-portal/shared';
import { docClient, SCANS_TABLE } from '../utils/dynamodb';
import { createProvider, startScan, getScanStatus, getFindings } from '../services/prowler-client';
import { mapFindingsToPillars, calculateOverallScore } from '../services/pillar-mapper';
import { createWorkload, associateLenses } from '../services/wa-tool-client';

const ASSESSMENTS_TABLE = process.env.ASSESSMENTS_TABLE ?? 'wafr-assessments';
const PROWLER_UI_BASE = process.env.PROWLER_UI_BASE ?? 'https://prowler.local';
const PROWLER_FRAMEWORKS = ['WAFR', 'FTR', 'CIS', 'FSBP', 'PCI-DSS'];

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Fetch a scan by scanId using the GSI.
 */
async function fetchScan(scanId: string): Promise<Scan | undefined> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: SCANS_TABLE,
      IndexName: 'scanId-index',
      KeyConditionExpression: 'scanId = :sid',
      ExpressionAttributeValues: { ':sid': scanId },
    }),
  );
  return result.Items?.[0] as Scan | undefined;
}

/**
 * Update the scan record with prowler info.
 */
async function updateScanWithProwlerInfo(
  scan: Scan,
  prowlerScanId: string,
  prowlerUiLink: string,
  status: Scan['status'],
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: SCANS_TABLE,
      Key: { userId: scan.userId, scanId: scan.scanId },
      UpdateExpression:
        'SET prowlerScanId = :psid, prowlerUiLink = :pui, #s = :st, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':psid': prowlerScanId,
        ':pui': prowlerUiLink,
        ':st': status,
        ':now': new Date().toISOString(),
      },
    }),
  );
}

/**
 * POST /scans/{scanId}/assessment — Start a WAFR assessment
 */
export async function startAssessment(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const scanId = event.pathParameters?.scanId;
  if (!scanId) {
    return jsonResponse(400, { message: 'scanId is required' });
  }

  const scan = await fetchScan(scanId);
  if (!scan) {
    return jsonResponse(404, { message: 'Scan not found' });
  }

  try {
    // 1. Create workload in WA Tool
    const { workloadArn, workloadId } = await createWorkload(
      scan.clientName,
      scan.awsAccountNumber,
      scan.awsRegion,
    );

    // 2. Associate lenses
    await associateLenses(workloadId);

    // 3. Create provider in Prowler
    const { providerId } = await createProvider(
      { accessKeyId: '', secretAccessKey: '' }, // credentials are managed externally
      scan.awsRegion,
    );

    // 4. Start scan in Prowler
    const { scanId: prowlerScanId } = await startScan(providerId, PROWLER_FRAMEWORKS);
    const prowlerUiLink = `${PROWLER_UI_BASE}/scans/${prowlerScanId}`;

    // 5. Save prowlerScanId and prowlerUiLink to scan record
    await updateScanWithProwlerInfo(scan, prowlerScanId, prowlerUiLink, 'assessment_in_progress');

    // 6. Create assessment record
    const assessmentId = uuidv4();
    const now = new Date().toISOString();

    const assessment: Assessment = {
      assessmentId,
      scanId,
      workloadArn,
      status: 'running',
      overallScore: 0,
      pillarResults: [],
      startedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: ASSESSMENTS_TABLE,
        Item: assessment,
      }),
    );

    const response: StartAssessmentResponse = { assessmentId };
    return jsonResponse(201, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error starting assessment';
    return jsonResponse(500, { message });
  }
}

/**
 * Process pillar results with partial failure handling.
 * If a pillar errors, mark it as error and continue with the rest.
 */
function applyPartialFailureHandling(pillarResults: PillarResult[]): {
  results: PillarResult[];
  status: AssessmentExecutionStatus;
} {
  const hasError = pillarResults.some((p) => p.status === 'error');
  const allError = pillarResults.every((p) => p.status === 'error');

  let status: AssessmentExecutionStatus = 'completed';
  if (allError) {
    status = 'failed';
  } else if (hasError) {
    status = 'partial_failure';
  }

  return { results: pillarResults, status };
}

/**
 * GET /assessments/{assessmentId}/status — Check assessment status
 */
export async function getAssessmentStatus(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const assessmentId = event.pathParameters?.assessmentId;
  if (!assessmentId) {
    return jsonResponse(400, { message: 'assessmentId is required' });
  }

  // Fetch assessment from DynamoDB using GSI
  const assessmentResult = await docClient.send(
    new QueryCommand({
      TableName: ASSESSMENTS_TABLE,
      IndexName: 'assessmentId-index',
      KeyConditionExpression: 'assessmentId = :aid',
      ExpressionAttributeValues: { ':aid': assessmentId },
    }),
  );

  const assessment = assessmentResult.Items?.[0] as Assessment | undefined;
  if (!assessment) {
    return jsonResponse(404, { message: 'Assessment not found' });
  }

  // If already completed or failed, return cached result
  if (assessment.status !== 'running') {
    const result: AssessmentStatus = {
      assessmentId: assessment.assessmentId,
      status: assessment.status,
      overallScore: assessment.overallScore,
      pillarResults: assessment.pillarResults,
      workloadArn: assessment.workloadArn,
    };
    return jsonResponse(200, result);
  }

  // Check Prowler scan status
  const scan = await fetchScan(assessment.scanId);
  if (!scan?.prowlerScanId) {
    return jsonResponse(200, {
      assessmentId: assessment.assessmentId,
      status: 'running',
    } satisfies AssessmentStatus);
  }

  const prowlerStatus = await getScanStatus(scan.prowlerScanId);

  if (prowlerStatus.status !== 'completed') {
    const result: AssessmentStatus = {
      assessmentId: assessment.assessmentId,
      status: 'running',
      prowlerUiLink: scan.prowlerUiLink,
    };
    return jsonResponse(200, result);
  }

  // Scan completed — get findings, map to pillars, calculate scores
  try {
    const findings = await getFindings(scan.prowlerScanId);
    const pillarResults = mapFindingsToPillars(findings);
    const { results, status } = applyPartialFailureHandling(pillarResults);
    const overallScore = calculateOverallScore(results);
    const now = new Date().toISOString();

    // Update assessment in DynamoDB
    await docClient.send(
      new UpdateCommand({
        TableName: ASSESSMENTS_TABLE,
        Key: { scanId: assessment.scanId, assessmentId },
        UpdateExpression:
          'SET #s = :st, overallScore = :os, pillarResults = :pr, completedAt = :ca',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':st': status,
          ':os': overallScore,
          ':pr': results,
          ':ca': now,
        },
      }),
    );

    // Update scan status
    const scanStatus = status === 'failed' ? 'assessment_failed' : 'assessment_completed';
    await docClient.send(
      new UpdateCommand({
        TableName: SCANS_TABLE,
        Key: { userId: scan.userId, scanId: scan.scanId },
        UpdateExpression: 'SET #s = :st, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':st': scanStatus,
          ':now': now,
        },
      }),
    );

    const result: AssessmentStatus = {
      assessmentId,
      status,
      overallScore,
      pillarResults: results,
      prowlerUiLink: scan.prowlerUiLink,
      workloadArn: assessment.workloadArn,
    };
    return jsonResponse(200, result);
  } catch (error) {
    // If processing fails, mark as failed
    await docClient.send(
      new UpdateCommand({
        TableName: ASSESSMENTS_TABLE,
        Key: { scanId: assessment.scanId, assessmentId },
        UpdateExpression: 'SET #s = :st, completedAt = :ca',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':st': 'failed',
          ':ca': new Date().toISOString(),
        },
      }),
    );

    const message = error instanceof Error ? error.message : 'Error processing assessment results';
    return jsonResponse(500, { message });
  }
}

/**
 * GET /scans/{scanId}/prowler-link — Return the Prowler UI link for a scan
 */
export async function getProwlerLink(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const scanId = event.pathParameters?.scanId;
  if (!scanId) {
    return jsonResponse(400, { message: 'scanId is required' });
  }

  const scan = await fetchScan(scanId);
  if (!scan) {
    return jsonResponse(404, { message: 'Scan not found' });
  }

  if (!scan.prowlerUiLink) {
    return jsonResponse(404, { message: 'Prowler UI link not available yet' });
  }

  return jsonResponse(200, { prowlerUiLink: scan.prowlerUiLink });
}

/**
 * Router handler — dispatches based on HTTP method and resource path.
 *
 * Routes:
 *   POST /scans/{scanId}/assessment          → startAssessment
 *   GET  /assessments/{assessmentId}/status   → getAssessmentStatus
 *   GET  /scans/{scanId}/prowler-link         → getProwlerLink
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const resource = event.resource ?? '';

  if (method === 'POST' && resource.includes('/assessment')) {
    return startAssessment(event);
  }

  if (method === 'GET' && resource.includes('/status')) {
    return getAssessmentStatus(event);
  }

  if (method === 'GET' && resource.includes('/prowler-link')) {
    return getProwlerLink(event);
  }

  return jsonResponse(405, { message: 'Method not allowed' });
}
