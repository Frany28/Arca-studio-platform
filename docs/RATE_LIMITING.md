# Rate limiting compartido (hallazgo B-2)

## Problema original

El limitador anterior guardaba los contadores en la memoria de cada instancia de Vercel. Se confirmaron cuatro debilidades:

- **Varias instancias:** con 3 instancias, una cuenta admitió 15 intentos en lugar de 5.
- **IP compartida:** detrás de Netlify, `req.ip` es la IP de Netlify para todos los usuarios, y la clave `IP:anonymous` bloqueaba a todos a la vez.
- **Expulsión LRU:** rellenar el almacén con claves de relleno reiniciaba el contador de una cuenta bloqueada.
- **Datos en claro:** las claves contenían el correo.

**Todos los límites usan ahora un contador compartido en PostgreSQL. El limitador en memoria se eliminó.**

## Componentes

| Pieza | Archivo | Responsabilidad |
| --- | --- | --- |
| Tabla | `Backend/prisma/migrations/20261014140000_rate_limit_buckets` | `key_hash` (32 bytes), `scope`, `count`, `window_started_at`, `expires_at`; índice por caducidad; RLS; `REVOKE` de D-2 si existen los roles de Supabase |
| Repositorio | `src/repositories/rateLimitRepository.js` | Incremento atómico de varias claves en una sentencia (orden estable de bloqueo) y limpieza por lotes |
| Claves | `src/utils/rateLimitKey.js` | HMAC-SHA256 con clave derivada (HKDF) de `AUTH_TOKEN_SECRET`; normalización de correos y de destinatarios |
| IP verificada | `src/utils/verifiedClientIp.js` | Proxy firmado de Netlify. **Inactivo** mientras no exista `NETLIFY_PROXY_SIGNATURE_SECRET` |
| Servicio | `src/services/rateLimitService.js` | Consume dimensiones, calcula `Retry-After`, registra anomalías y primeros bloqueos, programa la limpieza |
| Middleware común | `src/middlewares/sharedRateLimit.js` | 429 `RATE_LIMITED` (mismo contrato) y 503 `RATE_LIMIT_UNAVAILABLE` (fail-closed) |
| Autenticación y correos | `src/config/authRateLimits.js`, `src/middlewares/authRateLimit.js` | Políticas de los ámbitos de autenticación y de correos de seguridad |
| Acciones de usuario | `src/middlewares/actionRateLimits.js` | Comentarios, solicitudes, cargas y administración, por usuario autenticado |

## Atomicidad, concurrencia y expiración

`INSERT ... ON CONFLICT (key_hash) DO UPDATE` bloquea cada fila. Las peticiones simultáneas, aunque vengan de instancias distintas, cuentan exactamente, y si la ventana caducó la misma sentencia la reinicia.

- **Reloj único:** se usa el de PostgreSQL (`now()`).
- **Sin interbloqueos:** las claves se insertan ordenadas por `key_hash`.
- **Limpieza:** el 2 % de las peticiones limitadas lanza, sin esperar su resultado, un `DELETE` de hasta 500 filas caducadas (`FOR UPDATE SKIP LOCKED`). Un fallo de la limpieza solo se registra (`rate_limit_cleanup_failed`).

## Ámbitos y límites

| Ámbito | Rutas | Dimensión: límite |
| --- | --- | --- |
| `login` | `POST /auth/login` | cuenta (correo): 20/h · cuenta + IP verificada: 5/15 min (`AUTH_LOGIN_RATE_LIMIT_*`) · IP verificada: 30/15 min |
| `registration` | inicio, reenvío, verificación y completar del registro | igual que login; la cuenta es el correo o un token de registro **con firma válida** |
| `password-reset` | `forgot-password`, `verify-reset-token`, `reset-password` | igual que login; la cuenta es el correo o un token de recuperación **con firma válida** |
| `change-password` | `POST /auth/change-password` | usuario: 5/15 min · IP verificada: 30/15 min |
| `email-registration` | inicio y reenvío del registro (límite compartido) | destinatario: 5/h (`EMAIL_REGISTRATION_RATE_LIMIT_*`) |
| `email-password-reset` | `forgot-password` | destinatario: 5/h (`EMAIL_PASSWORD_RESET_RATE_LIMIT_*`) |
| `comments` | comentarios de proyectos y del entorno | usuario: 30/min (`COMMENT_RATE_LIMIT_*`) |
| `project-requests` | crear, editar, enviar y revisar solicitudes | usuario: 10/min (`PROJECT_REQUEST_RATE_LIMIT_*`) |
| `uploads` | cargas de proyectos, solicitudes y soporte | usuario: **60 cada 10 min** (`UPLOAD_RATE_LIMIT_*`) |
| `admin-*` | crear usuario 20/h, estado 60/h, notas 120/h, acción masiva 60/h, decisión 60/h | usuario |

Por qué las cargas pasaron a 60 cada 10 minutos: el panel de cargas del frontend sube **todos los archivos del lote a la vez**, sin máximo. Con 20 por minuto, un lote de 21 o más archivos recibía 429 a partir del archivo 21.

## Correos de seguridad (T1)

- **Dónde se aplica el límite:** después de validar la petición y **antes** de consultar si la cuenta existe. Cuenta igual para correos registrados y no registrados, así que la respuesta no revela qué cuentas existen (prueba: misma secuencia `202×5, 429`). Una petición bloqueada no llega al controlador: no consulta la cuenta ni envía correo.
- **Alias:** solo se unifican con reglas verificadas en la ayuda oficial de Gmail, y solo para `@gmail.com`: los puntos del nombre de usuario no cambian el buzón y el texto tras `+` es una etiqueta.
  - `googlemail.com`, Google Workspace, Outlook y otros dominios solo se normalizan en mayúsculas y espacios, porque no hay una regla oficial equivalente para la recepción.
  - Fuentes: [Los puntos no importan en Gmail](https://support.google.com/mail/answer/7436150), [Alias con «+» en Gmail](https://support.google.com/mail/answer/22370).
- **Notificaciones futuras:** las de proyectos (aprobaciones, cambios de estado, avisos) tendrán políticas propias y **no** usan estos límites.

## Tokens falsificados (T2)

En los pasos con enlace, el token solo identifica la cuenta si `verifyAuthToken` confirma la firma HMAC, la caducidad y el propósito (`user_registration` o `password_reset`). Un token falsificado o de otro propósito no crea contador de cuenta: solo suma al contador de observación del ámbito, que es una única fila. El controlador mantiene su verificación completa: existencia, uso y caducidad en PostgreSQL.

## Anomalías (T3)

Cada ámbito de autenticación y de correo suma además un contador de observación global (`scope-volume`) que **nunca bloquea**.

| Ámbito | Umbral |
| --- | --- |
| `login` | 300 / 5 min |
| `registration`, `password-reset` | 200 / 15 min |
| `change-password` | 50 / 15 min |
| `email-registration`, `email-password-reset` | 50 / h |

**Registros estructurados (en los logs de Vercel):**

- `rate_limit_anomaly` con `scope`, `dimension`, `threshold` y `windowSeconds`.
- `rate_limit_exceeded` (primer bloqueo de cada clave en su ventana) con `scope`, `dimension`, `max`, `windowSeconds` y `fingerprint`, que son los 12 primeros caracteres hexadecimales del HMAC, una huella seudónima.

Ninguno incluye correos, tokens, IP ni identificadores de usuario.

**Por qué funciona con varias instancias:** el contador es atómico y compartido, así que una sola instancia ve exactamente el valor del umbral. El resultado es un único registro por ventana. Está comprobado con tres procesos reales.

**Coste:** la observación es una fila por ámbito actualizada en cada petición. Bajo un ataque muy intenso esa fila serializa las actualizaciones (milisegundos cada una). Es aceptable para estos endpoints, de bajo volumen.

## Modo temporal sin IP verificada

Mientras no esté activo el proxy firmado de Netlify:

- **Nunca se usan** `req.ip` (detrás de Netlify es la misma para todos) **ni** `X-Forwarded-For`.
- Solo se aplican límites por cuenta, destinatario, token válido o usuario, más la observación global. No hay bloqueos colectivos.
- Las peticiones sin identidad reconocible (correo inválido, token falsificado) no consumen contador limitante y se rechazan sin consultar la base.

## Fallo de PostgreSQL

Todos los ámbitos responden `503 RATE_LIMIT_UNAVAILABLE` con `Retry-After: 30` y registran `rate_limit_unavailable`, **antes** de ejecutar la operación: no se envía correo, no se escribe ningún archivo, no se crea el comentario. Estos endpoints necesitan PostgreSQL de todos modos, así que el 503 no añade caídas, solo cambia el código de error.

## IP real con el proxy firmado de Netlify (preparado, no activo)

**Fuentes oficiales:**

- [Netlify, Rewrites and proxies](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/): JWS HS256 en `x-nf-sign` con `{ deploy_context, exp, iss: "netlify", netlify_id, site_url }`. La variable debe tener scope Runtime.
- [Vercel, Request headers](https://vercel.com/docs/headers/request-headers): Vercel sobrescribe `X-Forwarded-For`.
- `X-Nf-Client-Connection-Ip` solo aparece en el [foro de soporte de Netlify](https://answers.netlify.com/t/upcoming-change-stripping-exposed-netlify-headers-from-function-and-proxy-requests/52665).

**La firma no cubre la IP.** Para activarlo (requiere aprobación):

1. Generar un secreto de 32 bytes o más.
2. Netlify: crear la variable `ARCA_PROXY_SIGNATURE_SECRET` con scope Runtime y añadir `signed = "ARCA_PROXY_SIGNATURE_SECRET"` a la regla `/api/*`.
3. Vercel: crear `NETLIFY_PROXY_SIGNATURE_SECRET` con el mismo valor.
4. Staging:
   - una petición del navegador debe producir IP verificada;
   - una petición directa a `vercel.app` con la cabecera inventada no debe producirla;
   - Netlify debe **sobrescribir** una cabecera `X-Nf-Client-Connection-Ip` enviada por el cliente.

## Migraciones

`20261014140000_rate_limit_buckets` es la única migración de B-2, ya preparada. Esta fase no añadió migraciones: comentarios, cargas, administración, correos y anomalías usan la misma tabla.

Su orden respecto a las migraciones pendientes:

1. `20261014120000_support_tables` (D-4).
2. `20261014130000_revoke_api_role_table_privileges` (D-2).
3. `20261014140000_rate_limit_buckets` (B-2).

## Orden de despliegue

1. Copia de seguridad o punto de restauración de Supabase.
2. **Variables de Vercel:** comprobar que `UPLOAD_RATE_LIMIT_MAX` y `UPLOAD_RATE_LIMIT_WINDOW_MS` no conservan los valores antiguos (20 / 60000); si existen, eliminarlas o ponerlas en 60 / 600000. Comprobar también que todas las instancias comparten `AUTH_TOKEN_SECRET`.
3. Base de pruebas: `pnpm db:migrate:status` y después `pnpm db:migrate:deploy` (D-4, D-2 y B-2 en ese orden).
4. Producción: lo mismo, con `pnpm db:migrate:status` al final para confirmar que no queda nada pendiente.
5. Publicar el backend. **Nunca antes de la migración**: sin la tabla, todos los endpoints limitados responderían 503.
6. Comprobaciones:
   - login con la cuenta demo;
   - recuperación de contraseña: 5 envíos y luego 429 con `Retry-After`;
   - un comentario;
   - un lote de cargas;
   - una acción administrativa;
   - los logs no contienen `rate_limit_unavailable`.

## Reversión

- **Backend:** volver a publicar la versión anterior. La tabla puede quedarse: no la usa nadie.
- **Base de datos:** no hace falta revertir. Si se quisiera eliminar la tabla, crear una migración nueva con `DROP TABLE public.rate_limit_buckets` después de retirar el código.
- **Límites:** ajustar las variables de entorno documentadas. Un valor no válido usa el predeterminado, nunca desactiva el límite.

## Riesgos abiertos

- **Sin límite por IP** mientras el proxy firmado no esté activo: un ataque repartido entre muchas cuentas o destinatarios solo queda limitado por identidad. T3 lo detecta en los logs, pero no lo bloquea.
- **Cuota del proveedor de correo:** un atacante puede enviar hasta 5 correos por hora a cada destinatario distinto. En el plan gratuito de Resend (100 al día) eso puede agotar la cuota. El presupuesto global de correos de seguridad (A2) quedó propuesto, pendiente de decisión.
- **Bloqueo de una cuenta concreta:** se puede agotar el límite de 20 por hora de una cuenta, o de 5 por hora de un destinatario, y bloquearla hasta una hora. No afecta a otros usuarios.
- **Fila de observación:** concentra las actualizaciones de cada ámbito. Medir en staging con carga.

## Pruebas

- **`Backend/tests/authRateLimit.test.js`:** claves, IP verificada, políticas, servicio, middleware 429/503, login y recuperación con la aplicación real.
- **`Backend/tests/rateLimitEmailAndActions.test.js`:**
  - alias de Gmail;
  - límites de correo;
  - orden de los middlewares;
  - recuperación sin enviar al sexto intento y sin enumeración;
  - registro: inicio y reenvío comparten límite;
  - tokens falsificados sin filas;
  - anomalía única y sin datos personales;
  - límites de acciones;
  - lote de 60 cargas en paralelo y la 61 con 429 sin escribir;
  - 503 sin escribir archivos;
  - 503 en comentarios y administración sin consultas de negocio;
  - 429 de comentarios por usuario.
- **`Backend/tests/rateLimitStore.integration.test.js`** (PostgreSQL aislado, opcional):
  - migración;
  - concurrencia (60 → 20);
  - 3 procesos compartiendo el contador;
  - expiración;
  - dimensiones;
  - IP no confiable;
  - claves sin datos personales;
  - limpieza;
  - base inaccesible;
  - cargas entre 3 procesos (90 → 60);
  - anomalía única entre 3 procesos;
  - tokens falsificados;
  - alias de Gmail.
- **`Backend/tests/helpers/rateLimitQueryMock.js`:** emulación compartida del contador para las pruebas que sustituyen `pool.query`.

```powershell
$env:ARCA_RATE_LIMIT_DB_TESTS = "1"
$env:ARCA_RATE_LIMIT_TEST_CREATE_ROLES = "1"   # solo en un clúster desechable
$env:ARCA_RATE_LIMIT_TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/postgres"
node --test tests/rateLimitStore.integration.test.js
```
