# Plan de Implementación: WAFR Scan Portal

## Visión General

Implementación incremental del WAFR Scan Portal usando TypeScript tanto en frontend (React SPA) como en backend (AWS Lambda + Node.js). La infraestructura se define con CDK. Cada tarea construye sobre las anteriores, integrando componentes progresivamente hasta tener el sistema completo conectado y desplegable.

## Tareas

- [x] 1. Estructura del proyecto e interfaces base
  - [x] 1.1 Crear estructura de monorepo con directorios: `infra/` (CDK), `backend/` (Lambdas), `frontend/` (React SPA), `shared/` (tipos e interfaces compartidas)
    - Inicializar `package.json` raíz con workspaces
    - Configurar TypeScript (`tsconfig.json`) base y por paquete
    - Configurar ESLint y Prettier
    - _Requisitos: Todos_

  - [x] 1.2 Definir interfaces y tipos compartidos en `shared/`
    - Crear `Scan`, `ScanStatus`, `ScanFormData`, `Assessment`, `AssessmentExecutionStatus`, `PillarResult`, `PillarName`, `Finding`, `ValidationResult`, `MissingPermission`, `PrerequisiteResult`, `AwsCredentials`
    - Crear tipos de request/response para cada endpoint de API Gateway
    - _Requisitos: 2.1, 3.3, 4.1, 4.3, 4.4_

  - [x] 1.3 Configurar framework de testing con Jest y fast-check
    - Instalar `jest`, `ts-jest`, `@types/jest`, `fast-check`, `aws-sdk-client-mock`
    - Crear `jest.config.ts` base
    - _Requisitos: Todos (testing)_

- [x] 2. Infraestructura CDK — Autenticación y API
  - [x] 2.1 Crear stack CDK base con VPC, subnets públicas y privadas, NAT Gateway
    - Definir VPC con 2 AZs, subnets públicas y privadas
    - Configurar Security Groups base
    - _Requisitos: 9.4_

  - [x] 2.2 Crear stack de Amazon Cognito User Pool
    - Configurar User Pool con email/password
    - Configurar App Client para el frontend SPA
    - _Requisitos: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.3 Crear stack de API Gateway REST con Cognito Authorizer
    - Definir todos los endpoints según la tabla de diseño (POST /scans, POST /scans/{scanId}/credentials, GET /scans/{scanId}/permissions, etc.)
    - Configurar Cognito Authorizer en endpoints protegidos
    - _Requisitos: 1.4, 2.1_

  - [x] 2.4 Crear tablas DynamoDB (Scans, Assessments, AuditLog)
    - Definir partition keys, sort keys y GSIs según diseño
    - _Requisitos: 4.1.7, 8.3_

- [x] 3. Infraestructura CDK — Prowler App en ECS Fargate
  - [x] 3.1 Crear stack de Amazon RDS PostgreSQL y ElastiCache Redis
    - RDS: PostgreSQL 15, db.t3.medium, Single-AZ, 20GB SSD en subnet privada
    - ElastiCache: Redis 7, cache.t3.small en subnet privada
    - Security Groups para acceso solo desde ECS tasks
    - _Requisitos: 9.5, 9.6_

  - [x] 3.2 Crear stack ECS Fargate con servicios Prowler (API, Worker, UI)
    - ECS Cluster con Fargate
    - Task Definition prowler-api: `prowlercloud/prowler:latest`, 2 vCPU, 4GB RAM
    - Task Definition prowler-worker: `prowlercloud/prowler:latest`, 4 vCPU, 8GB RAM, Fargate Spot
    - Task Definition prowler-ui: `prowlercloud/prowler-ui:latest`, 1 vCPU, 2GB RAM
    - Variables de entorno para conexión a RDS y Redis
    - _Requisitos: 9.1, 9.3_

  - [x] 3.3 Crear Application Load Balancer con HTTPS para Prowler
    - ALB en subnets públicas con certificado ACM
    - Target groups para prowler-ui y prowler-api
    - Reglas de ruteo: `/api/*` → prowler-api, `/*` → prowler-ui
    - Security Group: acceso HTTPS solo desde IPs autorizadas
    - _Requisitos: 9.2, 9.4_

- [x] 4. Checkpoint — Verificar infraestructura base
  - Ejecutar `cdk synth` para validar que todos los stacks generan CloudFormation válido
  - Asegurar que no hay errores de tipos ni de configuración
  - Preguntar al usuario si hay dudas antes de continuar

- [x] 5. Backend — Lambda FormHandler
  - [x] 5.1 Implementar Lambda FormHandler (crear scan y consultar historial)
    - `createScan`: validar campos obligatorios, generar UUID, guardar en DynamoDB tabla Scans
    - `getScanHistory`: consultar scans por userId
    - `getScan`: consultar scan por scanId usando GSI
    - Validar formato de email con regex, región contra lista predefinida, campos no vacíos
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 5.2 Escribir test de propiedad para validación de formulario
    - **Propiedad 2: Validación de formulario con campos inválidos**
    - **Valida: Requisitos 2.1, 2.3, 2.4, 2.5**

  - [ ]* 5.3 Escribir test de propiedad para selección de región
    - **Propiedad 3: Selección de exactamente una región AWS**
    - **Valida: Requisito 2.2**

- [x] 6. Backend — Lambda CredentialValidator
  - [x] 6.1 Implementar extracción de credenciales del archivo Excel
    - Usar librería `xlsx` (SheetJS) para parsear el archivo .xlsx
    - Extraer access key y secret key de las celdas esperadas
    - Validar formato de extensión del archivo antes de procesar
    - _Requisitos: 3.1, 3.2, 3.3_

  - [ ]* 6.2 Escribir test de propiedad para rechazo de formato no .xlsx
    - **Propiedad 4: Rechazo de archivos con formato no .xlsx**
    - **Valida: Requisito 3.2**

  - [ ]* 6.3 Escribir test de propiedad para round-trip de credenciales
    - **Propiedad 5: Round-trip de extracción de credenciales del Excel**
    - **Valida: Requisito 3.3**

  - [x] 6.4 Implementar validación de conexión y permisos IAM
    - `testConnection`: usar STS `GetCallerIdentity` con las credenciales extraídas
    - `validateReadOnly`: usar IAM `SimulatePrincipalPolicy` para verificar que acciones de escritura retornen `implicitDeny`
    - `validateMinimumPermissions`: verificar políticas managed (`SecurityAudit`, `ViewOnlyAccess`) y permisos de prowler-additions-policy
    - Verificar permisos de `wellarchitected:CreateWorkload`, `wellarchitected:UpdateAnswer`, `wellarchitected:AssociateLenses`
    - `generateMinimumIamPolicy`: generar JSON descargable con la política IAM mínima
    - Eliminar credenciales de memoria después de validación
    - _Requisitos: 3.4, 3.5, 3.6, 3.7, 3.1.1, 3.1.2, 3.1.3, 3.1.4, 3.1.5, 3.1.6, 3.1.7_

  - [ ]* 6.5 Escribir test de propiedad para rechazo de permisos de escritura
    - **Propiedad 6: Rechazo de credenciales con permisos de escritura**
    - **Valida: Requisitos 3.1.1, 3.1.2**

  - [ ]* 6.6 Escribir test de propiedad para detección de permisos faltantes
    - **Propiedad 7: Detección de permisos de lectura faltantes**
    - **Valida: Requisitos 3.1.3, 3.1.5**

- [x] 7. Backend — Lambda PrerequisiteChecker
  - [x] 7.1 Implementar validación de AWS Config y Security Hub
    - `checkAwsConfig`: usar `DescribeConfigurationRecorders` para verificar Config habilitado y registrando en la región
    - `checkSecurityHub`: usar `GetEnabledStandards` para verificar Security Hub y estándares activos (FSBP, CIS, PCI DSS)
    - `getPrerequisiteStatus`: retornar `PrerequisiteResult` con estado de cada prerequisito
    - _Requisitos: 3.2.1, 3.2.2, 3.2.3, 3.2.4, 3.2.5, 3.2.6, 3.2.7_

  - [ ]* 7.2 Escribir test de propiedad para bloqueo por prerequisitos incompletos
    - **Propiedad 8: Bloqueo de evaluación por prerequisitos incompletos**
    - **Valida: Requisitos 3.2.6, 3.2.7**

- [x] 8. Checkpoint — Verificar Lambdas de validación
  - Asegurar que todos los tests pasan
  - Verificar que FormHandler, CredentialValidator y PrerequisiteChecker compilan sin errores
  - Preguntar al usuario si hay dudas antes de continuar


- [x] 9. Backend — Lambda AssessmentOrchestrator y cliente Prowler
  - [x] 9.1 Implementar cliente Prowler API (`ProwlerClient`)
    - `createProvider`: POST a Prowler API para crear provider con credenciales del cliente
    - `startScan`: POST a Prowler API para iniciar scan con frameworks (WAFR, FTR, CIS, FSBP, PCI DSS)
    - `getScanStatus`: GET polling del estado del scan
    - `getFindings`: GET resultados JSON del scan completado
    - _Requisitos: 4.1, 4.9, 9.3_

  - [x] 9.2 Implementar lógica de mapeo de hallazgos Prowler → 6 pilares WAFR
    - Parsear hallazgos JSON de Prowler y clasificar por severidad (critical, high, medium)
    - Mapear hallazgos a los 6 pilares WAFR usando el campo `compliance` de Prowler
    - Calcular score por pilar (0-100) basado en proporción checks pasados/fallidos
    - Calcular score general como promedio ponderado de los 6 pilares
    - Estimar horas de remediación por pilar
    - _Requisitos: 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 9.3 Escribir test de propiedad para completitud de 6 pilares
    - **Propiedad 9: Completitud de la evaluación en 6 pilares**
    - **Valida: Requisito 4.1**

  - [ ]* 9.4 Escribir test de propiedad para invariantes del modelo de datos
    - **Propiedad 10: Invariantes del modelo de datos del assessment**
    - **Valida: Requisitos 4.3, 4.4, 4.6, 4.7**

  - [ ]* 9.5 Escribir test de propiedad para calificación general ponderada
    - **Propiedad 11: Calificación general como promedio ponderado**
    - **Valida: Requisito 4.5**

  - [ ]* 9.6 Escribir test de propiedad para resiliencia ante fallo parcial
    - **Propiedad 12: Resiliencia ante fallo parcial de pilares**
    - **Valida: Requisito 4.10**

  - [x] 9.7 Implementar Lambda AssessmentOrchestrator
    - `startAssessment`: orquestar flujo completo — crear workload en WA Tool, invocar Prowler, parsear resultados, registrar en WA Tool, guardar en DynamoDB
    - `createWorkload`: llamar `CreateWorkload` de WA Tool API con nombre del cliente, región y account ID
    - `recordPillarResults`: llamar `UpdateAnswer` para registrar respuestas por pilar en el workload
    - `getAssessmentStatus`: consultar estado del assessment desde DynamoDB
    - Guardar `prowlerScanId` y `prowlerUiLink` en el registro del scan
    - Manejar errores parciales: si un pilar falla, continuar con los demás y marcar status `partial_failure`
    - _Requisitos: 4.1, 4.2, 4.8, 4.10, 4.1.1, 4.1.2, 4.1.3, 4.1.4, 4.1.5, 4.1.7_

  - [ ]* 9.8 Escribir test de propiedad para round-trip del Workload ARN
    - **Propiedad 13: Round-trip del Workload ARN en historial**
    - **Valida: Requisito 4.1.7**

- [x] 10. Backend — Lambda PDFGenerator
  - [x] 10.1 Implementar generación de PDF WAFR Ready
    - Usar librería `pdfkit` o `@react-pdf/renderer` para generar PDF
    - Incluir encabezado: nombre del partner, cliente, consola, región, fecha
    - Incluir hallazgos ordenados por severidad dentro de cada pilar
    - Incluir calificación por pilar y calificación general
    - Incluir horas estimadas de remediación por pilar
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 10.2 Implementar generación de PDF WAFR Detail
    - Incluir Workload ARN en el encabezado
    - Incluir encabezado: nombre del partner, cliente, consola, región, fecha
    - Para cada hallazgo: ARN del recurso, descripción, severidad, pasos de remediación
    - Agrupar hallazgos por pilar WAFR
    - Incluir checklist de remediación al final de cada pilar: casilla ☐, nombre del hallazgo, severidad, ARN del recurso, referencia a página del detalle
    - Ordenar checklist por severidad (crítica → alta → media)
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 4.1.6_

  - [ ]* 10.3 Escribir test de propiedad para contenido del PDF Ready
    - **Propiedad 14: Contenido completo del PDF WAFR Ready**
    - **Valida: Requisitos 5.2, 5.3, 5.4, 5.5**

  - [ ]* 10.4 Escribir test de propiedad para contenido del PDF Detail
    - **Propiedad 15: Contenido completo del PDF WAFR Detail**
    - **Valida: Requisitos 4.1.6, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**

  - [ ]* 10.5 Escribir test de propiedad para ordenamiento por severidad
    - **Propiedad 16: Ordenamiento de hallazgos por severidad**
    - **Valida: Requisitos 5.2, 6.6**

- [x] 11. Backend — Lambda EmailSender
  - [x] 11.1 Implementar envío de correos con Amazon SES
    - `sendReadyReport`: enviar PDF Ready al correo del VDM que inició la evaluación
    - `sendDetailReport`: enviar PDF Detail al correo del equipo técnico configurado
    - Asunto del correo: incluir nombre del cliente y fecha de evaluación
    - Lógica de reintentos: hasta 3 intentos con intervalos de 30 segundos
    - Si falla después de 3 reintentos: marcar como `emails_failed` y notificar al frontend
    - _Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 11.2 Escribir test de propiedad para formato del asunto del correo
    - **Propiedad 17: Formato del asunto del correo electrónico**
    - **Valida: Requisito 7.3**

  - [ ]* 11.3 Escribir test de propiedad para lógica de reintentos
    - **Propiedad 18: Lógica de reintentos del servicio de correo**
    - **Valida: Requisito 7.4**

- [x] 12. Backend — Audit Logger y seguridad
  - [x] 12.1 Implementar módulo de auditoría transversal
    - Crear middleware/utilidad que registre eventos en DynamoDB tabla AuditLog
    - Eventos: carga de credenciales, inicio de evaluación, envío de reportes
    - Sanitizar logs: filtrar patrones de access key (`AKIA...`) y secret key antes de persistir
    - Integrar en todas las Lambdas
    - _Requisitos: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 12.2 Escribir test de propiedad para ausencia de credenciales en logs
    - **Propiedad 19: Ausencia de credenciales en logs de auditoría**
    - **Valida: Requisito 8.3**

- [x] 13. Checkpoint — Verificar todo el backend
  - Asegurar que todos los tests pasan
  - Verificar que todas las Lambdas compilan sin errores
  - Verificar integración entre AssessmentOrchestrator → ProwlerClient → PDFGenerator → EmailSender
  - Preguntar al usuario si hay dudas antes de continuar


- [x] 14. Frontend — Configuración y autenticación
  - [x] 14.1 Crear proyecto React con TypeScript y configurar dependencias
    - Inicializar con Vite + React + TypeScript
    - Instalar dependencias: `aws-amplify` (Cognito), `react-router-dom`, `axios`
    - Configurar Amplify con el User Pool ID y App Client ID de Cognito
    - Crear layout base con rutas: `/login`, `/scan`, `/history`
    - _Requisitos: 1.1, 1.2_

  - [x] 14.2 Implementar página de login y protección de rutas
    - Formulario de login con email y contraseña usando Cognito SDK (Amplify Auth)
    - Manejo de errores: mostrar mensaje cuando credenciales son incorrectas
    - Guardar token JWT en estado de la app
    - Implementar `ProtectedRoute` que redirige a `/login` si no hay JWT válido
    - Interceptor de Axios: si respuesta 401, limpiar sesión y redirigir a login
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 8.4_

- [x] 15. Frontend — Formulario de scan y carga de credenciales
  - [x] 15.1 Implementar formulario de información del scan
    - Campos: nombre del partner, correo del partner, país, cliente final, número de consola AWS
    - Selector de región AWS con lista predefinida (exactamente 1 región)
    - Validación en cliente: campos obligatorios, formato de email, región válida
    - Mensajes de error específicos por campo
    - Botón de envío deshabilitado hasta que todos los campos sean válidos
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 15.2 Implementar carga de archivo Excel y flujo de validación
    - Input de archivo que solo acepta `.xlsx`
    - Validación de extensión en frontend antes de subir
    - Llamar a `POST /scans/{scanId}/credentials` para subir archivo
    - Llamar a `GET /scans/{scanId}/permissions` para validar permisos
    - Mostrar lista de permisos faltantes agrupados por servicio si la validación falla
    - Botón para descargar JSON de política IAM mínima (`GET /scans/{scanId}/iam-policy`)
    - Llamar a `GET /scans/{scanId}/prerequisites` para validar Config + Security Hub
    - Mostrar checklist visual de prerequisitos (verde ✓ / rojo ✗)
    - Habilitar botón "Iniciar Evaluación WAFR" solo cuando todas las validaciones pasen
    - _Requisitos: 3.1, 3.2, 3.5, 3.6, 3.1.5, 3.1.6, 3.1.7, 3.2.6, 3.2.7_

- [x] 16. Frontend — Ejecución del assessment y resultados
  - [x] 16.1 Implementar pantalla de ejecución del assessment con progreso
    - Llamar a `POST /scans/{scanId}/assessment` para iniciar evaluación
    - Polling de `GET /assessments/{assessmentId}/status` para mostrar progreso
    - Barra de progreso visual durante la ejecución
    - Manejo de estados: running, completed, partial_failure, failed
    - Al completar: mostrar resumen con score general, scores por pilar, Workload ARN copiable
    - Enlace a Prowler UI para ver resultados interactivos
    - _Requisitos: 4.1, 4.2, 4.5, 4.10, 4.1.5, 9.7_

  - [x] 16.2 Implementar descarga de PDFs y notificación de correos
    - Botones para descargar PDF Ready y PDF Detail (`GET /assessments/{assessmentId}/pdf/{type}`)
    - Mostrar estado del envío de correos (enviado / fallido)
    - Si el envío falló: ofrecer descarga directa de PDFs
    - _Requisitos: 5.1, 6.1, 7.1, 7.2, 7.5_

  - [x] 16.3 Implementar página de historial de evaluaciones
    - Listar evaluaciones previas del usuario (`GET /scans`)
    - Mostrar: cliente, fecha, score general, Workload ARN, estado
    - Permitir descargar PDFs de evaluaciones anteriores
    - Enlace a Prowler UI por cada evaluación
    - _Requisitos: 4.1.7, 9.7, 9.8_

- [x] 17. Infraestructura CDK — Frontend y despliegue
  - [x] 17.1 Crear stack CDK para S3 + CloudFront (hosting del frontend)
    - Bucket S3 privado para archivos estáticos del SPA
    - Distribución CloudFront con OAI
    - Configurar SPA routing (redirect 404 → index.html)
    - _Requisitos: Todos (frontend)_

  - [x] 17.2 Crear stack CDK para Lambdas del backend
    - Definir todas las funciones Lambda con sus roles IAM mínimos
    - Configurar variables de entorno (DynamoDB table names, Prowler API URL, SES config)
    - Conectar Lambdas a API Gateway
    - Configurar VPC access para Lambdas que necesitan comunicarse con Prowler (subnets privadas)
    - Configurar timeout adecuado: 15 min para AssessmentOrchestrator, 30s para el resto
    - _Requisitos: Todos (backend)_

  - [x] 17.3 Crear stack CDK para Amazon SES
    - Verificar dominio o dirección de correo para envío
    - Configurar identidad SES
    - _Requisitos: 7.1, 7.2_

  - [x] 17.4 Crear stack CDK para Bedrock Agent Core
    - Definir agente con modelo Amazon Nova Pro (`amazon.nova-pro-v1:0`)
    - Configurar action groups para las herramientas del agente (validación, Prowler, WA Tool, PDF, email)
    - Configurar permisos IAM del agente
    - _Requisitos: 4.1, 4.8_

- [x] 18. Integración final y wiring
  - [x] 18.1 Conectar flujo completo end-to-end
    - Verificar que el frontend se comunica correctamente con API Gateway
    - Verificar que API Gateway rutea a las Lambdas correctas con Cognito Authorizer
    - Verificar que AssessmentOrchestrator invoca correctamente al Bedrock Agent Core
    - Verificar que el Agent Core se comunica con Prowler API vía la VPC
    - Verificar flujo de PDFs y envío de correos
    - _Requisitos: Todos_

  - [ ]* 18.2 Escribir tests de integración del flujo completo
    - Test del flujo: formulario → validación → assessment → PDF → email usando mocks de AWS SDK
    - Verificar manejo de errores end-to-end
    - _Requisitos: Todos_

- [x] 19. Checkpoint final — Verificar sistema completo
  - Asegurar que todos los tests pasan
  - Verificar que `cdk synth` genera CloudFormation válido para todos los stacks
  - Verificar que el frontend compila sin errores (`npm run build`)
  - Preguntar al usuario si hay dudas antes de continuar

- [ ] 20. Push a GitHub
  - [ ] 20.1 Preparar repositorio para GitHub
    - Crear `.gitignore` adecuado (node_modules, cdk.out, .env, dist, etc.)
    - Crear `README.md` con instrucciones de setup, despliegue y arquitectura
    - Inicializar repositorio git, hacer commit inicial y push a GitHub
    - _Requisitos: Todos_

## Notas

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia los requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental del progreso
- Los tests de propiedades validan las propiedades de correctitud universales definidas en el diseño
- Los tests unitarios validan ejemplos específicos y edge cases
- El lenguaje de implementación es TypeScript tanto para frontend como backend
