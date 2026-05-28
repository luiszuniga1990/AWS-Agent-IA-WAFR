# WafrProwlerEcsStack — Deploy Guide

## Estado actual (2026-05-26)

El stack `WafrProwlerEcsStack` está pendiente de deploy. Se eliminó por errores en deploys anteriores.

## Problemas resueltos

| Problema | Causa raíz | Fix |
|----------|-----------|-----|
| Docker Hub rate limit (429) | Pulls anónimos agotados | Imágenes copiadas a ECR privado |
| API crash (exit 1) | Faltaban `POSTGRES_ADMIN_USER/PASSWORD`, usaba `REDIS_*` en vez de `VALKEY_*` | Env vars corregidas |
| UI health check fail (exit 143) | ALB health check en `/` devuelve 307 | Cambiado a `/api/auth/session` (200) |
| ECR permission denied | Execution roles sin `ecr:GetAuthorizationToken` | Usa `fromEcrRepository()` que agrega permisos automáticamente |
| CDK deploy en región incorrecta | Stacks sin `env` explícito | Agregado `env: { account, region: 'us-west-2' }` a todos |
| Bedrock Lambda import error | `fromFunctionArn` no funciona con env explícito | Cambiado a `fromFunctionAttributes` con `sameEnvironment: true` |

## ECR Repositories (us-west-2)

```
496272709874.dkr.ecr.us-west-2.amazonaws.com/prowler/api:latest
496272709874.dkr.ecr.us-west-2.amazonaws.com/prowler/worker:latest
496272709874.dkr.ecr.us-west-2.amazonaws.com/prowler/ui:latest
```

## Variables de entorno por container

### prowler-api (port 8080)
- Env: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `VALKEY_HOST`, `VALKEY_PORT`
- Secrets: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD`
- Health check: `/api/v1/healthcheck`

### prowler-worker (no port, Fargate Spot)
- Env: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `VALKEY_HOST`, `VALKEY_PORT`
- Secrets: `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Sin health check (no ALB)

### prowler-ui (port 3000)
- Env: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `VALKEY_HOST`, `VALKEY_PORT`, `AUTH_TRUST_HOST`, `AUTH_SECRET`
- Health check: `/api/auth/session`

## Pre-deploy checklist

1. Verificar stack eliminado:
   ```bash
   aws cloudformation describe-stacks --stack-name WafrProwlerEcsStack --region us-west-2
   ```
   Debe dar error "does not exist".

2. Si existe en DELETE_FAILED, force delete:
   ```bash
   aws cloudformation delete-stack --stack-name WafrProwlerEcsStack --deletion-mode FORCE_DELETE_STACK --region us-west-2
   ```

3. Limpiar recursos huérfanos:
   ```bash
   # Log groups
   for lg in $(aws logs describe-log-groups --log-group-name-prefix "WafrProwlerEcsStack" --region us-west-2 --query 'logGroups[].logGroupName' --output text); do
     aws logs delete-log-group --log-group-name "$lg" --region us-west-2
   done
   # Clusters
   for cl in $(aws ecs list-clusters --region us-west-2 --query 'clusterArns[]' --output text); do
     aws ecs delete-cluster --cluster "$cl" --region us-west-2
   done
   ```

4. Actualizar ALB health check (UI target group):
   ```bash
   aws elbv2 modify-target-group \
     --target-group-arn "arn:aws:elasticloadbalancing:us-west-2:496272709874:targetgroup/WafrPr-Prowl-B6FNHSDMXQFK/6fda76423bd1c667" \
     --health-check-path "/api/auth/session" \
     --region us-west-2
   ```

## Deploy command

```bash
cd /root/AWS-Agent-IA-WAFR/infra
AWS_DEFAULT_REGION=us-west-2 npx cdk deploy WafrProwlerEcsStack --require-approval never -c sesDomain=tdsynnex.com --exclusively
```

Tiempo estimado: ~3-5 minutos.

## Stacks pendientes después de ECS

Orden secuencial:
1. ✅ `WafrProwlerEcsStack` (este)
2. `WafrLambdaStack` — necesita `prowlerApiUrl` del ALB
3. `WafrApiStack` — necesita Lambdas
4. `WafrBedrockAgentStack` — necesita Lambda ARNs

Deploy de todos los pendientes:
```bash
AWS_DEFAULT_REGION=us-west-2 npx cdk deploy WafrLambdaStack WafrApiStack WafrBedrockAgentStack --require-approval never -c sesDomain=tdsynnex.com
```

## Archivos modificados

- `infra/src/app.ts` — env us-west-2 en todos los stacks
- `infra/src/stacks/prowler-ecs-stack.ts` — ECR, VALKEY, POSTGRES_ADMIN, AUTH_SECRET
- `infra/src/stacks/prowler-alb-stack.ts` — UI health check path
- `infra/src/stacks/bedrock-agent-stack.ts` — Lambda import fix
- `infra/src/stacks/prowler-ecs-stack.test.ts` — Unit tests (nuevo)

## Troubleshooting

Si el deploy se queda pegado >10 min:
```bash
# Ver eventos del servicio
CLUSTER=$(aws ecs list-clusters --region us-west-2 --query 'clusterArns[0]' --output text)
aws ecs describe-services --cluster $CLUSTER --services $(aws ecs list-services --cluster $CLUSTER --region us-west-2 --query 'serviceArns[]' --output text) --region us-west-2 --query 'services[].events[0].message'
```

Si hay error de capacity provider al eliminar:
```bash
aws cloudformation delete-stack --stack-name WafrProwlerEcsStack --deletion-mode FORCE_DELETE_STACK --region us-west-2
```
