# Rate limiting compartido (hallazgo B-2)

## Problema

`src/middlewares/rateLimit.js` guarda los contadores en la memoria de cada instancia. En Vercel cada instancia tiene sus propios contadores, y se confirmaron cuatro debilidades:

- **Varias instancias:** con 3 instancias, una cuenta admitió 15 intentos en lugar de 5.
- **IP compartida:** detrás de Netlify, `req.ip` es la IP de Netlify para todos los usuarios. En los endpoints sin correo, la clave `IP:anonymous` bloqueaba a todos a la vez.
- **Expulsión LRU:** rellenar el almacén con claves de relleno reiniciaba el contador de una cuenta bloqueada.
- **Datos en claro:** las claves contenían el correo.

## Diseño

| Pieza | Archivo | Responsabilidad |
| --- | --- | --- |
| Tabla | `prisma/migrations/20261014140000_rate_limit_buckets` | `key_hash` (32 bytes), `scope`, `count`, `window_started_at`, `expires_at`; índice por caducidad; RLS; `REVOKE` de D-2 si existen los roles de Supabase |
| Repositorio | `src/repositories/rateLimitRepository.js` | Incremento atómico de varias claves en una sentencia y limpieza por lotes |
| Claves | `src/utils/rateLimitKey.js` | HMAC-SHA256 (clave derivada con HKDF de `AUTH_TOKEN_SECRET`) de ámbito + dimensión + identificador |
| IP verificada | `src/utils/verifiedClientIp.js` | Firma del proxy de Netlify (`X-Nf-Sign`) + `X-Nf-Client-Connection-Ip` |
| Servicio | `src/services/rateLimitService.js` | Consume las dimensiones, calcula `Retry-After` y programa la limpieza |
| Políticas | `src/config/authRateLimits.js` | Dimensiones de cada ámbito de autenticación |
| Middleware | `src/middlewares/authRateLimit.js` | 429 `RATE_LIMITED` (mismo contrato) y 503 `RATE_LIMIT_UNAVAILABLE` |

### Atomicidad, concurrencia y expiración

`INSERT ... ON CONFLICT (key_hash) DO UPDATE` bloquea cada fila. Las peticiones simultáneas, aunque vengan de instancias distintas, cuentan exactamente, y si la ventana caducó la misma sentencia la reinicia.

- **Reloj único:** se usa el de PostgreSQL (`now()`), así que el desfase entre instancias no influye.
- **Sin interbloqueos:** las claves se insertan ordenadas por `key_hash`.
- **Limpieza:** el 2 % de las peticiones limitadas lanza, sin esperar su resultado, un `DELETE` de hasta 500 filas caducadas (`FOR UPDATE SKIP LOCKED`). Un fallo de la limpieza solo se registra (`rate_limit_cleanup_failed`), porque las filas caducadas se reinician en el siguiente uso y no afectan a la protección.

### Ámbitos y dimensiones

Cada flujo tiene su propio contador: `login`, `registration` (inicio, reenvío, verificación y completar), `password-reset` (solicitud, verificación del enlace y nueva contraseña) y `change-password`.

| Dimensión | Límite | Cuándo se aplica |
| --- | --- | --- |
| Cuenta | 20 / hora | Siempre que haya cuenta: correo normalizado o, en los pasos con enlace, el token |
| Cuenta + IP verificada | 5 / 15 min (`AUTH_LOGIN_RATE_LIMIT_*`) | Solo con IP verificada |
| IP verificada | 30 / 15 min | Solo con IP verificada |
| Usuario (cambio de contraseña) | 5 / 15 min | Siempre. Requiere sesión, por lo que un tercero no puede consumirlo |

### Modo temporal sin IP verificada

Mientras no esté activo el proxy firmado de Netlify:

- Solo se aplica la dimensión de cuenta.
- **Nunca se usa `req.ip`** (detrás de Netlify es la misma para todos) **ni `X-Forwarded-For`**, así que no hay bloqueos colectivos.
- Una petición sin cuenta reconocible no consume contador. El controlador la rechaza antes de cualquier operación costosa: validación de correo o firma del token, sin consultar la base.

Límites de este modo:

- No hay límite por IP para un ataque repartido entre muchas cuentas.
- Un atacante puede agotar el límite de 20 por hora de una cuenta concreta y bloquearla hasta una hora. Este riesgo existía antes con 5 intentos cada 15 minutos.
- Ninguna de las dos situaciones bloquea a otros usuarios.

### Fallo de PostgreSQL

En los endpoints de autenticación, si no se puede comprobar el límite:

- Respuesta `503 RATE_LIMIT_UNAVAILABLE` con `Retry-After: 30`.
- Registro `rate_limit_unavailable` con el código del error.
- El controlador no se ejecuta.

Esos endpoints también necesitan PostgreSQL para funcionar, así que el 503 no añade caídas.

### Endpoints no relacionados con autenticación

Comentarios, solicitudes de proyecto, cargas y acciones administrativas siguen con el limitador en memoria y sus límites actuales. Su clave es la del usuario autenticado, por lo que no sufren bloqueos colectivos. Siguen afectados por la multiplicación por instancias y la expulsión LRU, con un riesgo bajo: requieren sesión.

Antes de cambiarlos al contador compartido conviene decidir su comportamiento ante un fallo de PostgreSQL:

- **503:** coherente con autenticación. Sin PostgreSQL esos endpoints fallarían de todos modos, aunque el código de error sería otro.
- **Seguir con un contador en memoria y registrar el fallo:** mantiene la operación, pero degrada la protección.

Queda pendiente de decisión.

## IP real con el proxy firmado de Netlify (preparado, no activo)

**Fuentes oficiales:**

- [Netlify, Rewrites and proxies](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/): los proxies con `signed = "VARIABLE"` envían un JWS HS256 en `x-nf-sign` con `{ deploy_context, exp, iss: "netlify", netlify_id, site_url }`. La variable debe tener scope **Runtime**.
- [Vercel, Request headers](https://vercel.com/docs/headers/request-headers) y [Vercel, Reverse proxy](https://vercel.com/docs/security/reverse-proxy.md): Vercel sobrescribe `X-Forwarded-For` con quien se conecta, que detrás de Netlify es Netlify.
- `X-Nf-Client-Connection-Ip` solo aparece en el foro de soporte de Netlify ([cambio de cabeceras](https://answers.netlify.com/t/upcoming-change-stripping-exposed-netlify-headers-from-function-and-proxy-requests/52665)), como la cabecera que se conserva en los proxies externos.

**El backend solo confía en la IP si se cumplen todas estas condiciones:**

- existe `NETLIFY_PROXY_SIGNATURE_SECRET`;
- la firma HS256 es válida (comparación de tiempo constante) y `iss` es `netlify`;
- `exp` no caducó (con 30 s de tolerancia);
- `site_url` es uno de los orígenes CORS exactos;
- `X-Nf-Client-Connection-Ip` es una única IP válida.

Cualquier otro caso devuelve `null` y se aplica el modo temporal.

**Limitación:** la firma no cubre la IP. Antes de activar el mecanismo hay que comprobar en staging que Netlify **sobrescribe** una cabecera `X-Nf-Client-Connection-Ip` enviada por el cliente.

**Pasos para activarlo (requieren aprobación porque modifican servicios externos):**

1. Generar un secreto aleatorio (32 bytes o más).
2. Netlify: crear la variable `ARCA_PROXY_SIGNATURE_SECRET` con scope Runtime y añadir `signed = "ARCA_PROXY_SIGNATURE_SECRET"` a la regla `/api/*` de `netlify.toml`.
3. Vercel: crear `NETLIFY_PROXY_SIGNATURE_SECRET` con el mismo valor.
4. Staging:
   - una petición desde el navegador debe producir IP verificada;
   - una petición directa a `vercel.app` con `X-Nf-Client-Connection-Ip` inventada no debe producirla;
   - una petición a Netlify con esa cabecera inventada debe recibir la IP real.
5. Solo entonces, desplegar en producción.

## Orden de despliegue

1. Copia de seguridad o punto de restauración de Supabase.
2. Aplicar primero en una base de pruebas.
3. `pnpm db:migrate:status`: solo deben quedar pendientes las migraciones esperadas. Respetar también el orden de D-4 y D-2 (`PRISMA_MIGRATIONS.md`).
4. `pnpm db:migrate:deploy`, y `pnpm db:migrate:status` de nuevo.
5. Publicar el backend. Sin la tabla, los endpoints de autenticación responderían 503, por eso la migración va primero.
6. Comprobar el login con la cuenta demo, la recuperación de contraseña y que `Retry-After` aparece al superar el límite.
7. Cuando se apruebe el proxy firmado, seguir los pasos de la sección anterior.

**Requisito:** todas las instancias deben compartir `AUTH_TOKEN_SECRET`. La guardia de entorno ya lo exige en producción.

## Reversión

- **Backend:** volver a publicar la versión anterior, que usa el limitador en memoria. La tabla puede quedarse: no la usa nadie.
- **Base de datos:** no hace falta revertir. Si se quisiera eliminar la tabla, crear una migración nueva con `DROP TABLE public.rate_limit_buckets` después de retirar el código.
- **Proxy firmado:** quitar `signed` de `netlify.toml` y la variable de Vercel. El backend vuelve automáticamente al modo temporal.

## Pruebas

- **`Backend/tests/authRateLimit.test.js`** (unitarias, en `pnpm verify`):
  - claves HMAC sin datos personales;
  - IP verificada: firma válida, cabeceras suplantadas, `alg none`, caducidad, emisor y sitio;
  - dimensiones con y sin IP;
  - servicio (bloqueo, `Retry-After`, fallo e inconsistencias);
  - limpieza;
  - SQL parametrizado;
  - contrato 429 y 503;
  - login, recuperación y fallo de PostgreSQL con la aplicación real.
- **`Backend/tests/rateLimitStore.integration.test.js`** (PostgreSQL aislado, opcional):
  - migración con RLS y sin privilegios peligrosos;
  - 60 intentos simultáneos con exactamente 20 admitidos;
  - 3 procesos independientes que comparten el contador;
  - expiración;
  - dimensiones cuenta, cuenta + IP e IP;
  - IP no confiable;
  - claves sin datos personales;
  - limpieza;
  - base inaccesible.

Ejecución de la prueba de integración (clúster desechable):

```powershell
$env:ARCA_RATE_LIMIT_DB_TESTS = "1"
$env:ARCA_RATE_LIMIT_TEST_CREATE_ROLES = "1"   # solo en un clúster desechable
$env:ARCA_RATE_LIMIT_TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/postgres"
node --test tests/rateLimitStore.integration.test.js
```
