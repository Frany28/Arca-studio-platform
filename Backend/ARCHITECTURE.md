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

## Archivos

- `fileUploadService` valida nombre, MIME, extensión, tamaño y streaming.
- `objectStorage` encapsula el proveedor S3-compatible.
- Los controladores no deben usar comandos del SDK de AWS.
- No se permiten `Buffer` completos para uploads o descargas grandes.
- Si falla PostgreSQL después de subir, eliminar el objeto.
- Si falla el almacenamiento, no confirmar la transacción.
- Las cancelaciones deben liberar streams y conexiones.

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
- **IVA referencial** (informativo, no fiscal; migración `20261031120000_quote_reference_vat`): tasa fija del 16 % (`QUOTE_REFERENCE_VAT_RATE` en `domain/quoteReferenceVat.js`; sin variable de entorno ni tabla de configuración). `resolveQuoteReferenceVat` decide la tasa de cada guardado: nueva → 16 %; edición → el IVA de la versión guardada (su tasa histórica, o sin IVA si es anterior a esta regla), sin sustituirlo en silencio. `quote_versions` guarda `reference_vat_enabled`, `reference_vat_rate` NUMERIC(5,2) y `reference_vat_amount` NUMERIC(14,2), con CHECK que replican el motor (`round(services_total × tasa / 100, 2)`; sin IVA, tasa null e importe 0); el total estimado se deriva al leer (`services_total + reference_vat_amount`). La huella de cambios incluye la tasa. El PDF imprime los importes guardados.
- **Bloqueos**: cotización `FOR UPDATE` → cliente y proyecto `FOR SHARE` → servicios `FOR SHARE` ordenados por id (`lockQuotableServices`), siempre en ese orden para evitar interbloqueos.
- **Listado**: paginación por cursor con fragmentos ORDER en lista blanca (`code` → id; `total` → `services_total` + id), búsqueda por código, cliente o proyecto (`toContainsPattern`, compartido en `utils/sqlPatterns.js`) y rango `createdFrom` (inclusivo) / `createdBefore` (exclusivo) sobre la creación de la cotización.
- **PDF**: `GET /:quoteId/pdf?timeZone=` (zona IANA del navegador; UTC si falta o no es válida) responde como adjunto con la CSP estricta de `getFileResponseSecurity`, `Cache-Control: private, no-cache` y ETag `"quote-<id>-v<versión>-<zona>-r1"` (subir `r1` si cambia el diseño del documento; el resumen con IVA referencial no lo subió porque ninguna versión anterior tenía IVA y su PDF no cambia). Límites: escrituras 120/h y PDF 240/h por administrador (`actionRateLimits.js`).
- **Errores**: `quoteErrors.js` traduce FK, unicidad, bloqueos y triggers a `QUOTE_REFERENCE_CONFLICT`, `QUOTE_CONFLICT`, `QUOTE_CONCURRENT_UPDATE` y `QUOTE_HISTORY_IMMUTABLE`.

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

## Documentación de la lógica

Toda función o método de `src` debe tener un JSDoc en español cuya descripción inicial ocupe dos o tres líneas. El texto debe permitir que una persona externa entienda el propósito, las reglas de negocio y los efectos secundarios relevantes sin tener que reconstruirlos únicamente desde la implementación.

Los contratos deben usar `@param`, `@returns` y `@throws` cuando correspondan, incluyendo tipos y descripciones. Las funciones asíncronas con resultado documentan un `Promise<T>`. Los callbacks anónimos simples se excluyen; cuando contengan lógica relevante deben convertirse en helpers nombrados y documentados.
