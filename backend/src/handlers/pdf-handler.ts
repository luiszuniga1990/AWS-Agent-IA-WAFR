import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  Assessment,
  Scan,
  PdfType,
  AssessmentResult,
  ScanInfo,
} from '@wafr-portal/shared';
import { docClient, SCANS_TABLE } from '../utils/dynamodb';
import { generateReadyPdf, generateDetailPdf } from '../services/pdf-generator';

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

/** Fetch assessment by assessmentId using GSI. */
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

/** Fetch scan by scanId using GSI. */
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
 * Router handler — dispatches to generatePdf.
 *
 * Routes:
 *   GET /assessments/{assessmentId}/pdf/{type} → generatePdf
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generatePdf(event);
}

/**
 * GET /assessments/{assessmentId}/pdf/{type}
 *
 * Generates and returns a PDF (base64-encoded) for the given assessment.
 * type = 'ready' → WAFR Ready PDF
 * type = 'detail' → WAFR Detail PDF
 */
export async function generatePdf(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const assessmentId = event.pathParameters?.assessmentId;
  const pdfType = event.pathParameters?.type as PdfType | undefined;

  if (!assessmentId) {
    return jsonResponse(400, { message: 'assessmentId is required' });
  }
  if (!pdfType || (pdfType !== 'ready' && pdfType !== 'detail')) {
    return jsonResponse(400, { message: "type must be 'ready' or 'detail'" });
  }

  // 1. Fetch assessment
  const assessment = await fetchAssessment(assessmentId);
  if (!assessment) {
    return jsonResponse(404, { message: 'Assessment not found' });
  }

  if (assessment.status === 'running') {
    return jsonResponse(409, { message: 'Assessment is still running' });
  }

  // 2. Fetch scan info
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

  try {
    let pdfBuffer: Buffer;

    if (pdfType === 'ready') {
      pdfBuffer = await generateReadyPdf(assessmentResult, scanInfo);
    } else {
      pdfBuffer = await generateDetailPdf(assessmentResult, scanInfo, assessment.workloadArn);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="wafr-${pdfType}-${assessmentId}.pdf"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: pdfBuffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error generating PDF';
    return jsonResponse(500, { message });
  }
}
