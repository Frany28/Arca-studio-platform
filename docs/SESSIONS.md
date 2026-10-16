# Sesiones revocables (hallazgo B-3)

> **Aviso de despliegue: todos los usuarios deberán volver a iniciar sesión.**
> En cuanto se publique el backend de B-3, ninguna sesión abierta seguirá siendo válida: los tokens emitidos antes no tienen `sid` y se rechazan con `401`. Afecta a todas las cuentas, incluidas las de administración y la cuenta demo. Nadie pierde datos ni cambia de contraseña; basta con volver a entrar (la cuenta demo conserva sus credenciales precargadas). Hay que avisar a quienes revisan el staging antes de publicar y hacerlo en un momento de poco uso.
>
> Texto sugerido para el aviso: «Hoy a las HH:MM publicaremos una mejora de seguridad de las sesiones. Después de esa hora tendrás que volver a iniciar sesión una vez en cada dispositivo. Tus datos y tu contraseña no cambian.»

## Problema original

La sesión era un JWT HS256 sin estado en la cookie HttpOnly `__Host-arca_session`. Cada instancia de Vercel cargaba el usuario con una caché en memoria de 30 s y rechazaba el token si `users.updated_at` era posterior a su `iat` (con 5 s de tolerancia). Se confirmaron estos problemas:

| Id | Severidad | Problema |
| --- | --- | --- |
| B3-1 | Media | `logout` solo expiraba la cookie. Un token copiado seguía siendo válido hasta `exp` (12 h). |
| B3-2 | Media | No había forma de revocar una sesión concreta ni las de otros dispositivos. |
| B3-3 | Media (disponibilidad) | El trigger `update_users_updated_at` actualiza `updated_at` en cualquier `UPDATE` de `users`, incluido `last_login_at`. Por eso cada inicio de sesión cerraba las sesiones de los demás dispositivos, también en la cuenta demo compartida. |
| B3-4 | Baja | La caché de 30 s era local de cada instancia: invalidarla en una no afectaba a las demás. |
| B3-5 | Baja | La tolerancia de 5 s dejaba aceptar tokens emitidos justo antes de un cambio. |
| B3-6 | Baja | El frontend solo reaccionaba a un 401 durante la restauración inicial de la sesión. |
| B3-7 | Info | Las conexiones SSE están limitadas a 30 s por `maxDuration`, que acota su ventana residual. |

## Diseño

| Pieza | Archivo | Responsabilidad |
| --- | --- | --- |
| Tabla | `Backend/prisma/migrations/20261015090000_user_sessions` | `id` UUID (el `sid`), `user_id` (FK con cascada), `created_at`, `expires_at`, `revoked_at`, `revoked_reason`. Dos `CHECK`, un índice parcial de sesiones activas por usuario, un índice por caducidad, RLS y el `REVOKE` de D-2. No guarda IP, user agent ni el token. |
| Repositorio | `src/repositories/sessionRepository.js` | Crear, revocar una, revocar todas (con una excepción opcional) y limpiar por lotes. Acepta el cliente de una transacción. |
| Validación | `findActiveSessionUser` en `src/repositories/userRepository.js` | Una sola consulta: usuario activo, rol activo, permisos y `EXISTS` de la sesión vigente. |
| Servicio | `src/services/sessionService.js` | Emite el JWT `{sub, sid}`, deduplica cargas en vuelo, rota la sesión tras un cambio de contraseña y programa la limpieza. |
| Middleware | `src/middlewares/auth.js` | Exige `sid` UUID, `sub` numérico y ausencia de `purpose`; sin caché entre peticiones. |
| Frontend | `src/api/sessionExpiration.js`, `src/auth/authSession.js`, `src/auth/AuthContext.jsx` | Manejo global de `401 UNAUTHENTICATED`. |

### Qué revoca sesiones

| Evento | Efecto |
| --- | --- |
| Login o registro completado | Crea una sesión nueva; **no** toca las demás. |
| `POST /auth/logout` | Revoca solo la sesión actual (`logout`). |
| `POST /auth/sessions/revoke-others` | Revoca las demás sesiones del usuario (`revoked_by_user`). |
| `POST /auth/change-password` | En una transacción: contraseña nueva, revocación de todas (`password_changed`) y una sesión nueva para quien hizo el cambio. |
| `POST /auth/reset-password` | En una transacción: contraseña nueva y revocación de todas (`password_reset`). |
| Admin: estado `blocked` o `inactive` | Revoca todas (`user_disabled`) en la misma transacción. |
| Admin: edición con contraseña, rol, correo o estado distintos | Revoca todas (`password_changed`, `security_profile_changed` o `user_disabled`) en la misma transacción. |
| `POST /admin/users/:userId/sessions/revoke` | Revoca todas las del usuario indicado (`admin_revoked`). No se admite sobre la propia cuenta. |
| Nombre, teléfonos, empresa, avatar | No revocan. |
| Permisos de un rol | No revocan: se leen en cada petición, así que el cambio se aplica de inmediato. |

Reactivar una cuenta no revive sus sesiones revocadas.

## Caché: decisión

La propuesta inicial era evaluar una TTL de 10 s. Se descartó, y se eliminó también la caché anterior de 30 s:

- Con varias instancias de Vercel, invalidar la caché local no avisa a las demás. Cualquier TTL deja una ventana en la que una sesión revocada o una cuenta desactivada siguen funcionando, y esa ventana se multiplica por el número de instancias calientes.
- La consulta por petición es una sola, indexada, y ya sustituía a la que hacía la caché en cada fallo. Localmente mide p50 ≈ 1,1 ms y p95 ≈ 2 ms con 20 000 sesiones de un mismo usuario.
- Solo se conserva la **deduplicación en vuelo** por `sid`: las peticiones simultáneas de la misma sesión en una instancia comparten la consulta. La entrada desaparece al resolverse, así que no hay ventana residual.

Resultado: la ventana residual ante revocación, desactivación o cambio de rol es de **cero peticiones**. La única excepción es una petición ya en curso, o una conexión SSE abierta hasta 30 s (B3-7).

## Impacto en rendimiento

- Cada petición autenticada hace una consulta a PostgreSQL. Antes, la mayoría se servía desde la caché de 30 s. Con Supabase remoto el coste es aproximadamente un viaje de red (decenas de ms) por petición autenticada, sobre conexiones del pool ya abiertas.
- La consulta usa la clave primaria o el índice parcial de sesiones activas, nunca un recorrido secuencial; lo comprueba la prueba de integración.
- Login y registro añaden un `INSERT`. Cambiar o restablecer la contraseña añade dos sentencias dentro de la transacción.
- La limpieza elimina como máximo 200 filas, caducadas o revocadas hace más de un día, en segundo plano tras cada login, con `FOR UPDATE SKIP LOCKED`.
- El JWT es más pequeño: ya no incluye `email` ni `role`.

## Compatibilidad

- **Todos los usuarios deben iniciar sesión de nuevo tras el despliegue del backend.** Los JWT sin `sid` reciben 401, como se autorizó.
- Se mantienen las cookies (HttpOnly, Secure, SameSite, `__Host-`), CSRF por `Origin` y el rechazo de tokens con `purpose`.
- `POST /auth/profile-photo` ya no reemite la cookie. El frontend no dependía de ello, porque la cookie es HttpOnly.
- `AUTH_CACHE_TTL_MS`, `AUTH_CACHE_MAX_ENTRIES` y `AUTH_TOKEN_CLOCK_TOLERANCE_MS` dejan de usarse. Si existen en Vercel o en `.env` se ignoran y pueden eliminarse.

## Pruebas

| Archivo | Cobertura |
| --- | --- |
| `Backend/tests/authSessionTokenPurpose.test.js` | H-1: tokens de recuperación o registro, tokens antiguos sin `sid`, `sid` no UUID, `purpose` con `sid`. |
| `Backend/tests/authSessionRevocation.test.js` | Varios dispositivos, logout, fallo de PostgreSQL en logout, `revoke-others`, cambio y recuperación de contraseña, desactivación, cambio de rol, revocación administrativa (401/403/400/404/409/200), `sid` de otro usuario, reglas de edición administrativa. |
| `Backend/tests/userSessions.integration.test.js` | PostgreSQL real con el historial completo de migraciones: RLS, índices, restricciones, cascada, D-2, semántica de vigencia, **dos procesos independientes** (login en uno, logout en otro y rechazo inmediato en ambos), desactivación y reactivación, atomicidad del cambio de contraseña con fallo inyectado, concurrencia, ediciones administrativas, limpieza y rendimiento. |
| `Frontend/tests/sessionExpiration.test.js` | 401 frente a 403, rutas excluidas, deduplicación, 401 tardío, caída temporal, cancelación. |
| `Frontend/tests/browser/authSessionExpiration.test.js` | AuthProvider y ProtectedRoute reales: redirección única sin bucles, aviso a otras pestañas, 403 sin cierre, 401 tardío sin cierre. |

La prueba de integración se activa así:

```powershell
$env:ARCA_SESSION_DB_TESTS = "1"
$env:ARCA_SESSION_TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:54329/postgres"  # solo localhost
$env:ARCA_SESSION_TEST_CREATE_ROLES = "1"  # solo en un clúster desechable
node --test tests/userSessions.integration.test.js
```

## Despliegue seguro

Revisado el 15 de octubre de 2026 con consultas de catálogo de solo lectura en Supabase:
- PostgreSQL 17.6; las migraciones se ejecutan como `postgres`, propietario de las tablas.
- `public.user_sessions` no existe, así que no hay colisión de nombre.
- `gen_random_uuid()` está disponible.
- `users.id` es `bigint`, igual que la FK.
- La última migración aplicada es `20261014140000_rate_limit_buckets`.
- Hay un intento fallido de `20260825120000_project_request_legal_documentation`, marcado como revertido, seguido de un reintento correcto. Prisma no lo trata como bloqueante: B-2 se aplicó después.
- Un `CREATE TABLE` equivalente dentro de `BEGIN READ ONLY` fue analizado y rechazado con `25006`, como se esperaba.

1. **Migración** `20261015090000_user_sessions` (`pnpm db:migrate:deploy` con la URL de migraciones). Es aditiva y el backend actual la ignora.
2. **Comprobación:** que la tabla existe con RLS, que `anon`, `authenticated` y `service_role` no tienen `TRUNCATE`, `TRIGGER`, `REFERENCES` ni `MAINTAIN`, y que `_prisma_migrations` registra la migración como terminada.
3. **Frontend** (Netlify). Es compatible con el backend anterior y con el nuevo. Publicarlo antes del backend hace que, en el momento del corte, las pestañas abiertas detecten el `401` y lleven al login en lugar de mostrar errores sueltos.
4. **Aviso a los usuarios** (ver el aviso al principio de este documento).
5. **Backend** (Vercel), en un momento de poco uso. Desde aquí todos deben iniciar sesión de nuevo.
6. **Verificación posterior:**
   - login con la cuenta demo;
   - `/auth/me` responde `200`;
   - un logout y la reutilización de la cookie anterior dan `401`;
   - un login en dos navegadores deja ambos activos;
   - revisar en los logs de Vercel que no hay errores `42P01` (tabla inexistente).
7. Opcional: eliminar `AUTH_CACHE_TTL_MS`, `AUTH_CACHE_MAX_ENTRIES` y `AUTH_TOKEN_CLOCK_TOLERANCE_MS` de Vercel.

Si el backend se desplegara sin la migración, el login y todas las peticiones autenticadas fallarían con un 5xx porque la tabla no existe. Por eso la migración debe ir siempre antes que el backend.

### Transición con el frontend anterior

Si el backend se publica antes que el frontend nuevo, el frontend anterior sigue funcionando:
- Al recargar o abrir la aplicación, `/auth/me` responde `401` y la restauración lleva al login.
- En una pestaña ya abierta, las peticiones fallan con `401` y se muestra el error de cada vista, sin bucles ni redirección automática, hasta navegar o recargar.
- Login, logout, cambio de contraseña y foto de perfil son compatibles: la cookie sigue siendo HttpOnly y el frontend nunca leyó su contenido.

El frontend nuevo con el backend anterior tampoco cambia el comportamiento: no llama a los endpoints nuevos y el `401` global solo actúa cuando `/auth/me` confirma la falta de sesión.

### Reversión

- **Backend:** volver al despliegue anterior en Vercel (Instant Rollback). El backend anterior ignora `sid`, así que los tokens emitidos con B-3 siguen siendo válidos y nadie tiene que volver a entrar.
- **Advertencia:** al volver, las sesiones revocadas durante B-3 (logout, cambios de contraseña, desactivaciones) vuelven a aceptarse hasta su `exp` (máximo 12 h), salvo que `users.updated_at` sea posterior al token. Si hubo una revocación por seguridad, invalidar todos los tokens exige rotar `AUTH_TOKEN_SECRET`, que es un cambio de credenciales y requiere autorización explícita.
- **Frontend:** puede quedarse; es compatible con ambos backends.
- **Base de datos:** no hace falta revertir. La tabla puede quedarse porque el backend anterior no la consulta. Si se quisiera eliminar, se haría con una migración nueva (`DROP TABLE public.user_sessions`) después de retirar el código, nunca con `migrate reset`.

## Vías fuera de la aplicación

La revocación está en el código de la aplicación. Cualquier cambio hecho por otra vía no revoca sesiones:

| Vía | Qué cambia | Efecto actual |
| --- | --- | --- |
| `scripts/upsert-test-user.mjs` | Contraseña, rol, estado y `deleted_at = null` | **No revoca.** Rotar así la contraseña de la cuenta demo (paso obligatorio antes de producción, AGENTS §15) deja válidas todas sus sesiones previas durante hasta 12 h. |
| `scripts/set-user-status.mjs` (solo clientes) | `status` | Desactivar bloquea el acceso porque la consulta exige `status = 'active'`, pero no revoca: al reactivar, las sesiones previas vuelven a funcionar. |
| SQL manual o panel de Supabase sobre `roles.is_active` | Rol completo | Igual: bloquea mientras está inactivo y las sesiones reviven al reactivarlo. Hoy ningún endpoint ni script desactiva roles, y los tres roles están activos. |
| SQL manual sobre `users` (contraseña, correo, rol, `deleted_at`) | Cuenta | No revoca. |

Severidad: baja mientras estas vías no se usen. Pasa a **media** en cuanto se use `upsert-test-user` para rotar credenciales, que es precisamente el procedimiento previsto para retirar la cuenta demo.

**Corrección recomendada (pendiente de aprobación, requiere migración):** triggers en PostgreSQL que revoquen sesiones en el mismo `UPDATE`, sea cual sea la vía.
- En `users`: `AFTER UPDATE OF password_hash, role_id, email, status, deleted_at`, solo cuando el valor cambia (`IS DISTINCT FROM`). Así no se dispara con `last_login_at`.
- En `roles`: `AFTER UPDATE OF is_active`, cuando pasa de `true` a `false`.

Si se prefiere no tocar la base de datos, la alternativa mínima es que ambos scripts llamen a `revokeUserSessions` en la misma transacción. Esa opción no cubre el SQL manual.

## Coste por petición y cómo medirlo bajo concurrencia

**Estimación:** una consulta indexada (≈1–2 ms de ejecución) más un viaje de red de Vercel a Supabase por cada petición autenticada. Antes, la mayoría de las peticiones repetidas de un usuario en una misma instancia salían de la caché de 30 s. Cada consulta ocupa una conexión del pool solo durante ese tiempo; el riesgo bajo carga es que haya peticiones esperando conexión (`pool.waiting`), no el coste de la consulta en sí.

**Medición propuesta (solo staging; nunca en producción ni con cuentas reales):**
1. **Cuentas:** crear unas cuantas cuentas de prueba dedicadas, con rol cliente y marcadas `LOADTEST`. No usar la cuenta demo ni cuentas reales. Sus credenciales van en un `LOAD_USERS_FILE` fuera del repositorio.
2. **Corregir el script de k6.** `load-tests/mixed-workload.js` lee `token` del cuerpo del login, pero el login solo devuelve `{user}` y la cookie; así todas las peticiones enviarían `Bearer undefined` y recibirían `401` (es un fallo anterior a B-3). Debe usar la cookie de sesión de la respuesta (`response.cookies`) y no registrar su valor.
3. **Activar métricas temporalmente en staging:** `REQUEST_METRICS_ENABLED=true` y `DATABASE_SLOW_QUERY_MS`, para ver la duración de cada petición y el estado del pool (`idle`, `total`, `waiting`).
4. **Comparar** el perfil `smoke` y un escalón de 25–50 VU con el backend anterior y con B-3, mismo perfil y misma hora. Criterios:
   - `p95` de `/auth/me` y `/projects` sin una subida mayor de un viaje de red;
   - `pool.waiting` cerca de 0;
   - ningún `5xx` ni `503 RATE_LIMIT_UNAVAILABLE`.
5. **En Supabase,** consultar en solo lectura `pg_stat_statements` para la consulta de sesión (`mean_exec_time`, `calls`) y el número de conexiones activas frente al límite del pooler.
6. **Al terminar:**
   - cerrar las sesiones de las cuentas de carga (logout o `revoke-others`);
   - desactivar o eliminar esas cuentas;
   - volver a dejar `REQUEST_METRICS_ENABLED=false`.

   Los inicios de sesión del `setup` (uno por cuenta) caben en los límites de B-2.

## Riesgos residuales

- **Cuenta demo pública:** cualquiera que conozca las credenciales puede llamar a `revoke-others` o cambiar la contraseña y cerrar las sesiones de los demás revisores. El riesgo ya existía con la contraseña y ahora es explícito. El límite de 10 por hora lo acota; la mitigación de fondo es una cuenta demo por revisor (AGENTS §5).
- Una petición que ya superó la autenticación termina aunque su sesión se revoque mientras tanto. Una conexión SSE abierta sigue hasta 30 s.
- Si PostgreSQL no está disponible, toda petición autenticada falla (fail-closed). Antes, la caché podía cubrir hasta 30 s.
- Cambios hechos fuera de la aplicación (scripts, SQL manual, desactivar un rol) no revocan sesiones: ver «Vías fuera de la aplicación».
- No hay interfaz para listar o cerrar sesiones: los endpoints quedan preparados (no se diseñaron pantallas nuevas en esta fase).
