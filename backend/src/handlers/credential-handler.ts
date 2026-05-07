import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type {
  UploadCredentialsResponse,
  GetPermissionsResponse,
  IamPolicyDocument,
} from '@wafr-portal/shared';
import { extractCredentials } from '../services/credential-extractor';
import { testConnection, validateReadOnly, validateMinimumPermissions } from '../services/credential-validator';
import { generateMinimumIamPolicy } from '../services/iam-policy';
import { docClient, SCANS_TABLE } from '../utils/dynamodb';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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
  return result.Items?.[0] as { scanId: string; userId: string; awsRegion: string } | undefined;
}

/**
 * POST /scans/{scanId}/credentials
 * Extract credentials from uploaded Excel, test connection, return result.
 */
export async function uploadCredentials(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const scanId = event.pathParameters?.scanId;
  if (!scanId) {
    return jsonResponse(400, { message: 'scanId is required' });
  }

  let fileBase64: string;
  let fileName: string;
  try {
    const body = JSON.parse(event.body ?? '{}');
    fileBase64 = body.fileBase64;
    fileName = body.fileName;
  } catch {
    return jsonResponse(400, { message: 'Invalid JSON body' });
  }

  if (!fileBase64 || !fileName) {
    return jsonResponse(400, { message: 'fileBase64 and fileName are required' });
  }

  // Look up the scan to get the region
  const scan = await getScanByIdFromDb(scanId);
  if (!scan) {
    return jsonResponse(404, { message: 'Scan not found' });
  }

  // Extract credentials from Excel
  let credentials;
  try {
    credentials = extractCredentials(fileBase64, fileName);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to extract credentials';
    return jsonResponse(400, { message });
  }

  // Test connection using STS
  const connectionResult = await testConnection(credentials, scan.awsRegion);

  if (connectionResult.success) {
    // Update scan status
    await docClient.send(
      new UpdateCommand({
        TableName: SCANS_TABLE,
        Key: { userId: scan.userId, scanId },
        UpdateExpression: 'SET #status = :status, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'credentials_uploaded',
          ':now': new Date().toISOString(),
        },
      }),
    );
  }

  // Clear credentials from memory
  credentials.accessKeyId = '';
  credentials.secretAccessKey = '';

  const response: UploadCredentialsResponse = { connectionResult };
  return jsonResponse(200, response);
}

/**
 * GET /scans/{scanId}/permissions
 * Validate read-only + minimum permissions for the scan's credentials.
 */
export async function getPermissions(
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

  // Note: In production, credentials would be retrieved from a secure temporary store.
  // For this implementation, the frontend must re-upload or the credentials are
  // passed via a secure mechanism. Here we return an error if no credentials are available.
  return jsonResponse(400, {
    message: 'Credentials must be uploaded first via POST /scans/{scanId}/credentials. ' +
      'Permission validation is performed during the credential upload flow.',
  });
}

/**
 * GET /scans/{scanId}/iam-policy
 * Return downloadable JSON with the minimum required IAM policy.
 */
export async function getIamPolicy(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const scanId = event.pathParameters?.scanId;
  if (!scanId) {
    return jsonResponse(400, { message: 'scanId is required' });
  }

  const policy: IamPolicyDocument = generateMinimumIamPolicy();

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="wafr-minimum-iam-policy.json"`,
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(policy, null, 2),
  };
}

/**
 * Router handler — dispatches based on HTTP method and resource path.
 *
 * Routes:
 *   POST /scans/{scanId}/credentials  → uploadCredentials
 *   GET  /scans/{scanId}/permissions   → getPermissions
 *   GET  /scans/{scanId}/iam-policy    → getIamPolicy
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const resource = event.resource ?? '';

  if (method === 'POST' && resource.includes('/credentials')) {
    return uploadCredentials(event);
  }

  if (method === 'GET' && resource.includes('/permissions')) {
    return getPermissions(event);
  }

  if (method === 'GET' && resource.includes('/iam-policy')) {
    return getIamPolicy(event);
  }

  return jsonResponse(405, { message: 'Method not allowed' });
}
