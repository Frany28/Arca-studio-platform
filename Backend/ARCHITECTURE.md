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

## Documentación de la lógica

Toda función o método de `src` debe tener un JSDoc en español cuya descripción inicial ocupe dos o tres líneas. El texto debe permitir que una persona externa entienda el propósito, las reglas de negocio y los efectos secundarios relevantes sin tener que reconstruirlos únicamente desde la implementación.

Los contratos deben usar `@param`, `@returns` y `@throws` cuando correspondan, incluyendo tipos y descripciones. Las funciones asíncronas con resultado documentan un `Promise<T>`. Los callbacks anónimos simples se excluyen; cuando contengan lógica relevante deben convertirse en helpers nombrados y documentados.
