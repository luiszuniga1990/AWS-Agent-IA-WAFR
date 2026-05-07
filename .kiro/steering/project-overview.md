# WAFR Scan Portal — Contexto del Proyecto

## Descripción

WAFR Scan Portal es una aplicación web que permite a usuarios VDM ejecutar evaluaciones AWS Well-Architected Framework Review sobre cuentas de clientes. El usuario VDM interactúa con nuestro frontend React, mientras que Amazon Bedrock Agent Core (con Amazon Nova Pro) orquesta todo el backend: valida accesos contra AWS, invoca Prowler App para el assessment, genera PDFs y envía correos.

## Arquitectura

- Frontend: React SPA + TypeScript en S3/CloudFront
- Auth: Amazon Cognito (email/password, JWT)
- API: API Gateway REST + Cognito Authorizer
- Backend: AWS Lambda (Node.js/TypeScript)
- Orquestación: Amazon Bedrock Agent Core con Amazon Nova Pro
- Assessment: Prowler App en ECS Fargate (imágenes Docker Hub oficiales)
- Datos: DynamoDB (historial), RDS PostgreSQL (Prowler), ElastiCache Redis (Prowler)
- Correo: Amazon SES
- WA Tool: Well-Architected Tool API (CreateWorkload, UpdateAnswer)

## Flujo Principal

1. VDM se autentica con Cognito
2. Completa formulario (partner, país, cliente, consola, región)
3. Sube Excel con credenciales AWS
4. Agent Core valida: conexión (STS) → permisos IAM (read-only) → prerequisitos (Config + Security Hub)
5. Agent Core invoca Prowler API → ejecuta 572+ checks
6. Agent Core parsea resultados, calcula scores, crea Workload ARN
7. Genera PDFs (wafr-ready + wafr-detail)
8. Envía correos vía SES

## Spec Files

- Requisitos: #[[file:.kiro/specs/wafr-scan-portal/requirements.md]]
- Diseño: #[[file:.kiro/specs/wafr-scan-portal/design.md]]
- Flujo: #[[file:.kiro/specs/wafr-scan-portal/flujo-proceso.md]]
