# WAFR Scan Portal — Diagrama de Flujo del Proceso

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WAFR SCAN PORTAL                             │
│                    Flujo del Proceso Principal                       │
└─────────────────────────────────────────────────────────────────────┘

    ┌───────────────┐
    │  Usuario VDM  │
    │  accede al    │
    │    Portal     │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐       ┌──────────────────────┐
    │   Login con   │──NO──▶│  Mostrar error de    │
    │   Cognito     │       │  credenciales        │
    │  (email/pass) │       └──────────┬───────────┘
    └───────┬───────┘                  │
            │ SI                       ▼
            ▼                   (Reintentar)
    ┌───────────────┐
    │  Token JWT    │
    │  emitido      │
    └───────┬───────┘
            │
            ▼
┌─────────────────────────────────────────┐
│     FORMULARIO DE INFORMACIÓN           │
│                                         │
│  • Nombre del Partner                   │
│  • Correo del Partner                   │
│  • País                                 │
│  • Cliente Final                        │
│  • Número de Consola AWS                │
│  • Selección de 1 Región AWS            │
│                                         │
└────────────────┬────────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │  ¿Campos       │──NO──▶ Mostrar errores
        │  válidos?      │        de validación
        └────────┬───────┘
                 │ SI
                 ▼
┌─────────────────────────────────────────┐
│     CARGA DE ARCHIVO EXCEL (.xlsx)      │
│                                         │
│  Contiene: Access Key + Secret Key      │
└────────────────┬────────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │  ¿Formato      │──NO──▶ "Solo se aceptan
        │  .xlsx?        │        archivos .xlsx"
        └────────┬───────┘
                 │ SI
                 ▼
┌─────────────────────────────────────────┐
│  PASO 1: VALIDACIÓN DE CONEXIÓN         │
│  (Agent Core → AWS del cliente)         │
│                                         │
│  Agent Core extrae credenciales del     │
│  Excel y prueba conexión a la cuenta    │
│  AWS en la región seleccionada          │
│  (STS GetCallerIdentity)               │
└────────────────┬────────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │  ¿Conexión     │──NO──▶ Mostrar causa
        │  exitosa?      │        de la falla
        └────────┬───────┘
                 │ SI
                 ▼
┌─────────────────────────────────────────┐
│  PASO 2: VALIDACIÓN DE PERMISOS         │
│  (Agent Core → IAM del cliente)         │
│                                         │
│  • Verificar políticas managed:         │
│    - SecurityAudit                      │
│    - ViewOnlyAccess                     │
│  • Verificar prowler-additions-policy   │
│    (account, appstream, backup,         │
│     bedrock, cognito, ecr, glue,        │
│     lambda, macie2, shield, ssm, etc.)  │
│  • Rechazar si tiene permisos de        │
│    escritura sobre recursos             │
│    (excepto wellarchitected:* y         │
│     securityhub:BatchImportFindings)    │
│  • Verificar wellarchitected:           │
│    CreateWorkload, UpdateAnswer,        │
│    AssociateLenses                      │
└────────────────┬────────────────────────┘
                 │
                 ▼
        ┌────────────────┐       ┌──────────────────────┐
        │  ¿Permisos     │──NO──▶│ Mostrar lista de     │
        │  correctos?    │       │ políticas faltantes   │
        └────────┬───────┘       │ + Descargar JSON de   │
                 │ SI            │ política IAM mínima   │
                 ▼               └──────────────────────┘
┌─────────────────────────────────────────┐
│  PASO 3: VALIDACIÓN DE PREREQUISITOS    │
│  (Agent Core → Config/SH del cliente)   │
│                                         │
│  ✓ AWS Config habilitado y registrando  │
│    recursos en la región                │
│  ✓ Security Hub habilitado              │
│  ✓ Estándares activos:                  │
│    - AWS Foundational Security (FSBP)   │
│    - CIS AWS Foundations Benchmark      │
│    - PCI DSS (si aplica)                │
│                                         │
│  [Checklist visual: verde ✓ / rojo ✗]   │
└────────────────┬────────────────────────┘
                 │
                 ▼
        ┌────────────────┐       ┌──────────────────────┐
        │  ¿Todo         │──NO──▶│ Instrucciones paso   │
        │  activo?       │       │ a paso para activar  │
        └────────┬───────┘       │ desde consola AWS    │
                 │ SI            └──────────────────────┘
                 ▼
    ╔═════════════════════════════════════╗
    ║   BOTÓN "INICIAR EVALUACIÓN WAFR"  ║
    ║         (ahora habilitado)          ║
    ╚════════════════╤════════════════════╝
                     │
                     ▼
┌─────────────────────────────────────────┐
│  EJECUCIÓN DEL ASSESSMENT WAFR          │
│  (Agent Core + Prowler App en ECS)      │
│                                         │
│  1. Crear Workload en WA Tool API       │
│     → Genera Workload ARN               │
│  2. Crear Provider en Prowler API       │
│     con credenciales del cliente        │
│  3. Lanzar Scan en Prowler con          │
│     frameworks: WAFR, FTR, CIS,        │
│     FSBP, PCI DSS                       │
│  4. Prowler ejecuta 572+ checks        │
│  5. Parsear resultados JSON y mapear    │
│     hallazgos a 6 pilares:              │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ ○ Excelencia Operacional        │    │
│  │ ○ Seguridad                     │    │
│  │ ○ Fiabilidad                    │    │
│  │ ○ Eficiencia de Rendimiento     │    │
│  │ ○ Optimización de Costos        │    │
│  │ ○ Sostenibilidad                │    │
│  └─────────────────────────────────┘    │
│                                         │
│  6. Clasificar hallazgos por severidad  │
│     (Crítica / Alta / Media)            │
│  7. Calificar cada pilar (0-100)        │
│  8. Calcular calificación general       │
│  9. Estimar horas de remediación        │
│  10. Registrar respuestas (UpdateAnswer)│
│                                         │
│  [████████████░░░░] Progreso visible    │
│                                         │
│  📊 Resultados también visibles en      │
│     Prowler UI (dashboards interactivos)│
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  GENERACIÓN DE REPORTES PDF             │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  PDF "wafr-ready" (Resumen)     │    │
│  │                                 │    │
│  │  • Hallazgos por severidad      │    │
│  │  • Calificación por pilar       │    │
│  │  • Calificación general         │    │
│  │  • Horas estimadas remediación  │    │
│  │  • Encabezado: partner, cliente │    │
│  │    consola, región, fecha       │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  PDF "wafr-detail" (Detalle)    │    │
│  │                                 │    │
│  │  • Workload ARN                 │    │
│  │  • Cada hallazgo con:           │    │
│  │    - ARN del recurso            │    │
│  │    - Descripción del problema   │    │
│  │    - Severidad                  │    │
│  │    - Remediación vía consola    │    │
│  │  • Agrupado por pilar WAFR      │    │
│  │  • Checklist de remediación     │    │
│  │    por pilar (☐ por hallazgo)   │    │
│  └─────────────────────────────────┘    │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  ENVÍO POR CORREO (Amazon SES)          │
│                                         │
│  📧 wafr-ready ──▶ Correo del VDM      │
│  📧 wafr-detail ─▶ luis.zuniga          │
│                    @tdsynnex.com        │
│                                         │
│  Asunto: [Cliente Final] - [Fecha]      │
│                                         │
│  Reintentos: hasta 3 (cada 30 seg)     │
│  Si falla: descargar PDFs del Portal    │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  RESULTADO FINAL EN PORTAL              │
│                                         │
│  • Workload ARN visible y copiable      │
│  • Guardado en historial del VDM        │
│  • Listo para usar en Partner Central   │
│    (FTR / WAFR Program)                 │
│  • Enlace a Prowler UI para ver         │
│    dashboards interactivos              │
└─────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                    RESUMEN DE ORQUESTACIÓN                           │
│                                                                     │
│  Frontend (React) ──▶ Agent Core (Bedrock)                          │
│                          │                                          │
│                          ├──▶ AWS del cliente (validaciones)        │
│                          │    • STS: conexión                       │
│                          │    • IAM: permisos read-only             │
│                          │    • Config: habilitado                  │
│                          │    • Security Hub: estándares            │
│                          │                                          │
│                          ├──▶ Prowler App (ECS) (assessment)        │
│                          │    • Crea provider + lanza scan          │
│                          │    • 572+ checks de seguridad            │
│                          │    • Resultados JSON                     │
│                          │                                          │
│                          ├──▶ WA Tool API (registro formal)         │
│                          │    • CreateWorkload → ARN                │
│                          │    • UpdateAnswer por pilar              │
│                          │                                          │
│                          ├──▶ Genera PDFs (wafr-ready + detail)     │
│                          │                                          │
│                          └──▶ Envía correos (SES)                   │
│                               • Ready → VDM                        │
│                               • Detail → equipo técnico             │
└─────────────────────────────────────────────────────────────────────┘
```


---

# Flujo Simplificado de Orquestación

```
VDM usa nuestro Frontend (React)
        │
        ▼
Agent Core (Bedrock) se conecta a AWS del cliente
        │
        ├── Valida conexión (STS GetCallerIdentity)
        ├── Valida permisos read-only (IAM SimulatePrincipalPolicy)
        ├── Valida prerequisitos (Config + Security Hub)
        │
        ▼
Agent Core invoca Prowler API (ECS)
        │
        ├── Crea provider con credenciales del cliente
        ├── Lanza scan con frameworks WAFR/FTR/CIS/FSBP
        ├── Prowler ejecuta 572+ checks en la cuenta
        │
        ▼
Agent Core toma resultados de Prowler
        │
        ├── Parsea hallazgos JSON de Prowler
        ├── Mapea a los 6 pilares WAFR
        ├── Calcula scores y horas de remediación
        ├── Crea Workload ARN en WA Tool API
        ├── Genera PDF wafr-ready (resumen)
        ├── Genera PDF wafr-detail (detalle + checklist)
        │
        ▼
Agent Core envía los PDFs por correo (SES)
        │
        ├── wafr-ready → correo del VDM
        └── wafr-detail → luis.zuniga@tdsynnex.com
```
