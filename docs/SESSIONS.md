# Sesiones revocables (hallazgo B-3)

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

1. **Migración** `20261015090000_user_sessions` en Supabase (`pnpm db:migrate:deploy` con la URL de migraciones). Es aditiva: el backend actual la ignora.
2. Comprobar en Supabase que existe la tabla con RLS y sin los privilegios revocados por D-2.
3. **Backend.** A partir de aquí todos los usuarios deben iniciar sesión de nuevo. Conviene publicarlo en un momento de poco uso y avisar a quienes revisan el staging. La cuenta demo sigue funcionando con sus credenciales precargadas.
4. **Frontend** (manejo global de 401). Es compatible con el backend anterior y con el nuevo, así que también puede publicarse antes.
5. Opcional: eliminar `AUTH_CACHE_TTL_MS`, `AUTH_CACHE_MAX_ENTRIES` y `AUTH_TOKEN_CLOCK_TOLERANCE_MS` de Vercel.

Si el backend se desplegara sin la migración, el login y todas las peticiones autenticadas fallarían con un 5xx, porque la tabla no existe. Por eso el orden 1 → 3 es obligatorio.

**Reversión.** Volver al backend anterior restablece las sesiones sin estado: los tokens con `sid` siguen siendo válidos para él, porque ignora el claim. La tabla puede quedarse, ya que nadie la consulta.

## Riesgos residuales

- **Cuenta demo pública:** cualquiera que conozca las credenciales puede llamar a `revoke-others` o cambiar la contraseña y cerrar las sesiones de los demás revisores. El riesgo ya existía con la contraseña y ahora es explícito. El límite de 10 por hora lo acota; la mitigación de fondo es una cuenta demo por revisor (AGENTS §5).
- Una petición que ya superó la autenticación termina aunque su sesión se revoque mientras tanto. Una conexión SSE abierta sigue hasta 30 s.
- Si PostgreSQL no está disponible, toda petición autenticada falla (fail-closed). Antes, la caché podía servir hasta 30 s.
- Desactivar un **rol** completo (`roles.is_active = false`) bloquea el acceso, pero no revoca las sesiones; si el rol se reactiva, vuelven a funcionar. El script `user:set-status` tampoco revoca, aunque `status <> 'active'` ya bloquea el acceso.
- No hay interfaz para listar o cerrar sesiones: los endpoints quedan preparados (no se diseñaron pantallas nuevas en esta fase).
