# Estado canónico finished de proyectos

**Estado actual — 14 de octubre de 2026:** la migración `20261013000000_project_finished_status` está **aplicada en Supabase**, con autorización explícita del desarrollador. Prisma confirma 22 migraciones aplicadas y ninguna pendiente. Se conservaron los seis proyectos, sus fechas, responsables, relaciones y auditoría. Ver [respaldo y verificación de la aplicación](PROJECT_FINISHED_STATUS_DEPLOYMENT.md). Las referencias a pendientes en la evidencia histórica describen las revisiones anteriores a esta autorización.

## Causa y alcance

El enum PostgreSQL y las reglas de cierre del backend utilizaban `completed`. Las galerías del frontend utilizaban `finished`, mientras los filtros administrativos lo volvían a convertir a `completed`. Gestión reconocía ambos valores, pero la escritura masiva de visibilidad aceptaba únicamente el primero. Además, la publicación individual no exigía finalización. Se establece `finished` como único estado canónico de proyecto finalizado.

Los estados almacenables quedan: `pending`, `in_process`, `finished`, `cancelled`, `archived`. Los estados visuales `in_review`, `pending_approval` y `request` se conservan: este cambio no amplía el enum ni modifica solicitudes.

## Auditoría del repositorio

| Área | Hallazgo y resultado |
| --- | --- |
| Prisma y baseline | `project_status` es un enum, no texto libre. El baseline y las migraciones previas permanecen intactos. |
| Proyectos | `projects.status` y `archived_from_status` usan el enum. Recuperación usa el estado anterior o `pending` si falta. |
| Etapas e hitos | `project_stages.status` y `project_milestones.status` comparten el enum; también reciben `finished`. Sus columnas `completed_at` conservan nombre y valores. |
| Historial | `previous_status` y `new_status` son VARCHAR(50). Se normalizan únicamente coincidencias exactas de `completed`, conservando significado, filas y metadatos. |
| Índices y restricciones | El historial versionado define índice de estado, índice de nombres activos que excluye `cancelled`, checks de fechas/progreso y claves foráneas. Renombrar la etiqueta preserva el OID y sus dependencias. |
| Triggers y funciones | Las migraciones versionadas no definen triggers o funciones dependientes de `completed`. Las dependencias adicionales de la base real requieren auditoría antes del despliegue. |
| Creación y cambio de estado | Aprobar una solicitud crea proyectos `pending`. No existe un endpoint HTTP general de estado; los cambios existentes son archivo y recuperación. No se incorpora un contrato sin consumidor. |
| Visibilidad masiva | Conserva bloqueo ordenado, transacción y auditoría. Exige finalizados no eliminados. Recuperar un finalizado devuelve `finished` privado. |
| Visibilidad individual | Exige finalización en servicio y nuevamente en SQL, manteniendo acceso directo y permiso `projects.publish`. Activos/cancelados reciben 409 `PROJECT_NOT_FINISHED`; archivados conservan `PROJECT_ARCHIVED`. |
| Solo lectura | Servicios, asignaciones, comentarios generales/documentales y archivos rechazan finalizados. No se relajan permisos. |
| Métricas | Backend sigue contando activos solo en `pending/in_process`. Gestión cuenta finalizados con la política compartida, bajo la propiedad interna `finished`. Próximas entregas excluye finalizados actuales e históricos. |
| Filtros y galerías | El ID del filtro y el grupo de finalizados es `finished`. `completed` solo se normaliza como alias temporal. No cambia geometría ni animaciones. |
| Caché y sincronización | Las mutaciones mantienen reconciliación tras confirmación y refresco de lecturas derivadas mediante los hooks existentes. No se incorpora caché de autenticación o escrituras. |
| Otros dominios | `completed` de uploads, presentación de progreso y trabajos de procesamiento mantiene su significado. No se renombra `completed_at` ni estados de solicitudes. |

## Migración versionada

`Backend/prisma/migrations/20261013000000_project_finished_status/migration.sql` ejecuta en una única transacción:

1. `ALTER TYPE public.project_status RENAME VALUE 'completed' TO 'finished'`.
2. Normalización exacta de las dos columnas de códigos del historial.

No recrea tablas ni enum, ni elimina registros, relaciones, índices o columnas. No actualiza proyectos mediante UPDATE, por tanto no cambia sus fechas ni responsables. No modifica `changed_at`, notas ni autores del historial. Los JSON de `audit_logs` permanecen intactos como evidencia del contrato vigente cuando ocurrió el evento; futuros lectores deben interpretar su alias sin reescribir snapshots.

Es reproducible mediante Prisma Migrate, que la registra y aplica una sola vez. No es un script SQL para ejecutar repetidamente. Ante error, la transacción revierte la etiqueta y el historial juntos. Una migración fallida debe investigarse y resolverse según el estado real de Prisma, sin reset ni marcarla aplicada sin comprobarla.

## Archivos modificados

- Backend, dominio y servicios: `src/domain/projectStatus.js`, `src/services/projectMutationPolicy.js`, `src/services/projectService.js`, `src/services/adminDashboardService.js`.
- Backend, persistencia: `src/repositories/projectRepository.js`, `adminDashboardRepository.js`, `projectCommentRepository.js`, `fileRepository.js`.
- Backend, esquema y operaciones: `prisma/schema.prisma`, `prisma/migrations/20261013000000_project_finished_status/migration.sql`, `scripts/audit-project-status.mjs`, `scripts/seed-project-visibility-examples.mjs`, `PRISMA_MIGRATIONS.md`.
- Backend, pruebas: `tests/projectFinishedStatus.test.js`, `tests/projectFinishedStatus.integration.test.js`, `tests/projectArchivedReadOnly.test.js`.
- Frontend, políticas compartidas: `src/utils/projectStatus.js`, `src/utils/projectReadOnly.js`, `src/utils/projectStatusGroups.js`.
- Frontend, administración: `src/pages/admin-dashboard/AdminDashboard.jsx`, `src/pages/admin-dashboard/components/admin-active-projects/utils/adminProjectBulkActions.js`, `adminProjectPresentation.js`, `src/pages/admin-projects/AdminProjectsPage.jsx`, `src/pages/admin-projects/utils/adminProjectMetrics.js`.
- Frontend, pruebas: `tests/adminProjectPresentation.test.js`, `tests/adminProjectsPage.test.js`, `tests/archivedProjectReadOnly.test.js`, `tests/projectStatusGroups.test.js`.
- Contratos y reporte: `docs/API_CONTRACT.md`, `docs/ADMIN_PROJECTS_PHASE1_VALIDATION.md`, `docs/PROJECT_FINISHED_STATUS.md`.

## Compatibilidad temporal

`Backend/src/domain/projectStatus.js` centraliza catálogo, normalización y reglas de cierre. `Frontend/src/utils/projectStatus.js` centraliza la normalización de presentación; una prueba comprueba equivalencia con backend y Prisma. `completed` es únicamente un alias de lectura identificado como temporal, no un segundo estado canónico, filtro o valor aceptado por el nuevo enum.

No existe una entrada HTTP que acepte estados de proyecto arbitrarios, por lo que no se crea un validador Zod o endpoint sin consumidor. Los esquemas actuales de IDs, acciones y paginación permanecen vigentes. Esta compatibilidad de lectura **no permite mezclar versiones antiguas del backend con el enum renombrado**: sus casts SQL a `completed` fallarán. Coordinar migración y reinicio en una ventana de mantenimiento.

Retirar el alias de ambos normalizadores y sus pruebas cuando todas las instancias y consumidores usen `finished`, se renueven las pantallas antiguas y no haya importadores del contrato previo. Los snapshots de auditoría pueden conservar el alias histórico permanentemente sin convertirlo en estado válido de escritura.

## Prueba PostgreSQL local

`Backend/tests/projectFinishedStatus.integration.test.js` es optativa y **rechaza hosts remotos**. Requiere PostgreSQL local con permiso para crear bases y `psql` en PATH (o su ruta en `ARCA_PROJECT_STATUS_TEST_PSQL`). Usa una base efímera propia: reproduce las migraciones anteriores con psql para respetar los commits de sentencias de enum, carga proyectos activos/finalizados/archivados/cancelados, etapas, hitos, historial y auditoría. Compara todas las filas antes/después, verifica OID e índice parcial, simula un fallo para comprobar rollback y ejecuta repositorios reales para consulta, publicación, archivo, recuperación, métricas y creación.

Desde Backend, con la URL local suministrada por el entorno:

```powershell
$env:ARCA_PROJECT_STATUS_DB_TESTS = "1"
# Configurar ARCA_PROJECT_STATUS_TEST_DATABASE_URL con la conexión a PostgreSQL local.
node --test tests/projectFinishedStatus.integration.test.js
Remove-Item Env:ARCA_PROJECT_STATUS_DB_TESTS
Remove-Item Env:ARCA_PROJECT_STATUS_TEST_DATABASE_URL
```

La prueba no usa automáticamente `DATABASE_URL` de staging ni modifica bases preexistentes. Solo elimina la base efímera creada por ella. Esto comprueba el SQL versionado; `verify:db` únicamente consulta el estado de Prisma y no reemplaza esta prueba.

## Procedimiento de aplicación

La aplicación autorizada del 14 de octubre de 2026 está documentada en [el informe de despliegue de la migración](PROJECT_FINISHED_STATUS_DEPLOYMENT.md). Los pasos siguientes conservan el procedimiento de referencia.

1. Confirmar backup recuperable y destino de staging autorizado. No ejecutar los comandos de despliegue siguientes en una base remota sin aprobación explícita.
2. Desde Backend ejecutar `node scripts/audit-project-status.mjs` y `pnpm verify:db`. La auditoría usa una transacción exclusivamente de lectura, no muestra credenciales y registra columnas, enum, recuentos (incluidos archivados/eliminados), historial, índices, restricciones, dependencias, triggers, funciones e historial de migraciones. Usa DIRECT_URL cuando esté disponible y la configuración de conexión existente.
3. Revisar funciones/triggers, vistas y consumidores externos que comparen el texto `completed`, incluidos cuerpos de funciones no registrados en `pg_depend`. Comprobar que el enum contiene `completed` y no `finished`, que el usuario puede renombrarlo, que el historial puede actualizarse bajo RLS y que no hay migraciones fallidas. Revisar todas las migraciones pendientes: `migrate deploy` aplica todas, no solamente esta.
4. Ejecutar primero la prueba local anterior. Después validar en una copia aislada autorizada de la base real, comparando registros, relaciones, fechas y responsables.
5. Detener escrituras y coordinar el cambio de versión del backend. Desde Backend ejecutar `pnpm db:migrate:deploy` usando el destino revisado. No usar `db push`, `migrate reset` ni `migrate dev` sobre staging.
6. Ejecutar `pnpm verify:db`, repetir auditoría y comparar recuentos/metadatos. Todos los usos del enum deben decir `finished`; el historial no debe contener `completed` en sus códigos, aunque los snapshots de auditoría sí pueden conservarlo.
7. Reiniciar todas las instancias actualizadas del backend y publicar el frontend correspondiente. Validar publicación/ocultación de finalizados, rechazo de activos/archivados, archivo y recuperación a `finished` privado, filtros, indicadores y solo lectura.

El renombrado es incompatible con rollback aislado al backend antiguo. Si se requiere volver atrás, coordinar restauración de versión y base bajo un plan revisado; no alterar migraciones registradas. El UPDATE del historial puede bloquear filas: elegir una ventana acorde a su volumen.

## Evidencia y pendientes al 13 de octubre de 2026

**Seguimiento del 14 de octubre de 2026:** se diagnosticó la incompatibilidad IPv6 y se recuperó la conexión local por el pooler de sesión existente. `verify:db` confirma una única migración pendiente y la auditoría remota completó en modo READ ONLY. La prueba de migración pasó en PostgreSQL 17.6 local con datos sintéticos y el pool real; el esquema y los archivos SQL conservaron sus hashes. La migración sigue sin aplicar en Supabase. Consultar [diagnóstico, corrección y estado actual](POSTGRES_CONNECTION_DIAGNOSIS.md); la evidencia siguiente corresponde a la ejecución inicial del día 13.

La auditoría contra la conexión configurada falló con `ENOTFOUND`, incluso fuera del sandbox. No se conocen los recuentos reales ni las dependencias adicionales de esa base. No se aplicaron migraciones remotas. No hay herramientas PostgreSQL locales disponibles en esta sesión; la prueba optativa queda omitida y **la migración no se declara validada sobre PostgreSQL**.

| Comprobación ejecutada | Resultado |
| --- | --- |
| `pnpm verify` desde Backend, versión final | Correcto; incluye lint/JSDoc, Prisma validate, tests backend/frontend y build. |
| Backend | 261 pruebas: 256 aprobadas, 0 fallidas, 5 integraciones optativas omitidas. Incluye HTTP real con transporte PostgreSQL simulado para 401/403/400/200 en bulk-action. |
| Frontend, unitarias | 293 aprobadas, 0 fallidas. |
| Frontend, navegador | 45 aprobadas, 0 fallidas; suites `adminActiveProjects.test.js` y `adminProjectsPage.test.js`, responsive y temas claro/oscuro. |
| ESLint frontend | Correcto en los ocho archivos fuente modificados. |
| Revisión de diff | Sin errores de whitespace; cambios concentrados en el contrato de estado. |
| Auditoría PostgreSQL | No disponible: `ENOTFOUND`. |
| `pnpm verify:db` | Ejecutado; falla la conexión de Prisma con error del schema engine. No aplica migraciones. |
| Prueba local de migración | Omitida: no hay PostgreSQL local accesible/configurado. |

`verify:db` y la auditoría con conexión real quedan pendientes de corregir DNS/conectividad. Las pruebas con mocks y la validación Prisma no sustituyen la ejecución de la migración sobre PostgreSQL. Aplicarla en remoto requiere revisión y autorización. No se hicieron commits ni push.
