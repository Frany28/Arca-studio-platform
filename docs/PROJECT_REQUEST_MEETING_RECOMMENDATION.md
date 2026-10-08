# Recomendación de reunión en solicitudes

## Dominio y datos

La revisión técnica vive en `public.project_request_reviews`, con una fila por solicitud y revisor. Guardar otra revisión del mismo revisor actualiza esa fila; este cambio conserva ese comportamiento y no crea un historial append-only.

| Concepto | PostgreSQL | JSON | Valores |
| --- | --- | --- | --- |
| Valoración de workflow existente | `recommendation` | `recommendation` | `approve`, `reject`, `changes_requested` |
| Decisión de reunión | `meeting_recommendation` | `meetingRecommendation` | `SCHEDULE_MEETING`, `DO_NOT_SCHEDULE_MEETING`, `null` |
| Justificación | `note` | `note` | Texto de 10–2000 caracteres |

La reunión usa el enum `project_request_meeting_recommendation`, nullable y sin default. No se deriva de la compatibilidad, de la valoración de workflow ni del texto. Las revisiones previas no expresaban esta decisión y permanecen en `null`. Antes de aplicar la migración en staging el 6 de octubre de 2026 se comprobaron cero revisiones existentes; las pruebas cubren igualmente el comportamiento histórico.

## Contrato y responsabilidades

`PUT /api/project-requests/:projectRequestId/review` conserva el body anterior y admite el campo adicional:

```json
{
  "recommendation": "approve",
  "meetingRecommendation": "DO_NOT_SCHEDULE_MEETING",
  "note": "La propuesta puede revisarse; la reunión no se recomienda todavía."
}
```

Responde `{review:{id,recommendation,meetingRecommendation,note,updatedAt}}`. `GET /api/project-requests/review-queue` incluye `meetingRecommendation` en cada revisión. El drawer reutiliza esa cola; no existe una nueva ruta de detalle individual. Ambos contratos mantienen el control de caché existente (`no-store`); el workflow recarga la cola tras guardar y no almacena mutaciones en caché.

- Omitir `meetingRecommendation`: inserta `null` en una revisión nueva; en una existente conserva su decisión anterior.
- Enviar `null`: elimina explícitamente la decisión de reunión de esa revisión.
- Enviar uno de los dos códigos: persiste esa decisión.
- Enviar cualquier otro valor: Zod responde `VALIDATION_ERROR`, con el campo correspondiente.

La ruta conserva autenticación, roles `admin`/`architect` y rate limit. El repositorio conserva el bloqueo de la solicitud y las comprobaciones de estado/asignación; el servicio traduce a los errores existentes de recurso inexistente, solicitud cerrada o acceso denegado. Los controles y SQL existentes de la decisión administrativa no cambian. `Agendar reunión` no es una cuarta acción de workflow.

## Fuente de verdad y mapping

`Backend/src/domain/projectRequestReview.js` define los códigos usados por Zod. Prisma y la migración representan el mismo enum para PostgreSQL; una prueba comprueba su correspondencia. `Frontend/src/utils/projectRequestMeetingRecommendation.js` es exclusivamente el mapping de presentación del contrato, sin un enum frontend independiente; sus opciones se derivan del mapping y una prueba comprueba que cubren exactamente los códigos backend.

| Código API | Etiqueta | Tema de Badge | Icono |
| --- | --- | --- | --- |
| `SCHEDULE_MEETING` | Agendar reunión | Info | Visto bueno |
| `DO_NOT_SCHEDULE_MEETING` | No agendar reunión | Danger | X |
| `null` / ausencia histórica | Sin recomendación técnica registrada | Texto neutral | Sin icono |

Reunión y justificación se leen de la misma revisión más reciente por `updatedAt`, sin depender del orden de la API. Una revisión histórica reciente sin el campo no hereda una reunión de otra anterior. Los códigos desconocidos conservan el fallback neutral.

El formulario del arquitecto requiere una elección explícita separada del workflow y mantiene el borrador ante errores. El modal administrativo no envía la reunión. Los SVG se conservan como recursos locales de 16×16: X del nodo `3727:677617` y visto bueno exportado de la instancia `I3727:677372;3368:142551;2056:20521`. La máscara toma `currentColor` para respetar ambos temas. La exportación genérica de Figma del visto bueno resolvía el componente base de cierre; se exportó la instancia real sin modificar el diseño.

## Migración y despliegue

La migración versionada `20261006120000_project_request_meeting_recommendation` crea el enum y agrega la columna en una transacción. No elimina columnas, actualiza filas, agrega defaults ni modifica el enum del workflow. Aplicar esquema antes del backend y frontend nuevos.

En despliegues habituales usar `pnpm db:migrate:deploy`. En esta sesión, el desarrollador solicitó aplicar únicamente esta migración dejando pendiente `20260902120000_archive_admin_user_notes`. Se ejecutó su archivo versionado con `prisma db execute --file prisma/migrations/20261006120000_project_request_meeting_recommendation/migration.sql` y, tras confirmar el éxito, `prisma migrate resolve --applied 20261006120000_project_request_meeting_recommendation`. Su checksum y aplicación quedan registrados en `_prisma_migrations`. No se usó `db push` ni `migrate reset`.

La conexión directa configurada no estuvo disponible; se usó temporalmente `DATABASE_URL` (pooler de sesión, puerto 5432) como `DIRECT_URL` solo para esos procesos. No se cambió `.env`. El estado final de Prisma muestra únicamente la migración de notas pendiente; ese comando devuelve código 1 por esa pendiente conocida.

## Validación

- `pnpm verify` desde Backend: JSDoc, esquema Prisma, suites backend/frontend y build.
- `node --test tests/projectRequestWorkflow.test.js tests/projectRequestMeetingRecommendation.test.js` desde Backend: validación, mapping, guardado, lectura, históricos y errores.
- `$env:ARCA_WORKFLOW_DB_TESTS='1'; node --test tests/projectRequestMeetingRecommendation.integration.test.js` desde Backend: PostgreSQL real; fixture de solicitud y revisores en una transacción revertida al terminar. La prueba es opt-in para no usar una base externa en la suite normal.
- `node --test tests/adminRequestDetails.test.js tests/projectRequestWorkflow.test.js tests/projectRequestMeetingRecommendation.test.js` desde Frontend: presentación, contrato HTTP y separación de conceptos.
- `node --test tests/browser/projectRequestWorkflow.test.js` desde Frontend: envío de ambos códigos, selección explícita, error/reintento, última revisión, fallback, colores semánticos, SVG de 16×16, tema claro/oscuro y ancho móvil.

## Límites conservados

“Información completada” y “Viabilidad financiera” ya no son prototipos: llegan calculadas por la API (`completeness` y `financialViability`). La viabilidad es un estado de coherencia financiera sin porcentaje (ver `PROJECT_REQUEST_EVALUATION.md`, sección 9). Ninguna de las dos métricas genera ni modifica `meetingRecommendation`: la reunión y la justificación siguen siendo decisiones humanas persistidas en la revisión técnica.

La cola compartida sigue leyendo la primera página. Una solicitud fuera de esa página conserva el estado parcial existente del drawer; agregar carga de detalle o paginación completa queda fuera de este cambio. Este trabajo no despliega nuevas versiones del backend ni del frontend.

## Archivos y responsabilidades

| Archivo | Responsabilidad |
| --- | --- |
| `Backend/prisma/schema.prisma` | Modelo y enum nullable de reunión. |
| `Backend/prisma/migrations/20261006120000_project_request_meeting_recommendation/migration.sql` | Cambio transaccional de PostgreSQL sin backfill. |
| `Backend/src/domain/projectRequestReview.js` | Códigos únicos del contrato backend. |
| `Backend/src/validation/projectRequestWorkflowSchemas.js` | Validación Zod del campo opcional/nullable. |
| `Backend/src/services/projectRequestWorkflowService.js` | Propagación de reunión conservando reglas y errores. |
| `Backend/src/repositories/projectRequestWorkflowRepository.js` | Guardado, lectura y mapping SQL parametrizado. |
| `Frontend/src/api/projectRequestsApi.js` | Body HTTP extendido con omisión compatible. |
| `Frontend/src/hooks/useProjectRequestWorkflow.js` | Transporte de la elección al submit existente. |
| `Frontend/src/pages/architect-dashboard/utils/architectRequestReview.js` | Envío técnico separado de la decisión administrativa. |
| `Frontend/src/components/project-requests/ProjectRequestWorkflowModal.jsx` | Estado y validación de elección explícita. |
| `Frontend/src/components/project-requests/MeetingRecommendationField.jsx` | Campo accesible reutilizando Button/HintText. |
| `Frontend/src/utils/projectRequestMeetingRecommendation.js` | Mapping único de etiquetas, temas y opciones visibles. |
| `Frontend/src/pages/admin-dashboard/utils/adminRequestDetails.js` | Reunión y justificación de la última revisión. |
| `Frontend/src/pages/admin-dashboard/components/admin-request-details/AdminRequestEvaluation.jsx` | Render de badges, iconos y barras semánticas. |
| `Frontend/src/utils/projectRequestMetrics.js` | Completitud y viabilidad financiera reales (sustituye al prototipo eliminado `adminRequestDetailsPrototype.js`). |
| `Frontend/src/assets/project-requests/meeting-declined.svg` | Icono X local de Figma, 16×16. |
| `Frontend/src/assets/project-requests/meeting-suggested.svg` | Visto bueno local de la instancia real, 16×16. |
| `Backend/tests/projectRequestMeetingRecommendation.test.js` | Dominio, Zod, servicio/repositorio, HTTP y permisos. |
| `Backend/tests/projectRequestMeetingRecommendation.integration.test.js` | PostgreSQL real con rollback de fixtures. |
| `Frontend/tests/adminRequestDetails.test.js` | Compatibilidad, mapping, historial y separación de workflow. |
| `Frontend/tests/projectRequestMeetingRecommendation.test.js` | Correspondencia backend/frontend y body HTTP. |
| `Frontend/tests/browser/projectRequestWorkflow.test.js` | Interacción, reintento, semántica, temas, SVG y móvil. |
| `Backend/ARCHITECTURE.md`, `Frontend/DESIGN_SYSTEM.md` | Reglas del modelo y la presentación. |
| `docs/API_CONTRACT.md`, este documento | Contrato, migración, historial, validación y límites. |

Los cambios locales previos en `ActionMenu.jsx` y `actionMenuPosition.js` se conservaron sin modificaciones de esta tarea. Las pruebas de detalle/workflow que ya tenían cambios locales se extendieron conservándolos.
