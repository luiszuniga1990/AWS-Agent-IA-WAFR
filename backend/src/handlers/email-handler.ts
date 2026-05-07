import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Assessment, Scan, AssessmentResult, ScanInfo } from '@wafr-portal/shared';
import { docClient, SCANS_TABLE } from '../utils/dynamodb';
import { generateReadyPdf, generateDetailPdf } from '../services/pdf-generator';
import { sendReadyReport, sendDetailReport } from '../services/email-sender';

const ASSESSMENTS_TABLE = process.env.ASSESSMENTS_TABLE ?? 'wafr-assessments';

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

async function fetchAssessment(assessmentId: string): Promise<Assessment | undefined> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: ASSESSMENTS_TABLE,
      IndexName: 'assessmentId-index',
      KeyConditionExpression: 'assessmentId = :aid',
      ExpressionAttributeValues: { ':aid': assessmentId },
    }),
  );
  return result.Items?.[0] as Assessment | undefined;
}

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

async function updateScanStatus(
  scan: Scan,
  status: Scan['status'],
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: SCANS_TABLE,
      Key: { userId: scan.userId, scanId: scan.scanId },
      UpdateExpression: 'SET #s = :st, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':st': status,
        ':now': new Date().toISOString(),
      },
    }),
  );
}

/**
 * Router handler — dispatches to sendEmails.
 *
 * Routes:
 *   POST /assessments/{assessmentId}/emails → sendEmails
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return sendEmails(event);
}

/**
 * POST /assessments/{assessmentId}/emails — Send report emails after PDFs are generated.
 *
 * 1. Fetch assessment and scan from DynamoDB
 * 2. Generate both PDFs
 * 3. Send Ready PDF to VDM partner email, Detail PDF to technical team
 * 4. Update scan status to 'emails_sent' or 'emails_failed'
 */
export async function sendEmails(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const assessmentId = event.pathParameters?.assessmentId;
  if (!assessmentId) {
    return jsonResponse(400, { message: 'assessmentId is required' });
  }

  const assessment = await fetchAssessment(assessmentId);
  if (!assessment) {
    return jsonResponse(404, { message: 'Assessment not found' });
  }

  if (assessment.status === 'running') {
    return jsonResponse(409, { message: 'Assessment is still running' });
  }

  const scan = await fetchScan(assessment.scanId);
  if (!scan) {
    return jsonResponse(404, { message: 'Scan not found' });
  }

  const scanInfo: ScanInfo = {
    partnerName: scan.partnerName,
    clientName: scan.clientName,
    awsAccountNumber: scan.awsAccountNumber,
    awsRegion: scan.awsRegion,
    createdAt: scan.createdAt,
  };

  const assessmentResult: AssessmentResult = {
    overallScore: assessment.overallScore,
    pillarResults: assessment.pillarResults,
  };

  const date = scan.createdAt.split('T')[0];

  try {
    // Generate both PDFs
    const [readyPdf, detailPdf] = await Promise.all([
      generateReadyPdf(assessmentResult, scanInfo),
      generateDetailPdf(assessmentResult, scanInfo, assessment.workloadArn),
    ]);

    // Send emails
    const [readyResult, detailResult] = await Promise.all([
      sendReadyReport(scan.partnerEmail, readyPdf, scan.clientName, date),
      sendDetailReport(detailPdf, scan.clientName, date),
    ]);

    const allSuccess = readyResult.success && detailResult.success;
    const newStatus = allSuccess ? 'emails_sent' : 'emails_failed';

    await updateScanStatus(scan, newStatus);

    return jsonResponse(200, {
      status: newStatus,
      readyEmail: readyResult,
      detailEmail: detailResult,
    });
  } catch (error) {
    await updateScanStatus(scan, 'emails_failed');
    const message = error instanceof Error ? error.message : 'Error sending emails';
    return jsonResponse(500, { message });
  }
}
