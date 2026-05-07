# AWS-Agent-IA-WAFR

## WAFR Scan Portal

Aplicación web que permite a usuarios VDM ejecutar evaluaciones AWS Well-Architected Framework Review (WAFR) sobre cuentas de clientes.

## Arquitectura

- **Frontend**: React SPA + TypeScript (Vite) → S3/CloudFront
- **Auth**: Amazon Cognito (email/password, JWT)
- **API**: API Gateway REST + Cognito Authorizer
- **Backend**: AWS Lambda (Node.js/TypeScript)
- **Orquestación**: Amazon Bedrock Agent Core con Amazon Nova Pro
- **Assessment**: Prowler App en ECS Fargate
- **Datos**: DynamoDB (historial), RDS PostgreSQL (Prowler), ElastiCache Redis
- **Correo**: Amazon SES
- **IaC**: AWS CDK (TypeScript)

## Estructura del Proyecto

```
├── backend/       # Lambdas (TypeScript)
├── frontend/      # React SPA (Vite + TypeScript)
├── infra/         # CDK Stacks
├── shared/        # Tipos e interfaces compartidas
├── package.json   # Monorepo workspaces
└── tsconfig.base.json
```

## Setup

```bash
# Instalar dependencias
npm install

# Compilar backend
npm run build --workspace=backend

# Compilar infra
npm run build --workspace=infra

# Build frontend
npm run build --workspace=frontend

# Correr tests
npm test

# Sintetizar CloudFormation
cd infra && npx cdk synth
```

## Despliegue

```bash
cd infra
npx cdk bootstrap
npx cdk deploy --all
```

## Flujo Principal

1. VDM se autentica con Cognito
2. Completa formulario (partner, país, cliente, consola, región)
3. Sube Excel con credenciales AWS
4. Agent Core valida: conexión (STS) → permisos IAM → prerequisitos (Config + Security Hub)
5. Agent Core invoca Prowler → ejecuta 572+ checks
6. Parsea resultados, calcula scores, crea Workload ARN
7. Genera PDFs (wafr-ready + wafr-detail)
8. Envía correos vía SES
