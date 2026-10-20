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
- `domain/serviceCatalog.js`: reglas puras (tipos, compatibilidad `turnkey` ↔ unidad por código estable `square_meter`, detección de cambios efectivos).
- `services/serviceCatalogService.js`: coordina el versionado dentro de `withTransaction` (`config/db.js`); `services/serviceCatalogErrors.js` traduce 23505/23503/23001/23514/55000/40001/40P01 sin exponer PostgreSQL.
- `repositories/serviceCatalogRepository.js` y `repositories/measurementUnitRepository.js` (solo lectura de unidades): SQL parametrizado, `FOR UPDATE` del servicio y `FOR SHARE` de la unidad asignada.

Edición versionada (también para tarifa y estado; no existe otra ruta): bloquear el servicio → leer la versión vigente en una sentencia posterior (instantánea nueva en READ COMMITTED) → comparar con `expectedVersion` (409 SERVICE_VERSION_CONFLICT) → si no hay cambios efectivos, terminar sin versión → validar unidad → actualizar → retirar `is_current` → insertar la copia completa. El alta inserta el servicio y su versión 1 en la misma transacción. Los índices únicos de la migración son la última barrera ante carreras. Impedir servicios inactivos en cotizaciones nuevas corresponde al futuro servicio de cotizaciones.

## Unidades de medida (arquitectura B2)

- **Unidades base** (`measurement_units`): código estable (`square_meter`, `linear_meter`...), nombre completo, abreviatura (`m²`, `m.l.`...), decimales y estado. Concentran todas las reglas; las de negocio usan el código, nunca la abreviatura. Solo lectura en la API (`GET /api/admin/measurement-units`); el catálogo se amplía con cargas de datos autorizadas (`prisma/seeds/measurement_units.sql`).
- **Código público** (`measurement_unit_denominations.public_code`, `publicCode` en la API): identificador visible `UNID-001`, `UNID-1000`… Es una columna generada (`GENERATED ALWAYS AS … STORED`) a partir del `id`: hereda su unicidad y permanencia, es segura ante altas concurrentes, admite saltos y PostgreSQL rechaza escribirla. Es solo presentación y búsqueda; relaciones y reglas usan el `id`.
- **Denominaciones** (`measurement_unit_denominations`): texto personalizado sobre una base (`m²` + `de construcción`). Sin reglas propias; su base no cambia (trigger) y no se eliminan. Una denominación usada por servicios activos no se edita ni se desactiva (409 MEASUREMENT_UNIT_IN_USE): se crea otra y se reasignan los servicios.
- **Servicios**: `measurement_unit_id` (base, como antes) y `unit_denomination_id` opcional; la clave foránea compuesta impide combinar la denominación de una base con otra. Cambiar la denominación crea una versión, y `service_versions` copia su id y su texto.
- **Presentación**: `domain/measurementUnitLabel.js` (`formatUnitLabel`, `normalizeUnitText`) es la única composición de etiquetas (`unitLabel`, `label`) para API, cotizaciones y PDF.
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
- La regla llave en mano exige el código `square_meter`; otras superficies (ha, pie², km²) no se aceptan para esas modalidades.

## Documentación de la lógica

Toda función o método de `src` debe tener un JSDoc en español cuya descripción inicial ocupe dos o tres líneas. El texto debe permitir que una persona externa entienda el propósito, las reglas de negocio y los efectos secundarios relevantes sin tener que reconstruirlos únicamente desde la implementación.

Los contratos deben usar `@param`, `@returns` y `@throws` cuando correspondan, incluyendo tipos y descripciones. Las funciones asíncronas con resultado documentan un `Promise<T>`. Los callbacks anónimos simples se excluyen; cuando contengan lógica relevante deben convertirse en helpers nombrados y documentados.
