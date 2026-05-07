import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { GetPrerequisitesResponse } from '@wafr-portal/shared';
import { getPrerequisiteStatus } from '../services/prerequisite-checker';
import { docClient, SCANS_TABLE } from '../utils/dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

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

async function getScanByIdFromDb(scanId: string) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: SCANS_TABLE,
      IndexName: 'scanId-index',
      KeyConditionExpression: 'scanId = :sid',
      ExpressionAttributeValues: { ':sid': scanId },
    }),
  );
  return result.Items?.[0] as
    | { scanId: string; userId: string; awsRegion: string }
    | undefined;
}

/**
 * Router handler — dispatches to checkPrerequisites.
 *
 * Routes:
 *   GET /scans/{scanId}/prerequisites → checkPrerequisites
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return checkPrerequisites(event);
}

/**
 * GET /scans/{scanId}/prerequisites
 * Validate AWS Config and Security Hub prerequisites for the scan.
 *
 * Note: In production, credentials would be retrieved from a secure temporary store.
 * This handler expects credentials in the request body or via a secure mechanism.
 */
export async function checkPrerequisites(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const scanId = event.pathParameters?.scanId;
  if (!scanId) {
    return jsonResponse(400, { message: 'scanId is required' });
  }

  const scan = await getScanByIdFromDb(scanId);
  if (!scan) {
    return jsonResponse(404, { message: 'Scan not found' });
  }

  // Parse credentials from request body
  let accessKeyId: string;
  let secretAccessKey: string;
  try {
    const body = JSON.parse(event.body ?? '{}');
    accessKeyId = body.accessKeyId;
    secretAccessKey = body.secretAccessKey;
  } catch {
    return jsonResponse(400, { message: 'Invalid JSON body' });
  }

  if (!accessKeyId || !secretAccessKey) {
    return jsonResponse(400, {
      message: 'accessKeyId and secretAccessKey are required',
    });
  }

  const credentials = { accessKeyId, secretAccessKey };

  try {
    const prerequisiteResult = await getPrerequisiteStatus(credentials, scan.awsRegion);

    // Clear credentials from memory
    credentials.accessKeyId = '';
    credentials.secretAccessKey = '';

    const response: GetPrerequisitesResponse = { prerequisiteResult };
    return jsonResponse(200, response);
  } catch (err: unknown) {
    // Clear credentials from memory even on error
    credentials.accessKeyId = '';
    credentials.secretAccessKey = '';

    const message = err instanceof Error ? err.message : 'Prerequisite check failed';
    return jsonResponse(500, { message });
  }
}
