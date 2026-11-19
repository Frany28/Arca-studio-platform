# Cliente en Detalles de Solicitud

`GET /project-requests/review-queue` conserva `clientId` (`clients.id`) y añade
`requestedBy` (`users.id`, procedente de `project_requests.requested_by`). Son
identificadores distintos; ninguno debe sustituirse por el ID de la solicitud.
La adición mantiene los campos y consumidores existentes de la cola.

El modelo del drawer conserva `clientId` y expone `clientUserId` desde `requestedBy`.
`useAdminRequestClient` recibe ese usuario y consulta el endpoint existente
`GET /admin/users/:userId`, sin lecturas adicionales para averiguar el ID.
No busca otro usuario del cliente comercial ni utiliza datos ficticios si falta el solicitante.

## Diagnóstico en staging, 7 de octubre de 2026

La solicitud 9 tenía `clientId: 2` y `requested_by: 11`. La cola solo exponía el
primero y el drawer consultaba `/admin/users/2` en vez de `/admin/users/11`.
Ambas consultas devolvían HTTP 500, código `42703` y mensaje público
“Ocurrió un error inesperado.”. El registro del backend identificó la columna
`admin_user_notes.archived_at` ausente en la base configurada.

La migración existente `20260902120000_archive_admin_user_notes` era la única
pendiente. Se aplicó con autorización del desarrollador mediante Prisma Migrate
deploy, sin crear otra migración ni borrar datos. La conexión directa no estaba
disponible; se usó temporalmente `DATABASE_URL` como `DIRECT_URL` únicamente en
el proceso de Prisma, sin modificar `.env`.

Después de aplicar la migración, `/admin/users/2` devolvió 200 pero correspondía a
un arquitecto ajeno a la solicitud. `/admin/users/11` devolvió 200 con el cliente
“Cliente Showcase” y la empresa “ARCA Showcase”. La cola corregida expone para la
solicitud 9 `{ "clientId": 2, "requestedBy": 11 }`. Esto confirma que aplicar solo
la migración habría mostrado la identidad equivocada.

El historial confirma que `requestedBy` faltaba desde la incorporación de la cola
(`4f637b4`) y que el drawer usaba `clientId` desde su incorporación (`8e39573`).
El cambio de recomendación de reunión (`9b7a3bf`) conservó el mapping de cliente;
no eliminó ni renombró el usuario solicitante.

## Lectura y errores

- El hook valida IDs enteros positivos seguros; ausencias e IDs inválidos omiten HTTP.
- 404 muestra “Información del cliente no disponible” y no ofrece reintento.
- 401/403 conservan el mensaje público de autenticación/permisos, sin reintento.
- 5xx muestra “No fue posible cargar los datos del cliente.” y ofrece reintento.
- Los errores de red usan el mensaje compartido de conexión y ofrecen reintento.
- `status` y `code` permanecen en el resultado del hook para diagnóstico.
- El reintento carga únicamente el usuario; no vuelve a leer la cola ni el overview.
- Cerrar o cambiar la selección aborta la lectura. También se descartan respuestas
  tardías aunque el transporte ignore la cancelación; `AbortError` no se muestra.

El último resultado vive únicamente en la instancia del hook, por usuario y revisión,
y se revalida al reabrir. No hay caché global ni persistencia entre sesiones.
La evaluación, ubicación, proyecto y acciones conservan su funcionamiento independiente.

## Validación

Las pruebas unitarias cubren mapping, IDs inválidos y clasificación de errores.
Los escenarios Playwright del dashboard usan IDs distintos para solicitud, cliente
y usuario y cubren identidad, ausencia, permisos, red, 500, reintento y cancelación.

La prueba opcional de integración usa el backend y PostgreSQL reales con solo lecturas:

```powershell
$env:ARCA_REQUEST_CLIENT_DB_TESTS = '1'
node --test tests/adminRequestClient.integration.test.js
```

Requiere un administrador activo y una solicitud pendiente con solicitante activo.
Verifica la cola, identidad del usuario y respuestas 400/401/403/404.
En otros despliegues, aplicar primero las migraciones existentes, después actualizar
el backend que expone `requestedBy` y el frontend consumidor.

Resultados finales:

- `pnpm verify`: correcto (JSDoc, esquema Prisma, tests y build).
- `pnpm test` del backend con ambas integraciones PostgreSQL habilitadas:
  135/135 correctas, sin omisiones. La integración de reunión revierte sus filas.
- `pnpm test` del frontend: 259/259 correctas.
- `pnpm test:browser`: 172/172 correctas en la segunda ejecución completa.
  La primera tuvo un timeout de navegación en proyectos activos mientras se
  compilaba; los escenarios del drawer pasaron en ambas ejecuciones.
- `pnpm lint` del frontend y `git diff --check`: correctos.

La suite de navegador emitió advertencias preexistentes por botones anidados en
observaciones, ajenas a este cambio; no se modificó esa funcionalidad.
Los cambios de código permanecen locales; la migración sí quedó aplicada en staging.
