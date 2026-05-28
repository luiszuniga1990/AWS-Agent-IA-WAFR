# 📋 Playbook — Agent WAFR

## Resumen

Este playbook está diseñado para dos audiencias técnicas del proyecto **WAFR Scan Portal**:

1. **Técnico Manager** — Responsable de administrar la plataforma Prowler, monitorear servicios ECS, gestionar usuarios y asegurar la disponibilidad del sistema.
2. **Técnico de Ejecución** — Usuario VDM que opera la interfaz web para ejecutar evaluaciones WAFR sobre cuentas de clientes AWS.

---

# 🔧 PARTE 1: Técnico Manager

## Resumen para Manager

El WAFR Scan Portal utiliza **Prowler** como motor de evaluación de seguridad. Prowler corre en **ECS Fargate** con 3 servicios (API, Worker, UI) respaldados por **RDS PostgreSQL**, **ElastiCache Redis** y **Neo4j**. Como manager, tu rol es asegurar que estos servicios estén saludables, gestionar usuarios en Cognito, y monitorear los escaneos.

### Componentes bajo tu gestión:

| Componente | Servicio AWS | Función |
|---|---|---|
| Prowler API | ECS Fargate | Recibe solicitudes de escaneo, coordina workers |
| Prowler Worker | ECS Fargate (Spot) | Ejecuta los 572+ checks de seguridad |
| Prowler UI | ECS Fargate | Dashboard de resultados de Prowler |
| Base de datos | RDS PostgreSQL | Almacena resultados de Prowler |
| Cache | ElastiCache Redis | Cola de trabajos y cache de sesiones |
| Grafo | Neo4j (ECS) | Relaciones entre recursos escaneados |
| Usuarios | Cognito | Autenticación de VDMs |
| Load Balancer | ALB | Distribuye tráfico a API y UI |
| Monitoreo | CloudWatch Logs | Logs de todos los containers |

---

## Diagrama de Arquitectura (Manager)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INFRAESTRUCTURA PROWLER (ECS Fargate)                     │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌──────────────────┐
                         │   ALB (HTTPS)    │
                         │  Port 80 / 443   │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             │
         ┌──────────────┐ ┌──────────────┐    │
         │ Prowler API  │ │ Prowler UI   │    │
         │  (port 8080) │ │ (port 3000)  │    │
         │  /api/v1/*   │ │    /*        │    │
         └──────┬───────┘ └──────┬───────┘    │
                │                │             │
                ├────────────────┤             │
                │                │             │
                ▼                ▼             │
    ┌────────────────────────────────────┐    │
    │         VPC Privada (us-west-2)    │    │
    │                                    │    │
    │  ┌────────────┐  ┌─────────────┐  │    │
    │  │    RDS     │  │   Redis     │  │    │
    │  │ PostgreSQL │  │ (ElastiCache│  │    │
    │  │ port 5432  │  │  port 6379) │  │    │
    │  └────────────┘  └─────────────┘  │    │
    │                                    │    │
    │  ┌────────────┐  ┌─────────────┐  │    │
    │  │   Neo4j    │  │  Prowler    │  │    │
    │  │ (ECS)      │  │  Worker     │  │    │
    │  │ port 7474  │  │ (Fargate    │  │    │
    │  │ port 7687  │  │  Spot)      │  │    │
    │  └────────────┘  └─────────────┘  │    │
    │                                    │    │
    └────────────────────────────────────┘    │
                                              │
    ┌─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GESTIÓN DE USUARIOS                                  │
│                                                                             │
│  Cognito User Pool ──▶ VDMs se autentican ──▶ JWT Token ──▶ API Gateway    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         MONITOREO (CloudWatch)                               │
│                                                                             │
│  Log Groups:                                                                │
│  • /ecs/prowler-api                                                         │
│  • /ecs/prowler-worker                                                      │
│  • /ecs/prowler-ui                                                          │
│  • /ecs/neo4j                                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step by Step: Gestión de la Plataforma

### 1. Verificar salud de los servicios ECS

```
Consola AWS → ECS → Clusters → WafrProwlerEcsStack-ProwlerCluster
```

| Servicio | Tasks deseadas | Health Check |
|---|---|---|
| ProwlerApiService | 1 | `/api/v1/healthcheck` (port 8080) |
| ProwlerUiService | 1 | `/api/auth/session` (port 3000) |
| ProwlerWorkerService | 1 | Sin health check (procesa cola) |

**Señales de alerta:**
- Running tasks < Desired tasks → Container crasheando
- Last status: STOPPED → Revisar logs en CloudWatch

### 2. Verificar Neo4j

```
Consola AWS → ECS → Clusters → wafr-neo4j-cluster
```

- Debe tener 1 task running
- Si Neo4j está caído, Prowler API no puede generar grafos de relaciones

### 3. Gestionar usuarios (Cognito)

```
Consola AWS → Cognito → User Pools → us-west-2_hxoSHLE6n
```

**Crear usuario VDM:**
1. Click "Create user"
2. Email: correo del VDM
3. Marcar "Send invitation email"
4. El VDM recibirá contraseña temporal

**Deshabilitar usuario:**
1. Seleccionar usuario → Actions → Disable user

**Resetear contraseña:**
1. Seleccionar usuario → Actions → Reset password

### 4. Monitorear escaneos activos

```
Consola AWS → DynamoDB → Tables → wafr-scans
```

| Campo | Significado |
|---|---|
| status: `RUNNING` | Escaneo en progreso |
| status: `COMPLETED` | Escaneo finalizado |
| status: `FAILED` | Error durante escaneo |
| createdAt | Cuándo se inició |

**Si un escaneo está en RUNNING por más de 30 minutos:**
1. Revisar logs del Worker en CloudWatch
2. Verificar que el Worker task esté running
3. Verificar conectividad a la cuenta del cliente (credenciales válidas)

### 5. Verificar ALB y conectividad

```
Consola AWS → EC2 → Load Balancers → WafrPr-Prowl-*
```

- Target Groups: ambos deben mostrar targets "healthy"
- Si unhealthy: el container no responde al health check

### 6. Gestionar base de datos (RDS)

```
Consola AWS → RDS → Databases → wafrprowlerdatastack-prowlerdb*
```

- Monitorear CPU, conexiones activas, almacenamiento libre
- Las credenciales están en Secrets Manager (no acceder directamente)

### 7. Revisar logs de errores

```
Consola AWS → CloudWatch → Log Groups
```

Filtrar por:
- `ERROR` — Errores de aplicación
- `CRITICAL` — Fallos graves
- `timeout` — Timeouts de conexión

---

## Información clave para el Manager

- **Prowler Worker usa Fargate Spot** — puede ser interrumpido. Si un escaneo falla, verificar si fue por interrupción de Spot.
- **Redis es la cola de trabajos** — si Redis está caído, los workers no reciben tareas.
- **Los escaneos toman 10-25 minutos** dependiendo del tamaño de la cuenta del cliente.
- **Prowler ejecuta 572+ checks** de seguridad basados en CIS, NIST, HIPAA, PCI-DSS.
- **El ALB no tiene HTTPS con certificado custom** — usa HTTP en port 80 internamente.
- **Backups de RDS** — verificar que los snapshots automáticos estén activos.

---
---

# 👤 PARTE 2: Técnico de Ejecución (VDM)

## Resumen para Técnico de Ejecución

Como VDM (Value Delivery Manager), usas el **WAFR Scan Portal** para ejecutar evaluaciones de seguridad AWS Well-Architected Framework Review sobre cuentas de clientes. El sistema automatiza todo el proceso: valida credenciales, verifica prerequisitos, ejecuta Prowler (572+ checks), genera reportes PDF y los envía por correo.

### Lo que necesitas antes de empezar:

| Requisito | Detalle |
|---|---|
| Credenciales de acceso | Email + contraseña (proporcionados por el Manager) |
| Credenciales AWS del cliente | Access Key ID + Secret Access Key (con permisos de lectura) |
| Información del partner | Nombre, país, cliente final |
| Región AWS a escanear | La región principal de la cuenta del cliente |

---

## Diagrama del Flujo de Ejecución

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLUJO DEL TÉCNICO DE EJECUCIÓN                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐     ┌───────────────┐     ┌─────────────────────────────────────┐
│   VDM    │────▶│  CloudFront   │────▶│         LOGIN (Cognito)             │
│(Browser) │     │  (React SPA)  │     │  Email + Contraseña                 │
└──────────┘     └───────────────┘     └──────────────────┬──────────────────┘
                                                          │
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PASO 1: FORMULARIO INICIAL                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Nombre del Partner                                                │   │
│  │  • País                                                              │   │
│  │  • Nombre del Cliente Final                                          │   │
│  │  • URL de la Consola AWS del cliente                                 │   │
│  │  • Región AWS a escanear (ej: us-east-1)                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PASO 2: CREDENCIALES AWS                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Subir archivo Excel/CSV con:                                        │   │
│  │  • AWS Access Key ID                                                 │   │
│  │  • AWS Secret Access Key                                             │   │
│  │  • (Opcional) Session Token                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              PASO 3: VALIDACIÓN AUTOMÁTICA (Agent Core)                      │
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────────┐     │
│  │ 1. Validar     │  │ 2. Verificar   │  │ 3. Verificar             │     │
│  │    conexión    │──▶│    permisos    │──▶│    prerequisitos        │     │
│  │    (STS)       │  │    IAM         │  │    (Config+SecurityHub)  │     │
│  └────────────────┘  └────────────────┘  └──────────────────────────┘     │
│                                                                             │
│  ✅ Todo OK → Continúa automáticamente                                     │
│  ❌ Error → Muestra qué falta y cómo solucionarlo                          │
│                                                                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PASO 4: ESCANEO PROWLER                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Prowler ejecuta 572+ checks de seguridad                         │   │
│  │  • Frameworks: CIS, NIST 800-53, HIPAA, PCI-DSS, SOC2              │   │
│  │  • Duración: 10-25 minutos                                          │   │
│  │  • Barra de progreso visible en la interfaz                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PASO 5: RESULTADOS Y REPORTES                             │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐     │
│  │  Score por       │  │  PDF WAFR-Ready  │  │  PDF WAFR-Detail    │     │
│  │  Pilar WAF       │  │  (resumen)       │  │  (hallazgos)        │     │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘     │
│                                                                             │
│  Pilares evaluados:                                                         │
│  • Excelencia Operacional    • Seguridad                                   │
│  • Fiabilidad                • Eficiencia de Rendimiento                   │
│  • Optimización de Costos    • Sostenibilidad                              │
│                                                                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PASO 6: ENVÍO POR CORREO                                  │
│                                                                             │
│  • PDFs adjuntos enviados automáticamente vía SES                           │
│  • Destinatarios: VDM + Partner (configurable)                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Diagrama Técnico Interno (Ejecución)

```
┌────────────┐       ┌──────────────┐       ┌─────────────────────────┐
│  Browser   │──────▶│  CloudFront  │──────▶│  API Gateway REST       │
│  (React)   │       │  (S3 SPA)    │       │  + Cognito Authorizer   │
└────────────┘       └──────────────┘       └────────────┬────────────┘
                                                         │
                                                         ▼
                                            ┌────────────────────────┐
                                            │   Bedrock Agent Core   │
                                            │   (Amazon Nova Pro)    │
                                            │                        │
                                            │   Orquesta el flujo:   │
                                            │   1. credential-validator
                                            │   2. prerequisite-checker
                                            │   3. assessment-orchestrator
                                            │   4. pdf-generator      │
                                            │   5. email-sender       │
                                            └────────────┬────────────┘
                                                         │
                              ┌───────────────┬──────────┼──────────┬───────────┐
                              ▼               ▼          ▼          ▼           ▼
                     ┌──────────────┐ ┌────────────┐ ┌────────┐ ┌──────┐ ┌────────┐
                     │  Credential  │ │Prerequisite│ │Prowler │ │ PDF  │ │ Email  │
                     │  Validator   │ │  Checker   │ │  API   │ │ Gen  │ │ Sender │
                     │  (Lambda)    │ │  (Lambda)  │ │ (ECS)  │ │(Lambda)│(Lambda)│
                     └──────────────┘ └────────────┘ └────────┘ └──────┘ └────────┘
                              │               │          │          │           │
                              ▼               ▼          ▼          ▼           ▼
                         ┌─────────┐    ┌─────────┐  ┌──────┐  ┌──────┐   ┌──────┐
                         │  STS    │    │ Config  │  │ RDS  │  │  S3  │   │ SES  │
                         │  IAM    │    │ SecHub  │  │Redis │  │(PDFs)│   │      │
                         └─────────┘    └─────────┘  └──────┘  └──────┘   └──────┘
```

---

## Step by Step: Ejecutar una Evaluación WAFR

### Paso 1: Iniciar sesión

1. Abrir la URL del portal (CloudFront)
2. Ingresar email y contraseña proporcionados por el Manager
3. Si es primera vez, cambiar la contraseña temporal

### Paso 2: Completar formulario del partner

1. Click en **"Nueva Evaluación"** o **"New Scan"**
2. Llenar los campos:
   - **Partner**: Nombre de la empresa partner
   - **País**: País del partner
   - **Cliente Final**: Nombre del cliente que será evaluado
   - **URL Consola**: URL de la consola AWS del cliente
   - **Región**: Región AWS principal (ej: `us-east-1`)
3. Click **"Siguiente"**

### Paso 3: Subir credenciales AWS

1. Obtener del cliente un archivo Excel/CSV con:
   - `Access Key ID` (empieza con AKIA...)
   - `Secret Access Key`
   - `Session Token` (opcional, para credenciales temporales)
2. Arrastrar o seleccionar el archivo en la interfaz
3. El sistema extrae automáticamente las credenciales del archivo
4. Click **"Validar y Continuar"**

### Paso 4: Validación automática

El sistema ejecuta 3 validaciones en secuencia:

| Validación | Qué verifica | Si falla |
|---|---|---|
| **Conexión (STS)** | Las credenciales son válidas y pueden conectarse | Credenciales expiradas o incorrectas |
| **Permisos IAM** | El usuario tiene permisos de lectura suficientes | Solicitar al cliente que agregue la policy `SecurityAudit` |
| **Prerequisitos** | AWS Config y Security Hub están habilitados | Indicar al cliente que los habilite en la región |

- ✅ Si todo pasa → el escaneo inicia automáticamente
- ❌ Si algo falla → se muestra el error específico y la solución

### Paso 5: Esperar el escaneo

- Duración típica: **10-25 minutos**
- La interfaz muestra progreso en tiempo real
- **No cerrar el navegador** — puedes abrir otra pestaña
- Si necesitas salir, el escaneo continúa en background y puedes ver el resultado después

### Paso 6: Revisar resultados

Una vez completado:
1. Se muestra el **score por pilar** del Well-Architected Framework
2. Se generan automáticamente 2 PDFs:
   - **WAFR-Ready**: Resumen ejecutivo con scores
   - **WAFR-Detail**: Hallazgos detallados por pilar con recomendaciones
3. Los PDFs se envían por correo automáticamente

### Paso 7: Descargar o reenviar

- Click en **"Descargar PDF"** para obtener los reportes
- Click en **"Enviar por correo"** para reenviar a otros destinatarios

---

## Información clave para el Técnico de Ejecución

### Permisos mínimos que necesita la cuenta del cliente:

```
AWS Managed Policies requeridas:
• arn:aws:iam::aws:policy/SecurityAudit
• arn:aws:iam::aws:policy/job-function/ViewOnlyAccess
```

### Prerequisitos en la cuenta del cliente:

| Servicio | Debe estar | Cómo verificar |
|---|---|---|
| AWS Config | Habilitado en la región | Config → Settings → Recording is on |
| Security Hub | Habilitado en la región | Security Hub → Summary visible |

### Qué evalúa Prowler (572+ checks):

| Framework | Checks | Enfoque |
|---|---|---|
| CIS AWS Benchmark | ~150 | Configuración segura base |
| NIST 800-53 | ~200 | Controles federales |
| PCI-DSS | ~100 | Datos de tarjetas |
| HIPAA | ~80 | Datos de salud |
| SOC2 | ~50 | Controles de auditoría |

### Mapeo a pilares Well-Architected:

| Pilar | Qué evalúa |
|---|---|
| Seguridad | IAM, cifrado, redes, logging |
| Fiabilidad | Backups, multi-AZ, auto-scaling |
| Excelencia Operacional | CloudTrail, Config, alarmas |
| Eficiencia de Rendimiento | Tipos de instancia, caching |
| Optimización de Costos | Recursos sin uso, reservas |
| Sostenibilidad | Eficiencia de recursos |

### Troubleshooting común:

| Problema | Causa probable | Solución |
|---|---|---|
| "Invalid credentials" | Keys expiradas o mal copiadas | Solicitar nuevas credenciales al cliente |
| "Insufficient permissions" | Falta policy SecurityAudit | Enviar al cliente la policy requerida |
| "Config not enabled" | AWS Config no activo | Indicar al cliente que lo habilite |
| "Security Hub not enabled" | Security Hub no activo | Indicar al cliente que lo habilite |
| Escaneo tarda >30 min | Cuenta muy grande o Worker caído | Contactar al Manager |
| "Session expired" | Token JWT expirado | Refrescar la página y re-autenticarse |

### Tips:

- **No uses credenciales root** del cliente — siempre un usuario IAM con permisos limitados
- **Credenciales temporales** (con Session Token) son más seguras pero expiran en 1-12 horas
- **Una evaluación por cuenta** — no ejecutar múltiples escaneos simultáneos sobre la misma cuenta
- **Los resultados se guardan** — puedes acceder al historial de evaluaciones anteriores desde el panel lateral
