// Backend Lambda handler exports for WAFR Scan Portal
// Each handler module exports a `handler` router function used as the Lambda entry point,
// plus individual named functions for direct invocation or testing.

export { handler as formHandler, createScan, getScanHistory, getScan } from './handlers/form-handler';
export { handler as credentialHandler, uploadCredentials, getPermissions, getIamPolicy } from './handlers/credential-handler';
export { handler as prerequisiteHandler, checkPrerequisites } from './handlers/prerequisite-handler';
export { handler as assessmentHandler, startAssessment, getAssessmentStatus, getProwlerLink } from './handlers/assessment-handler';
export { handler as pdfHandler, generatePdf } from './handlers/pdf-handler';
export { handler as emailHandler, sendEmails } from './handlers/email-handler';
