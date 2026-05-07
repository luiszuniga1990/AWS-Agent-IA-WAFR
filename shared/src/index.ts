// ============================================================
// WAFR Scan Portal — Shared Types & Interfaces
// ============================================================

// --- Enums & Literal Types ---

export type ScanStatus =
  | 'form_submitted'
  | 'credentials_uploaded'
  | 'connection_validated'
  | 'permissions_validated'
  | 'prerequisites_validated'
  | 'assessment_in_progress'
  | 'assessment_completed'
  | 'assessment_failed'
  | 'pdfs_generated'
  | 'emails_sent'
  | 'emails_failed';

export type AssessmentExecutionStatus =
  | 'running'
  | 'completed'
  | 'partial_failure'
  | 'failed';

export type PillarName =
  | 'operational_excellence'
  | 'security'
  | 'reliability'
  | 'performance_efficiency'
  | 'cost_optimization'
  | 'sustainability';

export type FindingSeverity = 'critical' | 'high' | 'medium';

export type ProwlerFindingStatus = 'FAIL' | 'PASS' | 'INFO' | 'WARN';

export type ProwlerSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'informational';


// --- Core Domain Models ---

export interface Scan {
  scanId: string;
  userId: string;
  partnerName: string;
  partnerEmail: string;
  country: string;
  clientName: string;
  awsAccountNumber: string;
  awsRegion: string;
  status: ScanStatus;
  prowlerScanId?: string;
  prowlerUiLink?: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface ScanFormData {
  partnerName: string;
  partnerEmail: string;
  country: string;
  clientName: string;
  awsAccountNumber: string;
  awsRegion: string;
}

export interface Assessment {
  assessmentId: string;
  scanId: string;
  workloadArn: string;
  status: AssessmentExecutionStatus;
  overallScore: number;
  pillarResults: PillarResult[];
  startedAt: string;
  completedAt?: string;
}

export interface PillarResult {
  pillarName: PillarName;
  score: number; // 0-100
  findings: Finding[];
  estimatedRemediationHours: number;
  status: 'completed' | 'error';
  errorMessage?: string;
}

export interface Finding {
  findingId: string;
  resourceArn: string;
  description: string;
  severity: FindingSeverity;
  pillar: PillarName;
  remediationSteps: string[];
  remediationConsoleUrl?: string;
}


// --- Validation Models ---

export interface ValidationResult {
  connectionValid: boolean;
  connectionError?: string;
  permissionsValid: boolean;
  missingPermissions?: MissingPermission[];
  hasWriteAccess: boolean;
}

export interface MissingPermission {
  service: string;
  actions: string[];
}

export interface PrerequisiteResult {
  allPassed: boolean;
  configEnabled: boolean;
  configRecording: boolean;
  securityHubEnabled: boolean;
  standards: {
    fsbp: boolean;
    cis: boolean;
    pciDss: boolean;
  };
}

// --- Credentials ---

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

// --- Prowler Models ---

export interface ProwlerFinding {
  checkId: string;
  resourceArn: string;
  status: ProwlerFindingStatus;
  severity: ProwlerSeverity;
  description: string;
  remediation: string;
  compliance: Record<string, string[]>; // framework -> controls
  service: string;
  region: string;
}

export interface ProwlerScanStatus {
  scanId: string;
  status: 'running' | 'completed' | 'failed';
}


// --- Service Result Types ---

export interface ConnectionResult {
  success: boolean;
  accountId?: string;
  error?: string;
}

export interface PermissionResult {
  valid: boolean;
  missingPermissions?: MissingPermission[];
  hasWriteAccess?: boolean;
  writeActions?: string[];
}

export interface ConfigStatus {
  enabled: boolean;
  recording: boolean;
}

export interface SecurityHubStatus {
  enabled: boolean;
  standards: {
    fsbp: boolean;
    cis: boolean;
    pciDss: boolean;
  };
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// --- Assessment Helpers ---

export interface AssessmentStatus {
  assessmentId: string;
  status: AssessmentExecutionStatus;
  overallScore?: number;
  pillarResults?: PillarResult[];
  prowlerUiLink?: string;
  workloadArn?: string;
}

export interface AssessmentSummary {
  scanId: string;
  assessmentId: string;
  clientName: string;
  createdAt: string;
  overallScore: number;
  status: AssessmentExecutionStatus;
  workloadArn?: string;
  prowlerUiLink?: string;
}

export interface WorkloadParams {
  clientName: string;
  awsAccountNumber: string;
  awsRegion: string;
}

// --- Auth ---

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}


// --- API Request / Response Types ---

// POST /scans
export interface CreateScanRequest {
  formData: ScanFormData;
}

export interface CreateScanResponse {
  scanId: string;
}

// POST /scans/{scanId}/credentials
export interface UploadCredentialsRequest {
  scanId: string;
  fileBase64: string;
  fileName: string;
}

export interface UploadCredentialsResponse {
  connectionResult: ConnectionResult;
}

// GET /scans/{scanId}/permissions
export interface GetPermissionsResponse {
  permissionResult: PermissionResult;
}

// GET /scans/{scanId}/prerequisites
export interface GetPrerequisitesResponse {
  prerequisiteResult: PrerequisiteResult;
}

// GET /scans/{scanId}/iam-policy
export interface IamPolicyDocument {
  Version: string;
  Statement: IamPolicyStatement[];
}

export interface IamPolicyStatement {
  Effect: 'Allow' | 'Deny';
  Action: string[];
  Resource: string;
}

// POST /scans/{scanId}/assessment
export interface StartAssessmentRequest {
  scanId: string;
}

export interface StartAssessmentResponse {
  assessmentId: string;
}

// GET /assessments/{assessmentId}/status
export type GetAssessmentStatusResponse = AssessmentStatus;

// GET /assessments/{assessmentId}/pdf/{type}
export type PdfType = 'ready' | 'detail';

// GET /scans (history)
export interface GetScanHistoryResponse {
  scans: AssessmentSummary[];
}

// GET /scans/{scanId}/prowler-link
export interface GetProwlerLinkResponse {
  prowlerUiLink: string;
}

// --- Scan Info (used by PDF generation) ---

export interface ScanInfo {
  partnerName: string;
  clientName: string;
  awsAccountNumber: string;
  awsRegion: string;
  createdAt: string;
}

// --- Assessment Result (used by PDF generation) ---

export interface AssessmentResult {
  overallScore: number;
  pillarResults: PillarResult[];
}

// --- Error Response ---

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  fieldErrors?: Record<string, string>;
}
