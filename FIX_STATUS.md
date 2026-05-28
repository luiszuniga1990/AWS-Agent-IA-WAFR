# Estado del Fix - AWS-Agent-IA-WAFR (27 Mayo 2026)

## Problema Original
El frontend del portal WAFR Scan muestra "Error de conexión. Intente nuevamente." al intentar crear un scan o subir credenciales después de hacer login con Cognito.

## Causa Raíz Identificada
**TODAS las funciones Lambda fallan al iniciar** porque el deployment no incluye `node_modules`.

El CDK usa `lambda.Code.fromAsset(backendCodePath)` que empaqueta el directorio `backend/` pero como es un npm workspace, las dependencias están hoisted en el `node_modules` raíz del monorepo, NO dentro de `backend/node_modules`.

Error en CloudWatch:
```
Runtime.ImportModuleError: Error: Cannot find module 'uuid'
Require stack: /var/task/dist/handlers/form-handler.js
```

## Lo que ya se hizo
1. Se identificó el problema revisando CloudWatch logs de `/aws/lambda/wafr-form-handler`
2. Se intentó copiar dependencias manualmente al `backend/node_modules` y re-deployar las 6 Lambdas
3. Se resolvió `uuid` pero aparecieron más dependencias transitivas faltantes (`mnemonist`, etc.)
4. Las 6 Lambdas fueron actualizadas con `aws lambda update-function-code` pero el zip aún tiene dependencias incompletas

## Qué hacer para resolver (pasos pendientes)

### Opción A: Copiar node_modules completo (rápido, para fix inmediato)
```bash
cd /root/AWS-Agent-IA-WAFR/backend
rm -rf node_modules

# Copiar TODO excepto @wafr-portal (workspace circular)
cd /root/AWS-Agent-IA-WAFR/node_modules
find . -maxdepth 1 -not -name '@wafr-portal' -not -name '.' | while read dir; do
  cp -r "$dir" /root/AWS-Agent-IA-WAFR/backend/node_modules/
done

# Copiar shared compilado como @wafr-portal/shared
mkdir -p /root/AWS-Agent-IA-WAFR/backend/node_modules/@wafr-portal
cp -r /root/AWS-Agent-IA-WAFR/shared /root/AWS-Agent-IA-WAFR/backend/node_modules/@wafr-portal/shared

# Crear zip y deployar
cd /root/AWS-Agent-IA-WAFR/backend
zip -qr /tmp/backend-lambda.zip dist/ node_modules/ package.json

# Actualizar las 6 Lambdas
for fn in wafr-form-handler wafr-credential-validator wafr-prerequisite-checker wafr-assessment-orchestrator wafr-pdf-generator wafr-email-sender; do
  aws lambda update-function-code --function-name $fn --region us-west-2 --zip-file fileb:///tmp/backend-lambda.zip
done

# Verificar
aws lambda invoke --function-name wafr-form-handler --region us-west-2 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","path":"/scans","headers":{},"queryStringParameters":null,"body":null}' \
  /tmp/test-response.json && cat /tmp/test-response.json
```

### Opción B: Fix permanente en CDK (mejor a largo plazo)
Modificar `infra/src/stacks/lambda-stack.ts` para usar `NodejsFunction` con bundling:
```typescript
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
// Reemplazar lambda.Code.fromAsset por NodejsFunction con esbuild bundling
```
O agregar un script de build que haga `npm ci --omit=dev` dentro de `backend/` antes del `cdk deploy`.

## Datos clave del entorno
- Región: us-west-2 (Oregon)
- Account: XXXXXXXXXXXX
- API Gateway ID: sdsxytf6g6
- API URL: https://sdsxytf6g6.execute-api.us-west-2.amazonaws.com/prod
- Cognito User Pool: us-west-2_hxoSHLE6n
- Cognito Client: 40eabtcdubcqgae7oek8q5abi7
- Stack names: WafrAuthStack, WafrApiStack, WafrLambdaStack, WafrFrontendStack
- Lambdas: wafr-form-handler, wafr-credential-validator, wafr-prerequisite-checker, wafr-assessment-orchestrator, wafr-pdf-generator, wafr-email-sender
