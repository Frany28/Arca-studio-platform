# Arquitectura del backend — ARCA Studio

## Objetivo

El backend es un monolito modular en Node.js 22 y Express 5. PostgreSQL es la fuente de verdad, `pg` ejecuta las consultas, Prisma administra migraciones y un adaptador S3-compatible gestiona archivos. Esta arquitectura debe evolucionar sin duplicar reglas ni acoplar HTTP, negocio y persistencia.

## Flujo de una petición

```text
Cliente
  ↓
Route
  ↓ autenticación, permisos, rate limit y Zod
Controller
  ↓ entrada validada
Service
  ├── Repository → PostgreSQL
  ├── Object storage adapter → S3-compatible
  └── Event bus/cache → implementación local actual
  ↓
Controller → respuesta HTTP
```

### Routes

Las rutas solo componen middlewares y controladores:

```js
router.post(
  "/",
  requireAuth,
  requirePermissions("examples.create"),
  exampleRateLimit,
  validate(createExampleSchema),
  createExample,
);
```

No deben validar manualmente, ejecutar SQL ni contener reglas de negocio.

### Validation

Toda entrada externa se define con Zod en `src/validation`:

```js
export const createExampleSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(150),
  }),
});
```

El middleware `validate` normaliza la entrada. Los errores de validación mantienen esta forma:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Los datos enviados no son válidos.",
  "fields": {
    "body.name": "Required"
  }
}
```

### Controllers

Los controladores conocen HTTP, pero no SQL ni detalles de S3:

```js
export async function createExample(req, res, next) {
  try {
    const example = await exampleService.create({
      payload: req.body,
      user: req.user,
    });
    res.status(201).json({ example });
  } catch (error) {
    next(error);
  }
}
```

Un controlador debe limitarse a recibir datos validados, llamar un servicio y construir la respuesta exitosa.

### Services

Los servicios contienen reglas y coordinan dependencias:

```js
export async function createExample({ payload, user }) {
  const existing = await exampleRepository.findByName(payload.name);
  if (existing) throw new ConflictError("EXAMPLE_EXISTS", "El recurso ya existe.");
  return exampleRepository.create({ payload, userId: user.id });
}
```

Cuando una operación combina almacenamiento y PostgreSQL, el servicio define el orden, compensación y limpieza. Debe preservar el error principal aunque una limpieza secundaria falle.

### Repositories

Los repositorios solo acceden a PostgreSQL:

```js
export async function findExampleById(id) {
  const result = await query(
    "select id, name from public.examples where id = $1 limit 1",
    [id],
  );
  return result.rows[0] || null;
}
```

Reglas:

- parámetros `$1`, `$2`, etc.;
- transacciones con `try/catch/finally` y liberación garantizada;
- sin objetos `req`/`res`;
- sin llamadas S3, correo o APIs externas;
- transformación estable de filas a objetos públicos.

### Errores

Usar los errores de `src/errors/appError.js`:

```js
throw new ValidationError("Datos inválidos.", fields);
throw new NotFoundError("EXAMPLE_NOT_FOUND", "Recurso no encontrado.");
throw new ConflictError("EXAMPLE_CONFLICT", "El recurso ya existe.");
```

El middleware global es el único responsable de convertir errores en HTTP. Los fallos desconocidos responden con un mensaje genérico y se registran sin datos sensibles.

Los errores de disponibilidad de PostgreSQL (pool agotado, cola de espera llena, `53300`, `57014`/`statement_timeout`, conexión perdida) se clasifican en `src/config/databaseErrors.js` y se responden como `503 {code:"DATABASE_UNAVAILABLE", message, retryAfter}` con `Retry-After` (5 s, `DATABASE_RETRY_AFTER_SECONDS`), el mismo formato que el 503 del rate limiter. `appError.js` y `databaseErrors.js` también los importa el frontend a través de los dominios compartidos: no deben usar `process` directamente.

## Archivos

- `fileUploadService` valida nombre, MIME, extensión, tamaño y streaming.
- `objectStorage` encapsula el proveedor S3-compatible.
- Los controladores no deben usar comandos del SDK de AWS.
- No se permiten `Buffer` completos para uploads o descargas grandes.
- Si falla PostgreSQL después de subir, eliminar el objeto solo si su fila no llegó a registrarse (ver «Conservación de archivos guardados»).
- Si falla el almacenamiento, no confirmar la transacción.
- Las cancelaciones deben liberar streams y conexiones.
- Ninguna transferencia retiene una conexión ni un bloqueo: se reserva el id, se transfiere y se registra en una transacción corta que repite estado, acceso, duplicados y límites (`services/storedUpload.js`). La compensación solo elimina el objeto si su fila no existe.
- Adjuntos de solicitudes (`uploadPolicies.projectRequest`): `prepareUpload` comprueba la firma real del contenido y devuelve `ready`, que el servicio espera antes de transferir para responder 415 `INVALID_FILE_SIGNATURE` sin enviar al almacenamiento un flujo fallido. El validador conserva sus errores (firma o cancelación del cliente) con un oyente propio: el contenido llega antes de que el servicio lo lea y el SDK de S3 lo transfiere con `pipe`, que no escucha errores, así que un error sin oyentes terminaría el proceso.
- Política de adjuntos de solicitudes (`uploadPolicies.projectRequest`): JPEG, PNG, PDF, MP4 y MOV (`video/quicktime`, firma por el átomo inicial), con extensión y MIME coincidentes. Límite de 50 MB por archivo (`FILE_UPLOAD_MAX_BYTES`) y de 4,5 MB para vídeos (`maxBytesByType`, `PROJECT_REQUEST_VIDEO_MAX_BYTES`), el cuerpo máximo de una función de Vercel en el staging actual. MP4 y MOV se sirven en línea para su vista previa.
- Un adjunto de solicitud con el mismo nombre (sin distinguir mayúsculas) solo se reutiliza si coincide su tamaño: es el reintento de una subida cuya respuesta se perdió y responde 201 con `reused: true`. Otro contenido con el mismo nombre recibe 409 `DUPLICATE_PROJECT_REQUEST_FILE`; el detalle muestra el nombre normalizado (`file_versions.original_name`) y el cliente no puede detectar ese repetido antes de enviarlo.
- Borradores de solicitud al adjuntar: `POST /api/project-requests` con solo `{ submissionId }` (`createProjectRequestDraftSchema`, elegido en la ruta por `isEmptyProjectRequestDraftBody`) crea un borrador vacío e idempotente por `submissionId` (`createEmptyProjectRequestDraft`, `on conflict do nothing`) para asociar los adjuntos que el formulario sube al seleccionarlos; cualquier otro cuerpo exige la solicitud completa. Los datos se guardan después con `PATCH` (validación completa). Por eso `project_name`, `project_type` y `location` admiten NULL solo en `draft` (`chk_project_requests_identity_after_draft`, migración `20261106120000_project_request_attachment_drafts`), y el envío rechaza con 400 `VALIDATION_ERROR` (`findIncompleteProjectRequestFields`) un borrador sin los datos obligatorios antes de consumir el código. Los borradores no se listan al cliente ni al administrador; uno abandonado conserva sus adjuntos y no se elimina automáticamente (una limpieza masiva requiere autorización expresa).
- Validación temporal del envío (`config/projectRequestTestVerification.js`, decisión del desarrollador para la fase de desarrollo y staging): por defecto la emisión no genera ni envía correo y responde `verification.mode = "test"`, y el envío acepta cualquier código de 6 dígitos sin comprobar vencimiento, intentos ni coincidencia (registra `verified_at`). Se conservan autenticación, CSRF, propiedad, estado editable, validación del formulario e idempotencia del envío. `PROJECT_REQUEST_EMAIL_VERIFICATION=enabled` activa la verificación real por correo, que sigue implementada; debe activarse antes de producción (AGENTS.md §15).
- Aprobar una solicitud (`decideProjectRequest`, en la misma transacción que crea el proyecto) traslada sus adjuntos al proyecto. Las filas, versiones y objetos son los mismos, sin copias en el almacenamiento: `project_id` se asigna, `project_request_id` pasa a `NULL` (`chk_files_owner` exige un único dueño) y `origin_project_request_id` conserva la solicitud de origen. Esa columna viene de la migración `20261110120000_project_request_file_origin`. La solicitud sigue listando esos archivos. En una solicitud `converted`, su ruta de descarga solo los entrega al cliente propietario y al administrador; los arquitectos acceden por el proyecto según su asignación vigente. **Despliegue:** aplicar la migración antes de publicar el backend que la usa, porque el código anterior a ella falla al aprobar solicitudes con adjuntos y el nuevo requiere la columna.
- Las descargas usan `utils/streamResponse.js` (`pipeline`); S3, Resend y Geoapify tienen plazos explícitos (`STORAGE_*`, `EMAIL_REQUEST_TIMEOUT_MS`, `GEOAPIFY_REQUEST_TIMEOUT_MS`).
- La interpretación de referencias guardadas (`file_url`, `profile_photo_url`: URL pública formada, URL firmada o `s3://`) vive en `utils/storageObjectKey.js` como función pura (`describeStorageReference`, `parseStorageObjectKey`). `config/storage.js#getStorageObjectKeyFromFileUrl` la usa con el entorno del backend y el inventario con un destino explícito. `config/storage.js#createSupabaseS3Client` crea clientes con la misma configuración sin leer el entorno.

### Conservación de archivos guardados (B1, Fase 1.2)

Un archivo registrado en PostgreSQL se conserva: archivos de proyecto y adjuntos persistidos de solicitudes, con todas sus versiones y sus objetos del almacenamiento.

- **Nada lo elimina.** Ningún código borra el objeto de un archivo registrado, ni retira el archivo o sus versiones con `status = 'deleted'` o `deleted_at`. Las filas `deleted` anteriores a esta regla se conservan como estaban; el objeto de muchas ya lo había borrado el código anterior y no se puede recuperar.
- **Rutas de eliminación.** `DELETE /api/projects/:projectId/files/:fileId` y `DELETE /api/project-requests/:projectRequestId/files/:fileId` siguen existiendo, con su autenticación, permisos y comprobaciones previas (400, 401, 403, 404 y el 409 de un proyecto de solo lectura). Cuando el usuario podía eliminar el archivo, responden **409 `FILE_DELETION_NOT_ALLOWED`** y no modifican nada. Antes respondían 200 `{deleted:true,fileId}`. La regla vive en `services/storedFileRetentionService.js`; los repositorios `findProjectFileForRemoval` y `findProjectRequestFileForRemoval` solo leen.
- **Cargas fallidas.** La compensación (`services/storedUpload.js`, `storeThenRecord` y `discardUnrecordedObject`) se mantiene: antes de borrar el objeto de una carga fallida comprueba con una consulta nueva si su fila existe. Si la fila existe (COMMIT de resultado incierto), o si no se puede comprobar, el objeto se conserva y se registra como `storage_orphan_candidate`. Los scripts de subida (`upload-project-images-and-clear-comments`, `upload-project-videos`, `upload-project-panorama`) aplican la misma comprobación por clave de objeto (`scripts/lib/discardUnrecordedScriptObjects.mjs`, `isFileVersionObjectRecorded`).
- **Scripts.** `cleanup-legacy-models.mjs` está bloqueado: termina con error sin cargar `.env` ni conectar con PostgreSQL o el almacenamiento. Una limpieza de objetos sin registro (A7) necesita un plan propio, revisado y autorizado.
- **Únicas vías de borrado de objetos.** Una prueba estática (`tests/storedFileRetention.test.js`) limita `objectStorage.delete` y los comandos `DeleteObject` a `objectStorage.js` (definición), `storedUpload.js` (compensación) y `authController.js` (foto de perfil). También comprueba que ningún código retire filas de `files` o `file_versions`.
- **Foto de perfil (decisión pendiente).** Al reemplazarla se borra el objeto anterior, y si falla la actualización de `users` se borra el nuevo sin comprobar el resultado de la escritura. Su tratamiento (conservar o no las fotos anteriores y aplicar la compensación verificada) se decidirá en una entrega específica.
- **Pendiente de decisión.** El archivado, la reactivación y sus efectos sobre las audiencias no forman parte de esta regla.
- **Frontend.** Las tarjetas de archivos ya guardados no ofrecen quitarlos. Solo se cancela la selección que todavía no se guardó (pendiente, en curso o fallida). Cancelar una carga en curso puede llegar tarde si el servidor ya la registró; el panel del proyecto recarga sus archivos para mostrarla.

### Inventario de almacenamiento de solo lectura (E0, Fase 1.2)

Comando de mantenimiento `scripts/storage-inventory.mjs` que contrasta las referencias de PostgreSQL con los objetos del almacenamiento para confirmar la privacidad de los buckets y detectar objetos sin referencia. **No forma parte del runtime HTTP, no tiene endpoint y no se ejecuta en despliegues.**

- **Capas**: `domain/storageInventory.js` (normalización, comparación, huérfanos, privacidad y redacción del informe; puro) → `repositories/storageInventoryRepository.js` (lecturas sobre un cliente inyectado) → `services/storageInventoryService.js` (orquestación). El acceso a S3 pasa por `services/objectStorage.js#createReadOnlyStorageInspector`.
- **Solo lectura, con dos barreras por medio**:
  - PostgreSQL: transacción `REPEATABLE READ READ ONLY` que termina siempre con `ROLLBACK`, `statement_timeout`/`lock_timeout`/`idle_in_transaction_session_timeout` locales y una guardia en el cliente (`assertReadOnlyInventoryStatement`) que solo admite `SELECT` y el control de esa transacción. Cada fuente se lee dentro de un punto de guardado: un fallo de permisos o de tabla deja esa fuente como fallida sin abortar las demás.
  - **RLS**: las tablas de ARCA tienen Row Level Security activo y sin políticas, de modo que un rol que no sea propietario, superusuario ni `BYPASSRLS` lee **cero filas sin error**. Antes de leer, `readRowSecurityExposure` consulta el catálogo (`pg_class`, `pg_roles`) para cada tabla de cada fuente, incluidas las de los JOIN, y para `storage.buckets`; una tabla filtrada deja su fuente como fallida (`ROW_LEVEL_SECURITY_FILTERS_ROWS`) sin leerla, para no convertir objetos válidos en falsos huérfanos. Un rol de solo lectura para este inventario necesita `SELECT` sobre esas tablas y `BYPASSRLS` (o políticas de lectura equivalentes).
  - Almacenamiento: el inspector solo expone `listPage` (ListObjectsV2) y `headObject` (HeadObject), y una lista blanca (`assertReadOnlyStorageCommand`) rechaza cualquier otro comando antes de enviarlo. No se descarga contenido.
- **Destino explícito**: el comando no importa `dotenv/config` ni `config/db.js`. Lee únicamente el archivo de `--env-file`, que debe estar **fuera del repositorio** (se rechaza `Backend/.env`). Antes de cualquier conexión exige `--confirm-database <base@host>`, `--confirm-storage <host>` y `--confirm-buckets` con todos los buckets configurados; `--describe-target` muestra esos valores sin credenciales ni conectar.
- **Fuentes de referencias**: `file_versions` (`file_name` y contraste con `file_url`), `support_request_files` (`storage_key` y `file_url`), `users` (`profile_photo_url`, `signature_url`) y `quote_pdf_documents` (`object_key`, en el bucket privado de cotizaciones). Todas se leen completas con paginación por id; los buckets se listan hasta agotar el token de continuación.
- **Resultados**: separa confirmados (presentes, filas activas sin objeto confirmadas con HEAD 404, tamaños y URLs incoherentes, referencias duplicadas), inaccesibles (HEAD con error) y comprobaciones incompletas (fuente fallida, listado interrumpido, privacidad sin confirmar, límite de HEAD). La privacidad solo se confirma con `storage.buckets.public = false`.
- **Huérfanos**: solo se concluyen en un bucket con listado completo y todas sus fuentes leídas. Un objeto sin referencia es un **candidato a revisión**, nunca una autorización para borrarlo; los objetos referenciados solo por filas eliminadas se informan aparte. Los marcadores de carpeta de Supabase se cuentan aparte.
- **Bucket público**: se informa como hallazgo crítico con su impacto por contexto y un procedimiento de corrección documentado (`PUBLIC_BUCKET_CORRECTION_PROCEDURE`) que el comando **no ejecuta**. Con `--accepted-public-buckets <bucket[,bucket]>` (solo buckets configurados) el responsable registra que la publicidad está aceptada para ese entorno, por ejemplo uno de pruebas: el informe la conserva en `environment` y `publicAccepted`, con su impacto, pero no la cuenta como crítica. No cambia ninguna configuración remota.
- **Privacidad del informe**: se guarda fuera del repositorio (`~/ARCA_PRIVATE_BACKUPS/storage-inventory/` por defecto; se rechaza una ruta dentro). No contiene claves completas, nombres de archivo, URLs, credenciales ni mensajes del proveedor: cada objeto aparece con la huella SHA-256 truncada de `bucket + clave`, la forma de la clave (`projects/<n>/…/<archivo>.pdf`), tamaño, fecha e ids de fila.
- **Códigos de salida**: 0 completo sin hallazgos críticos; 2 completo con hallazgos críticos; 3 incompleto; 1 error o destino no confirmado.
- Pruebas con servicios simulados: `tests/storageInventory.test.js`, `tests/storageInventoryTarget.test.js` y `tests/storageInventoryCommand.test.js` (subproceso con un destino ficticio cerrado). `tests/storageInventoryS3.test.js` usa el SDK real contra un servidor HTTP local que imita S3: HEAD 404 es ausencia confirmada; 403, 400 y 500 son inaccesibles; un listado con 403 deja el bucket incompleto. `tests/storageInventory.integration.test.js` (opcional: `ARCA_STORAGE_INVENTORY_DB_TESTS=1` y `ARCA_STORAGE_INVENTORY_TEST_DATABASE_URL` local) aplica todas las migraciones en una base desechable y comprueba consultas reales, rol de solo lectura, RLS, escritura rechazada por el servidor (25006), permisos denegados (42501), `lock_timeout` (55P03), cierre de sesiones y el comando completo. Su ejecución contra un entorno real requiere autorización expresa.

### Catálogos de archivos y carpetas (E1, Fase 1.2)

Dominio puro. El catálogo de carpetas participa en las altas de proyectos (ver la sección siguiente), en el nombre visible del listado y en la creación de carpetas personalizadas; los contextos de archivos todavía no están conectados. Separa cuatro conceptos: ubicación visible (nombres), clasificación funcional (claves y secciones), clave física (diagnóstico, nunca organiza ni concede acceso) y permisos (fuera de estos módulos).

- `domain/fileContexts.js`: los cinco contextos existentes (`project_file`, `project_request_attachment`, `profile_photo`, `support_attachment`, `quote_pdf`) con entidad propietaria, quién aporta el archivo, registro en PostgreSQL, bucket, prefijo de clave actual y política de subida. `ownerChain` define la ubicación visible con entidades nombradas (cliente › proyecto › carpetas; usuario; cliente › solicitud; usuario › soporte; cliente › cotización). `describeVisibleLocation` devuelve etiquetas legibles con sus ids internos y, si falta un nombre, lo informa en lugar de mostrar un número. `findAmbiguousLabels` detecta nombres repetidos sin fijar cómo distinguirlos (D12). `resolveFilesRowContext` aplica la regla de `chk_files_owner`.
- `domain/projectFolderCatalog.js`: 18 carpetas predeterminadas (Figma 3727:618978 y 3727:682730 más las reglas confirmadas), en su orden, con clave funcional estable (`renders.images.execution`), nombre visible, sección y fase. Reglas confirmadas:
  - la clave clasifica y nunca cambia, aunque cambie el nombre visible. `renders.models` (y sus subcarpetas) se muestra como **«Panorámicas»** y contiene imágenes de 360°; conserva la clave y la sección `models_3d` de «Modelos 3D»;
  - los documentos de garantías se guardan en **«Documentos › Garantías»** (`documents.warranties`, `WARRANTY_DOCUMENTS_FOLDER_KEY`, sección `warranties`), después de «Propuesta inicial»;
  - las predeterminadas no se renombran, eliminan ni mueven, y toda carpeta con clave funcional está protegida aunque su clave salga del catálogo (igual que la API);
  - la portada admite una sola imagen JPG o PNG, sin subcarpetas, y se reemplaza;
  - las personalizadas se crean dentro de cualquier otra carpeta salvo la portada, se renombran y solo se eliminan vacías;
  - nombres de 1 a 120 caracteres, únicos entre hermanas sin distinguir mayúsculas;
  - la sección se hereda de la carpeta predeterminada más cercana, nunca del nombre visible;
  - el nombre visible de una carpeta predeterminada sale del catálogo (`resolveFolderDisplayName`), así un proyecto que guardó «Modelos 3D» se muestra como «Panorámicas» sin migrar datos;
  - las colisiones de nombre con carpetas existentes se informan sin adoptarlas.
- Lo que depende de una decisión abierta se devuelve como `pending_decision` con su identificador (`FOLDER_PENDING_DECISIONS`): D2 («Antes»), D7 (carpetas personalizadas en la raíz), D13 (mover carpetas personalizadas) y D14 (contenido admitido por carpeta, salvo la portada). D1 y D6 están resueltas.
- Pruebas: `tests/fileContexts.test.js` (contrasta políticas y prefijos con el código actual) y `tests/projectFolderCatalog.test.js` (árbol, «Panorámicas», «Garantías», coherencia, inmutabilidad, protección, nombre visible y decisiones pendientes).

### Dominio de archivos: conservación, revisión, versiones y audiencias (B2, Fase 1.2)

Dominio puro, sin PostgreSQL ni almacenamiento. La conservación ya se aplica (`storedUpload` y `storedFileRetentionService` consultan la regla); revisión, versiones, audiencias y garantías todavía no los usa ningún flujo y no cambian comportamiento. Clasificación (carpeta), aprobación (versión) y visibilidad (audiencias) son independientes.

- `domain/projectFileDecisions.js`: registro de decisiones abiertas (`FILE_PENDING_DECISIONS`): DA1 (archivado y sus efectos) y DA4 (restricciones nuevas por estado del proyecto: D10 y D8). DA2, DA3 y DA5 se resolvieron en B4, y D3 y D4 en B5 (`FILE_CONFIRMED_RULES`). `pendingFileDecision` rechaza identificadores no registrados. Un resultado `pending_decision` no autoriza ni prohíbe nada: el flujo que lo reciba debe esperar la decisión.
- `domain/projectFileRetention.js` (`evaluateStoredFileOperation`): borrar el objeto, borrar una versión o retirar un archivo guardado está prohibido; cancelar una selección sin enviar está permitido; descartar un objeto solo si se comprobó que no tiene registro (registrado o sin verificar: se conserva); archivar y reactivar dependen de DA1.
- `domain/projectFileReview.js`:
  - estados `pending`, `approved` y `rejected`; una versión se revisa una sola vez y el rechazo exige motivo (hasta 500 caracteres: PR4, confirmada en B4). Las versiones heredadas (sin estado) cuentan como vigentes y no se revisan;
  - versión vigente: la aprobada o heredada de mayor número (`resolveCurrentVersion`); una pendiente o rechazada nunca la desplaza;
  - `planNewVersion`: reemplazar y restaurar crean una versión nueva con motivo del cambio (hasta 255, como `change_note`), con el número siguiente y como máximo una pendiente por archivo (PR1, confirmada en B4). Restaurar solo admite una versión aprobada (PR2, confirmada en B4) y **reutiliza su objeto** (`storage.mode = "reuse_object"`), conservando todo el historial;
  - solo el administrador aprueba y rechaza (DA5, confirmada en B4) y toda versión nueva nace pendiente, también la del administrador y la del cliente (DA2, confirmada en B4).
- `domain/projectFileAccess.js` (`evaluateFileVersionAccess`):
  - política heredada (`accessPolicy` NULL): reproduce el acceso actual (solo la versión vigente; administrador siempre; equipo y propietario fuera de draft; imágenes y videos de proyectos públicos, anonimizados);
  - política 1.2: el equipo ve todas las versiones; el cliente propietario, la compartida (`clientVersionId`); las compartidas antes no dan acceso (D4, confirmada en B5); el escaparate, solo la versión autorizada de una imagen o video de un proyecto público finalizado, anonimizada;
  - **regla unificada de versiones pendientes y rechazadas**: las ve quien tiene acceso de equipo (`hasProjectStaffAccess`: administrador, también en draft; arquitecto asignado o responsable fuera de draft) o su autor mientras conserve el acceso al proyecto. Lo público nunca da acceso de equipo y un draft no existe para quien no es administrador;
  - archivos archivados: DA1; retirados heredados: sin acceso;
  - `evaluateFileAudienceChange`: solo el administrador comparte o autoriza el escaparate (D3), con una versión aprobada (AU2); el escaparate exige además proyecto público finalizado e imagen o video, y es independiente del cliente (AU1). Aprobar no comparte nada (`resolveClientAudienceOnApproval`, DA3 confirmada en B4). La propuesta PR3 se retiró en B5.
- `domain/projectWarrantyDocuments.js`: un documento de garantía vive en «Documentos › Garantías» (o en una subcarpeta suya) y se vincula solo con garantías vigentes del mismo proyecto; puede respaldar varias. Mientras tenga vínculos no sale de esa ubicación. Se resuelve con la política común: el equipo recibe la versión vigente y el cliente, la compartida; sin versión compartida o tras retirar el acceso, la garantía sigue visible y el documento se omite. El escaparate nunca lo expone. Retirar una garantía conserva sus vínculos como historial.
- **Reglas confirmadas en B4** (`FILE_CONFIRMED_RULES`): PR1 (una sola versión pendiente por archivo), PR2 (restaurar exige una versión aprobada; restaurar la vigente no se prohíbe), PR4 (motivo de rechazo de hasta 500 caracteres), DA2, DA3 y DA5; en B5, D3, D4, AU1 y AU2. **Propuestas sin confirmar** (`FILE_PROPOSED_RULES`, resultado marcado con `proposal`): PR5 (reemplazan y restauran el equipo o el autor del archivo) y PR6 (una sola versión activa en el escaparate: autorizar otra sustituye la anterior). PostgreSQL no impone ninguna propuesta.
- Pruebas: `tests/projectFileDomain.test.js`.

### Expansión estructural: revisión, versiones, audiencias y garantías (B3, Fase 1.2)

Migración aditiva `20261118120000_project_file_review_audience_expand`. Checksum que registra Prisma: `405291f62106b4216aff8929814524d5d7fc4da8eb619a4909a289a883848ac2`. Se verificó con `prisma migrate deploy` (Prisma 7.8) sobre una base local desechable, desde una copia sin `.env`: el valor registrado coincide con el SHA-256 de los bytes en LF. `.gitattributes` fija `eol=lf` para este archivo (`git check-attr`: `eol: lf`). Preflight y postcheck de solo lectura en `prisma/checks/20261118120000_project_file_review_audience_expand/`.

**Sin activación.** Solo añade estructura: no escribe ni modifica filas y el backend actual no la usa. Las columnas nuevas son anulables y sin valor por defecto; las tablas nuevas quedan vacías.

| Comportamiento | Estructura | Restricciones (reglas confirmadas) |
|---|---|---|
| Revisión de versiones | `file_versions.review_status` (enum `file_version_review_status`: `pending`, `approved`, `rejected`; NULL = heredada), `reviewed_by` (FK `users`), `reviewed_at`, `review_reason` (`TEXT`) | `chk_file_versions_review_state`: heredada o pendiente sin datos de revisión; revisada con fecha; **rechazada con motivo** no vacío. Aprobar admite comentario. La expresión va envuelta en `IS TRUE`: un CHECK que evalúa a NULL se acepta y `review_status = ...` es NULL en una versión heredada, así que sin ello una heredada con fecha, revisor o motivo pasaría. El postcheck lo comprueba (`ok_review_state_null_safe`). Índice `idx_file_versions_review_queue` (no único) para «Pendientes» y «Rechazados» |
| Formato propio de cada versión | `file_versions.content_type` | No vacío si se informa. Las versiones anteriores quedan en NULL y se sirven con `files.file_type`, como hoy |
| Restaurar reutilizando el objeto | `file_versions.restored_from_version_id` | `fk_file_versions_restored_from` `(restored_from_version_id, file_id)` → `(id, file_id)`: solo otra versión **del mismo archivo**; `chk_file_versions_restored_from_other`. El objeto se reutiliza con la misma clave (`file_name` no es único) |
| Coexistencia con la regla actual | `files.access_policy` (NULL = heredada exacta; 1 = Fase 1.2) | `chk_files_access_policy` |
| Autorizaciones de audiencia | Tabla `project_file_audience_grants`: `audience` (`client_owner`, `showcase`), versión, `granted_by/at`, `ended_by/at`, `end_reason` (`superseded`, `revoked`) | FK compuestas: versión del mismo archivo y archivo del mismo proyecto (un adjunto de solicitud no se autoriza). `chk_project_file_audience_grants_end`. **Una autorización activa del cliente por archivo** (`uq_project_file_audience_grants_client_active`) |
| Documentos de garantía | Tabla `project_warranty_documents` (vínculo, `linked_by/at`, `unlinked_by/at`) | FK compuestas `(warranty_id, project_id)` y `(file_id, project_id)`: **mismo proyecto**. Un vínculo activo por garantía y documento; un documento puede tener varias garantías; desvincular conserva la fila |
| Claves compuestas necesarias | `uq_files_id_project`, `uq_file_versions_id_file`, `uq_project_warranties_id_project` | Triviales: `id` ya es clave primaria |

- **D4 en el modelo.** El historial de autorizaciones distingue una versión **sustituida** al compartir otra (`superseded`) de un acceso **revocado** (`revoked`). Si D4 es «no», el cliente recibe solo la autorización activa; si es «sí», también las sustituidas sin una revocación posterior. Ambas respuestas se aplican sin cambiar el esquema.
- **Cliente y escaparate independientes.** Son filas distintas de la misma tabla; ninguna restricción relaciona una audiencia con la otra.
- **No se imponen (dependen de decisiones o propuestas pendientes):** una sola versión pendiente por archivo (PR1); restaurar solo versiones aprobadas (PR2); que el escaparate exija una autorización del cliente (PR3) o una sola versión en el escaparate; la longitud del motivo de rechazo (PR4); que una autorización exija una versión aprobada; columnas de archivado (DA1); origen de una aprobación automática (DA2); quién revisa (DA5). El postcheck comprueba que ningún índice único imponga PR1 ni el escaparate.
- **Primera versión pendiente.** No requiere modificar restricciones existentes: `files.current_version` ya admite NULL y `uq_file_versions_current` solo limita a una vigente por archivo. Requisito para la activación: `file_versions.is_current` tiene `DEFAULT true`, así que el código nuevo debe insertar `false` explícitamente en una versión pendiente. El ensayo inserta una primera versión pendiente (`current_version` NULL) y una pendiente junto a la vigente sin cambios de esquema.
- **Requisito de garantías.** `replaceProjectWarranties` marca como retiradas y vuelve a insertar todas las garantías en cada guardado. Antes de crear vínculos, la entrega de garantías debe actualizarlas por id; si no, los vínculos quedarían en garantías retiradas.
- **Compatibilidad del backend actual.** Sus `INSERT` y `SELECT` usan columnas explícitas: las filas nuevas quedan con `access_policy` y los datos de revisión en NULL (heredadas). Un archivo de solicitud sigue pudiendo pasar al proyecto (cambia `project_id`) mientras no tenga autorizaciones ni vínculos. Las integraciones del ciclo HTTP, carpetas, cotizaciones, inventario y migraciones anteriores se ejecutan con esta migración aplicada.
- **Bloqueos esperados.** `ACCESS EXCLUSIVE` breve sobre `files`, `file_versions` y `project_warranties`: las columnas nuevas solo cambian metadatos, pero las restricciones `UNIQUE` y `CHECK` recorren sus filas. Las claves foráneas toman `SHARE ROW EXCLUSIVE` sobre `projects`, `users`, `files`, `file_versions` y `project_warranties`. La migración fija `lock_timeout = 3s` y `statement_timeout = 60s` dentro de su transacción.
- **Rollback.** La migración es una sola transacción: cualquier fallo la revierte entera. El ensayo lo comprueba con un objeto preexistente que hace fallar una sentencia intermedia (42710) y con una transacción abierta sobre `files` que agota `lock_timeout` (55P03). En ambos casos no queda ni la columna, ni los tipos, ni las tablas; después, la misma migración se aplica completa. Si Prisma la registra como fallida, se diagnostica y se marca con `prisma migrate resolve --rolled-back` antes de reintentar. Revertir una migración ya aplicada requiere una migración nueva hacia delante.
- **Procedimiento (sin autorización todavía para entornos compartidos).** Respaldo con `pg_dump` y restauración de prueba en una base desechable; preflight; ventana con tráfico pausado; `prisma migrate deploy`; postcheck; reapertura. Aplicarla con el backend actual es seguro, porque no la usa.
- **Detener la operación si:** algún `ok_*` del preflight o del postcheck es falso; hay más de una migración pendiente o alguna sin terminar; hay otras transacciones abiertas al empezar; se agota `lock_timeout` o `statement_timeout`; el checksum registrado no es `405291f6…`; las huellas de `files`, `file_versions` o `project_warranties` difieren entre preflight y postcheck; o las tablas nuevas no están vacías, sin RLS o con privilegios para PUBLIC o los roles de la API.
- Pruebas: `tests/projectFileReviewExpansion.integration.test.js` (opcional: `ARCA_FILE_REVIEW_EXPANSION_DB_TESTS=1` y `ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL` local). Cubre preflight y postcheck, huellas, checksum, compatibilidad, primera versión pendiente, estados de revisión (con una regresión de 18 combinaciones válidas e inválidas para versiones heredadas, pendientes, aprobadas y rechazadas, incluida una heredada con fecha de revisión), restauración, autorizaciones, vínculos de garantías y rollback.


### Carpetas predeterminadas en proyectos draft nuevos (Fase 1.2)

Migración aditiva `20261117120000_project_folder_system_keys`. Checksum que registrará Prisma: `d71840d8b0837aae5b0427ff0555380c452d88060102b633082f869c8e67cefd`.

**Cómo se verificó el checksum.** Prisma registra en `_prisma_migrations.checksum` el SHA-256 de los bytes exactos de `migration.sql` en el disco, sin normalizar finales de línea. Se comprobó con `prisma migrate deploy` (Prisma 7.8) sobre una base local desechable. El valor registrado coincidió con el del archivo en disco, tanto para esta migración (LF) como para `20261113120000_project_draft_configuration` (copia CRLF, `7e5aa94…`).

- **Bytes fijos.** El repositorio usa `* text=auto` y esta máquina `core.autocrlf=true`: una extracción en Windows convertiría el archivo a CRLF y su checksum pasaría a ser `ee6f2484c6cfea5da3435e292844c3963f545e22554fdccea7bfa144018f78e4`. Por eso `.gitattributes` fija `eol=lf` solo para este archivo: cualquier extracción, en cualquier sistema, produce `d71840d8…`. Las migraciones históricas no se tocan, porque su checksum registrado corresponde a la copia con la que se aplicaron.
- **Prisma no lo comprueba.** `migrate deploy` y `migrate status` no validan el checksum de una migración ya aplicada: no avisaron ni con CRLF ni con un cambio real de contenido. Solo `migrate dev` lo hace, y no debe ejecutarse contra bases compartidas. La única comprobación es el postcheck, que muestra `recorded_checksum`; antes de reabrir el servicio debe coincidir con `d71840d8…`.
- **Migraciones futuras.** Añadir su propia línea `eol=lf` en `.gitattributes` y documentar su checksum de la misma forma.

Contenido:

- `project_folders.system_key VARCHAR(80)` anulable, sin valor por defecto: clave funcional de una carpeta predeterminada; `NULL` en las personalizadas.
- `chk_project_folders_system_key_format`: formato de la clave (igual que `SYSTEM_FOLDER_KEY_PATTERN`).
- `chk_project_folders_system_not_deleted`: una carpeta con `system_key` no puede tener `deleted_at` (impide su borrado lógico por cualquier vía).
- `uq_project_folders_system_key`: índice único parcial `(project_id, system_key) WHERE system_key IS NOT NULL AND deleted_at IS NULL`, que actúa de árbitro de la creación idempotente.

No modifica filas: las carpetas existentes quedan como personalizadas y los proyectos existentes no reciben carpetas. Preflight y postcheck de solo lectura en `prisma/checks/20261117120000_project_folder_system_keys/` (la huella de `project_folders` sin la columna nueva debe coincidir). Despliegue: aplicar la migración antes de publicar el backend que la usa; el backend anterior funciona con ella, porque la columna es anulable y no se exige.

- **Operación compartida**: `repositories/projectSystemFolderRepository.js#ensureProjectSystemFolders(client, { projectId, createdBy })`, dentro de la transacción que crea el proyecto:
  1. bloquea el proyecto `FOR UPDATE`, lo que serializa ejecuciones simultáneas;
  2. inserta el catálogo nivel a nivel (una sentencia por profundidad, madres antes que hijas, orden de Figma) con `ON CONFLICT … DO NOTHING` sobre `uq_project_folders_system_key`;
  3. comprueba que cada clave exista con su madre. Si no, lanza `PROJECT_SYSTEM_FOLDERS_INCONSISTENT` y la transacción se revierte.

  Los nombres visibles proceden del catálogo; las relaciones usan las claves. No adopta ni renombra carpetas existentes: un nombre que colisiona con una personalizada falla por `uq_project_folders_sibling_name`, lo que no ocurre en un proyecto nuevo.
- **Integración**: `projectService.createDraftProject`, que cubre la creación desde una cotización y el alta manual, y `projectRequestWorkflowRepository.decideProjectRequest` (aprobación), justo después de insertar el proyecto. Un fallo en las carpetas revierte proyecto, cotización, decisión y auditoría.
- **Protección: qué la garantiza exactamente.**

  | Operación sobre una carpeta predeterminada | Aplicación | PostgreSQL | Prueba |
  |---|---|---|---|
  | Renombrar (`PATCH …/folders/:folderId`) | 409 `PROJECT_FOLDER_PROTECTED` para cualquier carpeta con `system_key`, aunque la clave ya no esté en el catálogo | **No lo impide**: un `UPDATE` directo puede cambiar `name` | integración: servicio y HTTP |
  | Eliminar (`DELETE …/folders/:folderId`, borrado lógico) | 409 `PROJECT_FOLDER_PROTECTED`, también si está vacía | `chk_project_folders_system_not_deleted` rechaza `deleted_at` no nulo (23514) | integración: servicio, HTTP y `UPDATE` directo |
  | Mover (cambiar `parent_id`) | La API no tiene ninguna ruta para mover carpetas (`PATCH` solo acepta `{name}`) | **No lo impide** | — |
  | Cambiar o quitar `system_key` | La API no lo expone | Solo `chk_project_folders_system_key_format` (formato); poner `NULL` o cambiar la clave **no se impide** | integración: formato inválido (23514) |
  | Dos carpetas activas con la misma clave en un proyecto | `ensureProjectSystemFolders` usa `ON CONFLICT DO NOTHING` | `uq_project_folders_system_key` (23505) | integración: repetición, concurrencia e `INSERT` directo |
  | Borrado físico (`DELETE FROM`) | La aplicación nunca borra carpetas físicamente | Solo las FK existentes (subcarpetas o archivos que la referencien) | — |

  Las garantías de PostgreSQL cubren cualquier vía de escritura. Las de la aplicación solo cubren las rutas HTTP: un script o una sentencia directa puede renombrar, mover o quitar la clave de una carpeta predeterminada. Cerrar esos casos en PostgreSQL (por ejemplo, con un disparador que haga inmutables `name`, `parent_id` y `system_key` de las carpetas con clave) requeriría una migración nueva.
- **Orden de lectura**: `listProjectFolders` devuelve las carpetas en preorden del árbol (`orderFolderTree`): cada carpeta precede a sus descendientes; entre hermanas van primero las predeterminadas en el orden del catálogo, luego las de claves retiradas por clave y después las personalizadas por nombre normalizado (minúsculas y comparación por puntos de código, sin depender de la intercalación de PostgreSQL) y por id. Las carpetas con una madre ausente o en un ciclo se conservan al final.
- El listado añade `systemKey` y muestra el nombre del catálogo en las predeterminadas («Panorámicas» aunque la fila guarde «Modelos 3D»).
- **Catálogo B2**: los drafts nuevos nacen con 18 carpetas, incluidas «Panorámicas» (`renders.models`) y «Documentos › Garantías» (`documents.warranties`). Los proyectos creados con el catálogo anterior (17) no reciben «Garantías» hasta el comando de compatibilidad; `ensureProjectSystemFolders` la añadiría sin tocar las demás si se ejecutara sobre ellos.
- **Crear carpetas personalizadas** (regla confirmada): dentro de cualquier carpeta salvo la portada, que responde 409 `PROJECT_FOLDER_SUBFOLDERS_NOT_ALLOWED`. La raíz sigue admitiéndolas como hasta ahora, a la espera de D7.
- **Sin cambios (dependen de decisiones abiertas)**:
  - mover carpetas personalizadas (D13; la API no tiene esa ruta);
  - el contenido admitido por carpeta (D14), incluida la regla de la portada, que no se aplica todavía a las subidas;
  - la ubicación de los adjuntos heredados de la solicitud, que siguen sin carpeta (`folder_id` NULL).
- **Añadir una carpeta predeterminada más adelante**:
  1. incorporarla a `PROJECT_SYSTEM_FOLDERS` con una clave nueva y definitiva, derivada de la de su madre (las pruebas del catálogo exigen coherencia, y la del árbol exige actualizar `FIGMA_TREE`). Nunca reutilizar ni renombrar una clave existente; para cambiar solo el nombre visible basta con cambiar `name` (así se hizo con «Panorámicas»);
  2. los proyectos creados después la reciben automáticamente;
  3. los existentes no: necesitan un comando de mantenimiento revisable, con `ensureProjectSystemFolders` por proyecto, informe de colisiones de nombre (`findSystemFolderNameCollisions`) y confirmación explícita, sin adoptar carpetas por nombre;
  4. retirar una carpeta del catálogo no borra filas: la verificación ignora las claves retiradas, la API las sigue protegiendo y PostgreSQL impide su borrado lógico.
- Pruebas: `tests/projectSystemFolders.test.js` (operación con simulación) y `tests/projectSystemFolders.integration.test.js`. Esta última es opcional (`ARCA_PROJECT_FOLDERS_DB_TESTS=1` y `ARCA_PROJECT_FOLDERS_TEST_DATABASE_URL` local) y comprueba preflight, migración y postcheck, las tres rutas, repetición, concurrencia, rollback y protección.

### Versiones y revisión de archivos de proyecto (B4, Fase 1.2)

**Activación coordinada.** `PROJECT_FILE_REVIEW_ENABLED=true` expresa la intención; no habilita SQL ni rutas por sí sola. `middlewares/projectFileReview.js#loadProjectFileReviewActivation` resuelve el estado efectivo antes de los routers de la API. `services/projectFileReviewActivationService.js` exige historial terminado, no revertido y con checksum exacto de las migraciones `20261117120000`, `20261118120000` y `20261119120000`, sin intentos pendientes, además de las columnas, valores de enums, restricciones validadas e índices válidos/necesarios del catálogo PostgreSQL. La lista de dependencias vive en `config/projectFileReviewSchema.js` y sus lecturas en `repositories/projectFileReviewSchemaRepository.js`.

El estado efectivo se fija con `AsyncLocalStorage` (`config/projectFileReview.js`) para toda la petición y sus operaciones asíncronas: rutas, consultas, descargas, comentarios y eventos usan el mismo resultado aunque otra petición haga una comprobación distinta. Fuera de ese contexto está apagado; una operación interna que necesite revisión debe comprobar primero `resolveProjectFileReviewActivation()` y ejecutar su trabajo en `withProjectFileReviewState`.

La caché de disponibilidad tiene una sola clave por instancia/pool, positivos de 30 s y negativos de 5 s; deduplica comprobaciones simultáneas, se invalida al observar la intención apagada y expira para detectar migraciones aplicadas. No contiene datos de usuarios y no almacena errores. Si el esquema/historial está incompleto y los archivos siguen siendo heredados, preserva su lectura y mantiene las rutas nuevas en 404. Si ya hay archivos con `access_policy` informado, rechaza con 503 `DATABASE_SCHEMA_NOT_READY`: volver al acceso heredado ampliaría las audiencias. Los fallos de PostgreSQL se propagan al manejo central y conservan diagnóstico interno.

Apagada por defecto, la activación conserva el comportamiento anterior:
- la carga ejecuta las mismas sentencias de siempre, sin las columnas de B3: v1 vigente y `access_policy` NULL;
- la descarga usa `findProjectFileForDownload` e ignora `versionId`;
- las rutas nuevas responden 404 `API_ROUTE_NOT_FOUND` antes de autenticar (`middlewares/projectFileReview.js`).

Lo comprueban `tests/projectFileVersions.test.js`, que compara el SQL literal de la carga, `tests/projectFileReviewActivation.test.js` y `tests/projectFileReviewActivation.integration.test.js` (misma guarda local que B3). Las integraciones HTTP usan un historial local con checksums reales, registrado por la opción `recordMigrations` del helper aislado.

**Reglas aprobadas para B4** (`FILE_CONFIRMED_RULES`):
- solo el administrador aprueba y rechaza (DA5);
- toda versión nueva nace pendiente, también las subidas del administrador y del cliente (DA2);
- una sola pendiente por archivo (PR1);
- reemplazar exige motivo y conserva las versiones anteriores;
- restaurar una versión aprobada crea una pendiente nueva, registra `restored_from_version_id` y reutiliza el objeto almacenado (PR2). Restaurar la vigente no está prohibido;
- rechazar exige motivo de 1 a 500 caracteres (PR4);
- aprobar no comparte con el cliente (DA3): no crea autorizaciones y la respuesta devuelve `sharedWithClient: false`.

**Regla aplicada sin confirmación expresa (PR5).** Pueden reemplazar y restaurar quienes tienen acceso de equipo al proyecto, o el autor del archivo mientras conserve el acceso. Un draft solo existe para el administrador.

**Módulos**
- `repositories/projectFileVersionRepository.js`: contexto del archivo y su proyecto. En las escrituras bloquea `FOR UPDATE` la fila del archivo y `FOR SHARE` la del proyecto. Además: versiones con autor y revisor, autorizaciones activas, alta de una versión pendiente (siempre `is_current = false`) y aprobación o rechazo.
- `services/projectFileVersionService.js`: aplica el dominio (`projectFileReview`, `projectFileAccess`), las transacciones, la auditoría y el almacenamiento.
- `controllers/projectFileVersionController.js`, `validation/projectFileVersionSchemas.js` y las rutas en `routes/projects.js`. Contrato en `docs/API_CONTRACT.md`.

**Comportamiento con la activación encendida**
- **Carga nueva.** El archivo usa `access_policy = 1` y su v1 nace pendiente: `current_version` NULL, `is_current = false` y `content_type` informado.
- **Reemplazo.**
  - Se comprueba todo antes de transferir.
  - El objeto se transfiere sin conexiones abiertas, con una **clave única por intento** (`buildStorageObjectKey({ attemptId })`, segmento `v<n>-<id>`). Así dos reemplazos simultáneos nunca escriben la misma clave; sin esto, el segundo podría sobrescribir el objeto del primero ya registrado.
  - Con el archivo bloqueado se repiten permisos, estado, «una sola pendiente» y número de versión.
  - Si el registro falla, `storeThenRecord` descarta el objeto solo si ninguna versión registró su clave.
- **Revisión.** Aprobar convierte la versión en vigente: primero se retira `is_current` de la anterior, después se marca la nueva y se actualiza `files.current_version`. Rechazar conserva la vigente.
- **Proyectos de solo lectura.** Ni versiones nuevas ni revisión en proyectos archivados o finalizados (409). En un draft, solo el administrador.
- **Historial.** Se lee con la política del archivo y las autorizaciones activas: el equipo ve todas las versiones, el autor las suyas y el cliente la compartida. El motivo del rechazo y el revisor solo se muestran al equipo y al autor. La paginación usa un cursor por número de versión sobre las versiones visibles de un archivo (son pocas y se filtran en el servicio).
- **Descarga.**
  - Sin `versionId`, sirve la versión visible preferente (desde B5: la vigente para el equipo, la compartida para el cliente); con él, esa versión si el usuario puede verla, con su `content_type`.
  - En un archivo heredado, la vigente es exactamente la de `files.current_version`, como en la consulta anterior. Un `versionId` distinto responde 404, mientras que con la activación apagada se ignoraba.
  - La ETag usa la versión servida.
- **Archivos heredados.** No admiten versiones nuevas (409 `FILE_VERSIONING_UNAVAILABLE`) hasta su compatibilidad. Convertirlos ahora cambiaría su audiencia: con la regla heredada, aprobar una versión nueva la haría visible al cliente al instante, y eso contradice DA3.
- **Auditoría.** `project_file.version_submitted`, `version_restored`, `version_approved` y `version_rejected`, en la misma transacción. Si la auditoría falla, la operación se revierte.
- **Conservación.** Ninguna operación borra versiones ni objetos; retirar un archivo sigue respondiendo 409 (B1).

**Dependencias antes de encender la activación en un entorno compartido**
1. Migración `20261118120000_project_file_review_audience_expand` aplicada, con su procedimiento.
2. ~~Audiencias en todas las lecturas~~ y ~~compartir con el cliente y escaparate~~: resueltas en B5 (sección siguiente).
3. **Comentarios y SSE por audiencia (B6).**
4. **Compatibilidad de archivos heredados (B9).** Hasta entonces no admiten versiones.
5. **Scripts de subida.** Deben escribir la política explícitamente o negarse a ejecutarse.
6. **Frontend.** Debe mostrar que una carga queda pendiente, la revisión, el historial y la restauración.
7. **Notificaciones de aprobación y rechazo** (Figma: «será notificado»): todavía no se envían.
8. **Opcional:** una restricción única parcial en PostgreSQL para PR1. Hoy la garantiza el bloqueo de la fila del archivo en todas las rutas de la aplicación.

**Pruebas**
- `tests/projectFileVersions.test.js`.
- `tests/projectFileDomain.test.js`.
- `tests/projectFileVersions.integration.test.js` (opcional: `ARCA_FILE_VERSIONS_DB_TESTS=1` y `ARCA_FILE_VERSIONS_TEST_DATABASE_URL` local). Cubre la activación apagada, la subida pendiente, permisos, rechazo con motivo, aprobación sin compartir, reemplazo con formato propio, restauración que reutiliza el objeto, historial con cursor, autor cliente, archivos heredados, draft y solo lectura, concurrencia (tres reemplazos con las transferencias sincronizadas y dos aprobaciones), rollback por fallo de auditoría y compensación del objeto.

### Audiencias y controles de acceso de archivos de proyecto (B5, Fase 1.2)

Bajo la misma activación coordinada (`PROJECT_FILE_REVIEW_ENABLED`, apagada por defecto). Apagada, todas las lecturas usan exactamente las uniones anteriores, sin columnas ni tablas de B3, y las rutas de audiencias responden 404 `API_ROUTE_NOT_FOUND`.

**Reglas aprobadas** (`FILE_CONFIRMED_RULES`):
- solo el administrador comparte versiones con el cliente y autoriza su publicación en el escaparate (D3);
- el cliente consulta la versión con autorización activa; las sustituidas quedan como historial (D4);
- las dos audiencias tienen autorizaciones independientes (AU1);
- compartir exige una versión aprobada del mismo archivo (AU2); aprobar sigue sin compartir (DA3);
- se mantiene el acceso del autor a sus propias versiones.

**Gestión** (`services/projectFileAudienceService.js`, `repositories/projectFileAudienceRepository.js`, `controllers/projectFileAudienceController.js`). En una transacción se bloquea la fila del archivo y se comprueban:
- el estado del proyecto (archivado: 409);
- la política del archivo (heredado: 409 `FILE_AUDIENCE_UNAVAILABLE`, hasta B9);
- la versión, que debe ser del archivo;
- el dominio (`evaluateFileAudienceChange`).

Autorizar la misma versión es idempotente. Autorizar otra cierra la activa como `superseded`; revocar la cierra como `revoked`. Las filas nunca se borran. Las fechas usan `clock_timestamp()` tras el bloqueo: `now()` es el inicio de la transacción y podía ser anterior a la autorización que otra transacción acababa de confirmar, lo que violaba `chk_project_file_audience_grants_end` (lo detectó la prueba de concurrencia). Auditoría `project_file.audience_granted` y `project_file.audience_revoked` en la misma transacción. **PR6 (propuesta, pendiente de aprobación).** Definición (`FILE_PROPOSED_RULES.PR6`): «Una sola versión autorizada por audiencia: autorizar otra versión en el escaparate sustituye la anterior, como en el cliente».
- **Comportamiento que introduce:** `PUT …/audiences/showcase` con otra versión cierra la activa como `superseded` en lugar de añadir una segunda; la respuesta expone `showcase` como una sola autorización. En el cliente la misma sustitución es D4, confirmada.
- **Código que depende de ella:** solo `SUPERSEDE_RULE.showcase` en `services/projectFileAudienceService.js` (cierre previo a la nueva autorización, registrado en la auditoría como `oldValues.rule = "PR6"`), y la forma de `showcase` en la respuesta (`toAudienceState`).
- **Lo que no depende de ella:** PostgreSQL (solo hay índice único de autorización activa para el cliente), las lecturas (`showcaseVersionIds` y la política SQL admiten varias versiones activas y eligen la de mayor número) y la caché.
- **Si no se aprueba:** se elimina la sustitución del escaparate en ese punto y `showcase` pasa a ser una lista; no hace falta migración.

**Política común de lectura** (`utils/projectFileAudienceSql.js`, traducción SQL de `domain/projectFileAccess.js`). `buildVisibleFileVersionSql` añade una unión `LATERAL` que elige la versión visible de cada archivo para el usuario:
- heredado: la vigente;
- equipo: la vigente aprobada;
- propietario: la autorizada al cliente o las que subió él;
- resto: la autorizada al escaparate, en proyectos públicos finalizados e imágenes o videos.

Su condición va en el `WHERE`, antes del `LIMIT` y del cursor. La aplican:
- la galería del detalle;
- los documentos recientes;
- las miniaturas del listado, del detalle y de la publicación (`buildProjectThumbnailSql`);
- la portada de las solicitudes (`projectRequestCoverVersionJoin`).

La descarga y el historial usan el dominio en el servicio. Sin `versionId`, `defaultDownloadCandidates` elige la misma versión que el SQL. El acceso al proyecto y la restricción de los drafts siguen en cada consulta; la política repite la de los drafts, que solo existen para el administrador.

**Caché y revocación** (`utils/projectFileCache.js`, `controllers/fileController.js`). Encendida:
- `private, no-cache` con ETag por versión servida y representación (`direct`/`showcase`) y `Vary: Cookie, Authorization`;
- el 304 se decide **después** de resolver la autorización y **antes** de leer el almacenamiento;
- una autorización sustituida o revocada responde 200 con otra ETag o 404, nunca 304;
- sin `immutable`: una revocación surte efecto en la siguiente petición.

Apagada, se mantiene la caché anterior.

**Rutas de solicitudes** (revisión de B5). Los adjuntos de solicitud se crean siempre con la regla heredada y pasan al proyecto al aprobar la solicitud (`origin_project_request_id`), que nace en draft: durante la configuración el cliente solo los consulta por la ruta de la solicitud. La primera versión de B5 excluía de esa ruta los archivos 1.2 (404) porque la ruta servía la versión vigente sin la política de audiencias: una versión interna posterior, aprobada pero no compartida, habría llegado al cliente. Hoy no afectaba a ningún adjunto real, pero tras la compatibilidad (B9) habría cortado el acceso legítimo del cliente a lo que él mismo aportó.

Se sustituyó por una regla por versión (`requestAttachmentVersionIdSql` en `utils/projectFileAudienceSql.js`): la ruta sirve la versión vigente mientras el adjunto pertenece a la solicitud y, tras transferirlo, la que aportó el cliente (la más reciente creada hasta `project_requests.reviewed_at`, o la v1). Las versiones posteriores del equipo nunca se sirven por esta ruta, ni a los clientes ni al administrador. La misma versión da nombre y tamaño en `listProjectRequestFiles` (detalle del cliente) y en el flujo de trabajo (`workflowRequestRelations`), y es la portada de la solicitud para sus adjuntos. Con la activación apagada todas estas consultas usan exactamente las uniones anteriores.

**Contadores.** `file_count` de las carpetas en la configuración solo lo ve el administrador (equipo completo) y no cambia. No hay otros contadores de archivos expuestos al cliente.

**Dependencias restantes antes de encender la activación en un entorno compartido**
1. ~~Comentarios y SSE (B6)~~: resueltos en B6 (sección siguiente).
2. **Compatibilidad de archivos heredados (B9):** versiones y audiencias para los archivos `access_policy` NULL.
3. **Scripts de subida:** deben escribir la política explícitamente o negarse a ejecutarse.
4. **Frontend:** carga pendiente, revisión, historial, restauración y gestión de audiencias para el administrador.
5. **Notificaciones** de aprobación, rechazo y compartición.
6. **Confirmación de PR5 y PR6**, y decisiones DA1 (archivado y sus efectos sobre las audiencias) y DA4 (restricciones por estado).

**Pruebas**
- `tests/projectFileCache.test.js`: cabeceras de revalidación, `If-None-Match` y SQL común (apagada, la unión anterior sin parámetros).
- `tests/projectFileDomain.test.js` y `tests/fileContexts.test.js`: reglas D3, D4, AU1 y AU2.
- `tests/projectFileAudiences.integration.test.js` (opcional: `ARCA_FILE_AUDIENCES_DB_TESTS=1` y `ARCA_FILE_AUDIENCES_TEST_DATABASE_URL` local). Cubre:
  - la matriz de actores (administrador, arquitecto asignado y ajeno, cliente propietario y ajeno);
  - proyectos privado en curso, público finalizado y draft;
  - archivos compartidos, no compartidos, pendientes, rechazados, del propio cliente y heredados;
  - detalle, documentos recientes, historial y descarga;
  - revocación con ETag y 304 sin leer el almacenamiento;
  - escaparate independiente y anonimizado;
  - permisos y errores;
  - paginación con filtro previo al límite;
  - miniatura y portada de solicitud;
  - descarga por la ruta de solicitudes de la versión aportada, nunca de una interna posterior;
  - autorizaciones concurrentes (seis simultáneas: una sola activa, regla D4 en la auditoría);
  - sustitución en el escaparate con la regla PR6 registrada en la auditoría;
  - conservación de versiones y objetos;
  - la activación apagada.
- `tests/projectRequestLifecycle.integration.test.js`, prueba «Fase 1.2 (B5)», con el recorrido completo:
  - el cliente aporta una imagen y un PDF, el arquitecto revisa y el administrador aprueba;
  - en draft, el cliente consulta sus adjuntos por la solicitud y el proyecto le responde 404;
  - el archivo heredado no admite versiones (409);
  - simulación de B9: la foto pasa a 1.2 y el equipo incorpora una versión interna aprobada;
  - la solicitud sigue sirviendo y nombrando lo aportado, también en el flujo de trabajo y la portada;
  - draft → pending: la portada se lee por el proyecto con la versión del cliente, igual que el detalle, la miniatura del listado y la descarga sin `versionId`; la interna responde 404;
  - compartir la interna la entrega por el proyecto, mientras la solicitud mantiene la aportada.

### Comentarios y SSE según la audiencia de cada versión (B6, Fase 1.2)

Bajo la misma activación coordinada. Apagada, las consultas no añaden uniones ni condiciones y los eventos se difunden como antes.

**Política** (`domain/projectCommentAudience.js` y su traducción SQL `utils/projectCommentAudienceSql.js`). Sobre el acceso al proyecto (`utils/projectCommentAccessSql.js`, que ya excluye drafts salvo al administrador), cada comentario sigue la audiencia de la versión que comenta, con la misma regla que las descargas de B5:
- sin archivo (general, o `target_id` que no identifica un archivo del proyecto) y archivos heredados: todo el proyecto, su significado histórico;
- versión concreta de un archivo 1.2: el equipo; el cliente si es la versión con autorización activa del cliente o la subió él;
- comentario de imagen de un archivo 1.2 sin versión inequívoca: el equipo y su autor.

El archivo comentado se resuelve con `file_id` (documentos e imágenes desde B6) o, en los comentarios anteriores de imagen, video y panorámica, con el `target_id` numérico de la galería (`<id>` o `project-file-<id>`, siempre del mismo proyecto). Se aplica en el listado general (antes del `LIMIT`, el cursor y el `syncCursor`), en el listado y la creación de comentarios de documento (acceso a la versión concreta), en las respuestas (la raíz debe ser visible), en la creación de comentarios de galería y en la foto del autor (solo autores de comentarios visibles).

**Creación** (`createProjectCommentRecord`, `projectCommentAudienceRepository`). Encendida, en una transacción: bloqueo del proyecto (FOR UPDATE), comprobación de la raíz, resolución de la versión y alta. Un comentario de galería de un archivo 1.2 guarda `file_id` y `file_version_id`: la versión pedida, si es visible, o la que la galería muestra a ese usuario (`buildVisibleFileVersionSql`). Las respuestas heredan archivo y versión de la raíz. Los comentarios de documento comprueban la versión tras bloquear el proyecto, en una sentencia nueva.

**Contadores.** Los puntos de panorámica se numeran por destino y versión, y la migración `20261119120000_project_comment_version_points` lleva la unicidad al mismo criterio (con versión NULL es idéntica a la anterior). Los de documento ya eran por versión. Los de imagen y video los calcula el frontend sobre los comentarios visibles. Así ningún número revela comentarios ocultos.

**Comentarios históricos sin versión y puntos existentes.**
- **Qué son.** Comentarios de imagen, video y panorámica creados antes de B6 (o con la activación apagada): identifican el archivo solo por `target_id` y tienen `file_version_id` NULL. Los de documento siempre tuvieron versión.
- **Cómo se leen.** Se resuelve el archivo por `target_id` (`<id>` o `project-file-<id>`, solo del mismo proyecto). Si no hay archivo, o es heredado, conservan su significado histórico: los ve todo el proyecto, como antes. Si su archivo sigue la política 1.2 no hay versión inequívoca, así que solo los ven el equipo y su autor; nunca se les asigna una versión supuesta.
- **Cómo se numeran.** Sus puntos siguen en el grupo «sin versión» de su destino (`coalesce(file_version_id, 0)` = 0), con la misma unicidad que antes. Los comentarios nuevos con versión empiezan en 1 en su propia versión y no chocan con ellos.
- **Conservación.** La migración no escribe filas: la huella completa de `project_comments` es idéntica antes y después, y ningún punto existente cambia de número.
- **Comprobaciones completadas.** Duplicados con versión NULL rechazados; comentarios retirados y respuestas fuera del índice; numeración aislada por versión (cada versión empieza en 1, sin chocar con NULL ni con otra versión); reversión bloqueada (23505) mientras existan puntos repetidos entre versiones.
- **En B9.** Si un archivo heredado pasa a la política 1.2, sus comentarios históricos deberán recibir versión (por ejemplo, la vigente en la fecha del comentario) antes de dejar de ser ambiguos; su número de punto puede conservarse en el grupo de esa versión solo si no choca.

**Concurrencia y orden de bloqueos.** Cambiar una autorización bloquea el proyecto FOR SHARE y crear un comentario FOR UPDATE: la comprobación de la versión, hecha después del bloqueo, ve siempre las autorizaciones confirmadas (una revocación en curso hace esperar al comentario, que después responde 404). La prueba de concurrencia encontró un interbloqueo (40P01): las escrituras de versiones y audiencias tomaban el archivo FOR UPDATE y el proyecto FOR SHARE en la misma sentencia, mientras el comentario, con el proyecto bloqueado, esperaba el FOR KEY SHARE de su clave foránea sobre el archivo. `findProjectFileContext` bloquea ahora primero el proyecto y después el archivo: proyecto → archivo es el orden único de todas estas escrituras.

**SSE** (`services/projectEvents.js`, `services/projectCommentEvents.js`).
- Cada stream registra cómo resolver su destinatario vigente (sesión y acceso al proyecto). `publishProjectEventToRecipients` lo resuelve justo antes de escribir: si ya no tiene acceso (por ejemplo, un arquitecto desasignado), cierra el stream sin esperar a la revalidación periódica de 30 s.
- `project.comment.created` lee la audiencia del comentario al publicar y lo entrega solo a quien puede verlo. Los streams sin destinatario identificable no reciben eventos filtrados.
- `project.access.changed` `{projectId, timestamp}` se publica al compartir, sustituir o revocar. No contiene archivos, versiones, nombres ni contadores. El frontend (`projectCommentFeed`) responde con una recarga completa que reemplaza la lista (si había una incremental en curso, espera a que termine y recarga después), y así retira lo que el usuario dejó de ver. La galería y el detalle del proyecto deben recargarse con el mismo aviso: queda para el frontend de la Fase 1.2.
- Publicación después del commit: el controlador responde y después publica. Un rollback lanza antes y no publica nada. Un fallo al publicar se registra (`project_event_publish_failed`, solo código, evento y proyecto) y no cambia la respuesta: el estado está en PostgreSQL y el frontend lo recupera con sus lecturas incrementales y de respaldo. Los eventos de un destinatario pueden llegar desordenados entre sí; el frontend ordena por fecha y deduplica por id.
- Los comentarios de documento siguen sin evento propio, como antes.

**Pendiente para B9 (compatibilidad de archivos heredados).** Resuelto por la herramienta de B9 (sección «Compatibilidad de archivos heredados»): comentarios históricos, clientes con varios usuarios y referencia temporal.
1. **Comentarios históricos sin versión.** Los comentarios de imagen, video y panorámica anteriores a B6 identifican el archivo por `target_id` y no tienen versión. Mientras su archivo sea heredado conservan su significado (todo el proyecto). Si B9 convierte ese archivo a la política 1.2, pasarían a ser ambiguos (solo el equipo y su autor): B9 debe asignarles una versión, por ejemplo la vigente en la fecha del comentario, o decidir otra regla. Los comentarios de documento ya tienen versión.
2. **Clientes con varios usuarios.** La política reconoce como «suyas» las versiones y los comentarios ambiguos por usuario (`uploaded_by`, `user_id`), no por cliente. Otro usuario del mismo cliente no ve las versiones que subió su compañero, ni sus comentarios ambiguos, ni la portada de su solicitud si apunta a ellas (el ensayo lo comprueba con `coOwner`). B9 debe decidir si la autoría se extiende al cliente.
3. **Referencia temporal de los adjuntos transferidos.** La ruta de solicitudes sirve la versión creada hasta `project_requests.reviewed_at` (B5). B9 no debe cambiar ese valor en solicitudes convertidas ni recrear versiones anteriores con fechas nuevas. Si una conversión pudiera repetirse, la referencia debe guardarse aparte (por ejemplo, la versión de origen en el archivo).

**Pruebas**
- `tests/projectCommentAudience.test.js`: clasificación y destinatarios, patrón del destino de galería, SQL apagado, publicación por destinatario (cierre de quien perdió el acceso, aislamiento de fallos, streams sin identidad).
- `tests/projectCommentAudience.integration.test.js` (opcional: `ARCA_COMMENT_AUDIENCE_DB_TESTS=1` y `ARCA_COMMENT_AUDIENCE_TEST_DATABASE_URL` local). Cubre:
  - actores: administrador, arquitecto asignado y ajeno, cliente propietario y otro usuario del mismo cliente;
  - versiones compartidas, internas, propias y heredadas; comentarios de documento por versión; históricos ambiguos, heredados y sin archivo; drafts;
  - puntos por versión, respuestas y fotos de autor;
  - eventos iguales al listado de cada actor y coherentes con las descargas;
  - revocación, sustitución y desasignación con streams abiertos;
  - un comentario que espera a una revocación en curso (404) y comentarios simultáneos a compartir y revocar (sin 500 ni interbloqueos);
  - rollback de comentarios y autorizaciones sin eventos, y fallo de publicación tras confirmar;
  - la activación apagada.
- `Frontend/tests/projectCommentFeed.test.js`: el aviso de acceso recarga completo y retira lo que ya no devuelve el backend.
- `tests/projectCommentVersionPoints.integration.test.js` (opcional: `ARCA_COMMENT_VERSION_POINTS_DB_TESTS=1` y `ARCA_COMMENT_VERSION_POINTS_TEST_DATABASE_URL` local): la migración sobre puntos existentes (ver `PRISMA_MIGRATIONS.md`).

### Administrador de archivos (B7, Fase 1.2)

API de la pantalla «Gestión de archivos» (Figma 3727:682730): métricas, árbol de proyectos y carpetas, búsqueda, pestañas «Aprobados», «Pendientes por aprobación» y «Rechazados», tabla con filtros y orden, y carpetas personalizadas. Rutas en `/api/admin/files` (`routes/fileManager.js`, `controllers/fileManagerController.js`, `services/fileManagerService.js`, `repositories/fileManagerRepository.js`, `validation/fileManagerSchemas.js`). Contrato en `docs/API_CONTRACT.md`.

**Activación y permisos.** Bajo `PROJECT_FILE_REVIEW_ENABLED`: apagada, 404 `API_ROUTE_NOT_FOUND` antes de autenticar (el router se monta antes de `/api/admin`). Solo el administrador. Es equipo de todos los proyectos con la política común (B4/B5): ve todas las versiones, también pendientes, rechazadas y de drafts, con los datos de revisión. Arquitectos y clientes reciben 403; su acceso al administrador es una decisión pendiente. Clasificación (carpeta), revisión (pestaña) y visibilidad (audiencias) siguen siendo independientes: el administrador no comparte ni publica nada. Las respuestas son `private, no-store`, porque cambian con cada revisión.

**Ámbito.** Archivos de proyectos vigentes (`files.project_id`, sin `deleted_at` ni estado `deleted`). Quedan fuera los proyectos eliminados y los adjuntos que siguen en su solicitud (entran al pasar al proyecto).

**Métricas** (`GET /metrics`, todo, un proyecto o una carpeta con sus subcarpetas):
- **Archivos:** archivos vigentes (no versiones).
- **Espacio usado:** suma de los objetos almacenados distintos de sus versiones no retiradas. Un objeto reutilizado por restauraciones (misma clave `file_versions.file_name`) cuenta una sola vez. `objectCount` informa cuántos objetos se sumaron. Los tamaños son los registrados al subir (`file_size`); no se consulta el almacenamiento.
- **Última carga:** la versión más reciente con objeto propio. Las restauraciones no son cargas, porque no transfieren nada.

**Árbol** (`GET /tree`). Proyectos ordenados por nombre e id con cursor, con cliente, estado y número de archivos. Cada uno lleva sus carpetas en preorden (`orderFolderTree`) con su número de archivos directos. Los nombres son legibles: las predeterminadas muestran el nombre vigente del catálogo (`renders.models` → «Panorámicas» aunque el proyecto guardara el anterior). La búsqueda opcional compara el nombre del proyecto o del cliente.

**Búsqueda de carpetas** (`GET /folders`). Por el nombre visible (el del catálogo para las predeterminadas), sin distinguir mayúsculas y con `%`, `_` y `\` literales. Devuelve proyecto, cliente y la ruta legible de antecesoras, paginado por nombre, proyecto e id.

**Pestañas** (`GET /items`). Cada fila es una versión:
- **Aprobados:** la versión vigente de cada archivo, aprobada (política 1.2) o heredada (`review.status: "legacy"`, que cuenta como aprobada hasta B9).
- **Pendientes y rechazados:** cada versión pendiente o rechazada, aunque el archivo tenga otra vigente (un archivo puede aparecer en «Aprobados» con v2 y en «Pendientes» con v3).
- **Filtros:** proyecto, carpeta (sola o con `includeSubfolders`), texto en el nombre y extensiones.
- **Orden:** fecha (por defecto, descendente), nombre o peso, con la versión como desempate. Todos los filtros van antes del `LIMIT`. El cursor guarda pestaña, orden, sentido, valor e id, y reutilizarlo en otra consulta responde 400.

**Carpetas** (`POST`, `PATCH` y `DELETE /projects/:projectId/folders`). Fuera de draft, y también en draft, que prepara el administrador. Con el proyecto bloqueado y solo reglas confirmadas del catálogo:
- personalizadas anidadas a cualquier nivel dentro de otras carpetas, salvo la portada (409 `PROJECT_FOLDER_SUBFOLDERS_NOT_ALLOWED`);
- predeterminadas protegidas (409 `PROJECT_FOLDER_PROTECTED`);
- se retiran solo las personalizadas vacías (borrado lógico; con contenido, 409 `PROJECT_FOLDER_NOT_EMPTY`); nunca se tocan archivos;
- nombre repetido entre hermanas: 400 con `body.name`;
- archivado o finalizado: 409 `PROJECT_ARCHIVED` o `PROJECT_FINALIZED`.

Crear en la raíz depende de D7 y responde 409 `PROJECT_FOLDER_DECISION_PENDING`. La configuración del draft conserva su comportamiento anterior, que sí lo permite, hasta decidir D7. Mover carpetas depende de D13 y no se ofrece. Cada cambio se audita (`project_folder.created`, `renamed` y `deleted`) en la misma transacción.

**Fuera de B7.**
- Subida, reemplazo, aprobación, rechazo, historial, restauración y descarga: ya existen en las rutas de versiones de B4. La tabla las usa por `fileId` y `versionId`.
- Mover archivos entre carpetas fuera de draft: hoy solo en la configuración del draft, que desde B8 aplica la regla de los documentos de garantía.
- Interfaz: U1 (pantalla principal) consume estas rutas desde `Frontend/src/pages/admin-files` (`api.fileManager`); con la activación apagada presenta el administrador como no disponible y lee las métricas generales de `/admin/dashboard-metrics`. U2 añade el visor por tipo, aprobar y rechazar, historial con descarga y restauración y los vínculos de garantías, con las rutas de versiones (B4) y de garantías (B8); para elegir visor y ofrecer garantías, `FileManagerItem` incluye `fileCategory` y `folder.section` (sección del catálogo de la carpeta predeterminada más cercana, resuelta en SQL con un `lateral` recursivo sobre los ancestros). U3 añade `POST /admin/files/projects/:projectId/files` (`services/fileManagerUploadService.js` y `domain/fileManagerUpload.js`): reutiliza `uploadProjectFile` (streaming, firma, límites y `storeThenRecord`, que compensa el objeto si el registro falla) con la carpeta destino, la regla confirmada de la portada comprobada antes de transferir y de nuevo bajo el bloqueo del proyecto (`verifyTarget`), y la categoría `panorama` para las imágenes de «Panorámicas» (`resolveFileCategory`). El reemplazo usa la ruta de versiones (B4); `X-Change-Note` se añadió a las cabeceras CORS. Con la revisión activada, `file_versions.original_name` guarda el nombre legible de la v1 y de los reemplazos (la clave de almacenamiento sigue saneada); apagada, nada cambia. Detalle de interfaz en `Frontend/DESIGN_SYSTEM.md`, «Gestión de archivos (administrador)».

**Pruebas.** `tests/fileManager.integration.test.js` (opcional: `ARCA_FILE_MANAGER_DB_TESTS=1` y `ARCA_FILE_MANAGER_TEST_DATABASE_URL` local). Cubre:
- métricas globales, por proyecto y por carpeta con subcarpetas, con un objeto reutilizado por una restauración contado una vez y la restauración excluida de la última carga;
- exclusión de proyectos eliminados y de adjuntos de solicitudes;
- árbol paginado con nombre vigente del catálogo y preorden;
- búsqueda de carpetas con ruta, cursor y caracteres literales;
- las tres pestañas, con heredados y versiones pendientes de archivos aprobados;
- filtros de ámbito, texto y extensiones;
- los tres órdenes en ambos sentidos recorriendo páginas de uno en uno;
- cursores de otra consulta (400);
- carpetas anidadas en tres niveles, D7, portada, nombre repetido, protegidas, no vacías, estados del proyecto y auditoría;
- altas simultáneas con el mismo nombre;
- permisos y activación apagada.

### Garantías con ids estables y documentos vinculados (B8, Fase 1.2)

Reutiliza la tabla `project_warranty_documents` (B3), el dominio `domain/projectWarrantyDocuments.js` (B2) y la política común de versiones (B4/B5). Módulos nuevos: `domain/projectWarrantySave.js`, `repositories/projectWarrantyRepository.js`, `services/projectWarrantyService.js` y `controllers/projectWarrantyController.js`. Contrato en `docs/API_CONTRACT.md`.

**Guardado estable** (`PUT /admin/projects/:projectId/configuration/warranties`, solo en draft, con el proyecto bloqueado):
- una entrada con `id` actualiza esa garantía vigente del proyecto y conserva su id; solo escribe si algo cambió, así que repetir el mismo guardado no toca filas;
- una entrada sin `id` es nueva; el orden enviado solo fija `sort_order`;
- las vigentes omitidas se retiran (`deleted_at`): conservan su fila, sus vínculos y los archivos, versiones y objetos de sus documentos;
- un `id` de otro proyecto, retirado, inexistente o repetido responde 400 en `body.warranties.<n>.id`, sin cambiar nada.

**Compatibilidad.** Antes el guardado retiraba todas las garantías y las creaba de nuevo, y el esquema rechazaba `id`. Ahora `id` es opcional y el frontend lo envía para las existentes (`toWarrantiesPayload`).
- **Envíos anteriores, sin ningún `id`.** Sin documentos vinculados se comportan como antes: retiran y crean de nuevo, y no hay referencias que perder. Si retirarían una garantía con documentos vinculados, responden 409 `WARRANTY_REFERENCES_REQUIRED` sin cambiar nada: el cliente debe recargar y enviar los ids.
- **Nunca se asocia por posición ni por contenido.** Dos garantías iguales sin `id` son dos registros. Una garantía editada sin `id` es una nueva y la anterior se retira.
- **Con la activación apagada**, el guardado estable funciona igual (solo usa columnas anteriores a la Fase 1.2), pero no consulta vínculos: esa protección existe solo encendida, que es cuando se pueden crear.

**Vínculos** (`PUT` y `DELETE /admin/files/projects/:projectId/warranties/:warrantyId/documents/:fileId`, solo administrador y con la activación encendida). Con el proyecto bloqueado y operativo: draft sí, archivado y finalizado no.
- Garantía y documento deben ser del mismo proyecto. Lo exigen la consulta, que responde 404 `WARRANTY_NOT_FOUND` o `FILE_NOT_FOUND`, y las claves compuestas de B3.
- El documento debe estar en «Documentos › Garantías» o en una subcarpeta personalizada suya (409 `WARRANTY_DOCUMENT_OUTSIDE_FOLDER`) y activo; si está archivado, depende de DA1.
- Un documento puede respaldar varias garantías.
- Vincular de nuevo no cambia nada (`changed:false`).
- Desvincular cierra el vínculo (`unlinked_at`, `unlinked_by`) y lo conserva como historial; después se puede volver a vincular.
- Las garantías retiradas no admiten vínculos nuevos ni desvinculaciones (409 `WARRANTY_RETIRED`).
- Auditoría `project_warranty_document.linked` y `unlinked` en la misma transacción: si falla, no hay vínculo.

**Vínculo activo y evidencia.**
- **Vínculo activo:** fila de `project_warranty_documents` con `unlinked_at` NULL y garantía vigente (`deleted_at` NULL).
- **Vínculo deshecho:** fila con `unlinked_at`.
- **Evidencia:** fila abierta de una garantía retirada. Registra qué respaldaba al retirarse y no se modifica.

Solo los vínculos activos cuentan para retener un documento, para leer garantías y para la protección del guardado.

**Movimiento.** La única operación que cambia la carpeta de un archivo es `PATCH /admin/projects/:projectId/configuration/files/:fileId`; las altas crean archivos nuevos, los reemplazos conservan la carpeta, mover carpetas no existe (D13) y solo se eliminan carpetas vacías. Con el proyecto bloqueado aplica `evaluateWarrantyDocumentMove`: un documento con vínculos activos debe seguir dentro del subárbol de Garantías (409 `WARRANTY_DOCUMENT_MOVE_FORBIDDEN`). La evidencia de garantías retiradas no lo retiene. Cualquier operación futura que mueva archivos debe llamar a `assertWarrantyDocumentMove`.

**Lectura** (`GET /projects/:projectId/warranties`, con la activación encendida). Acceso directo al proyecto: administrador; arquitecto asignado o responsable y cliente propietario fuera de draft; el escaparate no expone garantías.
- Devuelve las garantías vigentes y, en cada una, sus documentos con vínculo activo en la versión que el usuario puede ver, con la política común en SQL (`buildVisibleFileVersionSql`), la misma que las descargas.
- El equipo recibe la vigente; el cliente, la versión autorizada para él (o una que subió él); los heredados, su vigente.
- Un documento sin versión visible no aparece, sin revelar por qué. La garantía sí aparece, aunque no tenga documentos visibles.
- Si se revoca el acceso, el documento desaparece de la respuesta y el vínculo se conserva.

**Conservación.** Retirar una garantía o desvincular un documento no toca archivos, versiones ni objetos: la prueba compara sus recuentos antes y después.

**Concurrencia.** Guardar garantías, vincular, desvincular y mover archivos bloquean el mismo proyecto FOR UPDATE y se serializan:
- vínculos simultáneos iguales dejan una sola fila;
- un movimiento y un vínculo simultáneos nunca dejan un documento vinculado fuera de Garantías;
- un guardado sin ids frente a un vínculo responde 200 o 409, según cuál llegue antes.

**Pruebas**
- `tests/projectWarrantySave.test.js`: plan del guardado (ids, posiciones, gemelas, ids inválidos y compatibilidad).
- `tests/projectWarranties.integration.test.js` (opcional: `ARCA_WARRANTIES_DB_TESTS=1` y `ARCA_WARRANTIES_TEST_DATABASE_URL` local). Cubre:
  - ids estables, reordenación y guardados repetidos sin escrituras;
  - gemelas e ids de otro proyecto, retirados, inexistentes o repetidos;
  - compatibilidad sin ids, con y sin vínculos, y con la activación apagada;
  - vínculos en la carpeta y en una subcarpeta, fuera del subárbol y entre proyectos; varias garantías por documento; idempotencia, desvinculación con historial y revinculación;
  - garantías retiradas con evidencia intacta, auditoría, permisos, activación apagada y estado finalizado;
  - movimientos permitidos y prohibidos, también tras retirar la garantía;
  - lectura por actor con la versión autorizada y sin documentos internos, coherente con la descarga y tras revocar;
  - concurrencia de vínculos, de movimiento con vínculo y de guardado con vínculo;
  - rollback por fallo de auditoría.
- `Frontend/tests/projectConfigurationWarranties.test.js`: el envío lleva el id de las existentes y nunca la clave local.

**Dependencias para B9 y la interfaz**
- **B9 (resuelto):** la conversión de un documento de garantía heredado crea la autorización del cliente para su versión vigente, así que todos los usuarios del cliente siguen recibiéndolo.
- **B9 (resuelto para lo heredado):** clientes con varios usuarios. La autorización del cliente es por cliente. «Subida por él» sigue siendo por usuario y solo amplía el acceso de su autor.
- **B9 / DA1:** documentos archivados (vínculo pendiente de DA1).
- **Interfaz:**
  - pantalla de garantías del cliente: hoy `ProjectWarrantiesPanel` usa datos de ejemplo (`projectWarrantyData.js`) y debe leer `GET /projects/:projectId/warranties`;
  - paso «Garantías» de la configuración: debe usar `toWarrantiesForm` y `toWarrantiesPayload`, conservando los ids, y tratar el 409 `WARRANTY_REFERENCES_REQUIRED` recargando;
  - vinculación desde el administrador de archivos;
  - recarga al recibir `project.access.changed`.
- **Decisión pendiente:** gestionar vínculos en proyectos finalizados (hoy de solo lectura, como las carpetas de B7).
- **Deuda existente, no relacionada:** `findProjectConfiguration` lanza consultas en paralelo sobre el cliente de la transacción, y `pg` 8 avisa que dejará de admitirlo en `pg@9`.

### Compatibilidad de archivos heredados (B9, Fase 1.2)

Herramienta de mantenimiento que pasa archivos heredados (`access_policy` NULL) a la política 1.2 sin cambiar lo que cada persona puede ver:
- comando: `scripts/project-file-compatibility.mjs`;
- lógica: `services/projectFileCompatibilityService.js`, `domain/projectFileCompatibility.js` y `repositories/projectFileCompatibilityRepository.js`;
- comprobaciones: `scripts/project-file-compatibility/preflight.sql` y `postcheck.sql`.

No depende de `PROJECT_FILE_REVIEW_ENABLED`: con la revisión apagada, el backend sigue tratando los archivos convertidos con la consulta anterior (versión vigente). Solo se ha ensayado en PostgreSQL local desechable. **Su ejecución en entornos compartidos requiere autorización.**

**Qué hace la conversión de un archivo.** Solo cambia lo necesario:
1. `files.access_policy = 1`. Las versiones no cambian: una versión heredada (estado NULL) ya cuenta como aprobada, así que no se inventan aprobaciones ni revisores.
2. Una autorización activa del cliente para la versión vigente, firmada por el operador. Es por cliente: **todos los usuarios del cliente** conservan el acceso que tenían, también a los documentos de garantía.
3. Una autorización del escaparate solo si hoy se ve en él: proyecto público y finalizado, con una imagen o un video vigente.
4. Comentarios históricos de imagen, video o panorámica sin versión: reciben `file_id` y `file_version_id` de la versión vigente cuando es inequívoca. Un hilo sigue a su raíz. Es inequívoca si el archivo tiene una sola versión o si, al crearse la raíz, la última versión existente ya era la vigente. Los números de punto se conservan.
5. Una marca de auditoría `project_file.compatibility_converted` (`user_agent` `maintenance:project-file-compatibility`) con la huella del plan.

No toca:
- versiones, objetos almacenados, `current_version` ni la carpeta;
- `origin_project_request_id` ni `project_requests.reviewed_at`, que son la procedencia y la referencia temporal de los adjuntos transferidos;
- vínculos de garantías, claves funcionales de carpetas ni el contenido de los comentarios.

**Equivalencia de acceso.** Se mide con las funciones de la aplicación: `evaluateFileVersionAccess` para versiones y la audiencia de B6 para comentarios.
- **Actores:** administrador, arquitecto asignado y responsables, cada usuario del cliente y dos ajenos (arquitecto y cliente), que representan el escaparate.
- **Qué se compara:** cada versión y cada comentario, en el estado actual del proyecto y, si es draft, también tras finalizar su configuración.
- **Diferencias esperadas** (no bloquean y se cuentan en el informe): el equipo pasa a ver el historial de versiones (`TEAM_VERSION_HISTORY`) y el autor sus propias versiones anteriores (`AUTHOR_OWN_VERSION`).
- **Revisión:** cualquier pérdida, el paso de directo a anonimizado o una ganancia de otro tipo deja el archivo en revisión.

**Casos que quedan en revisión.** Siguen con su política actual hasta resolverlos:
- `NO_CURRENT_VERSION`: sin versión vigente.
- `CURRENT_VERSION_MISMATCH`: la vigente heredada no es la de mayor número no retirada.
- `FILE_ARCHIVED_DA1` y `PROJECT_ARCHIVED_DA1`: pendientes de DA1.
- `EXISTING_AUDIENCE_GRANTS`: ya tiene autorizaciones.
- `COMMENT_ON_PREVIOUS_VERSION` y `COMMENT_BEFORE_FIRST_VERSION`: comentario histórico sin versión inequívoca.
- `DOCUMENT_COMMENT_ON_PREVIOUS_VERSION`: comentario de documento sobre una versión que no es la vigente.
- `POINT_COLLISION`: un número de punto chocaría.
- `ACCESS_LOSS`: por ejemplo, un proyecto público sin finalizar, cuyo escaparate exige finalizar en la política 1.2.
- `ACCESS_GAIN_UNEXPECTED` y `COMMENT_ACCESS_LOSS`.

**Ejecución segura**
- **Plan (`--plan`)**:
  - en una instantánea `REPEATABLE READ READ ONLY`, sin escrituras;
  - cada entrada lleva la huella SHA-256 de todo lo que decide la conversión (archivo, proyecto, equipo, usuarios del cliente, versiones con su clave, comentarios, autorizaciones y vínculos) y, si se convierte, la visión anterior de cada actor;
  - el comando muestra el SHA-256 del archivo del plan.
- **Aplicación (`--apply`)**:
  - exige el plan, su SHA-256, el mismo destino y un administrador activo como operador;
  - cada archivo va en su propia transacción: bloquea el proyecto (FOR SHARE) y el archivo (FOR UPDATE), en el orden de las demás escrituras;
  - omite el archivo si ya tiene la marca de este plan (`already_applied`), si ya no es heredado (`not_legacy`), si su huella cambió (`stale`) o si hoy ya no es convertible (`review_now`);
  - después aplica, vuelve a verificar la equivalencia con los datos ya escritos y registra la marca;
  - cualquier fallo revierte ese archivo (`error`) y continúa con los demás;
  - la marca, leída con el archivo bloqueado, hace la aplicación idempotente: repetir, reanudar tras una interrupción (`--max-files` permite tandas) o ejecutar dos procesos a la vez no convierte nada dos veces.
- **Verificación (`--verify`)**, de solo lectura:
  - cada archivo convertido contra su visión anterior y su integridad (versiones y claves, vínculos, carpeta, procedencia y fecha de aprobación);
  - los que quedaron en revisión siguen heredados.
- **Informe:** por modo, en `~/ARCA_PRIVATE_BACKUPS/project-file-compatibility/` o en `--report`, siempre fuera del repositorio. Contiene la huella y los recuentos del plan, el resultado por estado y la lista revisable (ids y motivos), sin nombres, correos, títulos ni claves de almacenamiento. El plan contiene ids y la visión de acceso: también se guarda fuera del repositorio.

**Sin estructura nueva.** No hace falta migración:
- la idempotencia la da la marca de auditoría, leída tras bloquear el archivo;
- la detección de cambios la dan las huellas del plan;
- la lista revisable vive en el plan y en el informe, y sus archivos no cambian.

Una tabla de revisión solo haría falta si se quisiera gestionar los casos ambiguos desde la aplicación; queda como decisión para la interfaz.

**Limitaciones**
- La marca se busca en `audit_logs` sin índice específico: es una consulta por archivo, aceptable para un mantenimiento, no para uso frecuente.
- El escaparate de un archivo convertido ya no aparece solo al publicar un proyecto más tarde: la política 1.2 exige autorizarlo. Hoy no cambia nada, porque solo se convierte lo que ya se ve.
- La autoría (`AUTHOR_OWN_VERSION`) sigue siendo por usuario.
- Los comentarios en revisión necesitan una decisión explícita: asignarles una versión anterior, que el cliente dejaría de ver salvo que se le comparta, o compartir esa versión.

**Procedimiento propuesto para una ejecución autorizada.** Pendiente de autorización.
1. Respaldo verificado de la base y archivo de entorno privado fuera del repositorio.
2. `--describe-target` y confirmación del destino.
3. `psql -X -f scripts/project-file-compatibility/preflight.sql`: todos los `ok_*` verdaderos; guardar el resultado fuera del repositorio.
4. `--plan --out <ruta privada>` y revisión de los recuentos, motivos y lista revisable. Anotar el SHA-256.
5. Ventana sin despliegues; `--apply --plan-file … --plan-sha256 … --operator-user-id <admin>` (opcionalmente por tandas).
6. `postcheck.sql`: todos los `ok_*` verdaderos y huellas idénticas a las del preflight.
7. `--verify`: solo `verified` y `review_unchanged`. Si hay `stale`, preparar un plan nuevo y repetir 4 a 7.
8. Revisar la lista y decidir cada caso pendiente.

**Pruebas**
- `tests/projectFileCompatibility.test.js`: autorizaciones, escaparate, draft antes y después de finalizar, ganancias esperadas, asignación de comentarios y motivos de revisión.
- `tests/projectFileCompatibility.integration.test.js` (opcional: `ARCA_FILE_COMPATIBILITY_DB_TESTS=1` y `ARCA_FILE_COMPATIBILITY_TEST_DATABASE_URL` local). Cubre:
  - preflight, plan sin escrituras y clasificación de diez casos con sus motivos;
  - aplicación con postcheck (huellas idénticas) y verificación;
  - acceso por HTTP antes y después para dos usuarios del mismo cliente y un ajeno: descargas, escaparate, versión del autor, adjunto transferido en draft (por la solicitud) y tras finalizar (por el proyecto), garantías y comentarios históricos con respuesta y punto de panorámica;
  - repetición idempotente, plan obsoleto, interrupción y reanudación, y dos aplicaciones simultáneas;
  - rollback por fallo y reintento;
  - plan con otra huella u otro formato, otro destino u operador no administrador;
  - el comando completo: destino confirmado, plan e informes fuera del repositorio, informe sin datos sensibles.

## Paginación

Las colecciones crecientes usan cursores opacos:

```http
GET /api/examples?limit=25&cursor=...
```

```json
{
  "examples": [],
  "nextCursor": null
}
```

- Límite predeterminado: `25`.
- Límite máximo: `100`.
- Orden estable con fecha e ID como desempate.
- El frontend combina páginas por ID y reinicia el cursor al cambiar el contexto.
- Los comentarios deben conservar conversaciones y deduplicar eventos SSE.

## PostgreSQL y Prisma

- `pg` sigue siendo el acceso de ejecución de la aplicación.
- Prisma se utiliza únicamente para esquema, historial y migraciones.
- La única carpeta de migraciones es `prisma/migrations`.
- Desarrollo: `pnpm db:migrate:dev --name nombre`.
- Despliegue: `pnpm db:migrate:deploy`.
- Estado: `pnpm db:migrate:status`.
- Detalles adicionales: `PRISMA_MIGRATIONS.md`.

Prisma no representa completamente RLS, restricciones `CHECK`, claves diferibles e índices por expresiones. Revisar y completar manualmente el SQL generado cuando una migración afecte esas características.

Saturación (`src/config/db.js`):

- Solo las lecturas que pierden la conexión se reintentan, una vez y tras 100–300 ms aleatorios. La saturación y las escrituras nunca se repiten.
- Con `DATABASE_MAX_WAITING` (200) peticiones esperando conexión, las siguientes reciben 503 al instante en lugar de esperar `DATABASE_CONNECTION_TIMEOUT_MS`. `0` desactiva el límite.
- El pool escucha `error`: una conexión inactiva cortada por la base no termina el proceso.

## Rendimiento y estabilidad

- **Métricas**: con `REQUEST_METRICS_ENABLED=true`, `middlewares/requestMetrics.js` registra `http_request` por petición (se omite con `REQUEST_METRICS_LOG_REQUESTS=false`) y `runtime_metrics` cada `RUNTIME_METRICS_INTERVAL_MS` (10 s): CPU, RSS y heap, retraso del event loop, pool (activas, libres, en espera), duración p50/p95/p99, clases de estado, 429, 503 y cancelaciones. No registra cabeceras, cookies, cuerpos ni la URL con ids.
- **Sincronización de comentarios**: la lista de comentarios de proyecto devuelve `syncCursor`; el frontend lo usa en `api/projectCommentFeed.js` (una carga, una conexión SSE y un sondeo incremental por proyecto, compartidos por todos los hooks).
- **Pruebas de carga**: `load-tests/` (k6) usa la cookie de sesión real (`load-tests/session.js`); `auth-smoke.mjs` valida el entorno antes de medir. Solo contra entornos aislados.

Problemas pendientes (no resueltos, documentados para fases posteriores):

1. **Precisión del cursor de paginación.** Un cursor construido desde un `Date` guarda la fecha con milisegundos y `created_at` tiene microsegundos. En un orden ascendente (`> cursor`) el último elemento puede repetirse al inicio de la página siguiente (los clientes deduplican por id: `collectCursorPages`, `projectCommentFeed`); en uno descendente (`< cursor`) se **omiten** las filas del mismo milisegundo que el límite, y si toda la página siguiente comparte ese milisegundo (altas en una misma transacción) llega vacía. **Corregido en Gestión de usuarios y sus notas** (`adminUserRepository`/`adminUserService`): la consulta selecciona `preciseCursorTimestampSql(...)` (`utils/pagination.js`, texto ISO UTC con microsegundos) como `cursor_created_at` y el servicio lo usa para el cursor; los cursores anteriores en milisegundos siguen siendo válidos. Prueba: `tests/adminUserPagination.integration.test.js` (`ARCA_ADMIN_USERS_DB_TESTS=1`, `ARCA_ADMIN_USERS_TEST_DATABASE_URL` local). **Pendiente** en el resto de listados por fecha (solicitudes del cliente y cola técnica, proyectos, archivos, comentarios y documentos): aplicar el mismo patrón en cada repositorio.
2. **SSE entre instancias.** El bus de eventos está en memoria del proceso: en Vercel, un comentario creado en otra instancia no llega por SSE. El sondeo incremental se mantiene como respaldo (30 s con SSE conectado, el intervalo pedido sin él), así que un comentario puede tardar ese tiempo en aparecer.
3. **Calibración de `DATABASE_MAX_WAITING`.** El valor 200 es razonado, no medido: ajustarlo con las pruebas de carga junto con el tamaño del pool y `DATABASE_CONNECTION_TIMEOUT_MS`.
4. **Recuperación de archivos huérfanos.** Si el proceso cae entre la transferencia y el registro, o falla el borrado de compensación, el objeto queda en el almacenamiento y se registra como `storage_orphan_candidate`. Desde B1 (Fase 1.2) los archivos guardados ya no se eliminan, así que no quedan objetos de borrados posteriores. No existe todavía un proceso de limpieza (A7).

## Estructura de un módulo nuevo

```text
src/routes/examples.js
src/controllers/exampleController.js
src/services/exampleService.js
src/repositories/exampleRepository.js
src/validation/exampleSchemas.js
tests/example.test.js
```

No todos los módulos necesitan todos los archivos, pero se debe respetar la dirección de dependencias: las capas inferiores nunca deben importar controladores o rutas.

## Definición de terminado

Una funcionalidad está terminada cuando:

1. conserva los contratos autorizados;
2. no duplica reglas existentes;
3. valida toda entrada externa;
4. aplica autenticación, permisos y límites adecuados;
5. incluye manejo de errores y compensación;
6. tiene pruebas proporcionales al riesgo;
7. documenta cambios públicos o migraciones;
8. `pnpm verify` finaliza correctamente.

## Revisión técnica de solicitudes

`project_request_reviews` conserva `recommendation` para la valoración de workflow (`approve`, `reject`, `changes_requested`), `note` para su justificación y `meeting_recommendation` para la decisión independiente de reunión. El nuevo enum nullable no tiene default ni backfill histórico. El servicio coordina la revisión y los errores de contexto; el repositorio guarda atómicamente ambos conceptos con consultas parametrizadas y bloqueo de la solicitud. Zod valida los códigos del dominio en `src/domain/projectRequestReview.js`. El contrato se extiende en `/review` y `/review-queue` sin añadir rutas ni cambiar las decisiones administrativas. Consultar [contrato y migración](../docs/PROJECT_REQUEST_MEETING_RECOMMENDATION.md).

### Consulta administrativa por ID

**Edición administrativa de solicitudes** («Editar solicitud»): `GET /api/admin/project-requests/:projectRequestId/form` y `PUT …/form` (router `admin`; `projectRequestIdSchema` y `adminUpdateProjectRequestSchema` = el cuerpo del formulario del cliente más `expectedUpdatedAt`, `.strict()`) → `projectRequestAdminEditController` → `projectRequestAdminEditService` → `findProjectRequestForAdminEdit`, `updateProjectRequestAnswers`, `updateProjectRequestCompatibility` (`projectRequestRepository`) e `insertAuditLog`. La política vive en `domain/projectRequestAdminEdit.js`: solo `pending_verification` y `pending_review` son editables (un borrador es del cliente, `changes_requested` está en sus manos y los estados con decisión no se tocan). El guardado ocurre en una transacción con la fila bloqueada (`FOR UPDATE`): comprueba estado y versión (`updatedAt` leído al abrir; 409 `PROJECT_REQUEST_EDIT_CONFLICT` si cambió), conserva el tipo histórico o uno vigente (`assertAllowedProjectType`) y la unicidad del nombre del cliente (`assertProjectRequestNameAvailable`, compartida con el flujo del cliente), sustituye solo las respuestas (`projectRequestAnswerParams`, el mismo orden de columnas que el cliente), recalcula la compatibilidad y audita `project_request.admin_update` con los nombres de los campos cambiados (`listChangedProjectRequestAnswers`), nunca sus valores. Guardar sin cambios revierte la transacción: no mueve la versión ni audita.

**Revisiones técnicas desactualizadas**: la auditoría de cada edición guarda `reviewRelevantFields` (`REVIEW_RELEVANT_ANSWER_FIELDS`: las respuestas que leen la compatibilidad, la viabilidad financiera y las observaciones técnicas, más ubicación y descripción; no cuentan nombre, enlace, precisión geográfica, quién decide ni experiencia). `projectRequestWorkflowRepository` deriva la última edición relevante con un único agregado sobre `audit_logs` (`ANSWERS_REVISION_SOURCE`; nunca `updated_at`, que también cambia al asignar o decidir) y marca `reviews[].outdated`, `hasOutdatedReviews` y `answersRevisedAt` en la cola y el detalle. Una revisión nueva o actualizada después de la edición deja de estar desactualizada. Las revisiones no se modifican ni se eliminan. En la transacción de la decisión (fila bloqueada), aprobar con revisiones desactualizadas exige `acknowledgeOutdatedReviews` y `outdatedReviewsJustification`; sin ellas responde 409 `PROJECT_REQUEST_REVIEWS_OUTDATED`, y con ellas audita `outdatedReviewsOverride`. Rechazar o pedir correcciones no lo exige. `audit_logs` no tiene índice por entidad: el agregado lee la tabla una vez por consulta. No cambia estado, cliente, solicitante, responsables, revisiones ni adjuntos, y no crea proyectos.

`GET /api/admin/project-requests/:projectRequestId` (router `admin`: sesión + rol `admin`; `projectRequestIdSchema`) → `getAdminProjectRequest` → `getAdminProjectRequestDetail` → `findProjectRequestForAdmin` + `listProjectRequestFiles`. Devuelve `{ projectRequest }` con `Cache-Control: private, no-store`: la misma forma que una entrada de la cola técnica (métricas calculadas al vuelo, `reviewObservations`, responsables y revisiones, sin las respuestas internas) más `referenceLink`, `formattedAddress`, `reviewedAt`, `convertedProject` (`id`, `name`, `status`, `publicSlug`; null si el proyecto fue eliminado) y `files` con tamaño y fecha (solo metadatos). Cubre todos los estados salvo `draft`; un borrador, una solicitud eliminada o inexistente responden `404 PROJECT_REQUEST_NOT_FOUND`. Las columnas y relaciones compartidas con la cola viven en `WORKFLOW_REQUEST_COLUMNS`/`WORKFLOW_REQUEST_RELATIONS`. No reutiliza `GET /project-requests/:id`, exclusivo del propietario.

## Cálculo de cotizaciones

`src/domain/quoteTotals.js` (`calculateQuoteTotals`) es la única fuente de los importes de una cotización. Lo utilizarán el servicio de cotizaciones, las validaciones y el PDF. No conoce el catálogo, PostgreSQL ni HTTP: recibe cantidades y tarifas aplicadas como parámetros, por lo que las tarifas del tabulador nunca se codifican en el motor.

- Subtotal = cantidad × tarifa aplicada, redondeado a 2 decimales; las tarifas fijas usan cantidad 1. Total de servicios = suma de subtotales redondeados. IVA referencial (informativo, `isReferenceOnly: true`) = total × tasa / 100; puede deshabilitarse y admite 0 %.
- Precisión: enteros escalados con `BigInt` (`src/utils/scaledDecimal.js`), sin coma flotante. Redondeo a la mitad hacia arriba, equivalente a `round()` de PostgreSQL para valores positivos. Las cantidades y tarifas no se redondean: un decimal adicional se rechaza.
- Escalas (`QUOTE_DECIMAL_FORMATS`): cantidad `NUMERIC(12,3)`, tarifa e importes `NUMERIC(14,2)`, tasa `NUMERIC(5,2)` entre 0 y 100. Los esquemas Zod futuros deben reutilizar esas constantes.
- Entrada recomendada en texto decimal; un `number` solo se acepta si su conversión es exacta. El resultado devuelve todos los importes como texto con escala fija.
- Los errores se reúnen y se lanzan juntos como `ValidationError` con `fields` por ruta (`items.0.quantity`, `referenceVat.rate`, `servicesTotal`, `estimatedTotalWithVat`).

## Catálogo de servicios

Backend administrativo del tabulador (`/api/admin/services`, solo rol admin). Sigue `route → validate → controller → service → repository`:

- `routes/serviceCatalog.js`: autenticación, rol, límite de escrituras y Zod (`validation/serviceCatalogSchemas.js`, que reutiliza `parseScaledDecimal` y `QUOTE_DECIMAL_FORMATS.unitRate` para la tarifa).
- `domain/serviceCatalog.js`: reglas puras (tipos, código generado, detección de cambios efectivos). La modalidad (`individual` o `turnkey`) no restringe la unidad: ambas admiten cualquier unidad base registrada y activa.
- `services/serviceCatalogService.js`: coordina el versionado dentro de `withTransaction` (`config/db.js`); `services/serviceCatalogErrors.js` traduce 23505/23503/23001/23514/55000/40001/40P01 sin exponer PostgreSQL.
- `repositories/serviceCatalogRepository.js` y `repositories/measurementUnitRepository.js` (solo lectura de unidades): SQL parametrizado, `FOR UPDATE` del servicio y `FOR SHARE` de la unidad asignada.

Edición versionada (también para tarifa y estado; no existe otra ruta): bloquear el servicio → leer la versión vigente en una sentencia posterior (instantánea nueva en READ COMMITTED) → comparar con `expectedVersion` (409 SERVICE_VERSION_CONFLICT) → si no hay cambios efectivos, terminar sin versión → validar unidad → actualizar → retirar `is_current` → insertar la copia completa. El alta inserta el servicio y su versión 1 en la misma transacción. El cuerpo no admite `code`: el servicio reserva el id con `nextval` de la secuencia de `services.id` y compone `SERV-001` (`formatGeneratedServiceCode` en `domain/serviceCatalog.js`; salta un código heredado coincidente), sin migraciones. `kind` lo elige el administrador (`individual` si se omite, validado por Zod); la modalidad no restringe la unidad: el servicio comprueba en la transacción que la unidad exista y esté activa, bloqueada FOR SHARE, antes de reservar el código. El esquema ya admitía ambas modalidades (`service_kind`), así que no hubo migración. PATCH también acepta `kind`; cambiar solo la modalidad conserva la unidad vigente sin revalidarla; la versión histórica conserva el `kind` anterior (trigger `service_versions_immutable`). Ver «Modalidad bloqueada por cotizaciones» (activa). Los índices únicos de la migración son la última barrera ante carreras. Impedir servicios inactivos en cotizaciones nuevas corresponde a `quoteService` (ver «Cotizaciones»).

### Unidad de medida del servicio (una por servicio)

Cada servicio tiene **una sola unidad** (base y denominación opcional en `services`) con la tarifa del servicio. Un servicio que se cobra de dos formas se registra como dos servicios independientes con nombres diferenciados («Recorrido Virtual / VR — Por minuto» y «— Por proyecto»), colocados juntos con `sort_order`. La migración `20261027120000_service_unit_options` (aplicada; no se edita) admitió varias unidades por servicio; `20261030120000_service_single_unit_option` vuelve a una sola sin borrar historial.

- **Tablas internas**: se conservan `service_unit_options` (exactamente una fila vigente por servicio en la posición 1, `chk_service_unit_options_single`, con tarifa confirmada, `chk_service_unit_options_rate_confirmed`; aporta el texto comercial opcional) y `service_version_unit_options` (copia inmutable por versión, trigger `service_version_unit_options_immutable`; las versiones nuevas copian una sola unidad mediante CHECK `NOT VALID`, que no revalida las copias anteriores con alternativas o tarifa pendiente). `quote_items.service_version_unit_option_id` guarda la unidad cotizada con FK compuesta a la misma versión del servicio: el documento y el PDF leen de ahí la unidad y su texto comercial históricos.
- **Coherencia en PostgreSQL para cualquier escritor**: `services_sync_primary_unit_option` crea o sincroniza la posición 1 al insertar o cambiar la unidad o la tarifa del servicio; `service_versions_snapshot_unit_options` la copia en cada versión nueva; triggers de restricción diferidos comprueban al COMMIT que coincida con la unidad y la tarifa del servicio.
- **Capas**: `domain/serviceUnitOptions.js` (etiqueta con texto comercial y regla del texto: se conserva mientras la unidad no cambie); `domain/serviceCatalog.js` incluye `presentationLabel` entre los campos versionados; `serviceCatalogService` valida y bloquea FOR SHARE la unidad nueva (o al reactivar) antes de reservar el código y, en cada versión nueva, **sustituye la fila de unidad antes de actualizar el servicio** (un servicio anterior a la unidad única pierde así sus alternativas vigentes; su versión anterior las conserva); `serviceCatalogRepository` lee el texto comercial con un JOIN a la posición 1.
- **Cotizaciones**: `chooseQuoteUnitOption` (`domain/quote.js`) usa la unidad del servicio (posición 1) o, en un concepto ya cotizado con esa misma versión, la unidad que tenía; la tarifa de referencia es la del tabulador y la aplicada la decide el administrador. `formatUnitOptionLabel` da la etiqueta (texto comercial o composición) a la API, al documento y al PDF.
- **Denominaciones en uso**: cuentan también las copiadas en versiones (`measurementUnitDenominationRepository` y el trigger `prevent_denomination_unit_change`).
- **Separación de servicios con alternativas**: `scripts/split-service-units.mjs` (`services/serviceUnitSplitService.js`) versiona cada original con su nombre nuevo y crea las variantes con los servicios del backend; ver «Carga del catálogo oficial».
- Pruebas: `tests/serviceUnitOptions.test.js`, `tests/serviceUnitOptionsMigration.test.js`, `tests/serviceUnitOptions.integration.test.js` (historial con alternativas, versionado, migración de unidad única, cotización y PDF) y `tests/serviceUnitSplit.integration.test.js`.

### Carga del catálogo oficial (comando de mantenimiento)

`scripts/load-official-service-catalog.mjs` registra una sola vez el catálogo oficial desde un archivo JSON que vive **fuera del repositorio** (contiene información comercial). No hay endpoint ni botón: es una operación de mantenimiento.

- **Modos**: `--dry-run` (por defecto, solo lectura y sin consumir secuencias), `--apply` y `--verify` (solo lectura). `--apply` exige `--confirm-target <base@host>` y `--catalog-sha256` con la huella mostrada en el dry-run, para no aplicar otro archivo ni otra base por error.
- **Identidad**: la persona que ejecuta se autentica con su propia cuenta (`authenticateMaintenanceAdmin` en `credentialService`, mismo criterio de credenciales que el login y rol `admin` como las rutas del catálogo). La contraseña se pide sin eco o se lee de `ARCA_MAINTENANCE_ADMIN_PASSWORD`; nunca va en la línea de comandos. No se crea sesión ni se suplanta a nadie.
- **Capas**: `validation/officialServiceCatalogSchemas.js` (archivo completo y sin ambigüedades: orden 1..N, totales declarados, denominaciones declaradas, una unidad por servicio —`unit`, `denomination?`, `presentationLabel?`— y `sortOrder?` para colocar una variante junto a su original); `domain/officialServiceCatalog.js` (plan puro: cuerpos de alta, comparación con lo existente, códigos previstos); `repositories/catalogMaintenanceRepository.js` (lecturas, próximo id de secuencia sin consumirlo y bloqueo consultivo de carga); `services/officialServiceCatalogLoadService.js` (plan, carga y verificación). Las altas usan `createDenomination` y `createService`, con sus validaciones, bloqueos, versión 1 y errores.
- **Códigos**: el servicio de orden N debe quedar como `SERV-00N`. La carga se bloquea si existen servicios que no son exactamente los primeros del catálogo, si alguno difiere o si la secuencia no entrega el id esperado. Nunca reinicia secuencias ni modifica registros existentes.
- **Atomicidad**: cada alta es atómica; la carga es reanudable (lo creado e idéntico se omite) y antes de cada servicio comprueba la secuencia, deteniéndose si otra escritura intervino.
- **Auditoría**: cada alta registra una fila en `audit_logs` (`service_catalog.official_load.*`, `user_agent` = `maintenance:load-official-service-catalog`, ejecución y huella del archivo); la versión 1 de cada servicio lleva la nota del catálogo y el id de ejecución. El informe JSON se guarda fuera del repositorio (`~/ARCA_PRIVATE_BACKUPS/catalog-load/` por defecto).
- Pruebas: `tests/officialServiceCatalog.test.js` y `tests/officialServiceCatalogLoad.integration.test.js` (base aislada; con `ARCA_OFFICIAL_CATALOG_FILE` usan el archivo real).
- **Separación de unidades** (`scripts/split-service-units.mjs`, una vez, antes de `20261030120000_service_single_unit_option`): recibe el catálogo revisado (estado final, una unidad por servicio). El plan solo lee: cada servicio con alternativas debe figurar en el catálogo con la misma unidad, tarifa y datos salvo el nombre; las altas se planifican sobre ese estado con las reglas de la carga (`SERV-00N` de la secuencia, sin reiniciarla); bloquea si algún concepto de cotización usa un servicio afectado o habría que crear denominaciones, y guarda la huella del historial (versiones, unidades copiadas y conceptos). `--apply` exige destino, huella del archivo y huella del plan; versiona con `updateService`, crea con `createService`, audita (`service_catalog.unit_split.*` / `user_agent` = `maintenance:split-service-units`) y verifica el catálogo y el historial. Informe en `~/ARCA_PRIVATE_BACKUPS/service-unit-split/`. Utilidades compartidas de los comandos en `scripts/lib/maintenanceCommand.mjs`.

### Modalidad bloqueada por cotizaciones

**Estado: activa desde el 2026-10-26** con la migración `20261026120000_quotes`. `updateService` comprueba `serviceHasQuoteReferences` (EXISTS sobre `quote_items`) tras el `FOR UPDATE` del servicio y responde 409 `SERVICE_MODALITY_IN_USE`; los servicios exponen `kindLocked`. No se añadió el trigger opcional del punto 4: el alta de conceptos bloquea los servicios `FOR SHARE`, lo que basta para la carrera descrita.

**Regla.** Un servicio con al menos un concepto en una cotización guardada no puede cambiar `kind` (`individual` ↔ `turnkey`), sea cual sea el estado de la cotización (borrador guardado, enviada, cancelada, histórica, archivada) o del servicio (activo o inactivo). Cambiar de modalidad cambiaría el significado comercial de lo cotizado: una tarifa integral por m² frente a tarifas por servicio.

- Solo bloquea un cambio efectivo (`"kind"` en `listChangedServiceFields`): enviar el mismo `kind`, o cambiar tarifa, nombre, descripción, unidad, orden o estado, sigue las reglas actuales. Activar o desactivar no se bloquea.
- Rechazo: 409 `SERVICE_MODALITY_IN_USE` («La modalidad no se puede modificar porque este servicio ya está incluido en una cotización.»), sin `fields` (no es un error de validación), sin escrituras ni versión nueva. Se evalúa después de `expectedVersion`: una versión obsoleta sigue respondiendo 409 `SERVICE_VERSION_CONFLICT`.
- No se eliminan registros. El historial no cambia: `service_versions` es inmutable y cada versión conserva su `kind`.

**Identificación del uso.** Los conceptos deben guardar la versión del servicio cotizada (`service_version_id` → `service_versions.id`), no solo el servicio, para conservar tarifa, unidad y modalidad aunque el servicio cambie. Un servicio está «en uso» si existe algún concepto que referencie cualquiera de sus versiones (`EXISTS … join service_versions sv … where sv.service_id = $1`), sin filtrar por estado. Si el diseño final referencia `service_id` directamente, la consulta se simplifica y la regla es la misma.

**Protección transaccional (al implementar).**

1. Repositorio: consulta parametrizada de referencias (p. ej. `serviceHasQuoteReferences(client, serviceId)`), ejecutada con el cliente de la transacción.
2. `updateService`: tras `lockServiceForUpdate` (`FOR UPDATE` de la fila de `services`), la comprobación de `expectedVersion` y `listChangedServiceFields`, y antes de validar unidades o escribir: si cambia `kind` y hay referencias, `ConflictError("SERVICE_MODALITY_IN_USE", …)`. `withTransaction` revierte.
3. Concurrencia: el alta de un concepto debe bloquear la fila del servicio con `FOR SHARE` y leer su versión vigente en la misma transacción. `FOR SHARE` y `FOR UPDATE` se excluyen: si el cambio de modalidad gana, el concepto espera y cotiza la versión nueva; si gana el concepto, el cambio espera y su consulta posterior (instantánea nueva en READ COMMITTED) ve la referencia y responde 409. No basta una consulta previa fuera de la transacción.
4. Respaldo opcional en PostgreSQL, a decidir con la migración de cotizaciones: un trigger `BEFORE UPDATE OF kind ON services` que rechace el cambio con referencias, traducido a 409 en `serviceCatalogErrors.js`.
5. API y formulario: el detalle del servicio (`GET /admin/services/:id`) expondrá el uso (p. ej. `kindLocked`) para que «Modalidad de Contratación» se muestre deshabilitada con el motivo; el frontend asociará el 409 `SERVICE_MODALITY_IN_USE` al campo de modalidad y conservará el borrador, como ya hace con los demás errores del formulario.
6. Pruebas: `tests/serviceModalityLock.contract.test.js` (backend, router con base simulada) y `Frontend/tests/serviceModalityLock.contract.test.js` cubren la regla. La prueba «alarma» admite `quote_items` y las dos tablas de unidades del servicio (describen el servicio, no su uso) y sigue fallando si otra tabla nueva referencia `services` o `service_versions`. `tests/quotes.integration.test.js` la cubre con PostgreSQL desechable.

## Cotizaciones

Módulo `/api/admin/quotes` (solo administradores) con el flujo obligatorio: `routes/quotes.js` → `validation/quoteSchemas.js` → `controllers/quoteController.js` → `services/quoteService.js` → `repositories/quoteRepository.js` y `repositories/quoteParticipantRepository.js`. El PDF lo coordinan `quotePdfService.js` (ETag y 304), `quotePdfRenderer.js` (pdfkit) y `quotePdfAssets.js` (fuentes Inter WOFF de `@fontsource/inter` —WOFF2 no se incrusta en fontkit— y SVG de `assets/quote-pdf`, en caché de proceso). La presentación del documento (`domain/quoteDocument.js`) no conoce pdfkit. `vercel.json` incluye esos archivos en la función.

- **Versionado inmutable**: `quotes` guarda la identidad (`COT-001`, compuesto del id reservado con `nextval` mediante `formatGeneratedCode`, compartido con los servicios); cada guardado con cambios crea una `quote_versions` nueva con sus `quote_items`. Los triggers `prevent_quote_version_mutation` y `prevent_quote_item_mutation` impiden modificarlas (solo `is_current` de true a false) y un índice único parcial garantiza una sola versión vigente. Sin cambios efectivos (`hasQuoteContentChanged`) no hay versión nueva. PATCH exige `expectedVersion` (409 `QUOTE_VERSION_CONFLICT`). No existe eliminación.
- **Instantáneas**: cada versión copia el nombre del cliente y del proyecto; cada concepto referencia la versión del servicio (`service_version_id`, FK compuesta con `service_id`) y guarda cantidad, tarifa aplicada y subtotal. Un cliente, proyecto o servicio ya cotizado conserva su instantánea al editar aunque ya no esté disponible; los nuevos deben estarlo (400 con `fields`). El proyecto debe pertenecer al cliente; se admiten proyectos archivados.
- **Importes**: `calculateQuoteTotals` con el IVA referencial aplicado; cantidades enteras si la unidad no admite decimales (`collectWholeQuantityErrors`); un servicio por línea (`collectDuplicateServiceErrors`); 1–100 conceptos. La vista previa del frontend (`quoteAmounts.js`) importa este motor y `domain/quoteReferenceVat.js` (módulos puros, sin I/O) en lugar de replicar fórmulas; la prueba de paridad lo comprueba.
- **IVA referencial** (informativo, no fiscal; migración `20261031120000_quote_reference_vat`): tasa fija del 16 % (`QUOTE_REFERENCE_VAT_RATE` en `domain/quoteReferenceVat.js`; sin variable de entorno ni tabla de configuración). `resolveQuoteReferenceVat` decide la tasa de cada guardado: nueva → 16 %; edición → el IVA de la versión guardada (su tasa histórica, o sin IVA si es anterior a esta regla), sin sustituirlo en silencio. `quote_versions` guarda `reference_vat_enabled`, `reference_vat_rate` NUMERIC(5,2) y `reference_vat_amount` NUMERIC(14,2), con CHECK que replican el motor (`round(services_total × tasa / 100, 2)`; sin IVA, tasa null e importe 0); el total estimado se deriva al leer (`services_total + reference_vat_amount`). La huella de cambios incluye la tasa. El IVA es solo una referencia del formulario: no se suma al total y el PDF no lo imprime (solo el total de la cotización).
- **Bloqueos**: cotización `FOR UPDATE` → cliente y proyecto `FOR SHARE` → servicios `FOR SHARE` ordenados por id (`lockQuotableServices`), siempre en ese orden para evitar interbloqueos.
- **Listado**: paginación por cursor con fragmentos ORDER en lista blanca (`code` → id; `total` → `services_total` + id), búsqueda por código, cliente o proyecto (`toContainsPattern`, compartido en `utils/sqlPatterns.js`) y rango `createdFrom` (inclusivo) / `createdBefore` (exclusivo) sobre la creación de la cotización.
- **PDF persistente**: generación automática al crear o versionar, después del COMMIT. `GET /:quoteId/pdf?version=` sirve exclusivamente el archivo guardado; no regenera. ETag SHA-256, adjunto con CSP estricta, `private, no-cache`, `Vary: Cookie, Authorization`. `timeZone` se acepta por compatibilidad y no altera el documento. Escrituras 120/h; lecturas y recuperación de PDF 240/h por administrador.
- **Errores**: `quoteErrors.js` traduce FK, unicidad, bloqueos y triggers a `QUOTE_REFERENCE_CONFLICT`, `QUOTE_CONFLICT`, `QUOTE_CONCURRENT_UPDATE` y `QUOTE_HISTORY_IMMUTABLE`.

## Persistencia privada de PDF de cotizaciones

- **Reserva durable** (`20261103120000_quote_pdf_documents`): una fila por `quote_version_id` (PK/FK), creada junto con la versión y sus conceptos, sin modificar `quote_versions`. Conserva instantánea JSON de presentación, huella de origen, revisión de maquetación, zona horaria, clave S3 y nombre. Metadatos operativos: bucket, MIME, tamaño, SHA-256 del binario, fechas de generación/confirmación, estado (`pending`, `available`, `error`), intentos, token y vencimiento de reserva, código de error. El trigger impide borrar o cambiar identidad, modelo, bucket asignado, hash o tamaño ya fijados. RLS sin políticas y privilegios revocados a los roles API.
- **Clave**: `quotes/{quoteId}/versions/v{versionNumber}/COT-{id con mínimo 3 dígitos}-v{versionNumber}.pdf`. Ejemplo: `quotes/152/versions/v2/COT-152-v2.pdf`. No incluye datos personales ni nombres proporcionados por usuarios. Proyecto y cliente se relacionan mediante la versión comercial.
- **Privacidad**: exige `SUPABASE_QUOTE_PDF_BUCKET`, separado de `SUPABASE_STORAGE_BUCKET`. `quotePdfRepository` comprueba `storage.buckets.public = false` antes de transferir, sin caché de visibilidad. El usuario PostgreSQL necesita lectura de esos metadatos. Una configuración ausente, pública, inaccesible o compartida impide transferir; no existe fallback al bucket general. No se crean URLs públicas ni firmadas, ni se alteran permisos de los archivos generales.
- **Consistencia**: `quoteService` confirma la transacción comercial, libera la conexión y espera un intento de generación/subida coordinado por `quotePdfService`. El fallo no revierte una cotización guardada: `quote.pdf` informa el resultado y el frontend muestra aviso. `changed:false` no genera ni sube. El replay de `submissionId` recupera pendientes sin repetir el Draft ni la cotización.
- **Concurrencia**: una actualización atómica adquiere un token UUID durante 10 minutos, sin conexiones retenidas. Preparación y confirmación exigen el token y vigencia; una ejecución obsoleta no confirma ni invalida otra. Antes de PUT se fijan hash, tamaño y bucket; no pueden cambiar después. HEAD permite adoptar una subida anterior, verificando también sus bytes antes de confirmarla. `If-None-Match: *` es defensa adicional, **no la garantía de consistencia**: Supabase tiene un [reporte abierto de esa precondición](https://github.com/supabase/storage/issues/1635). Aunque se ignore, ejecuciones de esta aplicación solo pueden reenviar los mismos bytes a la clave de esa misma versión. Cada versión tiene su propia clave. El bucket debe ser exclusivo del backend, sin escritores externos ajenos a este protocolo.
- **Recuperación**: `POST /:quoteId/pdf/retry?version=` (solo admin) adquiere o retoma la reserva. Si el proceso cayó antes de subir, genera; si subió sin confirmar, verifica y adopta; si otro trabaja, devuelve 202. No hay procesamiento en segundo plano ni cron: tras un corte se necesita reintento idempotente del alta o acción administrativa. Al vencer la reserva puede continuar otra instancia. Nunca se elimina un objeto de resultado incierto: su fila previa conserva la clave para reconciliarlo. Esta recuperación solo abarca este módulo, no los huérfanos generales de `storedUpload`.
- **Objeto perdido o corrupto**: GET verifica hash y tamaño antes de servir; incluso un 304 consulta existencia y metadatos. La ausencia invalida el estado y permite regeneración controlada; el binario debe coincidir con el hash original. Un objeto con identidad o bytes inconsistentes se informa como error y requiere revisión, sin borrarlo ni reemplazarlo. Una confirmación SQL incierta conserva ambos recursos para el siguiente intento.
- **Reproducibilidad**: fecha visible de creación de la cotización en `America/Caracas`; fechas internas PDF fijadas al instante de creación de su versión. El modelo se congela antes del COMMIT. No cambia la maquetación ni exige campos adicionales al Draft. Recursos Inter/SVG compartidos por proceso; antes de cambiar renderer, fuentes o vectores, aumentar `QUOTE_PDF_LAYOUT_REVISION` y conservar el generador anterior si se requiere regenerar documentos perdidos de esa revisión. Los PDF existentes se sirven tal como están.
- **Límites**: máximo 8 MiB por PDF; buffers acotados para generación y verificación íntegra antes del streaming HTTP. Plazos específicos: solicitud S3 3 s, PUT 10 s, cuerpo completo 8 s; lecturas cancelables desde el visor. No se modifican plazos globales ni `maxDuration:30` de Vercel. Una terminación de la función sigue siendo recuperable mediante la reserva durable.
- **Paginación del documento**: la revisión 2 limita cada página a diez servicios, contando de nuevo tras cada salto. También continúa antes si una fila no cabe; repite cabecera, título y columnas de la tabla. Total y observaciones aparecen después del último concepto. La revisión 1 conserva el salto por espacio disponible para recuperar los PDF anteriores con sus mismos bytes. Cada reserva nueva registra la revisión 2; la lectura de documentos ya almacenados conserva su revisión original.

### Preparación del despliegue (requiere autorización posterior)

1. Revisar `pnpm db:migrate:status` y todas las migraciones pendientes antes de ejecutar `pnpm db:migrate:deploy` al entorno autorizado; no usar db push ni reset. La migración nueva es aditiva y no modifica cotizaciones previas ni Storage. Desplegar el backend después de la migración y luego el frontend.
2. Crear o seleccionar un bucket exclusivo **privado**, sin acceso anónimo ni políticas para clientes/arquitectos. Configurar `SUPABASE_QUOTE_PDF_BUCKET` solo en el backend y mantener las credenciales S3 fuera del frontend. Verificar acceso SQL a `storage.buckets` y a la tabla nueva.
3. Validar en staging con una cotización de prueba: alta con Draft, edición, estado available, historial, GET autenticado, recuperación y 401/403. Confirmar los permisos anteriores de los archivos generales.
4. Las versiones heredadas o con generación fallida se recuperan desde su visor, que pide una recuperación automática (`POST /:quoteId/pdf/retry`) al abrir un documento pendiente, con error o perdido; GET nunca genera. Para rollback, conservar tabla, bucket y documentos; no borrar objetos.
   - **Requisito del despliegue:** `SUPABASE_QUOTE_PDF_BUCKET` debe estar definida en el backend desplegado (`arca-quote-pdfs`, distinta de `SUPABASE_STORAGE_BUCKET`). Sin ella cada alta guarda la cotización pero el PDF queda en `error` con `QUOTE_PDF_STORAGE_PRIVATE_REQUIRED` (ocurrió en staging: ningún PDF se generó al crear la cotización y todos se recuperaron después manualmente). La recuperación devuelve ese código con un mensaje de configuración en lugar de pedir otro reintento.
5. Comprobar latencia y memoria en el plan Vercel contratado. Si una caída dejó un documento pending, esperar el vencimiento de diez minutos y usar Reintentar; revisar eventos `quote_pdf_failed` y `quote_pdf_record_failed`. Una discrepancia de integridad necesita revisión manual autorizada.

Pruebas: `quotePdfPersistence.test.js` (dominio y adaptador SDK), `quoteRoutes.test.js` (HTTP, permisos, fallos e idempotencia), `quotePdfPersistence.integration.test.js` (PostgreSQL local desechable, migraciones, RLS, concurrencia y S3 simulado), y `Frontend/tests/browser/adminQuotes.test.js` (descarga, errores, recuperación, zoom, páginas, versiones y responsive).

Archivos de la implementación:

| Área | Archivos relativos al repositorio |
| --- | --- |
| Persistencia | `Backend/prisma/schema.prisma`, `Backend/prisma/migrations/20261103120000_quote_pdf_documents/migration.sql`, `Backend/src/domain/quotePdfDocument.js`, `Backend/src/repositories/quotePdfRepository.js` |
| Flujo y almacenamiento | `Backend/src/services/quoteService.js`, `Backend/src/services/quotePdfService.js`, `Backend/src/services/quotePdfRenderer.js`, `Backend/src/services/objectStorage.js`, `Backend/src/repositories/quoteRepository.js` |
| HTTP | `Backend/src/controllers/quoteController.js`, `Backend/src/routes/quotes.js`, `Backend/src/validation/quoteSchemas.js`, `Frontend/src/api/quotesApi.js` |
| Visor y acciones | `Frontend/src/pages/admin-services-quotes/quotes/components/QuotePdfViewerModal.jsx`, `Frontend/src/pages/admin-services-quotes/quotes/hooks/useQuotePdfDocument.js`, `Frontend/src/pages/admin-services-quotes/quotes/hooks/useQuotePdfDownload.js`, `Frontend/src/pages/admin-services-quotes/quotes/QuotesPanel.jsx`, `Frontend/src/pages/admin-services-quotes/quote-editor/QuoteEditorPage.jsx` |
| Pruebas | `Backend/tests/quotePdfPersistence.test.js`, `Backend/tests/quotePdfPersistence.integration.test.js`, `Backend/tests/quoteRoutes.test.js`, `Backend/tests/projectDraftQuotes.integration.test.js`, `Backend/tests/helpers/quoteDatabaseMock.js`, `Backend/tests/helpers/quotePdfMock.js`, `Frontend/tests/browser/adminQuotes.test.js` |
| Contratos y operación | `Backend/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, `Frontend/DESIGN_SYSTEM.md` |

## Proyectos draft desde cotizaciones

Migraciones `20261102120000_project_draft_status` (valor del enum, sola porque no puede usarse en la misma transacción), `20261102121000_project_draft_requirements` y `20261102122000_quote_submission_id`; preflight y postcheck en `prisma/checks/20261102121000_project_draft_requirements/` (solo lectura, huella de los datos existentes). Ninguna modifica filas.

- **Estado real `draft`**: proyecto preliminar creado al guardar una cotización con un nombre de proyecto nuevo. No es un proyecto contratado ni en ejecución y guardar cotizaciones nunca cambia su estado (las cotizaciones no tienen estado comercial). Es exclusivo de `projects` (`chk_project_stages_status_not_draft`, `chk_project_milestones_status_not_draft`).
- **Datos mínimos sin valores ficticios**: `start_date`, `project_type`, `location` y `has_plans` admiten NULL solo en un draft (también archivado desde draft); `chk_projects_draft_requirements` los exige en cualquier otro estado y `chk_projects_draft_without_end_date` impide la fecha de entrega. `toProject` devuelve `hasPlans: null` en lugar de `false`. La aprobación de solicitudes conserva `coalesce(has_plans, false)`: ahí `false` sigue significando «no indicado».
- **Alta atómica** (`quoteService.createQuote`, una transacción): bloqueo consultivo del envío (`lockQuoteSubmission`) → repetición o 409 `QUOTE_SUBMISSION_REUSED` (`findQuoteSubmission` y la huella SHA-256 de `buildQuoteSubmissionContent`) → cliente `FOR SHARE` (disponible) → conceptos y servicios `FOR SHARE` → id de la cotización → `projectService.createDraftProject` (nombre disponible con `findExistingProjectNameForClient`, la regla de las solicitudes: proyectos no cancelados y solicitudes activas; id reservado; slug `nombre-<id>`; `audit_logs` `project.create_from_quote`) → `quotes` con `submission_id` y huella → versión y conceptos. Cualquier fallo revierte todo. El bloqueo consultivo va primero para que un reintento simultáneo espere y encuentre la cotización registrada, sin chocar con el nombre del proyecto que el primero creó; `uq_quotes_created_by_submission` (por autor) es la última barrera. `submissionId` es opcional: sin él (frontend anterior) el alta no toma el bloqueo ni busca repeticiones y guarda identificador y huella NULL, lo que permite publicar el backend antes que el frontend. Dos altas distintas con el mismo nombre se resuelven con `uq_projects_client_active_name`: la segunda espera al COMMIT y recibe 400 en `fields.newProjectName` (`quoteErrors.js`).
- **Edición**: solo `projectId` (cualquier proyecto existente del cliente, incluidos drafts); no crea proyectos.
- **Visibilidad**: `utils/projectDraftVisibility.js` (`nonDraftProjectCondition`) se compone en todas las condiciones de acceso que no son de administrador: `projectRepository` (listado, detalle, slug, estado directo, foto del arquitecto, publicación), `projectCommentRepository` (comentarios, documentos y SSE), `fileRepository` (subida, borrado y descarga) y `environmentCommentAccess`. Para clientes y arquitectos un draft es un recurso inexistente (404). El administrador prepara el borrador: puede **subir archivos** (`POST /projects/:id/files`, `assertProjectOperationallyMutable(projectId, { allowDraft: isAdmin })` y `uploadProjectFile` con `configuringDraft`) y **asignar encargados** (`PUT /admin/projects/:id/assignees`, `allowDraft: true`; `replaceProjectAssignees` ya no excluye draft). Los comentarios y la eliminación de archivos siguen respondiendo 409 `PROJECT_DRAFT` (`projectMutationPolicy`, `createProjectReadOnlyError`). Asignar encargados no da acceso: para el arquitecto un draft sigue siendo inexistente hasta «Finalizar configuración». La métrica de proyectos activos ya cuenta solo `pending` e `in_process`.
- **Aprobación de solicitudes**: crea un proyecto **draft** (ver «Configuración de proyectos draft»); el 23505 de `uq_projects_client_active_name` se traduce a 409 `PROJECT_NAME_ALREADY_EXISTS` (`projectRequestWorkflowService`); cualquier otro error se propaga.

### Configuración de proyectos draft (aprobación → draft → pending)

Migración `20261113120000_project_draft_configuration` (aditiva: textos de configuración, primer contacto, `project_folders`, `files.folder_id` y `project_warranties`; retira `chk_projects_draft_without_end_date` porque un borrador configurado planifica su entrega). Capas: `domain/projectConfiguration.js` (mapeo, requisitos, progreso) → `repositories/projectConfigurationRepository.js` → `services/projectConfigurationService.js` → `controllers/projectConfigurationController.js`, rutas en `routes/admin.js` (sesión + rol admin) y esquemas en `validation/projectConfigurationSchemas.js`.

- **Aprobar** (`decideProjectRequest`, misma transacción con `FOR UPDATE` de la solicitud, lo que la hace idempotente: un reintento recibe 409): crea el proyecto en `draft` con `mapRequestToDraftProject` (nombre, cliente, tipo, descripción, ubicación con dirección, coordenadas y lugar, planos). **No** copia como definitivos el rango de inversión (no es presupuesto), el tamaño aproximado (no es un área), el plazo esperado (no confirma `start_date`) ni los responsables que revisaron la solicitud (no son responsables operativos): se devuelven como referencia (`request.suggestedAssigneeIds`, `investmentRange`, `projectSize`, `expectedStartTime`). Los adjuntos pasan al proyecto como antes. La notificación al cliente no enlaza el proyecto.
- **Visibilidad**: el draft sigue invisible para clientes y arquitectos (`nonDraftProjectCondition`). El cliente consulta su solicitud: `convertedProjectAvailable` indica si el proyecto ya salió de draft y `firstContactAt` si se registró el primer contacto. Mientras sea draft, su miniatura usa los adjuntos por la ruta de la solicitud.
- **Configurar** (solo admin, solo draft; otro estado → 409 `PROJECT_NOT_DRAFT`): cada guardado bloquea el proyecto `FOR UPDATE` y no cambia su estado. Secciones: general (datos, responsables con la regla de elegibilidad de la asignación del dashboard, zonificación, procedimientos, condiciones, equipo), seguimiento (fases e hitos sustituidos con `deleted_at`, entrega estimada en `end_date`, progreso = % de fases finalizadas) y garantías (opcionales; inicio ≤ servicio ≤ fin). El cliente del proyecto no se edita.
- **Fechas civiles** (Fase 1.1). `isConfigurationDate` comprueba calendario gregoriano y años 0001–9999 sin convertir a `Date`. Los esquemas lo reutilizan en entrega, fases, hitos y garantías. `findTrackingDateErrors` comprueba las fechas informadas, inicio ≤ fin de cada fase y entrega ≥ inicio más temprano de las fases. El guardado de seguimiento y la finalización reutilizan esta regla con el proyecto bloqueado. Se permiten fechas nulas en fases incompletas al guardar. Finalizar vuelve a exigir fases completas y revisa los datos persistidos, incluidos borradores guardados antes de esta corrección. Los errores de fechas también aparecen en `missingRequirements`.
- **Lectura de fechas**. Las consultas de configuración convierten exclusivamente sus columnas `DATE` con `to_char(..., 'YYYY-MM-DD')`. Servicio y repositorio conservan esas cadenas, independientemente de `TZ`, zona horaria PostgreSQL y `DateStyle`. Los instantes de auditoría y primer contacto mantienen su serialización existente. Los demás repositorios conservan sus tipos.
- **Errores de escritura**. `services/projectConfigurationErrors.js` traduce restricciones conocidas a 400 `VALIDATION_ERROR`, referencias retiradas (`23503`) y concurrencia (`40001`/`40P01`) a 409 `PROJECT_CONFIGURATION_CONFLICT`. Se aplica fuera de las transacciones de configuración, creación de carpetas y borradores manuales, por lo que también captura errores diferidos del `COMMIT`. Conserva los errores de aplicación y delega los desconocidos al middleware central. Los mensajes públicos se construyen con textos fijos. La respuesta de validación del guardado utiliza rutas `body.*`; la finalización conserva sus códigos de requisitos y añade `estimatedDeliveryDate.beforeStart` para la entrega incoherente.
- **Datos opcionales**. Las coordenadas siguen siendo opcionales y se informan juntas. La finalización permite ambas nulas. El guardado general conserva el valor previo de `has_plans` cuando llega null, y finalizar aplica `coalesce(has_plans, false)` cuando todavía se desconoce. Estas convenciones siguen vigentes.
- **Migración conservada**. La alternativa B de Fase 1.1 conserva el SQL y checksum originales. Las restricciones ya se crean validadas y las correcciones se realizan en la aplicación, por lo que esta fase carece de una migración adicional. El [preflight](prisma/checks/20261113120000_project_draft_configuration/preflight.sql) y el [postcheck](prisma/checks/20261113120000_project_draft_configuration/postcheck.sql) son transacciones de solo lectura con rollback. Su futura aplicación exige destino e historial confirmados, respaldo restaurado y ensayado, tráfico pausado, límites de bloqueo/sentencia/transacción verificados y todos los indicadores y huellas correctos. Un error, timeout, historial divergente o huella diferente detiene la operación para diagnóstico. El SQL original mantiene bloqueos exclusivos durante su transacción y una migración posterior no reduciría esa espera inicial. La validación local con datos sintéticos comprueba integridad y rollback, y requiere un ensayo adicional con volumen representativo para dimensionar la ventana compartida.
- **Archivos del borrador**: carpetas jerárquicas libres (`project_folders`, nombre único entre hermanas sin distinguir mayúsculas; solo se elimina una carpeta vacía), subida dentro de una carpeta (`uploadProjectFile` con `configuringDraft`, única escritura de archivos en draft; repite bajo bloqueo estado y carpeta) y mover archivos. Los adjuntos de la solicitud se reconocen por `origin_project_request_id` («Archivos del cliente»).
- **Finalizar configuración** (única transición draft → pending): con el proyecto bloqueado comprueba draft y los requisitos de Figma (nombre, cliente, ≥1 responsable, tipo, área general, área de construcción, ubicación ≥5, zonificación, ≥1 fase con nombre, estado y fechas); si falta algo responde 400 con un campo por requisito. Fija `start_date` al inicio de la primera fase, `has_plans` a false si nunca se informó, registra `project_status_history`, `audit_logs` (`project.configuration_finalized`) y notifica al cliente. **No** pasa a `in_process`.
- **Primer contacto**: `POST /admin/project-requests/:id/first-contact` registra fecha y autor una sola vez (solo `converted`; idempotente; auditado).
- **Pendiente**: reemplazo de un archivo por una versión nueva («Reemplazar archivo» de Figma) y edición de proyectos fuera de draft.

**Requisitos de PostgreSQL fuera de draft.** `chk_projects_draft_requirements` exige `start_date`, `project_type`, `location` y `has_plans`; la finalización los garantiza. Pruebas: `tests/projectDraftMigration.test.js`, `tests/projectDraftVisibility.test.js`, `tests/quoteRoutes.test.js` y `tests/projectDraftQuotes.integration.test.js` (PostgreSQL desechable: migración sobre datos existentes, rollback, concurrencia e idempotencia).

#### Aplicación segura de la migración de configuración

Este procedimiento pertenece a la Fase 1.1 y queda registrado en esta documentación versionada. Su ejecución sobre una base compartida requiere autorización de aplicación. Se conserva `20261113120000_project_draft_configuration/migration.sql` con SHA-256 `7e5aa94035425b39ea49d325c0c9eba050b44c3c3b8c53ecaeb06eeea2475635`. Las restricciones del archivo original ya se crean validadas y las correcciones de fechas y errores pertenecen a la aplicación, por lo que esta subfase requiere cero migraciones posteriores.

La transacción del archivo conserva sus bloqueos hasta `COMMIT`. Los cambios de columnas y restricciones sobre `projects`, `project_requests` y `files` requieren bloqueos exclusivos que afectan incluso a lecturas. La validación de restricciones y el índice ordinario de `files` pueden recorrer datos existentes. Las claves foráneas también adquieren bloqueos sobre tablas referenciadas, incluidos `users` y `projects`. Una solicitud DDL en espera puede acumular consultas detrás de ella. El tiempo de ejecución depende del volumen y de las transacciones concurrentes. La espera inicial ocurre antes de que pueda actuar una migración posterior. Referencias de PostgreSQL sobre [ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html) y [CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html).

1. Confirmar entorno, identidad de la base, versión de PostgreSQL, permisos y checksum del SQL. Prisma selecciona `DIRECT_URL` con precedencia sobre `DATABASE_URL`. Configurar psql para el mismo destino mediante parámetros privados del cliente y preservar TLS. Evitar imprimir o registrar credenciales. Ejecutar desde `Backend` `pnpm db:migrate:status` y comprobar que únicamente esta migración está pendiente, con historial coherente y sin intentos incompletos. Si ya está aplicada con el checksum esperado, revisar el estado existente y omitir su reaplicación. Un checksum diferente exige diagnóstico antes de continuar.
2. Acordar una ventana de mantenimiento y pausar tráfico y procesos que accedan a las tablas afectadas, incluidos backend, tareas y cargas en curso. Drenar transacciones y evitar ejecutores de migraciones o despliegues concurrentes. Mantener esa pausa hasta completar el postcheck para obtener huellas comparables.
3. Obtener un respaldo completo en una ubicación privada, calcular su hash y comprobar que `pg_restore --list` puede leerlo. Restaurarlo en una base temporal aislada con versión y volumen representativos, ensayar el SQL original y comparar las huellas. Medir duración y esperas para dimensionar la ventana y sus límites. Un respaldo cuya restauración no se haya ensayado impide continuar.
4. Ejecutar `psql -X -v ON_ERROR_STOP=1 -f prisma/checks/20261113120000_project_draft_configuration/preflight.sql` con la conexión privada previamente confirmada. Guardar la salida fuera del repositorio. Exigir todos los indicadores `ok_*` verdaderos, incluida la visibilidad de sesiones y la ausencia de otras transacciones abiertas. Revisar también tamaños y huellas. Un código de salida 0 de psql requiere además inspeccionar los indicadores. Un error, indicador falso o timeout detiene la operación.
5. Configurar para la conexión temporal del ejecutor límites de bloqueo, sentencia y transacción acordes al ensayo. Como valores iniciales para validar en la copia aislada, usar `lock_timeout=3s`, `statement_timeout=60s` y, en PostgreSQL 17+, `transaction_timeout=90s`. El primero limita cada adquisición de bloqueo, el segundo cada sentencia y el tercero la transacción completa. Pasarlos en `options` de la URL temporal seleccionada por Prisma, con espacios codificados como `%20`, y comprobar sus valores efectivos. libpq/psql interpreta `+` literalmente. `PGOPTIONS` por sí solo requiere comprobar soporte en el conector utilizado. Conservar la configuración TLS y mantener esos valores en el ámbito del proceso ejecutor. Los scripts de lectura establecen sus propios límites locales. [Parámetros de sesión de PostgreSQL](https://www.postgresql.org/docs/18/runtime-config-client.html).
6. Repetir el estado y confirmar la misma única pendiente antes de ejecutar una vez `pnpm db:migrate:deploy` dentro de la ventana autorizada. Vigilar duración, sesiones y esperas con `pg_stat_activity` y `pg_locks`. El bloqueo consultivo de Prisma, el registro de historial y los permisos también pueden impedir el inicio. Un timeout, error, cola creciente o bloqueo fuera del presupuesto detiene el procedimiento y mantiene el servicio en mantenimiento hasta determinar el estado real.
7. Ante un fallo, comprobar el rollback de la transacción explícita, el esquema, las huellas y las conexiones antes de decidir un reintento. Prisma puede conservar un intento fallido en `_prisma_migrations`. La reparación del historial exige diagnóstico y una decisión explícita. La terminación forzada de sesiones requiere una decisión operativa explícita. Evitar marcar la migración aplicada o revertida para eludir una discrepancia sin comprobar sus efectos.
8. Tras el éxito y antes de reabrir escrituras, ejecutar `psql -X -v ON_ERROR_STOP=1 -f prisma/checks/20261113120000_project_draft_configuration/postcheck.sql`. Exigir todos los indicadores verdaderos y las cuatro huellas idénticas al preflight. El script comprueba columnas, restricciones validadas, índices válidos, RLS, revocaciones, tablas nuevas vacías, columnas nuevas nulas y registro de migración terminado con checksum exacto. Ambos scripts fijan localmente zona horaria y DateStyle para que las huellas sean reproducibles. Sus transacciones son de solo lectura y terminan con `ROLLBACK`. Un error, timeout o diferencia impide reabrir el servicio y requiere diagnóstico con el respaldo disponible.
9. Confirmar ausencia de pendientes con `pnpm db:migrate:status`. Publicar el backend compatible bajo la autorización de despliegue correspondiente y comprobar salud y permisos antes de reabrir tráfico. El backend que consulta las columnas nuevas requiere primero la migración aplicada. La publicación del frontend de configuración depende del cierre y autorización de su fase.

El preflight corresponde al esquema anterior a esta migración. Las comprobaciones de tablas vacías y columnas nuevas nulas del postcheck corresponden al instante posterior a migrar y anterior a habilitar la funcionalidad. Los usos posteriores crean datos válidos que cambian esos resultados. Las huellas leen las cuatro tablas completas y tienen un límite de 30 s, por lo que un exceso exige revisar el volumen y la ventana antes de continuar.

Antes de la integración y del despliegue deben revisarse las pruebas de navegador y las integraciones optativas que quedaron sin ejecutar. Evaluar su aplicabilidad, ejecutar las que correspondan sobre entornos aislados y registrar los resultados y el motivo de cualquier omisión. Las pruebas locales con datos sintéticos y correo o almacenamiento simulados requieren complementarse con las comprobaciones de integración aplicables y con el ensayo de la migración sobre una copia representativa del destino.

## Clientes y cuentas pendientes desde cotizaciones

Migraciones `20261110130000_user_pending_status` (valor `pending` de `user_status`, sola porque un valor nuevo no puede usarse en su misma transacción) y `20261110131000_pending_client_accounts`; preflight y postcheck de solo lectura en `prisma/checks/20261110131000_pending_client_accounts/` (huella de usuarios y clientes). Ninguna modifica filas. **Despliegue:** migraciones, después backend y después frontend; el backend anterior nunca crea cuentas pendientes.

- **Modelo sin datos ficticios**: `users.email` y `users.password_hash` admiten NULL solo en una cuenta `pending` (`chk_users_identity_unless_pending`); una cuenta `pending` nunca tiene contraseña (`chk_users_pending_without_password`), así que no puede iniciar sesión por construcción. `clients.email` es opcional: es el contacto comercial, no una identidad. No hay columna persona/empresa: el modelo actual ya representa a una empresa con `clients.name`. El nombre se guarda completo en `clients.name` y en `users.first_name`, con `last_name` vacío, sin dividirlo ni inventar apellidos.
- **Alta atómica** (`quoteService.createQuote`): bloqueo del `submissionId` → repetición → `createQuoteClientAccount`: bloqueo consultivo `quote-client-creation`, que serializa estas altas → coincidencias otra vez bajo el bloqueo → `insertPendingClientAccount` (`adminUserRepository`, rol `client` activo) → resto del alta (cliente `FOR SHARE`, draft, cotización) → `audit_logs` `user.create_pending_from_quote`. Cualquier fallo revierte cliente, cuenta, draft y cotización.
- **Duplicados**: `public.person_name_key` (IMMUTABLE: NFD sin marcas U+0300–U+036F, espacios colapsados, minúsculas con `pg_c_utf8`; SQL solo ASCII mediante `chr()` para no depender de la codificación del cliente de psql) e índice no único `idx_clients_name_key`. `findQuoteClientNameMatches` devuelve fichas (también inactivas) y usuarios con rol cliente sin ficha, por la misma clave o porque todas las palabras de un nombre empiezan alguna del otro. Nunca fusiona ni vincula: sin confirmación (`acknowledged*Ids`), 409 `CLIENT_NAME_MATCHES` con `details.matches` (`AppError.details`, serializado por `app.js`). Vincular un usuario existente sin ficha a una ficha nueva no está implementado: modificaría una cuenta existente y queda como decisión separada.
- **Cuentas pendientes en administración**: visibles y editables en Usuarios (etiqueta «Pendiente»). Mientras siguen pendientes, el correo es opcional y no admiten contraseña. «Editar usuario» puede activarlas: con correo y contraseña pasan a `active`, y el formulario cambia el estado al definir la contraseña. También puede pasarlas a suspendidas o deshabilitadas con correo; sin contraseña, reciben un hash aleatorio inutilizable, como el alta administrativa. Conservan el rol `client` en esa edición y ninguna cuenta vuelve a `pending` (`assertPendingAccountEdit`, repetido bajo `FOR UPDATE`). La salida se audita (`user.activate_by_admin` / `user.leave_pending_by_admin`) e invalida el enlace de activación. La activación por el administrador no verifica el correo; el enlace sí. `PATCH /status` no las cambia. La ficha comercial sigue activa mientras están pendientes (`toClientStatus`). Mientras siguen pendientes, solo un correo distinto invalida el enlace enviado.
- **Activación (opción A)**: sin acceso desde la interfaz por ahora. Según Figma, el enlace de activación pertenece a «Crear usuario», cuyo envío sigue pendiente (decisión de staging). La gestión de usuarios no ofrece «Enviar activación»; una cuenta pendiente se activa desde «Editar usuario». `POST /api/admin/users/:userId/activation-link` (`accountActivationService`) firma un JWT con `purpose: "account_activation"`, guarda su hash en `password_recovery_tokens` (`createPasswordResetToken`, que invalida los anteriores) y lo envía con `sendResendEmail`. `/activar-cuenta` (`NewPassword` variante `activation`) usa `POST /api/auth/activation/verify` y `/complete`. `activatePendingAccount` bloquea la cuenta, exige que siga `pending` con el mismo correo, consume el token, guarda la contraseña, pasa a `active`, invalida los demás enlaces y audita `user.activate`. Abrir el enlace prueba el control del correo. Los propósitos no se cruzan: un enlace de activación no restablece contraseñas, ni al revés. `forgot-password` ignora cuentas no activas.
- **Riesgo conocido**: el autorregistro público por correo no conoce las cuentas pendientes (no tienen correo hasta que el administrador lo completa) y puede crear otra cuenta para la misma persona. Una vez completado el correo, el registro lo rechaza como duplicado.

Pruebas: `tests/quoteClientCreation.test.js`, `tests/quoteClientCreation.integration.test.js` (PostgreSQL desechable con `ARCA_SERVICE_CATALOG_DB_TESTS`: migración sobre datos existentes, transacción, rollback, concurrencia, activación y HTTP), `Frontend/tests/quoteNewClient.test.js`, `Frontend/tests/browser/adminQuotes.test.js` y `Frontend/tests/browser/pendingClientAccounts.test.js`.

## Unidades de medida (arquitectura B2)

- **Unidades base** (`measurement_units`): código estable (`square_meter`, `linear_meter`...), nombre completo, abreviatura (`m²`, `m.l.`...), decimales y estado. Concentran todas las reglas; las de negocio usan el código, nunca la abreviatura. Solo lectura en la API (`GET /api/admin/measurement-units`); el catálogo se amplía con cargas de datos autorizadas (`prisma/seeds/measurement_units.sql`).
- **Código público** (`measurement_unit_denominations.public_code`, `publicCode` en la API): identificador visible `UNID-001`, `UNID-1000`… Es una columna generada (`GENERATED ALWAYS AS … STORED`) a partir del `id`: hereda su unicidad y permanencia, es segura ante altas concurrentes, admite saltos y PostgreSQL rechaza escribirla. Es solo presentación y búsqueda; relaciones y reglas usan el `id`.
- **Denominaciones** (`measurement_unit_denominations`): texto personalizado sobre una base (`m²` + `de construcción`). Sin reglas propias y no se eliminan. Su base solo cambia si ningún servicio ni versión histórica la referencia (`baseUnitEditable`; el servicio lo comprueba tras `FOR UPDATE` y el trigger `measurement_unit_denominations_unit_immutable` lo impone: 409 MEASUREMENT_UNIT_BASE_IN_USE). Una denominación usada por servicios activos no se edita ni se desactiva (409 MEASUREMENT_UNIT_IN_USE): se crea otra y se reasignan los servicios.
- **Servicios**: `measurement_unit_id` (base, como antes) y `unit_denomination_id` opcional son la única unidad del servicio; `service_unit_options` la replica con su texto comercial (ver «Unidad de medida del servicio»). La clave foránea compuesta impide combinar la denominación de una base con otra. Cambiar la denominación crea una versión, y `service_versions` copia su id y su texto.
- **Presentación**: `domain/measurementUnitLabel.js` (`formatUnitLabel`, `normalizeUnitText`) es la única composición de etiquetas (`unitLabel`, `label`) para API, cotizaciones y PDF; `formatUnitOptionLabel` (`domain/serviceUnitOptions.js`) antepone el texto comercial de una unidad del servicio si lo tiene.
- **Unicidad**: índices de expresión con `lower(normalize(texto, NFKC) COLLATE pg_c_utf8)`; la intercalación integrada hace que las mayúsculas Unicode se comparen igual en cualquier entorno (con locale C, `lower()` solo convierte ASCII).
- **Concurrencia**: asignar una unidad o denominación a un servicio, o reactivar un servicio (aunque conserve las mismas), la revalida activa y la bloquea con `FOR SHARE`; editar o desactivar una denominación toma `FOR UPDATE` y cuenta los servicios activos en una sentencia posterior. Así nunca queda un servicio activo con una denominación inactiva.
- Archivos: `routes/measurementUnits.js`, `controllers/measurementUnitController.js`, `services/measurementUnitService.js`, `services/measurementUnitErrors.js`, `validation/measurementUnitSchemas.js`, `repositories/measurementUnitRepository.js` y `repositories/measurementUnitDenominationRepository.js`.

### Catálogo de unidades base

La carga inicial (`prisma/seeds/measurement_units.sql`) define 48 unidades para arquitectura, construcción, interiorismo, ingeniería, instalaciones, paisajismo, supervisión, procura y servicios profesionales. Se organizan en bloques de `sort_order` de 100 por categoría, con huecos para ampliar sin renumerar:

| Bloque | Categoría | Unidades (símbolo) |
| --- | --- | --- |
| 101 | Superficie | m², cm², pie², ha, km² |
| 201 | Longitud | m.l., m, mm, cm, km, pulg., pie |
| 301 | Volumen | m³, cm³, L, gal |
| 401 | Masa y peso comercial | kg, g, t |
| 501 | Cantidades, materiales y empaques | und., pza., pt., jgo., par, paq., caja, saco, rollo, lote |
| 601 | Tiempo | hrs, min, día, sem., mes, año |
| 701 | Personal y mano de obra | h-h, d-h |
| 801 | Servicios profesionales | proy., esp., vis., inf., plano, render, glb. |
| 901 | Energía, potencia y climatización | kWh, kW, kVA, TR |

- **Códigos**: inglés en `snake_case`, estables e independientes del texto visible. Las 11 unidades originales conservan código, nombre, símbolo y decimales.
- **Abreviaturas**: convención de interfaz de ARCA (≤10 caracteres, superíndices Unicode `²`/`³`), usadas en el Dropdown, tablas, cotizaciones y PDF. Son únicas tras `NFKC` y minúsculas, igual que los índices de PostgreSQL.
- **Decimales**: sí para magnitudes físicas, tiempo (salvo minuto), mano de obra y energía; no para unidades contables y empaques (und., pza., pt., jgo., par, paq., caja, saco, rollo, lote) ni para entregables y servicios (proy., esp., vis., inf., plano, render, glb.).
- **Base o denominación**: una unidad base es una magnitud o forma de contar distinta; una variante comercial es una denominación. Por eso no son bases salida (= pt.), jornada (= d-h), ambiente (= esp.) ni inspección (= vis.); se expresan como `pt. de salida eléctrica`, `vis. de inspección`, etc. Metro (`m`) y metro lineal (`m.l.`), y pieza (`pza.`) y unidad (`und.`), son bases separadas por decisión de ARCA para clasificar y presupuestar.
- **Carga**: la migración de datos `20261020130000_measurement_units_catalog_data` inserta el catálogo; su bloque `BEGIN…COMMIT` es idéntico al catálogo fuente `prisma/seeds/measurement_units.sql` (lo exige `tests/measurementUnitSeed.test.js`). Es idempotente por código (`ON CONFLICT (code) DO NOTHING`) y no modifica unidades existentes, cambios administrativos, denominaciones, servicios ni tarifas.
- **Ampliación**: añadir una unidad solo si no es expresable como denominación de una existente; elegir código, nombre y símbolo únicos (la carga falla ante equivalentes) y el siguiente `sort_order` libre de su bloque; añadirla al catálogo fuente y cargarla con una **migración de datos nueva** (las aplicadas no se modifican), actualizando las pruebas del catálogo.
- Ninguna modalidad restringe la unidad: un servicio llave en mano puede usar m², m³, m.l., und., pt., hrs o cualquier otra base activa del catálogo.

## Seguridad independiente de la plataforma y migración a VPS

Los controles de acceso viven en el backend y no dependen de Supabase, Netlify ni Vercel:

- **Archivos:** todo contenido protegido se sirve por la API (`objectStorage.get` tras comprobar acceso). Nunca se redirige a URLs del almacenamiento ni se devuelven claves (`sanitizePublicPayload`).
- **SSE:** `subscribeToProjectEvents` acepta `reauthorize` y revalida sesión y acceso cada `SSE_REAUTHORIZE_INTERVAL_MS` (30 s). Al perderlos, o si la revalidación falla, cierra el stream. Imprescindible en un servidor de larga duración.
- **Recuperación de contraseña:** los esquemas de `forgot-password`, `verify-reset-token` y `reset-password` exigen texto antes de los límites. Todo cambio de seguridad de la cuenta (contraseña, correo, rol, estado) invalida los enlaces pendientes (`invalidatePasswordResetTokens`), y el enlace debe corresponder al correo actual.
- **Límites:** por usuario para Geoapify y creación de soporte. Cuota de adjuntos de soporte (10 archivos / 200 MB), comprobada otra vez bajo bloqueo.
- **IP del cliente:** `CLIENT_IP_SOURCE=trusted-proxy` y `TRUST_PROXY` (`src/config/trustProxy.js`) permiten límites por IP detrás de Nginx sin cabeceras de Netlify.

Dependencias de la infraestructura actual que deben revisarse al migrar:

| Dependencia actual | Dónde | Al migrar al VPS |
| --- | --- | --- |
| IP verificada mediante la firma de Netlify (`X-Nf-Sign`) | `utils/verifiedClientIp.js` | Usar `CLIENT_IP_SOURCE=trusted-proxy` y `TRUST_PROXY=loopback`. Backend solo en `127.0.0.1`; Nginx debe sobrescribir `X-Forwarded-For` |
| `maxDuration: 30` acota la vida de SSE y peticiones | `vercel.json` | La revalidación SSE ya no depende de ello. Definir timeouts de Nginx para streams |
| Comprobación de privacidad solo para el bucket de PDF (`storage.buckets`, propio de Supabase) | `repositories/quotePdfRepository.js` | Con otro S3 o MinIO, garantizar buckets privados en la configuración del proveedor. La API no depende de que sean públicos |
| `file_url` persiste la forma `/storage/v1/object/public/…` de Supabase; las claves se derivan de él | `config/storage.js` | Mantener `getStorageObjectKeyFromFileUrl` compatible o migrar a guardar solo la clave |
| CSP, `frame-ancestors` y redirección `/api/*` definidos en Netlify (copia de la CSP en `Frontend/public/_headers`) | `netlify.toml` | Trasladar las cabeceras y el proxy a Nginx. `script-src` no admite `'unsafe-eval'`, solo `'wasm-unsafe-eval'` para pdf.js; `Frontend/tests/contentSecurityPolicy.test.js` fija la política y las pruebas de navegador de los visores la aplican |
| Bypass de autenticación para pruebas, que se desactiva ante marcadores de plataforma | `config/auth.js`, `config/environment.js` | En el VPS usar `NODE_ENV=production`; la guardia lo exige |

## Documentación de la lógica

Toda función o método de `src` debe tener un JSDoc en español cuya descripción inicial ocupe dos o tres líneas. El texto debe permitir que una persona externa entienda el propósito, las reglas de negocio y los efectos secundarios relevantes sin tener que reconstruirlos únicamente desde la implementación.

Los contratos deben usar `@param`, `@returns` y `@throws` cuando correspondan, incluyendo tipos y descripciones. Las funciones asíncronas con resultado documentan un `Promise<T>`. Los callbacks anónimos simples se excluyen; cuando contengan lógica relevante deben convertirse en helpers nombrados y documentados.
