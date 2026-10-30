# Contrato HTTP actual — ARCA Studio

Auditoría del código local: 1 de octubre de 2026. Entorno del proyecto: desarrollo, staging y demostración. Este documento describe la implementación existente; no introduce endpoints, normalizaciones ni garantías futuras. Se contrastaron cliente, consumidores, rutas, controladores, validaciones y serialización de respuestas. No se hicieron solicitudes contra despliegues ni se validó una sesión real o almacenamiento remoto.

## URL y transporte

- El backend monta todos los dominios en `/api` (`Backend/src/app.js`). Los paths de las tablas son relativos a esa base.
- `Frontend/src/api/http.js` usa `VITE_API_URL` **solo cuando `import.meta.env.DEV` es verdadero**; en otro caso usa `/api`. Elimina una barra final. `.env.example` propone `http://localhost:3000/api`. Vite también tiene proxy `/api` → `http://localhost:3000`.
- `netlify.toml` dirige `/api/*` a `https://sistema-web-arca-studio.vercel.app/api/:splat` antes del fallback SPA. La compilación depende de ese proxy de mismo origen; configurar `VITE_API_URL` no cambia su base. `Backend/vercel.json` dirige las solicitudes a la función API y fija duración máxima de 30 segundos.
- El cliente JSON usa `fetch`, `credentials: "include"` y `Content-Type: application/json`, también en GET. El body JSON global tiene límite de 100 KB. Los uploads envían bytes directamente por XMLHttpRequest; SSE usa EventSource.
- No hay envelope universal de éxito: existen `{user}`, `{project}`, `{projects,nextCursor}`, `{message}`, binarios y `204` sin cuerpo. El cliente devuelve `null` para `204`; también puede devolver `null` si una respuesta exitosa no tiene JSON válido con content type JSON.
- Las URLs construidas para imágenes, videos, enlaces y visores también consumen la API, aunque no llamen a `apiRequest`.

## Autenticación, autorización y cookies

Login y finalización de registro responden `{user}` y `Set-Cookie`; no devuelven token en JSON. El navegador conserva una cookie HttpOnly, `Path=/`, sin Domain. Caducidad por defecto: 43 200 segundos (12 horas). No existe endpoint de refresh.

| Configuración del proceso backend | Cookie efectiva |
| --- | --- |
| `NODE_ENV !== "production"` | `AUTH_COOKIE_NAME` o `arca_session`; SameSite `AUTH_COOKIE_SAMESITE` o `Lax`; Secure si `AUTH_COOKIE_SECURE=true` |
| `NODE_ENV === "production"` | `__Host-arca_session`, SameSite `Lax`, Secure obligatorio |

La rama `NODE_ENV=production` es comportamiento técnico del proceso y puede aplicarse al staging; no cambia la clasificación del proyecto. La guardia de arranque (`Backend/src/config/environmentGuard.js`) impide iniciar el backend si `NODE_ENV` no es exactamente `development`, `test` o `production`, si una plataforma de despliegue no usa `production`, o si producción tiene secreto JWT corto, orígenes no HTTPS o con comodín, `CSRF_ALLOW_NO_ORIGIN=true` o el flag de bypass. Un frontend y API en sitios distintos necesitan evaluar la política real de cookies del navegador; `credentials: include` por sí solo no elimina SameSite.

El backend acepta también `Authorization: Bearer <token>` y le da prioridad sobre la cookie; el frontend actual no lo envía. **Sesiones revocables (B-3).** El token firmado solo contiene `sub` (usuario), `sid` (sesión de `user_sessions`), `iat` y `exp`; cada login o registro completado crea una sesión independiente, por lo que iniciar sesión en un dispositivo ya no cierra los demás. En cada petición se carga, en una sola consulta, el usuario activo con rol y permisos **solo si** su sesión existe, no está revocada ni caducada; no hay caché entre peticiones, así que una revocación, desactivación o cambio de rol se aplica en la siguiente petición de cualquier instancia. Los JWT sin `sid` (emitidos antes de B-3) o con `purpose` reciben `401 UNAUTHENTICATED`. Logout revoca la sesión actual; cambiar la contraseña revoca todas y emite una cookie nueva; la recuperación de contraseña, la desactivación y los cambios administrativos de rol, correo, estado o contraseña revocan todas. Editar nombre, teléfonos, empresa o el avatar no cierra sesiones. Detalle en `docs/SESSIONS.md`.

El frontend confirma login con `GET /auth/me` y usa exclusivamente ese usuario confirmado. Restauración: solo `401` **con** `code: "UNAUTHENTICATED"` significa cierre definitivo; red, 429 y 5xx permiten dos reintentos (250 y 750 ms más jitter). Otros fallos dejan sesión temporalmente indisponible. No almacena el token en localStorage; usa almacenamiento del navegador para avisos de logout y registro completado. El logout limpia estado local incluso si falla la petición. Cualquier otra petición que reciba `401 UNAUTHENTICATED` (sesión revocada o caducada) dispara una comprobación con `/auth/me`; si se confirma, se limpia el estado, se avisa a otras pestañas y las rutas protegidas redirigen al login. `403` conserva la sesión (falta de permisos) y `/auth/me`, `/auth/login` y `/auth/logout` no disparan el manejo global, lo que evita bucles.

`user` de sesión contiene `id:number`, `clientId:number|null`, `email`, `firstName`, `lastName`, `name`, `phone`, `status`, `lastLoginAt`, `updatedAt`, `hasProfilePhoto:boolean`, `role:{id,code,name}`, `permissions:[{id,code,name,description,module}]` y `permissionCodes:string[]`. No contiene `profilePhotoUrl`. AuthContext convierte `role` a su código y conserva el objeto en `roleDetails`; fabrica el avatar con `/auth/profile-photo/image?v=<updatedAt o timestamp>`.

Todas las rutas de negocio consumidas requieren sesión salvo las operaciones públicas señaladas en autenticación. Autorización combina permisos, rol y pertenencia al recurso; un `404` puede ocultar un recurso no accesible. Que `isPublic=true` no elimina autenticación: sirve para ampliar la lectura de proyectos a usuarios autenticados, con archivos de showcase filtrados y sin acceso automático a comentarios. Quien solo ve un proyecto por ser público (sin acceso directo como cliente propietario, arquitecto asignado o administrador) recibe la vista `PublicProject` descrita abajo.

### CORS y origen de mutaciones

Se permiten GET, POST, PUT, PATCH, DELETE y OPTIONS; preflight exitoso `204`. Credenciales activas por defecto. Orígenes: defaults (localhost:5173 fuera de production; arcastudio.netlify.app en production) más `CORS_ORIGIN`, `CORS_ORIGINS`, `FRONTEND_URL`. Se admiten subdominios configurados con wildcard. Cabeceras permitidas incluyen Authorization, Content-Type, Range, X-File-Name y X-Original-File-Name; expuestas incluyen Content-Disposition, Content-Length, Content-Range, Accept-Ranges y Content-Type.

POST/PUT/PATCH/DELETE comprueban Origin o el origen de Referer (`UNTRUSTED_ORIGIN`, 403). Sin origen, `CSRF_ALLOW_NO_ORIGIN` decide; default permitido fuera de production. No hay token CSRF enviado por el frontend. CORS tiene además `CORS_ALLOW_NO_ORIGIN` y `CORS_CREDENTIALS`; un rechazo CORS puede llegar como error genérico 500 o como error de red del navegador.

## Errores y códigos HTTP

Forma común real:

```json
{"code":"VALIDATION_ERROR","message":"Los datos enviados no son válidos.","fields":{"body.email":"Correo inválido."}}
```

`code` y `message` son el contrato usado por el cliente; `fields` es opcional y corresponde a validación. Zod usa paths como `body.email`, `query.limit`, `params.userId` o `request`. Validaciones manuales pueden devolver claves distintas (`fileName`, `assigneeIds`, `projectIds`) o no devolver `fields`. No se garantiza un catálogo único para una misma clase de dato inválido.

El cliente JSON lanza Error con `.status`, `.code`, `.fields` (`null` si falta). Sin JSON de error usa `API_ROUTE_UNAVAILABLE` y mensaje genérico. Red: `NETWORK_ERROR`; AbortError conserva su identidad. No hay interceptor global que cierre sesión ante cualquier 401. Los uploads y Geoapify tienen adaptadores de error distintos; no conservan `fields`. Los uploads pueden emitir `UPLOAD_ABORTED`; sus errores de red carecen de status HTTP.

| HTTP | Situación relevante |
| --- | --- |
| 200 / 201 / 202 | Lectura o actualización / creación / aceptación de correo |
| 204 | Logout, OPTIONS y DELETE legado de notas |
| 206 | Contenido parcial cuando almacenamiento devuelve Content-Range |
| 400 | Zod (`VALIDATION_ERROR`), datos manualmente inválidos, token de recuperación inválido |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `CURRENT_PASSWORD_INCORRECT` |
| 403 | `FORBIDDEN`, `UNTRUSTED_ORIGIN`, `CLIENT_REQUIRED`, revisión no autorizada |
| 404 | Ruta desconocida (`API_ROUTE_NOT_FOUND`), recurso/token inexistente o inaccesible |
| 409 | Duplicados, cuenta no activa, estado de proyecto/solicitud incompatible |
| 411 / 413 / 415 | Falta longitud / exceso de tamaño / MIME, extensión o firma inválidos |
| 429 | Límites de acciones o conexiones SSE |
| 499 | Carga cancelada detectada por el backend, cuando puede responder |
| 500 / 502 | Error interno o dependencia / error de búsqueda Geoapify |

Excepciones a la estructura mínima: rate limit devuelve además `retryAfter` y cabecera `Retry-After` (429), o `503 RATE_LIMIT_UNAVAILABLE` si no puede comprobarse el límite. Todos los límites comparten contadores en PostgreSQL entre instancias (ver `docs/RATE_LIMITING.md`). Permisos administrativos no consumidos pueden añadir `missingPermissionCodes`; salud puede añadir `status` y `service`. Los errores centralizados no exponen stack ni mensajes internos PostgreSQL, pero `normalizeError` conserva el `code` original de errores no reconocidos: no se garantiza que todo código sea de dominio.

## Inventario de endpoints frontend

`—` significa sin query/body. Todos los IDs de recursos son enteros positivos salvo el identificador del detalle de proyecto, que acepta ID o slug. En las tablas `P` es query opcional `cursor:string, limit:integer`; ver paginación. `M` significa `{message:string}`. Las respuestas son **HTTP**, antes de transformaciones locales. Se incluyen rutas llamadas por pantallas/hooks y URLs de recursos construidas; los helpers también cuentan como consumo indirecto.

### Autenticación y registro

| Método y path | Request | Éxito | Sesión / errores específicos relevantes |
| --- | --- | --- | --- |
| POST `/auth/login` | `{email,password}`; email válido, password 8–256 | 200 `{user}` + cookie | Pública; 400 validación, 401 INVALID_CREDENTIALS, 409 ACCOUNT_NOT_ACTIVE, 429 |
| GET `/auth/me` | — | 200 `{user}` | Sesión; 401 UNAUTHENTICATED |
| POST `/auth/logout` | Sin body | 204 sin cuerpo + cookie expirada; revoca la sesión actual (las demás siguen activas) | Pública; si PostgreSQL falla responde 5xx con la cookie ya expirada |
| POST `/auth/sessions/revoke-others` | Sin body | 200 `{revokedCount}`; conserva la sesión actual | Sesión; 401 UNAUTHENTICATED, 429/503 (10 por hora por usuario) |
| POST `/auth/registration/start` | `{fullName,email,phone,company?,referralSource}` | 202 M | Pública; 400, 409 EMAIL_ALREADY_EXISTS / PHONE_ALREADY_EXISTS |
| POST `/auth/registration/resend` | `{email}` | 202 M | Pública; 404 REGISTRATION_NOT_FOUND |
| POST `/auth/registration/verify` | `{token}` | 200 `{email,valid:true}` | Pública; 404 INVALID_REGISTRATION_TOKEN |
| POST `/auth/registration/complete` | `{token,password,passwordConfirmation}` | 201 `{user}` + cookie | Pública; 400, 404 INVALID_REGISTRATION_TOKEN, 409 conflictos de correo/teléfono |
| POST `/auth/forgot-password` | `{email}` | 202 M, exista o no cuenta activa | Pública; 400 INVALID_EMAIL, fallo de correo puede ser 500 |
| POST `/auth/verify-reset-token` | `{token}` | 200 `{valid:true}` | Pública; 400 INVALID_RESET_TOKEN, 404 USER_NOT_FOUND |
| POST `/auth/reset-password` | `{token,password}` | 200 M; sin crear sesión | Pública; 400 INVALID_PASSWORD / INVALID_RESET_TOKEN, 404 USER_NOT_FOUND |
| POST `/auth/change-password` | `{currentPassword,newPassword}` | 200 M + cookie de una sesión nueva; revoca todas las sesiones anteriores, incluida la actual | Sesión; 400 INVALID_PASSWORD / PASSWORD_UNCHANGED, 401 CURRENT_PASSWORD_INCORRECT |
| POST `/auth/profile-photo` | Binario; ver archivos | 200 `{user}`; ya no reemite cookie ni afecta a otras sesiones | Sesión; validación de archivo, 404 USER_NOT_FOUND |
| GET `/auth/profile-photo/image` | Query `v` usada por frontend para URL; ignorada por backend | 200 imagen | Sesión; 404 PROFILE_PHOTO_NOT_FOUND |

Registro: fullName 3–300 caracteres, al menos dos palabras; company máximo 150; referralSource `instagram|referred|whatsapp|other`; phone se normaliza a número venezolano `+58` con diez dígitos nacionales. Token de registro 1–2000. Contraseña de registro 8–256, mayúscula, número y especial, confirmación idéntica. Cambio de contraseña aplica 8–256 con esa política y exige diferencia de la actual. Reset recorta la contraseña y exige mínimo 8 y complejidad, **sin máximo explícito en el controlador**; siguen aplicando los límites globales de JSON. Las operaciones de correo/contraseña indicadas pasan por loginRateLimit; avatar no usa ese limitador.

### Proyectos

`Project.status` usa `pending|in_process|finished|cancelled|archived`: **finished** es el único código canónico de finalización. Las lecturas normalizan temporalmente el alias histórico `completed` a `finished`; no se acepta como valor nuevo del enum PostgreSQL tras la migración. Publicación individual y masiva exigen finalización y conservan autenticación, permisos y acceso directo. Archivar oculta el proyecto y conserva `archived_from_status`; recuperar un finalizado devuelve `finished` y mantiene `isPublic:false`. Operaciones de archivos, comentarios y responsables siguen rechazando finalizados con `PROJECT_FINALIZED`. No existe actualmente un endpoint HTTP general para editar `Project.status`, ni un filtro de estado en GET `/projects`; los filtros de las pantallas se aplican a la colección obtenida por cursor. Ver [auditoría, compatibilidad y procedimiento de migración](PROJECT_FINISHED_STATUS.md).

| Método y path | Request | Éxito | Acceso / códigos relevantes |
| --- | --- | --- | --- |
| GET `/projects` | P; `scope?: accessible|owned` | 200 `{projects:Project[],nextCursor}` | Sesión + projects.read; alcance según rol/propiedad/publicación |
| GET `/projects/:projectId` | ID o slug; `filesCursor?`, `filesLimit?` 1–100 | 200 `{project:ProjectDetail}` | Sesión + projects.read; 404 PROJECT_NOT_FOUND |
| PATCH `/projects/:projectId/publication` | `{isPublic:boolean}` | 200 `{project:Project}` (sin los extras de ProjectDetail) | Sesión + projects.publish y acceso directo; exige finished; 400 INVALID_PROJECT_ID / INVALID_PUBLICATION_STATE, 404, 409 PROJECT_ARCHIVED / PROJECT_NOT_FINISHED |
| POST `/projects/:projectId/files` | Binario | 201 `{file:UploadedFile}` | Sesión + projects.files.upload y acceso al proyecto; 404, 409 DUPLICATE_PROJECT_FILE / PROJECT_ARCHIVED / PROJECT_FINALIZED |
| DELETE `/projects/:projectId/files/:fileId` | — | 200 `{deleted:true,fileId}` | Sesión + projects.files.delete y acceso; 404, 409 estados de solo lectura |
| GET `/projects/:projectId/files/:fileId/content` | `versionId?`; cabecera `Range?` | 200/206 binario | Sesión + projects.read, acceso al archivo; 404 FILE_NOT_FOUND |
| GET `/projects/:projectId/assigned-architect/profile-photo` | — | 200 imagen | Sesión + acceso; 404 si proyecto/foto inaccesible |
| GET `/projects/:projectId/comments` | P | 200 `{comments:Comment[],nextCursor}` | Sesión + acceso a comentarios; 400 INVALID_PROJECT_ID, 404 PROJECT_NOT_FOUND |
| GET `/projects/:projectId/files/:fileId/comments` | P + `fileVersionId` obligatorio | 200 `{comments:DocumentComment[],nextCursor}` | Sesión + permisos del documento/proyecto; 400, 404 |
| POST `/projects/:projectId/comments` | CommentInput definido abajo | 201 `{comment}` | Sesión + acceso; 400 COMMENT_TARGET_REQUIRED, 404 PROJECT_OR_COMMENT_NOT_FOUND, 409 COMMENT_CONFLICT / PROJECT_ARCHIVED / PROJECT_FINALIZED |
| GET `/projects/:projectId/comment-authors/:userId/profile-photo` | — | 200 imagen | Sesión + acceso al autor en proyecto; 404 |
| GET `/projects/:projectId/events` | —; EventSource con credenciales | 200 stream SSE | Sesión + acceso a comentarios; 400, 404, 429 SSE_CONNECTION_LIMIT |

`Project` contiene: `id`, `name`, `publicSlug`, `status`, `progress`, `isPublic`, `createdAt`, `updatedAt`, `createdBy`, `description`, `projectType`, `startDate`, `endDate`, `budget`, `generalArea`, `constructionArea`, `areaUnit`, `hasPlans`, `location`, `city`, `state`, `country`, `locationCoordinates:{latitude,longitude}|null`, `locationFormattedAddress`, `providerPlaceId`, `client:{id,name}`, `assignedArchitect:{id,name,hasProfilePhoto}|null`, `assignees` y `assignedArchitects` (`[{id,name,roleCode,roleName}]`), `imageFileId`, `imageFileVersionId`, `hasImage`. Los campos opcionales de datos pueden ser null. IDs y magnitudes numéricas se convierten a number.

**Rate limiting compartido (hallazgo B-2).** Los ámbitos de autenticación (`login`, `registration`, `password-reset`, `change-password`), los de correos de seguridad por destinatario (`email-registration` para el inicio y el reenvío del registro, `email-password-reset` para `forgot-password`, 5 por hora cada uno) y los de acciones de usuario (comentarios, solicitudes de proyecto, cargas de archivos y operaciones administrativas) comparten contadores en PostgreSQL entre instancias. Al superar el límite responden `429 {code:"RATE_LIMITED", message, retryAfter}` con `Retry-After`, el mismo contrato que antes. Si no se puede comprobar el límite, responden `503 {code:"RATE_LIMIT_UNAVAILABLE", message, retryAfter:30}` con `Retry-After: 30` y no ejecutan la operación. Límites y diseño en `docs/RATE_LIMITING.md`.

`PublicProject` (hallazgo P-1) es la proyección que reciben, en el listado y en el detalle, los usuarios sin acceso directo. La construye el backend (`src/domain/projectPublicView.js`) a partir de una lista de campos permitidos, por lo que cualquier campo nuevo de `Project` queda privado hasta añadirlo expresamente.

- **Contiene solo:** `id`, `name`, `publicSlug`, `status`, `progress`, `isPublic`, `createdAt`, `updatedAt`, `description`, `projectType`, `startDate`, `generalArea`, `constructionArea`, `areaUnit`, `city`, `state`, `country`, `assignedArchitect`, `assignees`, `assignedArchitects`, `imageFileId`, `imageFileVersionId` y `hasImage`.
- **`location`:** se sustituye por la ubicación general `"Ciudad, Estado, País"`, con los componentes disponibles, o `null`.
- **No contiene:** `budget`, `client`, `createdBy`, `endDate`, `hasPlans`, `locationCoordinates`, `locationFormattedAddress` ni `providerPlaceId`.
- **En el detalle:**
  - `requirements`, `technicalSpecifications` y `recentDocuments` son siempre `[]`;
  - `files` solo incluye imágenes y videos, filtrados en SQL antes del `LIMIT`, por lo que `filesNextCursor` es correcto;
  - cada archivo tiene `title` genérico (`"Imagen 12"`, `"Video 7"`), `description:null` y `uploadedBy:null`.
- **Descarga de contenido:** usa un nombre genérico (`imagen-12.png`) en `Content-Disposition`.

El frontend no debe usarse para ocultar información sensible.

**Cabeceras del contenido de archivos (hallazgo B-1).** `GET /projects/:projectId/files/:fileId/content` y `GET /project-requests/:projectRequestId/files/:fileId/content` aplican `src/utils/fileResponseSecurity.js`:

- PNG, JPEG y WebP (incluidas panorámicas), DOCX y XLSX: `inline` con `default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self' <orígenes CORS>; sandbox`.
- MP4: la misma política sin `sandbox`, porque `sandbox` impide reproducir el video al abrirlo en una pestaña (medido en Chrome y Edge 155).
- PDF de proyectos y de adjuntos de solicitudes: solo se visualizan dentro de ARCA Studio, en `ProjectDocumentViewerModal` (`fetch` + PDF.js), que no aplica `Content-Disposition` ni la CSP del recurso. En `ProjectRequestWorkflowModal` los PDF adjuntos son botones que abren ese visor sin observaciones (`commentsEnabled={false}`); los demás adjuntos conservan su enlace. Todos los PDF se sirven como `attachment` con la política estricta y `sandbox`: abrir la URL directamente descarga el archivo. Lo verifican `Frontend/tests/browser/projectPdfViewer.test.js` (renderizado, páginas, zoom, error, Escape y foco, móvil y descarga directa) y `Backend/tests/fileResponseSecurity.test.js`. La autorización sigue verificándose en el backend: sin acceso, 404.
- Cualquier otro tipo, incluido un `Content-Type` del almacenamiento como `text/html`, `image/svg+xml` o GLB heredado: `application/octet-stream` con `attachment` y política estricta con `sandbox`.

En los adjuntos de solicitudes, `frame-ancestors` solo admite `'self'`. Se mantienen `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`, `Range`/206, caché y ETag. `<img>`, `<video>` y `fetch()` no aplican la CSP del recurso, por lo que galería, panorámicas y vistas previas no cambian.

`ProjectDetail` añade `files:ProjectFile[]`, `filesNextCursor`, `recentDocuments:ProjectFile[]`, `requirements:[{id,description,sortOrder}]`, `technicalSpecifications:[{id,title,description,defaultOpen,sortOrder,items}]`; items conservan los campos del JSON existente y normalizan `id` y `sortOrder`. `ProjectFile` contiene `id,title,description,extension,fileType,fileCategory,size,available,currentVersion,currentVersionId,createdAt,uploadedBy:{id,name,hasProfilePhoto}|null`. La respuesta de upload usa `fileSize` y `originalName`, no `size` y `title` de la lectura.

`CommentInput`: `{content,commentType?,parentCommentId?,targetId?,image?,selection?,fileId?,fileVersionId?}`. content recortado de 1–2000; tipo `general` (default), `image`, `video`, `panorama`, `document`. IDs de archivo/versión/padre positivos o null. `targetId` string o number; image y selection objetos o null. Recursos no generales ni documentales necesitan targetId para una raíz. Metadatos se sanean; URLs privadas no sobreviven en el JSON.

- Video temporal: `selection:{kind:"video-time",timeSeconds:number,durationSeconds:number}`, duración >0, tiempo entre 0 y duración. Otros metadatos de video no tienen ese esquema específico.
- Panorama raíz: `selection:{kind:"panorama-point"|"viewer3d-point",yaw:number,pitch:number}`, yaw entre −180 y 180, pitch entre −90 y 90.
- Documento raíz: fileId y fileVersionId; normalizedX/Y entre 0 y 1. PDF: `kind:"document-point",pageNumber,pageCount` positivos y página ≤ total. Word: `kind:"document-section-point",sectionIndex,sectionCount` (índice desde cero). Excel: `kind:"document-cell-point",sheetName` no vacío ≤31 y `cell` tipo A1. Respuesta documental: padre + IDs y sin selection.

`Comment`: `{id,projectId,content,commentType,parentCommentId,type:"comment"|"reply",createdAt,author:{id,name,roleCode,hasProfilePhoto},targetId,image,selection,pointNumber}`. `DocumentComment` añade `fileId,fileVersionId,fileType,pageNumber` y selection normalizada. No todas las respuestas de creación/actualización equivalen al objeto completo del listado; los consumidores actuales fusionan o recargan datos.

### Observaciones del entorno

| Método y path | Request | Éxito | Acceso |
| --- | --- | --- | --- |
| GET `/environment-comments` | P | 200 `{comments:EnvironmentComment[],nextCursor}` | Sesión; autor o proyecto compartido; backend permite admin |
| POST `/environment-comments` | `{content,parentCommentId?:number|null}`; 1–2000 caracteres | 201 `{comment}` | Sesión y audiencia de la conversación; 404 ENVIRONMENT_COMMENT_NOT_FOUND |
| GET `/environment-comments/authors/:userId/profile-photo` | — | 200 imagen | Sesión y acceso al autor; 404 |

`EnvironmentComment`: `id,content,createdAt,parentCommentId,type,author` como Comment, `commentType:"general",projectId:null,scope:"environment"`. Respuestas heredan audiencia de la raíz. El frontend refresca periódicamente esta colección; no existe stream específico de entorno. El administrador tiene acceso amplio en backend aunque su panel no carga ni muestra estas observaciones.

### Solicitudes de proyecto

| Método y path | Request | Éxito | Acceso / errores relevantes |
| --- | --- | --- | --- |
| GET `/project-requests` | P | 200 `{projectRequests:ProjectRequest[],nextCursor}` | Sesión + clientId; solo solicitudes propias, excluye draft; 403 CLIENT_REQUIRED |
| POST `/project-requests` | RequestPayload + `submissionId:UUID` | 201 `{projectRequest}` | Sesión + clientId; crea draft, idempotencia por submissionId; 409 PROJECT_NAME_ALREADY_EXISTS |
| PATCH `/project-requests/:projectRequestId` | RequestPayload completo (no patch parcial) | 200 `{projectRequest}` | Sesión + propiedad; draft o changes_requested; 404 PROJECT_REQUEST_NOT_FOUND |
| POST `/project-requests/:projectRequestId/submit` | `{}` | 200 `{projectRequest}` | Sesión + propiedad; 404, 409 PROJECT_REQUEST_NOT_SUBMITTABLE; reenvío pendiente con evaluación puede devolver existente |
| POST `/project-requests/:projectRequestId/files` | Binario | 201 `{file}`; posible `{id,originalName,reused:true}` | Sesión + borrador editable propio; 404, 409 límite/duplicado, 413 acumulado |
| DELETE `/project-requests/:projectRequestId/files/:fileId` | — | 200 `{deleted:true,fileId}` | Sesión + borrador propio; 404 |
| GET `/project-requests/:projectRequestId/files/:fileId/content` | Range opcional | 200/206 binario | Sesión + propiedad o acceso de revisión; 404 |
| GET `/project-requests/review-queue` | P | 200 `{projectRequests:WorkflowRequest[],nextCursor}` | Sesión + admin/architect; arquitecto limitado a asignaciones |
| PUT `/project-requests/:projectRequestId/review` | `{recommendation:approve|reject|changes_requested,note,meetingRecommendation?:SCHEDULE_MEETING|DO_NOT_SCHEDULE_MEETING|null}`; nota 10–2000 | 200 `{review:{id,note,recommendation,meetingRecommendation,updatedAt}}` | Ruta admin/architect; conserva acceso del admin y del arquitecto asignado; 403 PROJECT_REQUEST_REVIEW_FORBIDDEN, 409 PROJECT_REQUEST_CLOSED |

RequestPayload (JSON estricto, rechaza propiedades desconocidas):

| Campo | Valores / restricción actual |
| --- | --- |
| projectName / description | Obligatorios, 3–150 / 30–100 caracteres recortados |
| projectType | Vigentes: residential, commercial, corporate, advertising_stand. stands_exhibitions solo puede conservarse al editar una solicitud que ya tenga ese tipo; no se admite al crear ni al asignarlo a otro registro |
| projectLocation | Obligatorio, 5–255; validación manual de texto de dirección |
| projectLocationFormattedAddress / projectLocationProviderPlaceId | Texto o null; máximo 500 / 255; ausentes normalizados a null |
| projectLocationLatitude / projectLocationLongitude | number o null; juntos; −90..90 / −180..180 |
| capitalAvailability | available_now, within_3_months, seeking_financing, undefined (literal string) |
| developmentMode | phased, full, undecided |
| investmentRange | undefined, under_10k, 10k_50k, 50k_150k, over_150k |
| legalDocumentationStatus | available, in_process, unavailable. Obligatorio solo si landStatus=available; en otro caso debe ser null u omitirse |
| legalDocumentTypes | Array (default []), máximo 4, sin duplicados: property_deed, purchase_contract, lease_contract, other. Con landStatus=available: no vacío si legalDocumentationStatus=available y vacío en otros estados; sin terreno disponible siempre vacío |
| hasMultipleOwners | boolean obligatorio si landStatus=available; en otro caso null u omitido |
| startTime | immediate, 1_3_months, 3_6_months, over_6_months |
| decisionMaker | Opcional/null: self, partner, extended_family, company_board |
| experience | Opcional/null: positive, negative, first_time |
| hasBlueprints | boolean opcional/null solo si landStatus=available; en otro caso null u omitido. Se devuelve como hasPlans |
| landStatus | available, acquiring, unavailable. Obligatorio salvo en advertising_stand, donde no aplica y debe ser null u omitirse (enviarlo responde 400 con `fields.body.landStatus`). Solo available, en un tipo que admite la pregunta, habilita los datos del inmueble; enviar datos legales, propietarios o planos sin él responde 400 |
| projectSize | Opcional/null: small_lt_80, medium_80_200, large_200_500, very_large_gt_500, unknown |
| quality | Opcional/null: functional_economic, standard, premium, luxury |
| referenceLink | Texto http/https o null, máximo 500 |

`advertising_stand` (Stand publicitario) es el único tipo vigente para la sección «Requisitos del stand». Su bloque `standRequirements` conserva las reglas y opciones descritas en [requisitos del stand](PROJECT_REQUEST_STAND_REQUIREMENTS.md); solo se acepta para ese tipo. Se devuelve como objeto o null en la solicitud y la cola administrativa. Para este tipo, `landStatus` y los datos legales, de propietarios y de planos del inmueble no aplican.

`stands_exhibitions` es un identificador histórico, con etiqueta de lectura «Stands y exhibiciones». Crear con ese valor responde 400 `VALIDATION_ERROR`. En edición el servicio compara el tipo recibido con el registro accesible al usuario: solo puede conservarse si ya estaba guardado; introducirlo en una solicitud de otro tipo responde 400 con `fields.body.projectType`. Se puede cambiar explícitamente a un tipo vigente. Lectura, edición y reenvío no convierten automáticamente registros antiguos ni exigen requisitos del stand para ellos. El enum PostgreSQL se conserva y las métricas admiten el tipo histórico como respuesta válida.

`ProjectRequest`: campos anteriores con diferencias públicas `location` (projectLocation), `formattedAddress`, `providerPlaceId`, `locationCoordinates` y `hasPlans`; añade `id,clientId,requestedBy,status,createdAt,updatedAt,correctionReason,rejectionReason,reviewedAt,convertedProjectId,compatibility`. No devuelve submissionId. Compatibility es null o `{score:number,level,observations:string[],findings}`: `observations` conserva hasta 3 textos; `findings` es `[{code,category,severity,explanation,evidence:[{code,explanation}]}]` con **todas** las causas detectadas en las fórmulas 3.0, 3.1, 3.2 o 3.3 (vigente; mismo catálogo más las evidencias retiradas —referencias en 3.2, planos en 3.3— que solo aparecen en evaluaciones guardadas), o `null` en evaluaciones históricas (1.x/2.x), que no se recalculan. Añade `completeness:{score,answered,applicable,missingFields:string[]}` (preguntas aplicables respondidas; las N/A se excluyen; en Stand publicitario incluye sus preguntas con rutas `standRequirements.*`) y `financialViability:{score:null,status,findings:[{code,category,severity,outcome,explanation,evidence:[{code,explanation}]}]}`: coherencia financiera orientativa, sin porcentaje. `status` es `NO_OBVIOUS_CONFLICT` (no es una aprobación), `REVIEW_REQUIRED`, `HIGH_RISK` (no demuestra inviabilidad) o `INSUFFICIENT_DATA`; `PENDING_RULES` queda reservado. `outcome` es el efecto del hallazgo (`HIGH_RISK`, `REVIEW_REQUIRED`, `INSUFFICIENT_DATA` o `INFORMATIVE`). Se calcula al vuelo, sin pesos ni deducciones. Las tres métricas son independientes y se describen en `PROJECT_REQUEST_EVALUATION.md`. Estados usados por flujo: draft, pending_verification, pending_review, changes_requested, approved, rejected. El frontend debe usar la evaluación devuelta; pesos y persistencia no son contrato HTTP.

`WorkflowRequest` es una proyección distinta: `id,clientId,projectName,projectType,location,description,status,createdAt,updatedAt,correctionReason,rejectionReason,compatibility:{score,level}|null,completeness,financialViability,reviewObservations:[{code,explanation}],assignees:[{id,name,roleCode,hasProfilePhoto}],files:[{id,name,fileType}],reviews:[{note,recommendation,meetingRecommendation,reviewer,updatedAt}]`. No equivale a ProjectRequest completo. `reviewObservations` son avisos sin puntos para la revisión inicial (p. ej. planos del inmueble no disponibles o sin confirmar). Se calculan al vuelo, solo cuando aplican, y no forman parte de ProjectRequest ni de la compatibilidad.

`meetingRecommendation` es una decisión estructurada de reunión independiente del workflow (`recommendation`) y de la justificación (`note`). Sus únicos códigos son `SCHEDULE_MEETING` y `DO_NOT_SCHEDULE_MEETING`; las lecturas históricas devuelven `null`. En escritura, omitir el campo conserva el valor registrado y `null` explícito lo elimina. La validación Zod rechaza códigos desconocidos. El drawer muestra reunión y nota de la misma revisión más reciente; no hereda decisiones antiguas ni interpreta el texto. No se agrega una acción de workflow ni un endpoint. Ver [modelo, migración y mapping frontend](PROJECT_REQUEST_MEETING_RECOMMENDATION.md).

`update` y `deleteFile` de solicitudes están consumidos por formularios/modales; `listReviewQueue` por dashboard. No existe GET de detalle individual de solicitud en la fachada.

### Administración

Todas las rutas siguientes requieren sesión y `role.code=admin` por middleware del router; no basta con un permiso frontend.

| Método y path | Request | Éxito / errores de dominio relevantes |
| --- | --- | --- |
| GET `/admin/dashboard-metrics` | — | 200 `{metrics}` |
| GET `/admin/dashboard-overview` | — | 200 `{overview:{newRequests,recentActivity}}` |
| GET `/admin/assignees` | — | 200 `{assignees:[{id,name,roleCode,roleName,hasProfilePhoto}]}` |
| GET `/admin/roles` | — | 200 `{roles:[{id,code,name,description,isActive}]}` |
| GET `/admin/users` | cursor?, limit? 1–10, role? CSV, status? CSV, search? ≤100 | 200 `{users:AdminUser[],nextCursor,metrics:{total,active,suspended,disabled}}` |
| GET `/admin/users/:userId` | — | 200 `{user:AdminUserDetail}`; 404 USER_NOT_FOUND |
| POST `/admin/users` | AdminUserInput | 201 `{message,user:AdminUser}`; 409 EMAIL_ALREADY_EXISTS / PHONE_ALREADY_EXISTS, 404 ROLE_NOT_FOUND |
| PATCH `/admin/users/:userId` | AdminUserInput completo + password? | 200 `{message,user:AdminUser}`; 409 SELF_ACCESS_CHANGE_NOT_ALLOWED, conflictos de correo/teléfono; cambiar contraseña, rol, correo o estado revoca sus sesiones |
| PATCH `/admin/users/:userId/status` | `{status:active|blocked|inactive}` | 200 `{message,user:AdminUser}`; 409 SELF_STATUS_CHANGE_NOT_ALLOWED; `blocked`/`inactive` revoca todas sus sesiones |
| POST `/admin/users/:userId/sessions/revoke` | Sin body | 200 `{revokedCount}`; 400 VALIDATION_ERROR, 404 USER_NOT_FOUND, 409 SELF_SESSION_REVOKE_NOT_ALLOWED, 429/503 (60 por hora por administrador) |
| GET `/admin/users/:userId/notes` | cursor?, limit? 1–25 | 200 `{notes:Note[],nextCursor}`; notas del administrador actual |
| POST `/admin/users/:userId/notes` | `{content}` 1–1000 recortado | 201 `{message,note}`; 404 USER_NOT_FOUND |
| PATCH `/admin/users/:userId/notes/:noteId` | `{content}` 1–1000 | 200 `{message,note}`; 404 NOTE_NOT_FOUND |
| PATCH `/admin/users/:userId/notes/:noteId/archive` | Sin body | 200 M; 404 NOTE_NOT_FOUND |
| GET `/admin/users/:userId/profile-photo` | — | 200 imagen; 404 |
| GET `/admin/assignees/:userId/profile-photo` | — | 200 imagen; 404 |
| PUT `/admin/projects/:projectId/assignees` | `{assigneeIds:number[]}` ≤20 únicos; [] permitido | 200 `{assignees}`; activos elegibles, 400 validación, 404 proyecto, 409 estados de solo lectura |
| PATCH `/admin/projects/bulk-action` | `{action:change_visibility,isPublic:boolean,projectIds}` o `{action:archive|unarchive,projectIds}`; 1–100 IDs únicos | 200 `{projects:[{id,status,isPublic,archived,archivedAt:null}]}`; 400 visibilidad exige finished, desarchivar exige archived; 404 |
| PUT `/admin/project-requests/:projectRequestId/assignees` | `{assigneeIds:number[]}` ≤20 únicos | 200 `{assignees}`; admin/architect activos; pending_verification/pending_review; en revisión conserva arquitecto; 400, 404, 409 PROJECT_REQUEST_CLOSED |
| PATCH `/admin/project-requests/:projectRequestId/decision` | `{action:approve|reject|request_changes,internalNotes?:string|null,reason?}`; reason requerido 10–2000 para rechazo/corrección; internalNotes ≤4000 | 200 `{project:{id,name,status}|null,projectRequest:{id,status,correctionReason,rejectionReason,convertedProjectId,reviewedAt}}`; 404, 409 PROJECT_REQUEST_INVALID_STATE / PROJECT_REQUEST_REVIEW_REQUIRED |

AdminUserInput: `fullName` 3–300 y dos palabras, `email`, `roleCode`, `status` obligatorios; `companyName?` ≤150, `phone?`, `secondaryPhone?` ≤40 con normalización internacional (8–15 dígitos); teléfonos distintos. Aunque use PATCH, la edición exige los campos obligatorios completos. Password opcional **solo en edición**: 8–72, mayúscula/número/especial. Creación genera contraseña aleatoria interna; respuesta no incluye contraseña ni garantiza envío de activación.

AdminUser: `id,name,email,role:{code,name},status,hasProfilePhoto,lastLoginAt,createdAt`. Detail añade `companyName,phone,secondaryPhone,notes,notesTotal,projects:[{id,name}]`. Note: `{id,content,createdAt,updatedAt}`. La fachada añade localmente profilePhotoUrl a listados y actualizaciones.

Metrics: `activeUsers:{total,thisMonth}`, `activeProjects:{total,thisMonth}`, `files:{total,totalBytes,latestUploadAt}`, `requests:{total,today}`, `criticalEvents:{total,latestAt}`. Overview.newRequests contiene `{id,projectName,projectType,status,createdAt,assignees}`; recentActivity `{id:string,createdAt,projectId,projectName,title,userName,userRoleCode}`. Estos arrays son resúmenes limitados, sin cursor; no representan el historial completo.

### Catálogo de servicios (administración)

Router propio `src/routes/serviceCatalog.js` montado en `/admin/services` antes de `/admin`. Exige sesión y `role.code=admin` (401 UNAUTHENTICATED, 403 FORBIDDEN) en todas las rutas; no usa permisos de base de datos en esta fase. Las escrituras comparten un límite de 120 por hora por administrador (`admin-service-catalog-write`; 429/503). Las lecturas responden `Cache-Control: no-store`.

| Método y path | Request | Éxito / errores de dominio relevantes |
| --- | --- | --- |
| GET `/admin/services` | cursor?, limit? 1–100 (default 25), search? ≤100 (nombre o código, literal), status? `active|inactive`, kind? `individual|turnkey`, measurementUnitId?, unitDenominationId? | 200 `{services:Service[],nextCursor}`; orden `sortOrder, id`; incluye inactivos salvo filtro; `measurementUnitId` y `unitDenominationId` filtran por la unidad del servicio |
| GET `/admin/services/:serviceId` | — | 200 `{service:Service}`; 404 SERVICE_NOT_FOUND |
| POST `/admin/services` | ServiceCreateInput | 201 `{message,service}` con `currentVersion=1`, `code` generado (`SERV-001`) y el `kind` elegido (`individual` si se omite); 400 VALIDATION_ERROR (unidad inexistente o inactiva en `fields.measurementUnitId`; ambas modalidades admiten cualquier unidad base registrada y activa; `code` enviado en `fields["body.code"]`; `kind` fuera de `individual|turnkey` en `fields["body.kind"]`); 409 SERVICE_CODE_ALREADY_EXISTS solo si no hay código libre |
| PATCH `/admin/services/:serviceId` | ServiceUpdateInput | 200 `{changed,changedFields,message,service}`; sin cambios efectivos `changed=false` y no se crea versión; 404 SERVICE_NOT_FOUND; 409 SERVICE_VERSION_CONFLICT |
| PATCH `/admin/services/:serviceId/status` | `{expectedVersion,isActive,changeNote?}` | Igual que la edición (misma lógica versionada); reactivar con la unidad base o la denominación inactivas responde 400 VALIDATION_ERROR (`fields.measurementUnitId` o `fields.unitDenominationId`) sin modificar el servicio ni crear versión |
| DELETE `/admin/services/:serviceId` | — | 405 SERVICE_DELETION_NOT_ALLOWED con `Allow: GET, PATCH`; los servicios se desactivan, nunca se eliminan |

ServiceCreateInput (campos desconocidos se rechazan): **`code` no se acepta** (400 en `body.code`). El sistema reserva el id con la secuencia de `services.id` en la misma transacción y genera `SERV-` más el id con al menos tres dígitos (`SERV-001`, `SERV-1000`): único, permanente, seguro ante altas concurrentes, nunca reutilizado (tampoco de servicios desactivados ni de altas fallidas, que dejan saltos) y sin contar registros ni usar `MAX(id)+1`; si coincide con un código heredado escrito a mano, se reserva el siguiente id. `kind?` es la modalidad de contratación elegida por el administrador: `individual` («Detalle por detalle») o `turnkey` («Llave en mano»); omitido, `individual` (compatibilidad con clientes previos); cualquier otro valor, incluido null o vacío, 400 en `body.kind`; `name` 1–150 recortado; `description?` ≤2000 (vacío o null = sin descripción); `measurementUnitId` entero positivo de una unidad existente y activa; `referenceRate` texto decimal (recomendado) o número exacto, ≥0, hasta 12 enteros y 2 decimales, sin redondeo; `isActive?` (default true); `sortOrder?` 0–2147483647 (default 0); `changeNote?` ≤255; `unitDenominationId?` (entero o null) de una denominación activa de la misma unidad base; `presentationLabel?` (ver «Unidad del servicio»). La modalidad no restringe la unidad: `individual` y `turnkey` admiten cualquier unidad base registrada y activa (m², m³, m.l., und., pt., hrs…); una unidad inexistente o inactiva responde 400 en `fields.measurementUnitId` sin reservar código ni escribir nada. La versión 1 copia el `kind` elegido.

ServiceUpdateInput: `expectedVersion` (entero ≥1, versión vigente leída por el cliente) obligatorio y al menos uno de `name`, `description`, `kind`, `measurementUnitId`, `unitDenominationId`, `presentationLabel`, `referenceRate`, `isActive`, `sortOrder`; `changeNote?`. `code` y la moneda no son editables. Una nueva unidad o denominación debe estar activa, y reactivar (`isActive` de false a true) exige que la unidad y la denominación vigentes también lo estén; la modalidad no restringe la unidad, así que cambiar solo `kind` conserva la unidad vigente (incluida una histórica) sin revalidarla. Cambiar la unidad base de un servicio con denominación exige enviar también `unitDenominationId` (de la nueva base, o null): 400 en `fields.unitDenominationId` en caso contrario. Cambiar o retirar la denominación crea una versión. Cambiar `kind` de un servicio con conceptos en cualquier cotización guardada (aunque el servicio esté inactivo) responde 409 `SERVICE_MODALITY_IN_USE` sin escrituras ni versión nueva; enviar el mismo `kind` y los demás cambios no se ven afectados (Backend/ARCHITECTURE.md, «Modalidad bloqueada por cotizaciones»).

**Unidad del servicio.** Cada servicio tiene **una sola unidad de medida** (`measurementUnitId` + `unitDenominationId?`: una base sola o una denominación activa de esa base) y su tarifa es `referenceRate`. Un servicio que se cobra de dos formas se registra como dos servicios con nombres diferenciados («Recorrido Virtual / VR — Por minuto» y «— Por proyecto»), colocados juntos con `sortOrder`. `unitOptions` ya no se acepta (400 por campo desconocido). `presentationLabel?` (≤80, normalizado; vacío o null lo retira) es el texto comercial que sustituye a la etiqueta compuesta («Global por Proyecto»): lo usan la carga del catálogo y el mantenimiento, el formulario no lo edita. Omitido, se conserva mientras la unidad no cambie; cambiar la unidad sin enviarlo lo retira (describía la anterior). Las versiones anteriores a la unidad única (migración `20261030120000_service_single_unit_option`) pueden conservar unidades alternativas como historial; nunca se ofrecen ni se cotizan.

Service: `{id,code,name,description,kind,kindLocked,measurementUnit:{id,code,name,symbol,allowsDecimals,isActive},unitDenomination:{id,denomination,isActive}|null,presentationLabel:string|null,unitLabel:"m² de construcción",referenceRate:"12.00",currency:"USD",isActive,sortOrder,currentVersion,createdAt,updatedAt}`. `unitLabel` es la etiqueta de la unidad (su `presentationLabel` si lo tiene; sin denominación, solo la abreviatura): es la que deben mostrar formularios, tablas, cotizaciones y PDF. `referenceRate` es texto decimal para conservar la precisión; no convertir a `Number`. Cada cambio efectivo crea una versión inmutable en `service_versions` (no hay endpoint de historial ni de restauración en la fase 1). Otros 409: SERVICE_REFERENCE_CONFLICT (referencia ya no disponible o RESTRICT 23001), SERVICE_CONCURRENT_UPDATE (bloqueo o serialización), SERVICE_VERSION_MISSING (servicio sin versión vigente), SERVICE_HISTORY_IMMUTABLE.

### Unidades de medida (administración)

Routers propios `src/routes/measurementUnits.js`, montados antes de `/admin`. Exigen sesión y `role.code=admin` (401/403); las escrituras comparten un límite de 120 por hora por administrador (`admin-measurement-unit-write`). Las lecturas responden `Cache-Control: no-store`. Las **unidades base** concentran las reglas (código estable, decimales, compatibilidad) y son de solo lectura en la API; las **denominaciones** son las "unidades de medida" personalizadas del formulario (abreviatura de la base + texto).

| Método y path | Request | Éxito / errores de dominio relevantes |
| --- | --- | --- |
| GET `/admin/measurement-units` | includeInactive? `true|false` (default false) | 200 `{measurementUnits:MeasurementUnit[]}` en orden `sortOrder, id`; sin paginación (catálogo acotado) |
| POST/PATCH/PUT/DELETE `/admin/measurement-units[/:id]` | — | 405 MEASUREMENT_UNIT_READ_ONLY con `Allow: GET` |
| GET `/admin/measurement-unit-denominations` | cursor?, limit? 1–100 (default 25), measurementUnitId?, status? `active|inactive`, search? ≤100 (código público, texto o abreviatura, literal) | 200 `{unitDenominations:UnitDenomination[],nextCursor}`; orden: base, texto, id |
| GET `/admin/measurement-unit-denominations/:denominationId` | — | 200 `{unitDenomination}`; 404 MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND |
| POST `/admin/measurement-unit-denominations` | `{measurementUnitId,denomination}` | 201 `{message,unitDenomination}`; 400 VALIDATION_ERROR (base inexistente o inactiva, texto inválido); 409 MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS |
| PATCH `/admin/measurement-unit-denominations/:denominationId` | `{denomination,measurementUnitId?}` | 200 `{changed,message,unitDenomination}`; 400 VALIDATION_ERROR (nueva base inexistente o inactiva en `fields.measurementUnitId`); 404; 409 duplicado (también en la nueva base); 409 MEASUREMENT_UNIT_IN_USE si cambia el texto y la usan servicios activos; 409 MEASUREMENT_UNIT_BASE_IN_USE si cambia la base y la referencia algún servicio (activo o inactivo) o versión histórica |
| PATCH `/admin/measurement-unit-denominations/:denominationId/status` | `{isActive}` | Igual que la edición; desactivar una usada por servicios activos responde 409 MEASUREMENT_UNIT_IN_USE; activar exige base activa |
| DELETE `/admin/measurement-unit-denominations/:denominationId` | — | 405 MEASUREMENT_UNIT_DELETION_NOT_ALLOWED con `Allow: GET, PATCH` |

`denomination`: se normaliza (NFC, sin espacios sobrantes ni dobles), 1–80 caracteres, sin caracteres de control. Dos denominaciones de la misma base son equivalentes si coinciden sin distinguir mayúsculas ni formas Unicode compatibles (NFKC); las tildes sí distinguen. Para cambiar una denominación en uso se crea otra y se reasignan los servicios (`GET /admin/services?unitDenominationId=`). `measurementUnitId` en la edición es opcional: enviarlo con la base actual no es un cambio; con otra base solo se acepta si `baseUnitEditable` es true en el momento de guardar (la API lo comprueba con la denominación bloqueada y PostgreSQL lo impone con el trigger `measurement_unit_denominations_unit_immutable`). El `publicCode` se conserva.

MeasurementUnit: `{id,code,name,symbol,allowsDecimals,isActive,sortOrder}`. UnitDenomination: `{id,publicCode:"UNID-001",denomination,label:"m² de construcción",isActive,activeServiceCount,baseUnitEditable,measurementUnit:{id,code,name,symbol,allowsDecimals,isActive,sortOrder},createdAt,updatedAt}`. `publicCode` es el identificador visible (columna N.º de la tabla administrativa): `UNID-` más el id con al menos tres dígitos (`UNID-001`, `UNID-1000`), generado por PostgreSQL al crear, permanente aunque se edite o desactive la denominación y nunca aceptado en el cuerpo de las peticiones (400). No se usa para relaciones ni reglas: los servicios referencian el `id` interno. `label` y `unitLabel` se componen con `formatUnitLabel(symbol, denomination)` (`src/domain/measurementUnitLabel.js`). `baseUnitEditable` es true si ningún servicio (de cualquier estado) ni versión histórica referencia la denominación; es un indicador de la lectura y la edición lo vuelve a comprobar. Otros 409: MEASUREMENT_UNIT_REFERENCE_CONFLICT, MEASUREMENT_UNIT_CONCURRENT_UPDATE.

### Cotizaciones (administración)

Router `src/routes/quotes.js` en `/api/admin/quotes`. Exige sesión y `role.code=admin` (401/403). Importes como texto decimal (no convertir a `Number`) y moneda USD. El IVA es solo **referencial** (informativo, no fiscal): no altera tarifas ni el total de servicios. Las lecturas responden `Cache-Control: no-store`.

| Método | Ruta | Respuesta |
| --- | --- | --- |
| GET | `/` | `{quotes, nextCursor}`. Query: `limit`, `search` (≤100; código, cliente o proyecto), `createdFrom` (inclusivo) y `createdBefore` (exclusivo) en ISO 8601 con zona, `sort` `code`/`total`, `direction` `asc`/`desc`, `cursor` (validado según `sort`). |
| GET | `/summary` | `{summary:{total}}`. |
| GET | `/reference-vat` | `{referenceVat:{enabled, rate}}`: tasa configurada del IVA referencial (`QUOTE_REFERENCE_VAT_RATE`, porcentaje 0–100 con hasta 2 decimales, normalizada: `"16.00"`). Sin valor: `{enabled:false, rate:null}` («pendiente de configuración»). Valor no válido: 500 `QUOTE_REFERENCE_VAT_MISCONFIGURED` (también en POST/PATCH, sin escribir). |
| GET | `/clients` | `{clients, nextCursor}`: clientes activos para el selector (`search`, `limit`, `cursor`). |
| GET | `/clients/:clientId/projects` | `{projects, nextCursor}`: proyectos del cliente. |
| POST | `/` | 201 `{message, quote}`: crea la cotización y su versión 1. |
| GET | `/:quoteId` | `{quote}`: versión vigente, conceptos y autoría. 404 `QUOTE_NOT_FOUND`. |
| PATCH | `/:quoteId` | `{changed, message, quote}`: crea una versión si el contenido cambia; si no, `changed:false`. |
| GET | `/:quoteId/pdf` | PDF adjunto (`timeZone` IANA opcional, ≤64). ETag y 304 con `If-None-Match`, `Cache-Control: private, no-cache`. Límite 240/h. |

QuoteInput (estricto): `clientId`, `projectId`, `notes?` (≤2000), `items` (1–100) `[{serviceId, quantity, unitRate}]` con cantidad `NUMERIC(12,3)` > 0 y tarifa aplicada `NUMERIC(14,2)` ≥ 0 como texto (`unitOptionPosition` ya no se acepta: 400). Cada concepto se cotiza con la única unidad del servicio; su tarifa de referencia es la del tabulador y la tarifa aplicada la decide el administrador sin cambiar el tabulador. Un concepto ya cotizado con esa misma versión conserva su unidad copiada (también una alternativa anterior a la unidad única). PATCH añade `expectedVersion`. El cuerpo no lleva IVA: el servidor lo calcula con `quoteTotals.js` y lo guarda con la versión. Una cotización nueva usa la tasa configurada; al editar, una cotización guardada con IVA conserva su tasa aunque la configuración cambie, y una guardada sin tasa adopta la configurada (es un cambio de contenido: crea versión). Escrituras: 120/h por administrador. 400 con `fields` (`clientId`, `projectId`, `items.N.serviceId`, `items.N.quantity`) si el cliente o el proyecto no existen o no están disponibles, el proyecto no pertenece al cliente, un servicio se repite o está inactivo, la versión del servicio no tiene una unidad cotizable, o una cantidad no es entera para su unidad. 409: `QUOTE_VERSION_CONFLICT`, `QUOTE_REFERENCE_CONFLICT`, `QUOTE_CONFLICT`, `QUOTE_CONCURRENT_UPDATE`, `QUOTE_HISTORY_IMMUTABLE`.

Quote (listado): `{id, code, client:{id,name}, project:{id,name}, servicesTotal, referenceVat:{enabled, rate, amount, isReferenceOnly:true}, estimatedTotalWithVat, currency, currentVersion, createdAt, updatedAt}`; `referenceVat` y `estimatedTotalWithVat` (= `servicesTotal` + `amount`) son los guardados con la versión; sin IVA, `enabled:false`, `rate:null`, `amount:"0.00"` y el estimado igual al total. El orden por total usa `servicesTotal`. El PDF imprime el IVA solo si la versión lo tiene: total de servicios (sin IVA), «IVA referencial (16 %)», total estimado con IVA y el aviso de que no es una liquidación fiscal; el detalle añade `notes`, `createdBy`, `version:{id, createdAt, createdBy:{id,name,hasProfilePhoto}}` e `items:[{lineNumber, quantity, unitRate, referenceRate, subtotal, service:{id, versionId, code, name, description, kind, isActive}, unit:{label, allowsDecimals, position, optionId}}]`; `unit` es la copia de la unidad cotizada de esa versión (su etiqueta incluye el texto comercial si lo tenía). Nombres, tarifas y unidades son instantáneas de la versión; `service.isActive` es el estado actual en el tabulador.

### Soporte y direcciones

| Método y path | Request | Éxito | Acceso / errores relevantes |
| --- | --- | --- | --- |
| POST `/support/requests` | `{subject,description,issueType}`; asunto 1–150, descripción 1–5000 recortados; issueType recortado sin enum validado en controlador | 201 `{supportRequest:{id,userId,subject,description,issueType,status,createdAt}}` | Sesión + support.requests.create; 400 INVALID_SUPPORT_SUBJECT / INVALID_SUPPORT_DESCRIPTION |
| POST `/support/requests/:supportRequestId/files` | Binario | 201 `{file:{id,originalName,fileExtension,fileSize,fileType,supportRequestId,createdAt}}` | Sesión + support.files.upload y solicitud accesible; 400 ID inválido, 404 SUPPORT_REQUEST_NOT_FOUND |
| GET `/geoapify/address-suggestions` | `q:string` recortado | 200 `{suggestions:[{formattedAddress,latitude,longitude,placeId:string|null}]}` | Sesión; 500 GEOAPIFY_API_KEY_MISSING; 502 GEOAPIFY_CONFIGURATION_INVALID / GEOAPIFY_LIMIT_REACHED / GEOAPIFY_REQUEST_FAILED |

Geoapify: texto <2 devuelve []; texto de coordenadas intenta geocodificación inversa y puede devolver [] si el proveedor falla. Búsqueda normal usa idioma es, sesgo ve, límite 5 y deduplicación. El frontend valida suggestions como array y devuelve únicamente ese array. No consume el proveedor directamente ni envía su clave.

## Paginación y caché

Cursor opaco base64url de dos valores; enviar `nextCursor` sin decodificar. Ausencia/null termina el recorrido. Colecciones generales: límite default 25, máximo 100. Usuarios admin: default/máximo 10; notas: default/máximo 25. Detalle de proyecto usa `filesCursor/filesLimit` y devuelve `project.filesNextCursor`, sin nextCursor raíz. No hay page/offset ni total estándar.

El orden depende de la colección: comentarios/entorno recorren creación ascendente; solicitudes propias descendente por creación; cola de revisión descendente por actualización. El cursor no representa un snapshot estable ante mutaciones. Cambiar usuario, recurso o filtros exige reiniciar cursor. Los helpers listAll, listAllComments, listAllDocumentComments y getByIdAllFiles recorren páginas de 100 y deduplican por id; devuelven cursor null una vez agregadas. No hay deduplicación universal de fetch: restauración de sesión y cargas concretas tienen sus propios controles.

Auth usa no-store/Pragma no-cache. Métricas, overview y responsables admin: private,max-age=30,must-revalidate; usuarios: private,max-age=15; notas/detalle admin y cola revisión: no-store. Fotos ajenas: private,max-age=60,must-revalidate; avatar propio: private,no-store. Sin cabecera explícita en otras lecturas no debe inferirse una política común. Overview frontend tiene caché/deduplicación 15 s por scopeKey (consumidor usa id/email; fallback admin-session), recarga force y sin función explícita de limpieza al logout. Los visores tienen cachés de recursos propias; no deben asumirse equivalentes a la caché HTTP.

RecentProjectsContext mantiene tres entradas de navegación en sessionStorage por usuario/alcance y deduplica solicitudes concurrentes. Revalida con `/projects?limit=25&scope=owned` para clientes y accessible para otros roles; no comprueba TTL del dato persistido. El backend ya no guarda en caché el usuario de la sesión (B-3): solo comparte la consulta en vuelo de peticiones simultáneas con el mismo `sid`, de modo que los cambios de cuenta, rol, permisos o sesiones se aplican en la siguiente petición.

## Archivos: uploads, descargas y referencias

Uploads no usan multipart/FormData. Se envía el File como body, su MIME en Content-Type y `X-File-Name: encodeURIComponent(file.name)`. Backend acepta también X-Original-File-Name. Necesita Content-Length conocido y positivo (lo establece navegador/transporte); 411 FILE_LENGTH_REQUIRED si falta. Nombre máximo 150; default 50 MiB por archivo (FILE_UPLOAD_MAX_BYTES, PROFILE_PHOTO_MAX_BYTES). MIME application/octet-stream del fallback cliente no es aceptado por las políticas actuales.

| Destino | Formatos aceptados |
| --- | --- |
| Proyecto y soporte | PDF, DOCX, XLSX, JPEG/JPG, PNG, MP4; MIME debe coincidir con extensión |
| Solicitud de proyecto | PDF, JPEG/JPG, PNG, MP4; coincidencia MIME/extensión y firma binaria |
| Avatar | JPEG/JPG, PNG, WebP; extensión y MIME permitidos, sin mapa de coincidencia específico |

Solicitudes: máximo 10 archivos y 200 MiB acumulados; reintento del mismo nombre puede drenar/validar el stream y devolver `{id,originalName,reused:true}` con 201. Nuevo UploadedFile de proyecto/solicitud tiene `id,originalName,fileCategory,fileType,fileSize`; solicitudes nuevas añaden `createdAt,extension,title`. No devuelve URL de almacenamiento. XHR informa progreso hasta 99% durante transferencia y 100% después del éxito HTTP; AbortSignal cancela. Avatar comprueba señal previamente abortada; helper de uploads generales no tiene esa comprobación inicial.

Descargas pasan por las rutas `/content`, nunca por repositories o claves S3. GET devuelve stream con Content-Type, Content-Disposition inline y nombre codificado. Range se reenvía a almacenamiento; 206 si hay ContentRange. Proyecto anuncia Accept-Ranges y permite embebido desde orígenes configurados. Solicitud tiene private,max-age=60,must-revalidate. Proyecto usa private,max-age=300 o private,max-age=31536000,immutable si versionId coincide con currentVersionId; ETag identifica archivo/versión y Vary:Cookie. No hay manejo explícito de If-None-Match en el controlador.

**Limitación actual:** versionId se valida y se usa para caché, pero no se pasa a la búsqueda del objeto. La descarga sirve la versión actual; no garantiza recuperar una versión histórica. fileVersionId de observaciones sí delimita su consulta y anclaje.

La sanitización global JSON y SSE elimina claves de recursos (`fileUrl`, `profilePhotoUrl`, `storageKey`, `src`, `href`, etc.) y strings reconocidos como URLs salvo referenceLink. El frontend fabrica URLs con IDs, hasProfilePhoto y campos de versión. Esta transformación se aplica después de los mappers; un mapper interno con URL no significa que la respuesta HTTP la incluya.

## SSE / eventos

`GET /projects/:projectId/events` usa text/event-stream, no-cache,no-transform, keep-alive y X-Accel-Buffering:no. EventSource abre con withCredentials=true y la función subscribeToEvents devuelve cierre explícito.

```text
id: <timestamp>-<secuencia>
event: project.comment.created
data: {"comment":{...}}

```

Primera emisión `project.connected` con `{projectId,timestamp}`. Heartbeat comentario `: heartbeat` cada 25 s. Creación de comentarios publica `project.comment.created`; documentos publican desde su servicio. El cliente actual escucha ese evento, parsea JSON, ignora eventos malformados y entrega data.comment. onerror recibe evento del navegador, **no** Error normalizado con status/code/fields. Reconexión propia de EventSource; no se implementa replay, almacenamiento durable ni procesamiento Last-Event-ID. Bus y límites están en memoria del proceso (default 5 conexiones/usuario y 100/proyecto). Exceso antes de abrir: 429 SSE_CONNECTION_LIMIT + Retry-After:30; carrera posterior a cabeceras puede cerrar stream sin JSON. No se garantiza mantener la conexión más allá del límite de duración de la función Vercel ni repartir eventos entre procesos.

## Responsabilidades Frontend / Backend

**Frontend** consume contratos públicos HTTP y no depende de repositories, services ni detalles internos del backend. Centraliza peticiones HTTP en la capa API; actualmente existen las excepciones inventariadas abajo. Maneja estados visuales de carga/contenido/vacío/error/paginación, presentación, navegación y adaptación de datos para UI. Construir rutas públicas con IDs no habilita acceso: la autorización la decide backend.

**Backend** define y mantiene los contratos HTTP: métodos, paths, entradas, respuestas y errores de dominio. Realiza validación, autenticación/autorización, reglas de negocio, persistencia y almacenamiento. Los nombres de tablas, consultas, objetos S3, servicios y repositorios no son dependencias del frontend. Los paths y DTO públicos sí lo son. Esta sección expresa la división de trabajo solicitada sin alterar la arquitectura ni prometer que todas las excepciones actuales estén resueltas.

## Hallazgos: acoplamientos, inconsistencias y supuestos

1. El frontend importa únicamente los módulos de dominio puros de cotizaciones (`Backend/src/domain/quoteTotals.js` y `quoteReferenceVat.js`, sin I/O) para la vista previa de importes e IVA, en lugar de duplicar sus fórmulas; no consume repositories ni services. Sí hay dependencia dispersa de paths públicos para avatares en AuthContext, commentDisplay y projectAssigneeDisplay, además del cliente central. La base API se duplica en utils/geoapify.
2. HTTP fuera de `src/api/http.js`: `utils/geoapify.js` (API JSON con errores propios); `config/modelViewer.js` (fetch binario con credentials include); `pages/projects/components/ProjectDocumentPreview.jsx` (tres fetch con signal y credenciales default same-origin para documentos); `components/ui/Gallery/VRModelViewer.jsx` (fetch de modelo/avatar con include). `Panorama360Viewer.jsx` usa TextureLoader sobre item.fileUrl. Imágenes, video, iframe y enlaces también disparan GET nativos; useVideoThumbnail carga video para captura. Mapas Google y assets externos de showcase no son endpoints ARCA.
3. Credenciales de documentos no equivalentes al cliente central: sus fetch funcionan por defecto en mismo origen, pero no envían cookies cross-origin cuando DEV usa API absoluta. Loaders/medios nativos tienen sus propias reglas de cookies/CORS y no normalizan errores JSON.
4. ADMIN UI oculta observaciones, pero `projectCommentRepository` y `environmentCommentAccess` conceden acceso a admin. Es comportamiento existente, distinto de las reglas de presentación documentadas; no se corrigió ni se presentó como prohibición backend.
5. Detalle admite slug; comentarios, eventos, archivos y avatar de arquitecto requieren ID numérico. El frontend debe resolver el detalle antes de esas llamadas. Slug público no significa API anónima.
6. versionId de descarga no selecciona versión histórica. No equiparar cache busting con contrato de versiones.
7. `fields` Zod incluye prefijo body/query/params, pero CreateAccount copia las claves directamente y sus errores locales usan email/phone. Puede fallar la asociación visual de errores Zod; los conflictos por código sí se traducen a campos locales.
8. Shapes distintos: upload vs listado (`fileSize/originalName` y `size/title`), usuario de sesión vs usuario administrativo, solicitud de cliente vs cola de revisión, objeto completo vs mutaciones parciales. PATCH de usuario/solicitud exige payload completo. No asumir sustitución de objetos sin fusión/recarga.
9. apiRequest no valida esquemas de éxito; una respuesta HTML 200 puede producir null y otros consumidores sustituyen arrays ausentes por vacíos. Geoapify y restauración de sesión sí validan su estructura mínima. No todas las respuestas defectuosas se detectan igual.
10. El helper overview tiene clave fallback compartida y TTL sin limpieza explícita; consumidor principal aporta id/email. No existe caché central de todas las lecturas. listAll depende de nextCursor consistente y puede recorrer muchas páginas.
11. SSE no garantiza entrega durable, continuidad en serverless ni revisión de permisos durante toda la conexión. Frontend combina por ID/refresca; eventos no sustituyen las lecturas autorizadas.
12. Los helpers listAll son varias peticiones a endpoints existentes, no endpoints adicionales. `projects.getById` y `projects.listDocumentComments` se usan indirectamente por sus helpers. `projects.listAllComments` también recarga ante SSE. `projects.listAll` no envía scope owned; el backend aplica su default de alcance. `projects.listAllDocumentComments` limita por versión.
13. La validación de comentario documental accede a `selection.normalizedX/Y` sin protección cuando hay fileId/fileVersionId y no hay padre. Con selection ausente/null en esa entrada, el código puede lanzar TypeError y responder error interno en lugar de 400 de validación. Se documenta como inconsistencia, sin cambiar el esquema.

## Rutas backend adicionales y compatibilidad

Sin consumidor frontend actual identificado: GET `/health`, GET `/health/database`; GET `/admin/permissions`, GET `/admin/roles-permissions`, GET/PUT `/admin/roles/:roleCode/permissions`; DELETE `/admin/users/:userId/notes/:noteId` legado. No se eliminan ni se consideran nuevos contratos. El DELETE legado archiva y responde 204; el frontend usa PATCH /archive y recibe message. Permisos usan query includeInactive opcional (true literal), PUT `{permissionCodes:string[]}`, respuestas `{permissions}`, `{roles}` o `{role}` según ruta; requieren admin. Health es público y responde `{status,service}`, database añade timestamp o error 500 (503 durante shutdown). No hay API de listado/download de soporte en la fachada actual.

## Evidencia y archivos revisados

- Reglas: `AGENTS.md`, `Backend/ARCHITECTURE.md`, `Frontend/DESIGN_SYSTEM.md`.
- Frontend: todos los archivos de `src/api`, `src/auth`, `src/config`; búsqueda global de fetch/XMLHttpRequest/EventSource/URLs/loaders y usos `api.*`; `utils/geoapify.js`, `commentDisplay.js`, `projectAssigneeDisplay.js`, `projectImage.js`; consumidores de autenticación, Home, solicitudes, Settings/SupportPanel, ArchitectDashboard, AdminUsersPage/Drawer, ProjectDetailsPage/UploadFilesPanel, ProjectRequestModal, hooks de comentarios y visores enumerados. `Frontend/.env.example`, `vite.config.js`, package.json, tests y scripts existentes se usaron para verificar contrato/ejecución.
- Backend: todos los routers, controladores y esquemas de `src/routes`, `src/controllers`, `src/validation`; `app.js`, middlewares auth/validate/trustedOrigin/sanitizePublicResponse/rateLimit; config auth/cors/adminUsers; errors/appError; utils cookies/authCookies/tokens/pagination/publicPayload/uploadStream/projectFileCache/adminUsers/adminDashboardMetrics/adminDashboardOverview/environmentCommentAccess; servicios y mappers/repositorios de proyecto, archivos, observaciones, solicitudes/workflow, registro, usuario/admin, soporte, caché de sesión y projectEvents. Se inspeccionaron serializaciones y controles de acceso para no confundir datos internos con respuestas HTTP.
- Configuración: nombres/documentación en `Backend/.env.example` (no se copiaron secretos del .env real), `netlify.toml`, `Backend/vercel.json`, scripts package.json.

Variables API relevantes: frontend VITE_API_URL; backend PORT, NODE_ENV, AUTH_TOKEN_SECRET (privado), AUTH_TOKEN_EXPIRES_IN_SECONDS (también vigencia de `user_sessions`), AUTH_COOKIE_*, AUTH_LOGIN_RATE_LIMIT_*, CORS_*, CSRF_ALLOW_NO_ORIGIN, FRONTEND_URL, FILE_UPLOAD_MAX_BYTES, PROFILE_PHOTO_MAX_BYTES, SSE_MAX_CONNECTIONS_PER_USER/PROJECT y límites de acciones. GEOAPIFY_API_KEY (fallback VITE_GEOAPIFY_API_KEY en backend) no forma parte del request frontend. URLs/tokens SMTP de registro/reset se mantienen en backend. FILE_UPLOAD_LIMIT figura en ejemplo, pero el límite efectivo de los streams auditados es MAX_BYTES. ROUTE_AUTH_DISABLED_FOR_TESTS y PUBLIC_TEST_* son excepciones temporales backend que solo se activan con el flag exactamente `true`, NODE_ENV `development` o `test` y sin marcadores de plataforma (VERCEL, VERCEL_ENV, AWS_LAMBDA_FUNCTION_NAME, FUNCTIONS_WORKER_RUNTIME, NETLIFY); cualquier otro valor lo ignora y registra `route_auth_bypass_ignored`; bypass de protección frontend solo está habilitado en DEV y no sustituye la sesión real del servidor.

## Alcance de la verificación

La auditoría contrastó el código con búsquedas de llamadas HTTP, rutas, consumidores y variables, y lecturas de validaciones, controles de acceso y serializaciones. Las inconsistencias descritas permanecen sin corregir; este documento no modifica el comportamiento del sistema.

El resultado de las comprobaciones posteriores a la instalación de dependencias con lockfiles congelados está registrado en [DEVELOPMENT_BASELINE.md](DEVELOPMENT_BASELINE.md). Ese baseline sustituye los resultados iniciales afectados por dependencias incompletas.

No se validaron migraciones, conectividad de base de pruebas, integración con cookies reales, proveedor de almacenamiento, correo ni entrega SSE en despliegues. La auditoría es del contrato implementado en el código local, sin garantizar su operación en servicios remotos.
