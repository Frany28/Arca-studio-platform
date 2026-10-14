# Cambios temporales para pruebas

## Vercel staging: migraciones fuera del build

- `Backend/vercel.json` mantiene temporalmente `buildCommand: null` porque ejecutar `pnpm db:migrate:deploy` durante el build bloquea los despliegues del backend de staging.
- Las migraciones continúan administrándose mediante los scripts de Prisma del backend y deben desplegarse de forma controlada cuando exista una migración nueva.
- Antes de producción se debe definir un paso de migración separado y verificable que no impida construir ni promover la función de Vercel.

## Bypass de autenticación para pruebas locales

El switch ya no es una constante en el código. Se controla con variables de entorno y solo puede activarse en una máquina local.

### Backend

- Variable: `ROUTE_AUTH_DISABLED_FOR_TESTS=true` (opcionalmente `PUBLIC_TEST_USER_ID` y `PUBLIC_TEST_CLIENT_ID`).
- Regla en `Backend/src/config/auth.js` (`resolveRouteAuthBypass`): se activa solo si el flag es `true`, `NODE_ENV` es `development` o `test` y no existe ningún marcador de plataforma (`VERCEL`, `VERCEL_ENV`, `AWS_LAMBDA_FUNCTION_NAME`, `FUNCTIONS_WORKER_RUNTIME`, `NETLIFY`).
- Mientras está activo, `requireAuth`, `requireRoles` y `requirePermissions` dejan pasar las solicitudes con un usuario de prueba con rol de administrador.
- Fuera de esas condiciones se ignora y se registra `route_auth_bypass_ignored`. En producción, además, la guardia de arranque rechaza el flag (ver la sección siguiente).

### Frontend

- `Frontend/src/auth/testAccess.js` (`resolveRouteAuthDisabledForTests`) solo permite el bypass visual en compilaciones de desarrollo (`import.meta.env.DEV`) cuando además se solicita explícitamente. No sustituye la sesión real del servidor.

### Cómo desactivarlo

Eliminar `ROUTE_AUTH_DISABLED_FOR_TESTS` del `.env` local o definirlo como `false`. No requiere cambios de código.

### Antes de producción

Eliminar el mecanismo completo (flag, `PUBLIC_TEST_*` y el usuario de prueba en `Backend/src/middlewares/auth.js`) junto con las credenciales demo, según la sección 15 de `AGENTS.md`.

## Guardia de configuración segura al arrancar

`Backend/src/config/environmentGuard.js` se importa en `Backend/local.js` y `Backend/api/index.js` justo después de cargar el entorno y antes de la aplicación. Si la configuración es insegura, lanza `INSECURE_ENVIRONMENT` y el servicio no atiende solicitudes: en local el proceso termina con error y en Vercel la función no se inicializa. El mensaje lista los códigos y nombres de variables, nunca sus valores. Las reglas están en `Backend/src/config/environment.js` (`collectEnvironmentViolations`).

| Código | Condición que impide arrancar |
| --- | --- |
| `NODE_ENV_INVALID` | `NODE_ENV` ausente o distinto de exactamente `development`, `test` o `production` (por ejemplo `Production`, ` production `, `staging`, `prod`) |
| `HOSTED_RUNTIME_NOT_PRODUCTION` | Hay un marcador de plataforma y `NODE_ENV` no es `production` |
| `AUTH_TOKEN_SECRET_WEAK` | En producción, `AUTH_TOKEN_SECRET` falta o tiene menos de 32 caracteres |
| `AUTH_BYPASS_FLAG_PRESENT` | En producción, `ROUTE_AUTH_DISABLED_FOR_TESTS` tiene cualquier valor distinto de vacío o `false` |
| `CSRF_ALLOWS_MISSING_ORIGIN` | En producción, `CSRF_ALLOW_NO_ORIGIN=true` |
| `CORS_ORIGIN_INSECURE` | En producción, algún origen de `CORS_ORIGIN`, `CORS_ORIGINS` o `FRONTEND_URL` no es HTTPS, contiene `*` o no es una URL válida |

### Qué garantiza

- Una instancia desplegada no puede funcionar con cookies, CORS, CSRF o secreto JWT de desarrollo por un `NODE_ENV` ausente, mal escrito o desconocido: cualquier valor no canónico falla en cualquier host, haya o no marcadores de plataforma.
- En plataformas conocidas, `development` o `test` también fallan.
- En producción no puede quedar activo el bypass ni aceptarse mutaciones sin `Origin`, y solo se aceptan orígenes HTTPS concretos.

### Límites

- Un host desconocido configurado deliberadamente con `NODE_ENV=development` o `test` se trata como local: la guardia no puede distinguirlo de una máquina de desarrollo. Los servidores propios deben usar `NODE_ENV=production`.
- Solo protege a los puntos de entrada que importan la guardia. Cualquier punto de entrada nuevo debe importar `environmentGuard.js` antes que `src/app.js`. Las pruebas que importan `src/app.js` directamente no pasan por ella.
- Valida la forma de la configuración, no la calidad real del secreto ni que los orígenes sean los correctos.
- `vercel dev` define `VERCEL=1` y, por tanto, solo arranca con la configuración de producción. Para desarrollo local se usa `pnpm dev`.

### Requisitos previos al despliegue

Verificar en Vercel, sin copiar los valores:

- `NODE_ENV`: sin definir (Vercel usa `production`) o exactamente `production`.
- `AUTH_TOKEN_SECRET`: definido, con al menos 32 caracteres.
- `CORS_ORIGIN`, `CORS_ORIGINS` y `FRONTEND_URL`: solo orígenes `https://` concretos; eliminar `https://*.netlify.app` si está configurado.
- `CSRF_ALLOW_NO_ORIGIN` y `ROUTE_AUTH_DISABLED_FOR_TESTS`: sin definir o `false`.

Tras desplegar en un entorno de prueba, comprobar `GET /api/health`. Si la función falla al inicializarse, el log de Vercel indica el código y la variable que hay que corregir.
