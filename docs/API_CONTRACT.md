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

La rama `NODE_ENV=production` es comportamiento técnico del proceso y puede aplicarse al staging; no cambia la clasificación del proyecto. Un frontend y API en sitios distintos necesitan evaluar la política real de cookies del navegador; `credentials: include` por sí solo no elimina SameSite.

El backend acepta también `Authorization: Bearer <token>` y le da prioridad sobre la cookie; el frontend actual no lo envía. El token firmado incluye identidad, rol y expiración. Se vuelve a cargar un usuario activo con permisos y se comprueba antigüedad respecto a su actualización. Cambios de usuario invalidan la caché de sesión; contraseña y avatar propios reemiten cookie. Logout expira la cookie (`204`), sin lista de revocación del token.

El frontend confirma login con `GET /auth/me` y usa exclusivamente ese usuario confirmado. Restauración: solo `401` **con** `code: "UNAUTHENTICATED"` significa cierre definitivo; red, 429 y 5xx permiten dos reintentos (250 y 750 ms más jitter). Otros fallos dejan sesión temporalmente indisponible. No almacena el token en localStorage; usa almacenamiento del navegador para avisos de logout y registro completado. El logout limpia estado local incluso si falla la petición.

`user` de sesión contiene `id:number`, `clientId:number|null`, `email`, `firstName`, `lastName`, `name`, `phone`, `status`, `lastLoginAt`, `updatedAt`, `hasProfilePhoto:boolean`, `role:{id,code,name}`, `permissions:[{id,code,name,description,module}]` y `permissionCodes:string[]`. No contiene `profilePhotoUrl`. AuthContext convierte `role` a su código y conserva el objeto en `roleDetails`; fabrica el avatar con `/auth/profile-photo/image?v=<updatedAt o timestamp>`.

Todas las rutas de negocio consumidas requieren sesión salvo las operaciones públicas señaladas en autenticación. Autorización combina permisos, rol y pertenencia al recurso; un `404` puede ocultar un recurso no accesible. Que `isPublic=true` no elimina autenticación: sirve para ampliar la lectura de proyectos a usuarios autenticados, con archivos de showcase filtrados y sin acceso automático a comentarios.

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

Excepciones a la estructura mínima: rate limit de acciones devuelve además `retryAfter` y cabecera `Retry-After`; login usa el mismo mecanismo con configuración propia (default 5 intentos en 15 minutos). Permisos administrativos no consumidos pueden añadir `missingPermissionCodes`; salud puede añadir `status` y `service`. Los errores centralizados no exponen stack ni mensajes internos PostgreSQL, pero `normalizeError` conserva el `code` original de errores no reconocidos: no se garantiza que todo código sea de dominio.

## Inventario de endpoints frontend

`—` significa sin query/body. Todos los IDs de recursos son enteros positivos salvo el identificador del detalle de proyecto, que acepta ID o slug. En las tablas `P` es query opcional `cursor:string, limit:integer`; ver paginación. `M` significa `{message:string}`. Las respuestas son **HTTP**, antes de transformaciones locales. Se incluyen rutas llamadas por pantallas/hooks y URLs de recursos construidas; los helpers también cuentan como consumo indirecto.

### Autenticación y registro

| Método y path | Request | Éxito | Sesión / errores específicos relevantes |
| --- | --- | --- | --- |
| POST `/auth/login` | `{email,password}`; email válido, password 8–256 | 200 `{user}` + cookie | Pública; 400 validación, 401 INVALID_CREDENTIALS, 409 ACCOUNT_NOT_ACTIVE, 429 |
| GET `/auth/me` | — | 200 `{user}` | Sesión; 401 UNAUTHENTICATED |
| POST `/auth/logout` | Sin body | 204 sin cuerpo + cookie expirada | Pública |
| POST `/auth/registration/start` | `{fullName,email,phone,company?,referralSource}` | 202 M | Pública; 400, 409 EMAIL_ALREADY_EXISTS / PHONE_ALREADY_EXISTS |
| POST `/auth/registration/resend` | `{email}` | 202 M | Pública; 404 REGISTRATION_NOT_FOUND |
| POST `/auth/registration/verify` | `{token}` | 200 `{email,valid:true}` | Pública; 404 INVALID_REGISTRATION_TOKEN |
| POST `/auth/registration/complete` | `{token,password,passwordConfirmation}` | 201 `{user}` + cookie | Pública; 400, 404 INVALID_REGISTRATION_TOKEN, 409 conflictos de correo/teléfono |
| POST `/auth/forgot-password` | `{email}` | 202 M, exista o no cuenta activa | Pública; 400 INVALID_EMAIL, fallo de correo puede ser 500 |
| POST `/auth/verify-reset-token` | `{token}` | 200 `{valid:true}` | Pública; 400 INVALID_RESET_TOKEN, 404 USER_NOT_FOUND |
| POST `/auth/reset-password` | `{token,password}` | 200 M; sin crear sesión | Pública; 400 INVALID_PASSWORD / INVALID_RESET_TOKEN, 404 USER_NOT_FOUND |
| POST `/auth/change-password` | `{currentPassword,newPassword}` | 200 M + cookie renovada | Sesión; 400 INVALID_PASSWORD / PASSWORD_UNCHANGED, 401 CURRENT_PASSWORD_INCORRECT |
| POST `/auth/profile-photo` | Binario; ver archivos | 200 `{user}` + cookie renovada | Sesión; validación de archivo, 404 USER_NOT_FOUND |
| GET `/auth/profile-photo/image` | Query `v` usada por frontend para URL; ignorada por backend | 200 imagen | Sesión; 404 PROFILE_PHOTO_NOT_FOUND |

Registro: fullName 3–300 caracteres, al menos dos palabras; company máximo 150; referralSource `instagram|referred|whatsapp|other`; phone se normaliza a número venezolano `+58` con diez dígitos nacionales. Token de registro 1–2000. Contraseña de registro 8–256, mayúscula, número y especial, confirmación idéntica. Cambio de contraseña aplica 8–256 con esa política y exige diferencia de la actual. Reset recorta la contraseña y exige mínimo 8 y complejidad, **sin máximo explícito en el controlador**; siguen aplicando los límites globales de JSON. Las operaciones de correo/contraseña indicadas pasan por loginRateLimit; avatar no usa ese limitador.

### Proyectos

| Método y path | Request | Éxito | Acceso / códigos relevantes |
| --- | --- | --- | --- |
| GET `/projects` | P; `scope?: accessible|owned` | 200 `{projects:Project[],nextCursor}` | Sesión + projects.read; alcance según rol/propiedad/publicación |
| GET `/projects/:projectId` | ID o slug; `filesCursor?`, `filesLimit?` 1–100 | 200 `{project:ProjectDetail}` | Sesión + projects.read; 404 PROJECT_NOT_FOUND |
| PATCH `/projects/:projectId/publication` | `{isPublic:boolean}` | 200 `{project:Project}` (sin los extras de ProjectDetail) | Sesión + projects.publish y acceso directo; 400 INVALID_PROJECT_ID / INVALID_PUBLICATION_STATE, 404, 409 PROJECT_ARCHIVED |
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
| PUT `/project-requests/:projectRequestId/review` | `{recommendation:approve|reject|changes_requested,note}`; nota 10–2000 | 200 `{review:{id,note,recommendation,updatedAt}}` | Ruta admin/architect; servicio exige arquitecto asignado; 403 PROJECT_REQUEST_REVIEW_FORBIDDEN, 409 PROJECT_REQUEST_CLOSED |

RequestPayload (JSON estricto, rechaza propiedades desconocidas):

| Campo | Valores / restricción actual |
| --- | --- |
| projectName / description | Obligatorios, 3–150 / 30–100 caracteres recortados |
| projectType | residential, commercial, corporate, stands_exhibitions |
| projectLocation | Obligatorio, 5–255; validación manual de texto de dirección |
| projectLocationFormattedAddress / projectLocationProviderPlaceId | Texto o null; máximo 500 / 255; ausentes normalizados a null |
| projectLocationLatitude / projectLocationLongitude | number o null; juntos; −90..90 / −180..180 |
| capitalAvailability | available_now, within_3_months, seeking_financing, undefined (literal string) |
| developmentMode | phased, full, undecided |
| investmentRange | undefined, under_10k, 10k_50k, 50k_150k, over_150k |
| legalDocumentationStatus | available, in_process, unavailable |
| legalDocumentTypes | Array obligatorio, máximo 4, sin duplicados: property_deed, purchase_contract, lease_contract, other. No vacío si available; vacío en otros estados |
| hasMultipleOwners | boolean obligatorio |
| startTime | immediate, 1_3_months, 3_6_months, over_6_months |
| decisionMaker | Opcional/null: self, partner, extended_family, company_board |
| experience | Opcional/null: positive, negative, first_time |
| hasBlueprints | boolean opcional/null; se devuelve como hasPlans |
| landStatus | Opcional/null: available, acquiring, unavailable |
| projectSize | Opcional/null: small_lt_80, medium_80_200, large_200_500, very_large_gt_500, unknown |
| quality | Opcional/null: functional_economic, standard, premium, luxury |
| referenceLink | Texto http/https o null, máximo 500 |

`ProjectRequest`: campos anteriores con diferencias públicas `location` (projectLocation), `formattedAddress`, `providerPlaceId`, `locationCoordinates` y `hasPlans`; añade `id,clientId,requestedBy,status,createdAt,updatedAt,correctionReason,rejectionReason,reviewedAt,convertedProjectId,compatibility`. No devuelve submissionId. Compatibility es null o `{score:number,level,observations:string[]}` (hasta 3). Estados usados por flujo: draft, pending_verification, pending_review, changes_requested, approved, rejected. El frontend debe usar la evaluación devuelta; pesos y persistencia no son contrato HTTP.

`WorkflowRequest` es una proyección distinta: `id,clientId,projectName,projectType,location,description,status,createdAt,updatedAt,correctionReason,rejectionReason,compatibility:{score,level}|null,assignees:[{id,name,roleCode,hasProfilePhoto}],files:[{id,name,fileType}],reviews:[{note,recommendation,reviewer,updatedAt}]`. No equivale a ProjectRequest completo.

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
| PATCH `/admin/users/:userId` | AdminUserInput completo + password? | 200 `{message,user:AdminUser}`; 409 SELF_ACCESS_CHANGE_NOT_ALLOWED, conflictos de correo/teléfono |
| PATCH `/admin/users/:userId/status` | `{status:active|blocked|inactive}` | 200 `{message,user:AdminUser}`; 409 SELF_STATUS_CHANGE_NOT_ALLOWED |
| GET `/admin/users/:userId/notes` | cursor?, limit? 1–25 | 200 `{notes:Note[],nextCursor}`; notas del administrador actual |
| POST `/admin/users/:userId/notes` | `{content}` 1–1000 recortado | 201 `{message,note}`; 404 USER_NOT_FOUND |
| PATCH `/admin/users/:userId/notes/:noteId` | `{content}` 1–1000 | 200 `{message,note}`; 404 NOTE_NOT_FOUND |
| PATCH `/admin/users/:userId/notes/:noteId/archive` | Sin body | 200 M; 404 NOTE_NOT_FOUND |
| GET `/admin/users/:userId/profile-photo` | — | 200 imagen; 404 |
| GET `/admin/assignees/:userId/profile-photo` | — | 200 imagen; 404 |
| PUT `/admin/projects/:projectId/assignees` | `{assigneeIds:number[]}` ≤20 únicos; [] permitido | 200 `{assignees}`; activos elegibles, 400 validación, 404 proyecto, 409 estados de solo lectura |
| PATCH `/admin/projects/bulk-action` | `{action:change_visibility,isPublic:boolean,projectIds}` o `{action:archive|unarchive,projectIds}`; 1–100 IDs únicos | 200 `{projects:[{id,status,isPublic,archived,archivedAt:null}]}`; 400 visibilidad exige completed, desarchivar exige archived; 404 |
| PUT `/admin/project-requests/:projectRequestId/assignees` | `{assigneeIds:number[]}` ≤20 únicos | 200 `{assignees}`; admin/architect activos; pending_verification/pending_review; en revisión conserva arquitecto; 400, 404, 409 PROJECT_REQUEST_CLOSED |
| PATCH `/admin/project-requests/:projectRequestId/decision` | `{action:approve|reject|request_changes,internalNotes?:string|null,reason?}`; reason requerido 10–2000 para rechazo/corrección; internalNotes ≤4000 | 200 `{project:{id,name,status}|null,projectRequest:{id,status,correctionReason,rejectionReason,convertedProjectId,reviewedAt}}`; 404, 409 PROJECT_REQUEST_INVALID_STATE / PROJECT_REQUEST_REVIEW_REQUIRED |

AdminUserInput: `fullName` 3–300 y dos palabras, `email`, `roleCode`, `status` obligatorios; `companyName?` ≤150, `phone?`, `secondaryPhone?` ≤40 con normalización internacional (8–15 dígitos); teléfonos distintos. Aunque use PATCH, la edición exige los campos obligatorios completos. Password opcional **solo en edición**: 8–72, mayúscula/número/especial. Creación genera contraseña aleatoria interna; respuesta no incluye contraseña ni garantiza envío de activación.

AdminUser: `id,name,email,role:{code,name},status,hasProfilePhoto,lastLoginAt,createdAt`. Detail añade `companyName,phone,secondaryPhone,notes,notesTotal,projects:[{id,name}]`. Note: `{id,content,createdAt,updatedAt}`. La fachada añade localmente profilePhotoUrl a listados y actualizaciones.

Metrics: `activeUsers:{total,thisMonth}`, `activeProjects:{total,thisMonth}`, `files:{total,totalBytes,latestUploadAt}`, `requests:{total,today}`, `criticalEvents:{total,latestAt}`. Overview.newRequests contiene `{id,projectName,projectType,status,createdAt,assignees}`; recentActivity `{id:string,createdAt,projectId,projectName,title,userName,userRoleCode}`. Estos arrays son resúmenes limitados, sin cursor; no representan el historial completo.

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

RecentProjectsContext mantiene tres entradas de navegación en sessionStorage por usuario/alcance y deduplica solicitudes concurrentes. Revalida con `/projects?limit=25&scope=owned` para clientes y accessible para otros roles; no comprueba TTL del dato persistido. La caché de sesión backend tiene TTL default 30 s y deduplicación por usuario; los cambios realizados por sus flujos de administración invalidan entradas. Por ello no debe asumirse propagación instantánea de cambios externos a esos flujos.

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

1. No se encontraron imports frontend hacia Backend ni consumo directo de repositories/services. Sí hay dependencia dispersa de paths públicos para avatares en AuthContext, commentDisplay y projectAssigneeDisplay, además del cliente central. La base API se duplica en utils/geoapify.
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

Variables API relevantes: frontend VITE_API_URL; backend PORT, NODE_ENV, AUTH_TOKEN_SECRET (privado), AUTH_TOKEN_EXPIRES_IN_SECONDS, AUTH_TOKEN_CLOCK_TOLERANCE_MS, AUTH_COOKIE_*, AUTH_LOGIN_RATE_LIMIT_*, AUTH_CACHE_*, CORS_*, CSRF_ALLOW_NO_ORIGIN, FRONTEND_URL, FILE_UPLOAD_MAX_BYTES, PROFILE_PHOTO_MAX_BYTES, SSE_MAX_CONNECTIONS_PER_USER/PROJECT y límites de acciones. GEOAPIFY_API_KEY (fallback VITE_GEOAPIFY_API_KEY en backend) no forma parte del request frontend. URLs/tokens SMTP de registro/reset se mantienen en backend. FILE_UPLOAD_LIMIT figura en ejemplo, pero el límite efectivo de los streams auditados es MAX_BYTES. ROUTE_AUTH_DISABLED_FOR_TESTS y PUBLIC_TEST_* son excepciones temporales backend fuera de NODE_ENV production; bypass de protección frontend solo está habilitado en DEV y no sustituye la sesión real del servidor.

## Alcance de la verificación

La auditoría contrastó el código con búsquedas de llamadas HTTP, rutas, consumidores y variables, y lecturas de validaciones, controles de acceso y serializaciones. Las inconsistencias descritas permanecen sin corregir; este documento no modifica el comportamiento del sistema.

El resultado de las comprobaciones posteriores a la instalación de dependencias con lockfiles congelados está registrado en [DEVELOPMENT_BASELINE.md](DEVELOPMENT_BASELINE.md). Ese baseline sustituye los resultados iniciales afectados por dependencias incompletas.

No se validaron migraciones, conectividad de base de pruebas, integración con cookies reales, proveedor de almacenamiento, correo ni entrega SSE en despliegues. La auditoría es del contrato implementado en el código local, sin garantizar su operación en servicios remotos.
