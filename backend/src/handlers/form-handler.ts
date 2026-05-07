import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import type { Scan, ScanFormData, CreateScanResponse } from '@wafr-portal/shared';
import { validateScanForm } from '../utils/validators';
import { docClient, SCANS_TABLE } from '../utils/dynamodb';

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

function getUserId(event: APIGatewayProxyEvent): string | null {
  return event.requestContext.authorizer?.claims?.sub ?? null;
}

/**
 * POST /scans — Create a new scan from form data
 */
export async function createScan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return jsonResponse(401, { message: 'Unauthorized' });
  }

  let formData: ScanFormData | undefined;
  try {
    const body = JSON.parse(event.body ?? '{}');
    formData = body.formData;
  } catch {
    return jsonResponse(400, { message: 'Invalid JSON body' });
  }

  const validationError = validateScanForm(formData);
  if (validationError) {
    return jsonResponse(validationError.statusCode, validationError);
  }

  // formData is guaranteed non-null after validation
  const data = formData as ScanFormData;
  const now = new Date().toISOString();
  const scanId = uuidv4();

  const scan: Scan = {
    scanId,
    userId,
    partnerName: data.partnerName,
    partnerEmail: data.partnerEmail,
    country: data.country,
    clientName: data.clientName,
    awsAccountNumber: data.awsAccountNumber,
    awsRegion: data.awsRegion,
    status: 'form_submitted',
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: SCANS_TABLE,
      Item: scan,
    })
  );

  const response: CreateScanResponse = { scanId };
  return jsonResponse(201, response);
}

/**
 * GET /scans — Get scan history for the authenticated user
 */
export async function getScanHistory(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return jsonResponse(401, { message: 'Unauthorized' });
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: SCANS_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward: false,
    })
  );

  return jsonResponse(200, { scans: result.Items ?? [] });
}

/**
 * GET /scans/{scanId} — Get a single scan by scanId (uses GSI)
 */
export async function getScan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const scanId = event.pathParameters?.scanId;
  if (!scanId) {
    return jsonResponse(400, { message: 'scanId is required' });
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: SCANS_TABLE,
      IndexName: 'scanId-index',
      KeyConditionExpression: 'scanId = :sid',
      ExpressionAttributeValues: { ':sid': scanId },
    })
  );

  const scan = result.Items?.[0];
  if (!scan) {
    return jsonResponse(404, { message: 'Scan not found' });
  }

  return jsonResponse(200, scan);
}

/**
 * Router handler — dispatches based on HTTP method and path.
 * Used as the single Lambda entry point for API Gateway proxy integration.
 *
 * Routes:
 *   POST /scans           → createScan
 *   GET  /scans            → getScanHistory
 *   GET  /scans/{scanId}   → getScan
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const scanId = event.pathParameters?.scanId;

  if (method === 'POST' && !scanId) {
    return createScan(event);
  }

  if (method === 'GET' && scanId) {
    return getScan(event);
  }

  if (method === 'GET' && !scanId) {
    return getScanHistory(event);
  }

  return jsonResponse(405, { message: 'Method not allowed' });
}
