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
- Si falla PostgreSQL después de subir, eliminar el objeto.
- Si falla el almacenamiento, no confirmar la transacción.
- Las cancelaciones deben liberar streams y conexiones.
- Ninguna transferencia retiene una conexión ni un bloqueo: se reserva el id, se transfiere y se registra en una transacción corta que repite estado, acceso, duplicados y límites (`services/storedUpload.js`). La compensación solo elimina el objeto si su fila no existe.
- Adjuntos de solicitudes (`uploadPolicies.projectRequest`): `prepareUpload` comprueba la firma real del contenido y devuelve `ready`, que el servicio espera antes de transferir para responder 415 `INVALID_FILE_SIGNATURE` sin enviar al almacenamiento un flujo fallido. El validador conserva sus errores (firma o cancelación del cliente) con un oyente propio: el contenido llega antes de que el servicio lo lea y el SDK de S3 lo transfiere con `pipe`, que no escucha errores, así que un error sin oyentes terminaría el proceso.
- Política de adjuntos de solicitudes (`uploadPolicies.projectRequest`): JPEG, PNG, PDF, MP4 y MOV (`video/quicktime`, firma por el átomo inicial), con extensión y MIME coincidentes. Límite de 50 MB por archivo (`FILE_UPLOAD_MAX_BYTES`) y de 4,5 MB para vídeos (`maxBytesByType`, `PROJECT_REQUEST_VIDEO_MAX_BYTES`), el cuerpo máximo de una función de Vercel en el staging actual. MP4 y MOV se sirven en línea para su vista previa.
- Un adjunto de solicitud con el mismo nombre (sin distinguir mayúsculas) solo se reutiliza si coincide su tamaño: es el reintento de una subida cuya respuesta se perdió y responde 201 con `reused: true`. Otro contenido con el mismo nombre recibe 409 `DUPLICATE_PROJECT_REQUEST_FILE`; el detalle muestra el nombre normalizado (`file_versions.original_name`) y el cliente no puede detectar ese repetido antes de enviarlo.
- Borradores de solicitud al adjuntar: `POST /api/project-requests` con solo `{ submissionId }` (`createProjectRequestDraftSchema`, elegido en la ruta por `isEmptyProjectRequestDraftBody`) crea un borrador vacío e idempotente por `submissionId` (`createEmptyProjectRequestDraft`, `on conflict do nothing`) para asociar los adjuntos que el formulario sube al seleccionarlos; cualquier otro cuerpo exige la solicitud completa. Los datos se guardan después con `PATCH` (validación completa). Por eso `project_name`, `project_type` y `location` admiten NULL solo en `draft` (`chk_project_requests_identity_after_draft`, migración `20261106120000_project_request_attachment_drafts`), y el envío rechaza con 400 `VALIDATION_ERROR` (`findIncompleteProjectRequestFields`) un borrador sin los datos obligatorios antes de consumir el código. Los borradores no se listan al cliente ni al administrador; uno abandonado conserva sus adjuntos y no se elimina automáticamente (una limpieza masiva requiere autorización expresa).
- Validación temporal del envío (`config/projectRequestTestVerification.js`, decisión del desarrollador para la fase de desarrollo y staging): por defecto la emisión no genera ni envía correo y responde `verification.mode = "test"`, y el envío acepta cualquier código de 6 dígitos sin comprobar vencimiento, intentos ni coincidencia (registra `verified_at`). Se conservan autenticación, CSRF, propiedad, estado editable, validación del formulario e idempotencia del envío. `PROJECT_REQUEST_EMAIL_VERIFICATION=enabled` activa la verificación real por correo, que sigue implementada; debe activarse antes de producción (AGENTS.md §15).
- Las descargas usan `utils/streamResponse.js` (`pipeline`); S3, Resend y Geoapify tienen plazos explícitos (`STORAGE_*`, `EMAIL_REQUEST_TIMEOUT_MS`, `GEOAPIFY_REQUEST_TIMEOUT_MS`).

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

1. **Precisión del cursor de paginación.** El cursor guarda la fecha con milisegundos y `created_at` tiene microsegundos: el último elemento de una página puede repetirse al inicio de la siguiente. Los clientes deduplican por id (`collectCursorPages`, `projectCommentFeed`). Corregirlo afecta a todas las paginaciones por fecha.
2. **SSE entre instancias.** El bus de eventos está en memoria del proceso: en Vercel, un comentario creado en otra instancia no llega por SSE. El sondeo incremental se mantiene como respaldo (30 s con SSE conectado, el intervalo pedido sin él), así que un comentario puede tardar ese tiempo en aparecer.
3. **Calibración de `DATABASE_MAX_WAITING`.** El valor 200 es razonado, no medido: ajustarlo con las pruebas de carga junto con el tamaño del pool y `DATABASE_CONNECTION_TIMEOUT_MS`.
4. **Recuperación de archivos huérfanos.** Si el proceso cae entre la transferencia y el registro, o falla el borrado de compensación, el objeto queda en el almacenamiento y se registra como `storage_orphan_candidate`. También quedan objetos si falla el borrado posterior a eliminar un archivo. No existe todavía un proceso de limpieza.

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
4. Las versiones heredadas se recuperan explícitamente desde su visor, sin backfill remoto ni generación durante GET. Para rollback, conservar tabla, bucket y documentos; no borrar objetos.
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
- **Visibilidad**: `utils/projectDraftVisibility.js` (`nonDraftProjectCondition`) se compone en todas las condiciones de acceso que no son de administrador: `projectRepository` (listado, detalle, slug, estado directo, foto del arquitecto, publicación), `projectCommentRepository` (comentarios, documentos y SSE), `fileRepository` (subida, borrado y descarga) y `environmentCommentAccess`. Para clientes y arquitectos un draft es un recurso inexistente (404). El administrador recibe 409 `PROJECT_DRAFT` en archivos, comentarios y responsables (`projectMutationPolicy`, `createProjectReadOnlyError`, `replaceProjectAssignees`). La métrica de proyectos activos ya cuenta solo `pending` e `in_process`.
- **Aprobación de solicitudes**: sin cambios de flujo; solo el 23505 de `uq_projects_client_active_name` se traduce a 409 `PROJECT_NAME_ALREADY_EXISTS` (`projectRequestWorkflowService`); cualquier otro error se propaga.

**Transición futura draft → pending (no implementada).** La decidirá un administrador mediante un endpoint administrativo nuevo (no existe hoy edición de datos ni de estado de un proyecto). Requisitos: `projectType` vigente (no `stands_exhibitions`), `location` de 5–255 caracteres (coordenadas, dirección formateada y `providerPlaceId` opcionales, con las reglas de las solicitudes), `startDate`, `hasPlans` explícito y cliente activo; descripción, áreas y presupuesto opcionales. Debe registrar `project_status_history` (`draft` → `pending`) y `audit_logs`. `chk_projects_draft_requirements` ya lo impone en PostgreSQL. Pruebas: `tests/projectDraftMigration.test.js`, `tests/projectDraftVisibility.test.js`, `tests/quoteRoutes.test.js` y `tests/projectDraftQuotes.integration.test.js` (PostgreSQL desechable: migración sobre datos existentes, rollback, concurrencia e idempotencia).

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
| CSP, `frame-ancestors` y redirección `/api/*` definidos en Netlify | `netlify.toml` | Trasladar las cabeceras y el proxy a Nginx |
| Bypass de autenticación para pruebas, que se desactiva ante marcadores de plataforma | `config/auth.js`, `config/environment.js` | En el VPS usar `NODE_ENV=production`; la guardia lo exige |

## Documentación de la lógica

Toda función o método de `src` debe tener un JSDoc en español cuya descripción inicial ocupe dos o tres líneas. El texto debe permitir que una persona externa entienda el propósito, las reglas de negocio y los efectos secundarios relevantes sin tener que reconstruirlos únicamente desde la implementación.

Los contratos deben usar `@param`, `@returns` y `@throws` cuando correspondan, incluyendo tipos y descripciones. Las funciones asíncronas con resultado documentan un `Promise<T>`. Los callbacks anónimos simples se excluyen; cuando contengan lógica relevante deben convertirse en helpers nombrados y documentados.
