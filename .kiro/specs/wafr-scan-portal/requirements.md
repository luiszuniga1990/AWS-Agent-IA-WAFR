# Documento de Requisitos — WAFR Scan Portal

## Introducción

WAFR Scan Portal es una aplicación web que permite a usuarios VDM ejecutar evaluaciones AWS Well-Architected Framework Review (WAFR) sobre cuentas de clientes. El usuario VDM interactúa exclusivamente con nuestro frontend React, donde ingresa información del partner, sube credenciales AWS mediante un archivo Excel, y el sistema — orquestado por Amazon Bedrock Agent Core — se comunica directamente con la consola AWS del cliente para validar accesos, permisos IAM y prerequisitos (Config + Security Hub). Luego, el Agent Core invoca a Prowler App (desplegado en ECS) para ejecutar el assessment de seguridad con 572+ checks, toma los resultados de Prowler, genera dos reportes PDF personalizados con hallazgos y remediaciones, y los envía por correo electrónico a los destinatarios correspondientes.

La arquitectura se basa en servicios AWS: Amazon Cognito para autenticación, AWS Lambda para lógica de negocio, Amazon Bedrock Agent Core para orquestación del agente de evaluación, Prowler (open source) desplegado en Amazon ECS como motor de assessment de seguridad y compliance, y otros servicios complementarios según buenas prácticas.

## Glosario

- **Portal**: La aplicación web WAFR Scan Portal.
- **Usuario_VDM**: Usuario autenticado con rol VDM que opera el Portal para iniciar evaluaciones WAFR.
- **Formulario_Scan**: Formulario web donde el Usuario_VDM ingresa la información del partner y las credenciales AWS.
- **Servicio_Autenticación**: Componente basado en Amazon Cognito que gestiona el registro, inicio de sesión y autorización de usuarios.
- **Validador_Credenciales**: Componente Lambda que valida la conexión a la cuenta AWS del cliente usando las credenciales proporcionadas.
- **Agente_WAFR**: Componente basado en Amazon Bedrock Agent Core con el modelo Amazon Nova Pro que orquesta todo el flujo backend: se comunica con la consola AWS del cliente para validar accesos y permisos IAM, invoca a Prowler App vía API para ejecutar los checks de seguridad, toma los resultados de Prowler para generar los PDFs, y utiliza la AWS Well-Architected Tool API para crear workloads y lenses programáticamente.
- **Prowler_App**: Plataforma open source de seguridad cloud (prowler-cloud/prowler) desplegada en Amazon ECS con su interfaz web, API REST, PostgreSQL y Redis. Ejecuta 572+ checks de seguridad mapeados a frameworks como AWS Well-Architected, FTR, CIS, FSBP y PCI DSS.
- **Prowler_UI**: Interfaz web de Prowler App accesible para el equipo técnico, que permite visualizar dashboards, hallazgos, compliance y attack paths de forma interactiva.
- **WA_Tool_API**: AWS Well-Architected Tool API (`wellarchitected:*`) que permite crear workloads, asociar lenses y registrar respuestas de evaluación de forma programática, dando estructura formal al assessment.
- **Workload_ARN**: ARN único generado por la WA_Tool_API al crear un workload (formato `arn:aws:wellarchitected:<region>:<account-id>:workload/<workload-id>`). Este ARN se utiliza como evidencia en AWS Partner Central para programas como FTR y WAFR Partner Program.
- **Generador_PDF**: Componente Lambda que crea los documentos PDF a partir de los resultados de la evaluación WAFR.
- **Servicio_Correo**: Componente que envía los reportes PDF por correo electrónico usando Amazon SES.
- **Archivo_Credenciales**: Archivo Excel (.xlsx) que contiene el access key y secret key de AWS.
- **PDF_WAFR_Ready**: Reporte PDF resumido con hallazgos ordenados por severidad, calificaciones por pilar y estimación de horas de remediación.
- **PDF_WAFR_Detail**: Reporte PDF detallado con cada hallazgo, su ARN, descripción y pasos de remediación vía consola web de AWS.
- **Pilar_WAFR**: Cada uno de los 6 pilares del AWS Well-Architected Framework: Excelencia Operacional, Seguridad, Fiabilidad, Eficiencia de Rendimiento, Optimización de Costos y Sostenibilidad.

## Requisitos

### Requisito 1: Autenticación de Usuarios

**Historia de Usuario:** Como Usuario_VDM, quiero autenticarme en el Portal de forma segura, para que solo usuarios autorizados puedan ejecutar evaluaciones WAFR.

#### Criterios de Aceptación

1. THE Servicio_Autenticación SHALL autenticar a los usuarios mediante Amazon Cognito con correo electrónico y contraseña.
2. WHEN un Usuario_VDM proporciona credenciales válidas, THE Servicio_Autenticación SHALL emitir un token JWT y redirigir al Usuario_VDM al Formulario_Scan.
3. WHEN un Usuario_VDM proporciona credenciales inválidas, THE Servicio_Autenticación SHALL mostrar un mensaje de error indicando que las credenciales son incorrectas.
4. WHILE un Usuario_VDM no posee un token JWT válido, THE Portal SHALL restringir el acceso al Formulario_Scan y redirigir al Usuario_VDM a la página de inicio de sesión.

### Requisito 2: Formulario de Información del Scan

**Historia de Usuario:** Como Usuario_VDM, quiero completar un formulario con la información del partner y del cliente, para que el sistema tenga los datos necesarios para ejecutar la evaluación.

#### Criterios de Aceptación

1. THE Formulario_Scan SHALL solicitar los siguientes campos obligatorios: nombre del partner, correo electrónico del partner, país, cliente final y número de consola AWS.
2. THE Formulario_Scan SHALL solicitar la selección de exactamente 1 región de AWS de una lista predefinida de regiones disponibles.
3. WHEN el Usuario_VDM envía el Formulario_Scan con campos vacíos o inválidos, THE Portal SHALL mostrar mensajes de validación específicos para cada campo incorrecto.
4. WHEN el Usuario_VDM ingresa un correo electrónico con formato inválido, THE Formulario_Scan SHALL mostrar un mensaje indicando que el formato de correo electrónico es incorrecto.
5. THE Formulario_Scan SHALL impedir el envío hasta que todos los campos obligatorios contengan valores válidos.

### Requisito 3: Carga y Validación de Credenciales AWS

**Historia de Usuario:** Como Usuario_VDM, quiero subir un archivo Excel con las credenciales AWS del cliente, para que el sistema pueda conectarse a la cuenta y ejecutar la evaluación.

#### Criterios de Aceptación

1. THE Formulario_Scan SHALL permitir al Usuario_VDM cargar un Archivo_Credenciales en formato .xlsx.
2. WHEN el Usuario_VDM carga un archivo con formato diferente a .xlsx, THE Portal SHALL rechazar el archivo y mostrar un mensaje indicando que solo se aceptan archivos .xlsx.
3. WHEN el Usuario_VDM carga un Archivo_Credenciales válido, THE Validador_Credenciales SHALL extraer el access key y el secret key del archivo Excel.
4. WHEN el Validador_Credenciales extrae las credenciales, THE Validador_Credenciales SHALL intentar una conexión de prueba a la cuenta AWS usando la región seleccionada por el Usuario_VDM.
5. WHEN la conexión de prueba es exitosa, THE Portal SHALL mostrar una confirmación de conexión exitosa y habilitar el botón para iniciar la evaluación WAFR.
6. IF la conexión de prueba falla, THEN THE Portal SHALL mostrar un mensaje de error descriptivo indicando la causa de la falla de conexión.
7. THE Validador_Credenciales SHALL eliminar las credenciales de la memoria inmediatamente después de completar la validación de conexión.

### Requisito 3.1: Validación de Permisos de las Credenciales AWS

**Historia de Usuario:** Como Usuario_VDM, quiero que el sistema valide que las credenciales AWS subidas tengan los permisos correctos de solo lectura, para garantizar la seguridad de la cuenta del cliente y saber qué políticas faltan antes de correr el assessment.

#### Criterios de Aceptación

1. WHEN la conexión de prueba es exitosa, THE Validador_Credenciales SHALL verificar que las credenciales NO posean permisos de escritura, eliminación o modificación sobre recursos del cliente (por ejemplo: `ec2:TerminateInstances`, `s3:DeleteBucket`, `iam:CreateUser`, `rds:DeleteDBInstance`). Se exceptúan los permisos de escritura necesarios para el assessment: `wellarchitected:*` (crear workloads) y `securityhub:BatchImportFindings` (requerido por Prowler para importar hallazgos).
2. IF las credenciales poseen permisos de escritura sobre recursos del cliente (excluyendo `wellarchitected:*` y `securityhub:BatchImportFindings`), THEN THE Portal SHALL rechazar las credenciales y mostrar un mensaje indicando que solo se aceptan credenciales con permisos de solo lectura.
3. THE Validador_Credenciales SHALL verificar que las credenciales posean las políticas AWS managed requeridas por Prowler: `arn:aws:iam::aws:policy/SecurityAudit` y `arn:aws:iam::aws:policy/job-function/ViewOnlyAccess`.
4. THE Validador_Credenciales SHALL verificar que las credenciales posean los permisos adicionales de lectura requeridos por Prowler (prowler-additions-policy), incluyendo: `account:Get*`, `appstream:Describe*`, `backup:List*`, `backup:Get*`, `bedrock:List*`, `bedrock:Get*`, `cloudtrail:GetInsightSelectors`, `cognito-idp:GetUserPoolMfaConfig`, `ec2:GetEbsEncryptionByDefault`, `ec2:GetSnapshotBlockPublicAccessState`, `ecr:Describe*`, `ecr:GetRegistryScanningConfiguration`, `elasticfilesystem:DescribeBackupPolicy`, `glue:GetConnections`, `glue:GetSecurityConfiguration*`, `lambda:GetFunction*`, `logs:FilterLogEvents`, `macie2:GetMacieSession`, `s3:GetAccountPublicAccessBlock`, `shield:DescribeProtection`, `shield:GetSubscriptionState`, `securityhub:BatchImportFindings`, `securityhub:GetFindings`, `ssm:GetDocument`, `support:Describe*`, `tag:GetTagKeys`, `wellarchitected:List*`, y `apigateway:GET`.
5. THE Validador_Credenciales SHALL verificar que las credenciales posean permisos de `wellarchitected:CreateWorkload`, `wellarchitected:UpdateAnswer` y `wellarchitected:AssociateLenses` para poder crear el workload y registrar las respuestas de evaluación en el Well-Architected Tool.
5. IF las credenciales carecen de uno o más permisos de lectura necesarios, THEN THE Portal SHALL mostrar una lista detallada de las políticas o permisos faltantes, agrupados por servicio AWS, indicando al Usuario_VDM exactamente qué políticas debe agregar al IAM user para poder correr el assessment.
6. THE Portal SHALL ofrecer al Usuario_VDM la opción de descargar un archivo JSON con la política IAM mínima requerida, que incluya las políticas managed (`SecurityAudit`, `ViewOnlyAccess`), la política custom de Prowler (prowler-additions-policy) y los permisos de `wellarchitected:CreateWorkload`, `wellarchitected:UpdateAnswer` y `wellarchitected:AssociateLenses`, lista para ser aplicada en la consola AWS del cliente.
7. THE Portal SHALL impedir el inicio de la evaluación WAFR hasta que todas las validaciones de permisos sean exitosas.

### Requisito 3.2: Validación de Servicios Prerequisito (AWS Config y Security Hub)

**Historia de Usuario:** Como Usuario_VDM, quiero que el sistema valide que AWS Config y AWS Security Hub estén activados con los estándares requeridos en la cuenta del cliente, para asegurar que el assessment WAFR pueda recopilar los datos necesarios.

#### Criterios de Aceptación

1. WHEN la validación de permisos es exitosa, THE Validador_Credenciales SHALL verificar que AWS Config esté habilitado y registrando recursos en la región seleccionada por el Usuario_VDM.
2. IF AWS Config no está habilitado en la región seleccionada, THEN THE Portal SHALL mostrar un mensaje indicando que AWS Config debe estar activado y registrando todos los tipos de recursos en la región antes de poder ejecutar el assessment.
3. THE Validador_Credenciales SHALL verificar que AWS Security Hub esté habilitado en la región seleccionada por el Usuario_VDM.
4. THE Validador_Credenciales SHALL verificar que Security Hub tenga activados los estándares de seguridad requeridos: AWS Foundational Security Best Practices, CIS AWS Foundations Benchmark y PCI DSS (si aplica).
5. IF AWS Security Hub no está habilitado o le faltan estándares requeridos, THEN THE Portal SHALL mostrar un mensaje detallado indicando qué estándares de Security Hub deben ser activados, con instrucciones paso a paso para habilitarlos desde la consola web de AWS.
6. THE Portal SHALL mostrar el estado de cada prerequisito (AWS Config y Security Hub con sus estándares) como un checklist visual, marcando en verde los que están activos y en rojo los que faltan.
7. THE Portal SHALL impedir el inicio de la evaluación WAFR hasta que tanto AWS Config como Security Hub con los estándares requeridos estén verificados como activos.

### Requisito 4: Ejecución de la Evaluación WAFR

**Historia de Usuario:** Como Usuario_VDM, quiero que el sistema ejecute automáticamente una evaluación WAFR sobre la cuenta del cliente, para obtener un diagnóstico de los 6 pilares del Well-Architected Framework.

#### Criterios de Aceptación

1. WHEN el Usuario_VDM inicia la evaluación, THE Agente_WAFR SHALL invocar a Prowler_App vía su API REST para ejecutar un scan sobre la cuenta del cliente con los frameworks de compliance mapeados a los 6 Pilar_WAFR: Excelencia Operacional, Seguridad, Fiabilidad, Eficiencia de Rendimiento, Optimización de Costos y Sostenibilidad.
2. WHILE la evaluación está en ejecución, THE Portal SHALL mostrar un indicador de progreso al Usuario_VDM consultando el estado del scan en la API de Prowler.
3. THE Agente_WAFR SHALL parsear los resultados JSON de Prowler y clasificar cada hallazgo con una severidad: crítica, alta o media.
4. THE Agente_WAFR SHALL calcular una calificación numérica de 0 a 100 para cada Pilar_WAFR evaluado, basándose en la proporción de checks pasados vs fallidos reportados por Prowler.
5. THE Agente_WAFR SHALL calcular una calificación general de la consola como promedio ponderado de las calificaciones de los 6 pilares.
6. THE Agente_WAFR SHALL extraer de los resultados de Prowler para cada hallazgo: el ARN del recurso afectado, una descripción del problema y los pasos de remediación a través de la interfaz web de AWS.
7. THE Agente_WAFR SHALL estimar un aproximado de horas de remediación para los hallazgos de cada Pilar_WAFR.
8. THE Agente_WAFR SHALL utilizar la WA_Tool_API para crear un workload en la cuenta del cliente, asociar los lenses de los 6 pilares y registrar las respuestas de evaluación de forma programática.
9. THE Agente_WAFR SHALL configurar el scan de Prowler para ejecutar los checks correspondientes a los frameworks: AWS Well-Architected Framework, AWS FTR, AWS Foundational Security Best Practices, CIS AWS Foundations Benchmark y PCI DSS.
10. IF el Agente_WAFR encuentra un error durante la evaluación de un pilar, THEN THE Agente_WAFR SHALL registrar el error, continuar con los pilares restantes e incluir el estado de error en el reporte.

### Requisito 4.1: Generación y Registro del Workload ARN

**Historia de Usuario:** Como Usuario_VDM, quiero que cada evaluación WAFR genere un Workload ARN válido en el AWS Well-Architected Tool, para poder usarlo como evidencia en AWS Partner Central (programas FTR y WAFR).

#### Criterios de Aceptación

1. WHEN el Agente_WAFR inicia una evaluación, THE Agente_WAFR SHALL crear un workload en el AWS Well-Architected Tool usando la API `CreateWorkload` con el nombre del cliente, la región seleccionada y el account ID del cliente.
2. THE WA_Tool_API SHALL retornar un Workload_ARN único para cada evaluación creada.
3. THE Agente_WAFR SHALL asociar los lenses correspondientes a los 6 pilares WAFR al workload creado.
4. THE Agente_WAFR SHALL registrar las respuestas de evaluación de cada pilar en el workload usando la API `UpdateAnswer`.
5. THE Portal SHALL mostrar el Workload_ARN al Usuario_VDM al finalizar la evaluación, para que pueda copiarlo y usarlo en AWS Partner Central.
6. THE PDF_WAFR_Detail SHALL incluir el Workload_ARN en el encabezado del reporte.
7. THE Portal SHALL almacenar el Workload_ARN asociado a cada evaluación en el historial del Usuario_VDM para consulta futura.

### Requisito 5: Generación del PDF WAFR Ready

**Historia de Usuario:** Como Usuario_VDM, quiero recibir un reporte PDF resumido con los hallazgos principales, para tener una visión rápida del estado de la cuenta del cliente.

#### Criterios de Aceptación

1. WHEN la evaluación WAFR finaliza, THE Generador_PDF SHALL crear el PDF_WAFR_Ready.
2. THE PDF_WAFR_Ready SHALL contener los hallazgos ordenados por severidad (crítica, alta, media) dentro de cada Pilar_WAFR.
3. THE PDF_WAFR_Ready SHALL incluir la calificación numérica de cada Pilar_WAFR y la calificación general de la consola.
4. THE PDF_WAFR_Ready SHALL incluir un estimado de horas de remediación para cada Pilar_WAFR.
5. THE PDF_WAFR_Ready SHALL incluir en el encabezado: nombre del partner, cliente final, número de consola, región evaluada y fecha de la evaluación.

### Requisito 6: Generación del PDF WAFR Detail

**Historia de Usuario:** Como Usuario_VDM, quiero que se genere un reporte PDF detallado con cada hallazgo, para que el equipo técnico pueda ejecutar las remediaciones.

#### Criterios de Aceptación

1. WHEN la evaluación WAFR finaliza, THE Generador_PDF SHALL crear el PDF_WAFR_Detail.
2. THE PDF_WAFR_Detail SHALL contener para cada hallazgo: el ARN del recurso, una descripción del problema, la severidad y los pasos de remediación a través de la interfaz web de AWS.
3. THE PDF_WAFR_Detail SHALL organizar los hallazgos agrupados por Pilar_WAFR.
4. THE PDF_WAFR_Detail SHALL incluir en el encabezado: nombre del partner, cliente final, número de consola, región evaluada y fecha de la evaluación.
5. THE PDF_WAFR_Detail SHALL incluir al final de cada pilar una sección de checklist de remediación, donde cada hallazgo aparezca como un ítem con una casilla de verificación (☐) vacía, el nombre del hallazgo, su severidad y un espacio para marcar como completado.
6. THE checklist de remediación SHALL estar ordenado por severidad (crítica primero, luego alta, luego media) dentro de cada Pilar_WAFR.
7. THE checklist de remediación SHALL incluir para cada ítem: la casilla de verificación, el nombre corto del hallazgo, el ARN del recurso afectado y una referencia a la página del PDF donde se encuentra el detalle completo de la remediación.

### Requisito 7: Envío de Reportes por Correo Electrónico

**Historia de Usuario:** Como Usuario_VDM, quiero que los reportes PDF se envíen automáticamente por correo, para que los destinatarios reciban los resultados sin intervención manual.

#### Criterios de Aceptación

1. WHEN el Generador_PDF completa la creación de ambos PDFs, THE Servicio_Correo SHALL enviar el PDF_WAFR_Ready al correo electrónico del Usuario_VDM que inició la evaluación.
2. WHEN el Generador_PDF completa la creación de ambos PDFs, THE Servicio_Correo SHALL enviar el PDF_WAFR_Detail al correo electrónico configurado del equipo técnico.
3. THE Servicio_Correo SHALL incluir en el asunto del correo: el nombre del cliente final y la fecha de la evaluación.
4. IF el Servicio_Correo falla al enviar un correo, THEN THE Servicio_Correo SHALL reintentar el envío hasta 3 veces con intervalos de 30 segundos.
5. IF el Servicio_Correo falla después de 3 reintentos, THEN THE Portal SHALL notificar al Usuario_VDM que el envío falló y ofrecer la opción de descargar los PDFs directamente desde el Portal.

### Requisito 8: Seguridad y Manejo de Credenciales

**Historia de Usuario:** Como Usuario_VDM, quiero que las credenciales AWS del cliente se manejen de forma segura, para proteger la información sensible durante todo el proceso.

#### Criterios de Aceptación

1. THE Portal SHALL transmitir el Archivo_Credenciales usando cifrado TLS 1.2 o superior.
2. THE Validador_Credenciales SHALL almacenar las credenciales temporalmente en memoria y eliminarlas inmediatamente después de completar la evaluación WAFR.
3. THE Portal SHALL registrar en un log de auditoría cada evento de carga de credenciales, inicio de evaluación y envío de reportes, sin incluir las credenciales AWS en el log.
4. IF un token JWT expira durante una sesión activa, THEN THE Portal SHALL solicitar al Usuario_VDM que inicie sesión nuevamente.

### Requisito 9: Infraestructura Prowler App en Amazon ECS

**Historia de Usuario:** Como equipo técnico, quiero que Prowler App esté desplegado en Amazon ECS con su interfaz web accesible, para poder visualizar dashboards de seguridad y compliance de forma interactiva además del flujo automatizado del Portal.

#### Criterios de Aceptación

1. THE Prowler_App SHALL estar desplegada en Amazon ECS (Fargate) usando las imágenes Docker oficiales de Docker Hub: `prowlercloud/prowler:latest` para API (Django + Celery) y Worker, y `prowlercloud/prowler-ui:latest` para la UI. Se usará Amazon RDS (PostgreSQL) y Amazon ElastiCache (Redis) como servicios de datos.
2. THE Prowler_UI SHALL estar accesible vía HTTPS a través de un Application Load Balancer (ALB) con certificado SSL.
3. THE Prowler_App SHALL exponer su API REST para que el Agente_WAFR pueda crear providers, lanzar scans y consultar resultados de forma programática.
4. THE Prowler_App SHALL estar desplegada en una VPC privada con acceso controlado mediante Security Groups, permitiendo acceso a la UI solo desde IPs autorizadas del equipo.
5. THE Prowler_App SHALL usar Amazon RDS (PostgreSQL) como base de datos persistente para almacenar los resultados de scans, providers y configuraciones.
6. THE Prowler_App SHALL usar Amazon ElastiCache (Redis) como broker de mensajes para las colas de Celery.
7. THE Portal SHALL permitir al Usuario_VDM acceder a un enlace directo a la Prowler_UI para visualizar los resultados del scan de forma interactiva después de completar la evaluación.
8. THE Prowler_App SHALL mantener un historial de todos los scans ejecutados, accesible tanto desde la Prowler_UI como desde la API.


## Estimación de Costos Mensuales

**Escenario**: 50 usuarios VDM, 50 assessments por mes, región us-east-1.

| Componente | Especificación | Cálculo | Costo Mensual (USD) |
|---|---|---|---|
| **Amazon Cognito** | 50 usuarios activos | Free tier cubre hasta 50,000 MAU | $0.00 |
| **Amazon S3 + CloudFront** | Frontend React SPA (~50MB), ~5,000 requests/mes | S3: $0.023/GB + CloudFront: $0.085/GB primeros 10TB | ~$2.00 |
| **API Gateway** | ~50 assessments × ~15 API calls c/u = 750 requests/mes | $3.50 por millón de requests | ~$0.01 |
| **AWS Lambda** | 6 funciones, ~750 invocaciones/mes, ~30s promedio, 512MB | $0.0000166667/GB-s × 750 × 30s × 0.5GB | ~$0.19 |
| **Amazon DynamoDB** | 3 tablas, ~150 writes + 500 reads/mes | Free tier: 25 WCU + 25 RCU | $0.00 |
| **Amazon Bedrock Agent Core (Runtime)** | 50 sesiones/mes, ~120s c/u, 1vCPU, 2GB RAM | CPU: 50 × 40s activo × $0.0895/3600 + Mem: 50 × 120s × 2GB × $0.00945/3600 | ~$0.38 |
| **Amazon Bedrock (Amazon Nova Pro)** | Modelo Nova Pro para análisis, ~50K input + 10K output tokens por assessment | 50 × (50K × $0.0008/1K + 10K × $0.0032/1K) = 50 × ($0.04 + $0.032) | ~$3.60 |
| **ECS Fargate: Prowler API** | 2 vCPU, 4GB RAM, 24/7 | (2 × $0.04048 + 4 × $0.004445) × 730 hrs | ~$72.10 |
| **ECS Fargate: Prowler Worker** | 4 vCPU, 8GB RAM, 24/7 (Fargate Spot) | (4 × $0.04048 + 8 × $0.004445) × 730 hrs × 0.30 | ~$43.26 |
| **ECS Fargate: Prowler UI** | 1 vCPU, 2GB RAM, 24/7 | (1 × $0.04048 + 2 × $0.004445) × 730 hrs | ~$36.05 |
| **Amazon RDS (PostgreSQL)** | db.t3.medium, Single-AZ, 20GB SSD | $0.068/hr × 730 hrs + 20GB × $0.115/GB | ~$51.94 |
| **Amazon ElastiCache (Redis)** | cache.t3.small, Single-AZ | $0.034/hr × 730 hrs | ~$24.82 |
| **Application Load Balancer** | 1 ALB para Prowler UI/API | $0.0225/hr × 730 + LCU estimado | ~$18.43 |
| **Amazon SES** | 100 correos/mes (2 por assessment) | $0.10 por 1,000 correos | ~$0.01 |
| **AWS Well-Architected Tool API** | 50 CreateWorkload + 300 UpdateAnswer | Sin costo adicional (incluido en AWS) | $0.00 |
| **Amazon CloudWatch** | Logs y métricas de todos los componentes | ~5GB logs/mes | ~$3.81 |
| **VPC + NAT Gateway** | 1 NAT Gateway para subnets privadas | $0.045/hr × 730 + $0.045/GB × ~10GB | ~$33.35 |
| **ACM (Certificado SSL)** | 1 certificado para ALB | Gratuito con ALB | $0.00 |
| | | | |
| **TOTAL ESTIMADO** | | | **~$289.95/mes** |

### Notas sobre la Estimación

1. **Costos dominantes**: ECS Fargate (Prowler) representa ~50% del costo total (~$151/mes). El Worker usa Fargate Spot para reducir costos un 70%.
2. **Amazon Nova Pro**: $0.80/1M input tokens y $3.20/1M output tokens. Excelente relación precio/rendimiento para análisis de hallazgos y generación de remediaciones. Significativamente más económico que Claude (~75% menos).
3. **NAT Gateway**: Necesario para que los servicios en subnets privadas accedan a internet. Es un costo fijo significativo (~$33/mes).
4. **Fargate Spot**: El Worker de Prowler usa Fargate Spot (70% descuento). Si un scan se interrumpe por reclamación de capacidad, el sistema reintenta automáticamente.
5. **Free tier**: Cognito, DynamoDB, API Gateway y SES están dentro del free tier para este volumen.
6. **Escalabilidad**: Si se duplican los assessments a 100/mes, solo aumentarían los costos de Bedrock (~$7.20) y Lambda (~$0.38). La infraestructura de Prowler y RDS no cambia.
