# Migraciones de base de datos con Prisma

El backend usa **Prisma Migrate 7.8** para registrar y desplegar cambios de PostgreSQL. Las consultas de la aplicación siguen usando `pg`; Prisma Client no reemplaza los repositorios actuales.

## Estado inicial

Para el estado finalizado canónico `finished`, consultar [auditoría, compatibilidad y procedimiento](../docs/PROJECT_FINISHED_STATUS.md). La migración `20261013000000_project_finished_status` renombra el enum y normaliza los códigos del historial en una transacción, sin recrear datos ni modificar fechas. Su aplicación remota requiere revisión y autorización explícita.

La conexión local de Prisma se corrigió para una red IPv4 utilizando el pooler de sesión existente en puerto 5432, sin cambiar el proveedor ni la configuración runtime. Ver [diagnóstico de conexión y estado de migraciones](../docs/POSTGRES_CONNECTION_DIAGNOSIS.md). El endpoint directo IPv6 original se conserva para entornos compatibles; un exit code 1 de `verify:db` puede indicar migraciones pendientes aunque la conexión funcione.

La base ya existía antes de incorporar Prisma. La migración `20260713000000_baseline` representa su estructura completa al 13 de julio de 2026, incluidos:

- 21 tablas y sus relaciones;
- índices de proyectos, comentarios y archivos;
- restricciones `CHECK` y claves diferibles;
- índices por expresiones, incluida la unicidad de puntos 3D;
- activación de Row Level Security.

El baseline está registrado como aplicado en la base de pruebas. No debe ejecutarse manualmente sobre esa base. En una base vacía, `prisma migrate deploy` sí lo utiliza para construir toda la estructura.

## Tablas del módulo de soporte (`20261014120000_support_tables`)

Hasta esta migración, `supportRepository.ensureSupportTables` ejecutaba `CREATE TABLE IF NOT EXISTS` para `support_requests` y `support_request_files` en la primera solicitud de soporte. El esquema cambiaba en runtime y el rol de la aplicación necesitaba permisos de DDL (hallazgo D-4 de la auditoría). Ahora ambas tablas se declaran en `schema.prisma` y en la migración, y el repositorio no ejecuta DDL. `tests/supportSchemaManagement.test.js` impide que vuelva a aparecer DDL en `src/`.

La migración reproduce exactamente la definición anterior: columnas, tipos, valores por defecto, claves primarias y la clave foránea `support_request_files_support_request_id_fkey` con `ON DELETE CASCADE`. `user_id` y `uploaded_by` siguen sin clave foránea. Además activa RLS, como el resto de tablas.

Usa `CREATE TABLE IF NOT EXISTS`: si un backend anterior ya creó las tablas en algún entorno, la migración las adopta sin recrearlas ni modificar sus datos. Antes comprueba que columnas, tipos, nulabilidad, claves primarias y clave foránea coinciden; ante cualquier diferencia aborta sin cambios. Al revisarlo el 14 de octubre de 2026, las tablas no existían en la base configurada para desarrollo y staging, y todas las migraciones anteriores estaban aplicadas.

Orden seguro de despliegue:

```text
1. pnpm db:migrate:status       → confirmar que solo 20261014120000_support_tables está pendiente
2. pnpm db:migrate:deploy       → crea las tablas (o adopta las existentes)
3. pnpm db:migrate:status       → confirmar que no quedan migraciones pendientes
4. publicar el backend nuevo
5. probar POST /api/support/requests con la cuenta demo
```

Si se publica el backend antes de aplicar la migración, solo fallan los endpoints de soporte, con HTTP 500 y código `42P01` (tabla inexistente); el resto del sistema no se ve afectado. Para resolverlo, aplicar la migración. El backend anterior sigue funcionando con la migración aplicada, porque su `CREATE TABLE IF NOT EXISTS` no hace nada sobre tablas existentes.

## Privilegios de los roles de la API (`20261014130000_revoke_api_role_table_privileges`)

Revoca `TRUNCATE`, `TRIGGER`, `REFERENCES` y `MAINTAIN` a `anon`, `authenticated` y `service_role` sobre las tablas de ARCA en `public` (hallazgo D-2). Debe aplicarse después de `20261014120000_support_tables`. Si D-4 no está aplicada, D-2 aborta sin cambios. El inventario, la compatibilidad con Supabase, el despliegue y la reversión están en [docs/DB_PRIVILEGES.md](../docs/DB_PRIVILEGES.md).

## Rate limiting compartido (`20261014140000_rate_limit_buckets`)

Crea `rate_limit_buckets` para los contadores compartidos entre instancias (hallazgo B-2). La tabla es nueva y vacía, con RLS y el `REVOKE` de D-2, este último solo si existen los roles de Supabase. Debe aplicarse **antes** de publicar el backend que la usa, porque sin ella los endpoints de autenticación responden 503. El historial completo de migraciones se comprobó sobre un PostgreSQL 18 aislado y vacío. Diseño, despliegue y reversión en [docs/RATE_LIMITING.md](../docs/RATE_LIMITING.md).

## Catálogo de servicios (`20261019120000_service_catalog`)

**Aplicada en Supabase de desarrollo/staging el 19/10/2026 (23:56 UTC)** con `pnpm db:migrate:deploy`, tras autorización expresa. Respaldo previo verificado y restaurado localmente: `Backend/.local-backups/service-catalog-20261019-235029Z/` (SHA-256 `819cc2f8…`). Después de aplicarla: `Database schema is up to date` (27/27), checksum `72ac8f21…` registrado, tablas vacías con RLS y sin privilegios de los roles de la API, y los datos existentes idénticos (huella por tabla antes/después).

Crea, sin modificar tablas ni datos existentes, el enum `service_kind` (`individual`, `turnkey`) y tres tablas vacías con RLS y el `REVOKE` de D-2:

- `measurement_units`: unidades configurables (código `snake_case` único, nombre, símbolo, `allows_decimals`, `is_active`, `sort_order`). Se desactivan; no se eliminan mientras estén referenciadas.
- `services`: código único en mayúsculas, nombre, descripción, tipo, unidad, `reference_rate NUMERIC(14,2) >= 0` (misma escala que `QUOTE_DECIMAL_FORMATS`), `currency_code = 'USD'`, estado, orden y autoría. Las modalidades llave en mano usan `kind = 'turnkey'` con unidad m². Sin eliminación física.
- `service_versions`: copia completa del servicio y de su unidad en cada versión, con `version_number` único por servicio, `changed_by`, `change_note` e `is_current`. El índice único parcial `uq_service_versions_current` impide dos versiones vigentes y el trigger `service_versions_immutable` impide modificar o borrar versiones; solo permite pasar `is_current` de `true` a `false`. Las cotizaciones futuras referenciarán `service_versions.id` además de copiar los importes aplicados.

Todas las claves foráneas usan `ON DELETE RESTRICT` (PostgreSQL responde `23001`). `created_by`, `updated_by` y `changed_by` admiten `NULL` para cargas del sistema. No carga servicios: los 19 registros del tabulador 3.2 irán en una migración de datos independiente. `tests/serviceCatalogMigration.test.js` comprueba en `pnpm verify` la consistencia con `schema.prisma`, las restricciones y que la migración no sea destructiva. `tests/serviceCatalog.integration.test.js` aplica el historial completo en una base local desechable (`ARCA_SERVICE_CATALOG_DB_TESTS=1`, `ARCA_SERVICE_CATALOG_TEST_DATABASE_URL` en localhost y, opcionalmente, `ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES=1`).

Orden seguro de despliegue (requiere autorización explícita):

```text
1. backup de PostgreSQL
2. pnpm db:migrate:status       → confirmar que solo 20261019120000_service_catalog está pendiente
3. pnpm db:migrate:deploy       → crea el enum, las tablas, índices y el trigger
4. pnpm db:migrate:status       → confirmar que no quedan migraciones pendientes
```

Ningún backend publicado usa todavía estas tablas, por lo que el orden respecto al despliegue del backend es indiferente. Reversión mientras estén vacías: `DROP TABLE public.service_versions, public.services, public.measurement_units; DROP FUNCTION public.prevent_service_version_mutation(); DROP TYPE public.service_kind;` y eliminar la fila de `_prisma_migrations`, solo con autorización.

## Unidades de medida y denominaciones (`20261020090000_measurement_unit_denominations`)

**Aplicada en Supabase de desarrollo/staging el 20/10/2026 (02:09 UTC)** con `pnpm db:migrate:deploy`, tras autorización expresa, desde el commit `80f9899` (SHA del SQL `bb370d32…`). Respaldo previo verificado y restaurado localmente, fuera del repositorio y de OneDrive: `C:\Users\nuvis\ARCA_PRIVATE_BACKUPS\b2-20261020-020757Z\` (SHA-256 `19db355f…`). Después: `Database schema is up to date` (28/28), objetos, RLS y privilegios verificados, tablas nuevas vacías y datos existentes idénticos. Aditiva, sobre tablas vacías al prepararla (comprobado en solo lectura):

- `measurement_units`: `CHECK` de formato de la abreviatura (sin espacios exteriores, ≤10) e índices únicos de abreviatura y nombre equivalentes, `lower(normalize(…, NFKC) COLLATE pg_c_utf8)`. `pg_c_utf8` existe en PostgreSQL 17+ (verificado en Supabase 17.6) y evita depender del locale de la base.
- Tabla nueva `measurement_unit_denominations` con RLS, `REVOKE` de D-2, índice único por base y texto equivalente, `UNIQUE (id, measurement_unit_id)` y el trigger `measurement_unit_denominations_unit_immutable` (función sin `EXECUTE` para `PUBLIC`).
- `services.unit_denomination_id` opcional con FK compuesta `(unit_denomination_id, measurement_unit_id)` `RESTRICT`; `service_versions.unit_denomination_id` y `unit_denomination` (ambas NULL o ambas informadas).
- La carga inicial de las unidades base está aparte, en `prisma/seeds/measurement_units.sql` (48 unidades aprobadas, idempotente por código), **pendiente de autorización y NO cargada en Supabase**; se recomienda convertirla en una migración de datos al aplicarla. Validada en PostgreSQL 18 desechable (doble ejecución sin cambios y sin sobrescribir cambios administrativos). Si una base ya tenía la carga anterior de 11 unidades, esas conservan su `sort_order` antiguo (1–11) y conviene reordenarlas con autorización; en Supabase la tabla estaba vacía.
- Pruebas: `tests/measurementUnitDenominationsMigration.test.js` (estática, en `pnpm verify`; `tests/helpers/migrationSchema.js` acumula columnas de todo el historial) y `tests/measurementUnits.integration.test.js` (aislada, con las mismas variables que el catálogo).

Orden seguro de aplicación (requiere autorización): respaldo verificado → `pnpm db:migrate:status` (solo esta pendiente) → `pnpm db:migrate:deploy` → `pnpm db:migrate:status` → comprobaciones de catálogo (tabla, RLS, privilegios, índices, FK compuesta, trigger) → publicar el backend que la usa. El backend publicado actual no se ve afectado (columnas opcionales). Reversión mientras estén vacías: eliminar FK, índices y columnas nuevas de `services`/`service_versions`, la tabla, la función y las restricciones/índices nuevos de `measurement_units`, y la fila de `_prisma_migrations`, solo con autorización.

## Catálogo de unidades base (`20261020130000_measurement_units_catalog_data`)

Migración **solo de datos**: inserta las 48 unidades base aprobadas (bloque idéntico a `prisma/seeds/measurement_units.sql`, exigido por `tests/measurementUnitSeed.test.js`), idempotente por código.

**Aplicada en Supabase de desarrollo/staging el 20/10/2026 (02:40 UTC)** con `pnpm db:migrate:deploy`, tras autorización expresa (checksum `765989e9…`). Respaldo previo verificado y restaurado localmente, con ensayo de la migración sobre la copia real: `C:\Users\nuvis\ARCA_PRIVATE_BACKUPS\units-20261020-023939Z\` (SHA-256 `d7451416…`). Después: `Database schema is up to date` (29/29); 48 unidades activas que coinciden campo por campo con el catálogo; sin duplicados por `NFKC`/`pg_c_utf8`; orden correcto; sin denominaciones ni servicios; las otras 35 tablas idénticas. **Se aplicó desde el árbol local antes de su commit**: hasta publicarla en `origin/main`, un `migrate status` desde otra copia mostrará una migración aplicada que falta en su carpeta.

## Código público de denominaciones (`20261020150000_measurement_unit_denomination_public_code`)

**Aplicada en Supabase de desarrollo/staging** (registrada como terminada en `_prisma_migrations`; comprobado el 27/10/2026). Añade `public_code VARCHAR(24) GENERATED ALWAYS AS ('UNID-' || lpad(id::text, greatest(3, length(id::text)), '0')) STORED NOT NULL` y `uq_measurement_unit_denominations_public_code`. Sin funciones, triggers ni datos. Añadir la columna recalcula la tabla (reescritura con bloqueo exclusivo breve); en Supabase estaba vacía y su secuencia sin usar al prepararla (comprobado en solo lectura), por lo que la primera denominación será `UNID-001`. Pruebas: `tests/measurementUnitPublicCodeMigration.test.js` (estática) y `tests/measurementUnitPublicCode.integration.test.js` (aislada, incluye tabla vacía y registros preexistentes).

Orden seguro: respaldo verificado → `pnpm db:migrate:status` (solo esta pendiente) → `pnpm db:migrate:deploy` → verificar columna generada, restricción única y datos intactos → publicar el backend que devuelve `publicCode`. El backend publicado anterior no se ve afectado (no lee la columna); el nuevo backend necesita la columna, por lo que la migración debe aplicarse **antes** de publicarlo. Reversión mientras no se use: `ALTER TABLE public.measurement_unit_denominations DROP COLUMN public_code;` y borrar su fila de `_prisma_migrations`, solo con autorización.

## Cotizaciones (`20261026120000_quotes`)

**Aplicada en Supabase de desarrollo/staging el 27/10/2026 (03:00 UTC)** con `pnpm db:migrate:deploy`, tras autorización expresa, junto con `20261021120000_measurement_unit_denomination_base_change` (las dos únicas pendientes). Respaldo previo completo (`pg_dump` 18, formato custom, legible con `pg_restore --list`, datos de las 36 tablas de `public`): `C:Users
uvisARCA_PRIVATE_BACKUPSmigrations-20261027-025804Z` (SHA-256 `5d9b724f…`). No se ensayó la restauración en un PostgreSQL local (sin credenciales locales). `prisma/checks/20261026120000_quotes/postcheck.sql`: todas las comprobaciones `ok_*` en `true` (29 restricciones, 7 índices, 2 triggers, RLS, D-2, tablas vacías) y huella de las 35 tablas existentes idéntica antes y después. `Database schema is up to date` (32/32). Debe estar aplicada **antes** de publicar el backend que la usa: sin ella fallan `/api/admin/quotes` y las lecturas de servicios (`kindLocked`).

Añade `UNIQUE (id, service_id)` en `service_versions` (`uq_service_versions_id_service`, para la FK compuesta) y crea tres tablas vacías con RLS y el `REVOKE` de D-2: `quotes` (identidad, código único, autoría), `quote_versions` (instantáneas de cliente y proyecto, notas, total y una sola vigente por `uq_quote_versions_current`) y `quote_items` (`line_number`, versión del servicio, cantidad, tarifa y subtotal con `CHECK` de redondeo). Los triggers `prevent_quote_version_mutation` y `prevent_quote_item_mutation` (`search_path` vacío, sin `EXECUTE` para PUBLIC) impiden modificar el historial. Todas las FK usan `ON DELETE RESTRICT`. `tests/quoteMigration.test.js` comprueba la consistencia con `schema.prisma` en `pnpm verify`; `tests/quotes.integration.test.js` usa la misma base local desechable que el catálogo (`ARCA_SERVICE_CATALOG_DB_TESTS=1`, `ARCA_SERVICE_CATALOG_TEST_DATABASE_URL`) y no se ejecutó en esta máquina (sin credenciales del PostgreSQL local).

Reversión mientras estén vacías (solo con autorización): `DROP TABLE public.quote_items, public.quote_versions, public.quotes;`, `DROP FUNCTION public.prevent_quote_item_mutation(), public.prevent_quote_version_mutation();`, `ALTER TABLE public.service_versions DROP CONSTRAINT uq_service_versions_id_service;` y eliminar la fila de `_prisma_migrations`.

## Unidades de medida del servicio (`20261027120000_service_unit_options`)

**Aplicada en Supabase de desarrollo/staging el 29/10/2026 (~02:35 UTC)** con `pnpm db:migrate:deploy`, tras autorización expresa (solo esta migración; sin carga de catálogo). Respaldo previo `C:\Users\nuvis\ARCA_PRIVATE_BACKUPS\unit-options-migration-20261029-023144Z\arca.dump` (SHA-256 `253e9298…fcfdba`), restaurado con éxito en un PostgreSQL local con conteos idénticos (39 tablas, 338 filas); ensayo de la migración sobre esa copia sin errores. Postcheck (`postcheck.txt` en la misma carpeta): tablas con RLS, sin privilegios para los roles de la API, restricciones y triggers presentes, funciones sin EXECUTE público, conteos y secuencias SERV/UNID sin cambios, `Database schema is up to date` (33/33). Backend publicado en Vercel: `ea3c61b6`. Crea `service_unit_options` (1–10 unidades vigentes por servicio, tarifa NULL = pendiente, `presentation_label` opcional) y `service_version_unit_options` (copia inmutable por versión), ambas con RLS y el `REVOKE` de D-2; rellena la posición 1 de cada servicio y versión existentes con su unidad y tarifa actuales; añade `quote_items.service_version_unit_option_id` NOT NULL (rellenada con la unidad principal de la versión cotizada, desactivando `quote_items_immutable` solo dentro de la transacción de la migración) con FK compuesta a la misma versión; crea los triggers de sincronización (`services_sync_primary_unit_option`), de copia por versión (`service_versions_snapshot_unit_options`), de inmutabilidad y de coherencia diferida, y amplía `prevent_denomination_unit_change` a las tablas nuevas. Funciones con `search_path` vacío y sin `EXECUTE` para PUBLIC. Pruebas: `tests/serviceUnitOptionsMigration.test.js` (estática, en `pnpm verify`) y `tests/serviceUnitOptions.integration.test.js` (aislada; incluye migrar servicios, versiones y cotizaciones previas).

Orden seguro: respaldo verificado → `pnpm db:migrate:status` (solo esta pendiente) → `pnpm db:migrate:deploy` → verificar que cada servicio y versión tiene su posición 1 y que ninguna línea de cotización queda sin unidad → publicar el backend y el frontend que usan `unitOptions`. El backend anterior sigue funcionando tras la migración (los triggers mantienen la posición 1 y la copia por versión), salvo al **crear cotizaciones**, porque no rellena la columna nueva; por eso conviene publicar el backend nuevo inmediatamente después. El backend nuevo necesita la migración. No crear servicios en Supabase antes de cargar el catálogo oficial: consumirían `SERV-001`.

Reversión (solo con autorización y antes de que existan alternativas o cotizaciones con ellas): `ALTER TABLE public.quote_items DROP COLUMN service_version_unit_option_id;`, `DROP TABLE public.service_version_unit_options, public.service_unit_options;`, borrar las funciones y triggers nuevos, restaurar la versión anterior de `prevent_denomination_unit_change` y eliminar la fila de `_prisma_migrations`.

## Proyectos draft e idempotencia de cotizaciones (`20261102120000`–`20261102122000`)

**Pendientes de aplicar; requieren autorización expresa.** No se ejecutaron contra Supabase. Diseño en `ARCHITECTURE.md` («Proyectos draft desde cotizaciones»).

- `20261102120000_project_draft_status`: `ALTER TYPE public.project_status ADD VALUE 'draft' BEFORE 'pending'`. Va sola: PostgreSQL no permite usar el valor en la transacción que lo crea.
- `20261102121000_project_draft_requirements`: `DROP NOT NULL` en `projects.start_date`, `project_type`, `location` y `has_plans` (conserva `DEFAULT false`), con `chk_projects_draft_requirements` y `chk_projects_draft_without_end_date` (solo un draft, o un archivado desde draft, puede omitir esos datos o la fecha de entrega) y `chk_project_stages_status_not_draft` / `chk_project_milestones_status_not_draft`. Restricciones `NOT VALID` y después `VALIDATE`.
- `20261102122000_quote_submission_id`: `quotes.submission_id UUID` y `submission_fingerprint CHAR(64)` nulas (sin relleno), `chk_quotes_submission` e índice único parcial `uq_quotes_created_by_submission (created_by, submission_id)`.

Ninguna modifica filas, triggers ni secuencias. Ensayadas el 2/11/2026 sobre un PostgreSQL 18 local desechable con `psql` (historial completo hasta antes de estas migraciones, proyectos, una etapa y una cotización existentes): preflight correcto, las tres aplicadas, restricciones validadas y huella de `projects`, `quotes`, `project_stages` y `project_milestones` idéntica antes y después.

Orden seguro: respaldo verificado → `psql "$DIRECT_URL" -X -f prisma/checks/20261102121000_project_draft_requirements/preflight.sql` (todo `ok_*` verdadero; guardar la huella fuera del repositorio) → `pnpm db:migrate:status` (solo estas tres pendientes) → `pnpm db:migrate:deploy` → postcheck (misma huella) → publicar backend y frontend juntos. El backend anterior funciona con las migraciones aplicadas (no crea drafts ni usa las columnas nuevas). El backend nuevo necesita las tres: sin ellas, el alta de cotizaciones falla al buscar `submission_id`, y el frontend nuevo envía `submissionId`, que el backend anterior rechaza (400).

Reversión (solo con autorización y mientras no existan drafts ni altas con `submission_id`): `DROP INDEX public.uq_quotes_created_by_submission; ALTER TABLE public.quotes DROP CONSTRAINT chk_quotes_submission, DROP COLUMN submission_fingerprint, DROP COLUMN submission_id;`, eliminar las cuatro restricciones `chk_*draft*` y volver a `SET NOT NULL` las cuatro columnas de `projects`. PostgreSQL no permite quitar un valor de un enum: `draft` permanece sin uso. Eliminar las filas de `_prisma_migrations`.

## Configuración de borradores, Fase 1.1 y alternativa B

Se conserva íntegra `20261113120000_project_draft_configuration`. Su SHA-256 es `7e5aa94035425b39ea49d325c0c9eba050b44c3c3b8c53ecaeb06eeea2475635`. La consulta autorizada de staging encontró 45 migraciones locales y esta única pendiente. La inspección local carece de un inventario completo de otras bases compartidas, por lo que se eligió preservar su historial.

La Fase 1.1 añade validación de fechas y traducción de errores en la aplicación, y comprobaciones en `prisma/checks/20261113120000_project_draft_configuration/`. Las restricciones de la migración original se crean validadas. Los fallos corregidos procedían de validación y serialización de la aplicación y se resuelven en esas capas. Por ello esta fase requiere **cero migraciones correctivas posteriores**. Una migración posterior tampoco reduciría los bloqueos de la primera ejecución del archivo original.

### Bloqueos de la migración original

El archivo abre una transacción explícita y mantiene sus bloqueos hasta `COMMIT`. Los `ADD COLUMN`, `ADD CHECK` y `DROP CONSTRAINT` sobre `projects`, `project_requests` y `files` requieren `ACCESS EXCLUSIVE`, que entra en conflicto incluso con lecturas. Las comprobaciones de restricciones pueden recorrer filas existentes. Las claves foráneas también afectan a tablas referenciadas, incluidos `users` y `projects`. El índice de `files` se crea mediante `CREATE INDEX` ordinario dentro de esa misma transacción. Aunque las columnas se añaden sin relleno de filas y las tablas nuevas están vacías, el tiempo de escaneo y la espera por transacciones abiertas deben medirse en una copia restaurada. Una solicitud DDL en espera también puede hacer crecer la cola de consultas detrás de ella. Referencias oficiales de [ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html) y [CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html).

`preflight.sql` lee el tamaño de las tres tablas y cuenta las transacciones abiertas de otras sesiones. Esto describe un instante y requiere visibilidad suficiente de las sesiones. La ventana de mantenimiento debe impedir nuevas operaciones hasta terminar el postcheck. Las huellas cubren todas las columnas anteriores de `projects`, `project_requests`, `files` y `file_versions`, incluidas filas retiradas. Se excluyen únicamente las columnas añadidas por esta migración. Ambos scripts normalizan zona horaria y DateStyle localmente para comparar huellas de forma reproducible. Las huellas requieren leer esas tablas y tienen un límite de 30 s. Si lo exceden, se detiene el procedimiento para revisar volumen y ventana de ejecución.

### Procedimiento futuro sujeto a autorización de aplicación

Este procedimiento se documenta para una ejecución posterior. La Fase 1.1 únicamente lo ensaya en PostgreSQL local desechable.

1. Confirmar el destino, identidad de la base, versión de PostgreSQL, permisos y SHA-256 del archivo. Revisar el historial completo con `pnpm db:migrate:status`. Debe mostrar exclusivamente esta migración pendiente y ningún historial divergente o intento fallido. Si ya figura aplicada con el checksum esperado, revisar el estado existente y omitir su reaplicación. Si el checksum difiere, detenerse y diagnosticar el historial.
2. Preparar una ventana aprobada y pausar procesos que lean o escriban las tablas afectadas, incluidos backend, tareas y cargas en curso. Drenar las transacciones abiertas. Evitar despliegues paralelos y otros ejecutores de migraciones durante toda la operación.
3. Obtener un respaldo completo en ubicación privada, calcular su hash y comprobar su lectura con `pg_restore --list`. Restaurarlo en una base temporal aislada y ensayar la misma migración original con datos representativos. Comparar las huellas y medir duración y bloqueos. Acordar los límites de tiempo a partir de ese ensayo y del tamaño real. Un respaldo sin restauración ensayada impide continuar.
4. Ejecutar `psql -X -f prisma/checks/20261113120000_project_draft_configuration/preflight.sql` mediante configuración privada de conexión del cliente. Guardar la salida fuera del repositorio. Exigir todos los indicadores `ok_*` verdaderos, ausencia de transacciones abiertas de otras sesiones y condiciones de datos cumplidas. Un código de salida 0 de psql requiere además revisar esos indicadores. Mantener las escrituras pausadas para que las huellas sean comparables.
5. Configurar **solo para la conexión del ejecutor** `lock_timeout=3s`, `statement_timeout=60s` y, con PostgreSQL 17+, `transaction_timeout=90s` como límites iniciales que deben ajustarse al ensayo aprobado. `lock_timeout` limita cada adquisición de bloqueo, `statement_timeout` cada sentencia y `transaction_timeout` la transacción completa. Verificar los valores efectivos en el destino aislado antes de su futura aplicación. Prisma utiliza `DIRECT_URL` con precedencia sobre `DATABASE_URL`; pasar los parámetros codificados dentro de `options` de esa URL temporal y conservar la configuración TLS existente. El wrapper transmite la URL al CLI. `PGOPTIONS` por sí solo requiere comprobar soporte en el conector. Mantener las credenciales en memoria del proceso o configuración privada y evitar imprimirlas o guardarlas en logs. Los scripts de lectura usan sus propios límites locales. [Parámetros de sesión PostgreSQL](https://www.postgresql.org/docs/18/runtime-config-client.html).
6. Tras repetir el estado y confirmar la misma única pendiente, ejecutar una vez `pnpm db:migrate:deploy` en la ventana autorizada. Vigilar esperas y duración desde una sesión administrativa con acceso a `pg_stat_activity` y `pg_locks`. La fila de historial, el bloqueo consultivo del CLI y los permisos también pueden impedir el inicio. Ante timeout, error, crecimiento de la cola o bloqueo fuera del presupuesto, detener el procedimiento y mantener el backend en mantenimiento hasta determinar el estado real.
7. Si falla el SQL, la transacción explícita debe revertir el DDL completo. Prisma puede conservar un intento fallido en `_prisma_migrations`. Revisar columnas, restricciones, huellas y conexiones antes de cualquier reintento. Una reparación de historial exige una decisión explícita tras el diagnóstico. Evitar marcar aplicada o revertida una migración para eludir una discrepancia sin comprobar su efecto real. La finalización forzada de sesiones también requiere una decisión operativa explícita.
8. Tras el éxito, ejecutar inmediatamente `postcheck.sql` con psql y la misma configuración privada de lectura. Exigir todas las columnas, restricciones validadas, índices válidos, RLS, revocaciones a PUBLIC y roles API, tablas nuevas vacías, columnas nuevas nulas, historial terminado con checksum exacto y las cuatro huellas idénticas al preflight. Ejecutar `pnpm db:migrate:status` y confirmar ausencia de pendientes. Cualquier diferencia impide reabrir el servicio y requiere diagnóstico con el respaldo disponible.
9. Publicar posteriormente el backend compatible y comprobar su salud y los permisos antes de reabrir el tráfico, siguiendo la autorización de despliegue correspondiente. El backend que consulta las columnas nuevas necesita primero la migración aplicada. La publicación del frontend de configuración queda sujeta al cierre de su fase y a su autorización específica.

En una base con tráfico, el postcheck de tablas vacías y valores nuevos nulos corresponde al instante posterior a migrar y anterior a habilitar la funcionalidad. Los usos posteriores crean datos válidos que incumplirían esas comprobaciones de instalación. El preflight está destinado a bases anteriores a esta migración.

### Resultado del ensayo local de Fase 1.1

Validación realizada en PostgreSQL 18.6, en un clúster nuevo llamado `arca_phase11_disposable`, enlazado exclusivamente a `127.0.0.1` y con directorio temporal propio. Cada suite creó y eliminó su propia base. Se utilizaron datos sintéticos y adaptadores simulados de correo y almacenamiento en el ciclo HTTP. Las comprobaciones de esta fase se ejecutaron exclusivamente en ese entorno.

| Comprobación | Resultado final |
| --- | --- |
| Referencia previa, configuración y migraciones draft | 10 aprobadas, 0 fallos |
| Seis suites relacionadas, con PostgreSQL habilitado | 51 aprobadas, 0 fallos, 0 omisiones |
| De esas 51, unidad de configuración / estáticas de migración | 9 / 2 aprobadas |
| De esas 51, migración con datos / ciclo HTTP / drafts de cotización / clientes desde cotización | 1 / 14 / 11 / 14 aprobadas |
| `pnpm verify`, backend | 760 aprobadas, 174 integraciones optativas omitidas, 0 fallos |
| `pnpm verify`, frontend | 529 aprobadas, 0 fallos, 0 omisiones |
| Lint JSDoc/backend, lint frontend, Prisma Validate y build | Correctos |
| CLI real Prisma sobre base vacía, historial de 45 migraciones | Correcto, estado actualizado |
| psql real, preflight y postcheck | Todos los indicadores verdaderos y cuatro huellas idénticas |
| Rollback ante `lock_timeout` durante el segundo ALTER de la migración | Correcto, esquema y huellas originales preservados |
| Integridad de Fase 2 y migración original | Siete archivos pendientes y migración idénticos por SHA-256 |
| `git diff --check` | Correcto |

Las 174 omisiones del comando general corresponden a guardas de integraciones optativas. Las 40 pruebas PostgreSQL de las seis suites relacionadas se ejecutaron por separado, incluidas en el total de 51. Las demás integraciones optativas permanecieron desactivadas. La suite de navegador queda fuera de esta comprobación del backend y de SQL. Los archivos visuales de la Fase 2 se preservaron y sus pruebas habituales se ejecutaron dentro de verify.

El ensayo de CLI aplicó primero las 44 migraciones previas desde una copia temporal de los archivos, ejecutó preflight con psql, incorporó el archivo original intacto y lo aplicó con Prisma, y ejecutó postcheck y status. La aplicación exclusiva de la migración objetivo tardó 1414 ms, incluyendo el arranque de Prisma, sobre tablas vacías. Esta medición exige un ensayo adicional con volumen y versión representativos del destino antes de dimensionar una ventana compartida. Los checks finales ampliados de columnas y visibilidad también pasaron en la integración de migración.

Las primeras ejecuciones detectaron un fixture de proyecto sin el `public_slug` obligatorio y una URL de ensayo con espacios codificados como `+`, que libpq interpreta literalmente. Se completó el fixture y se codificaron los espacios como `%20`. Todas las ejecuciones finales pasaron. El sandbox exigió ejecutar las pruebas con procesos hijos fuera de su aislamiento por `spawn EPERM`. El alcance siguió siendo local.

Logs de pruebas en la carpeta temporal del usuario, `arca-phase11-integration-final.log` y `arca-phase11-verify-final.log`. Este documento continúa excluido de Git por la regla existente para Markdown privado. La arquitectura y el contrato API versionados describen las reglas públicas y las condiciones de aplicación. El consumidor frontend pendiente de Fase 2 deberá asociar los nuevos códigos de fecha con el paso Seguimiento.

### Aplicaci?n autorizada posterior al cierre de Fase 1.1

Aplicada en staging el 12/11/26, 11:54:19 p. m. (America/Caracas), tras la autorizaci?n expl?cita de commit y migraciones. Commit local `567c57a0`, con los 13 archivos aprobados. Se aplic? exclusivamente `20261113120000_project_draft_configuration`, con el archivo original y su checksum intactos. Prisma confirm? las 45 migraciones al d?a.

Respaldo completo del esquema public en `C:\Users\nuvis\ARCA_PRIVATE_BACKUPS\project-configuration-20261113T035043Z`, SHA-256 `fdce653be5230c6ad04ed2f7a2134fc63aeb1d05b50de546610b30d044ac9843`, creado desde una instant?nea de solo lectura y restaurado en un cl?ster temporal PostgreSQL 17.6. Las huellas de las 42 tablas restauradas coincidieron con la instant?nea. El ensayo de migraci?n y sus checks pasaron antes de la aplicaci?n remota. Los cuatro fingerprints del preflight/postcheck de staging fueron id?nticos y todas las comprobaciones resultaron verdaderas.

El backend permaneci? disponible durante la operaci?n. El preflight confirm? ausencia de transacciones abiertas de otras sesiones. Se verificaron nuevamente los datos afectados contra el respaldo y se aplicaron l?mites de conexi?n de 3 s para bloqueos, 60 s para sentencias y 90 s para la transacci?n. El comando remoto dur? 9947 ms, incluido el arranque del CLI.

Nueve checksums hist?ricos difer?an por finales de l?nea CRLF/LF y coincidieron al normalizar a LF. Se conservaron todos los archivos hist?ricos y el registro de migraciones. La primera restauraci?n local requiri? recrear el esquema public de la base vac?a y se repiti? correctamente en otra base ef?mera. Los siete archivos pendientes de Fase 2 contin?an fuera del commit. Las pruebas de navegador e integraciones optativas pendientes deber?n revisarse antes de integrar y desplegar la aplicaci?n.

## 20261114120000_approved_request_projects_to_draft (migración de datos, pendiente de aplicar)

Lleva a `draft` los proyectos que nacieron de una solicitud aprobada (`project_requests.status = 'converted'`, `converted_project_id`) y siguen exactamente en `pending`: el estado real tras aprobar. No toca `in_process`, `finished`, `cancelled` ni `archived`, ni proyectos sin solicitud. Conserva fechas, encargados, archivos y comentarios; registra `project_status_history` (`pending` → `draft`) y `audit_logs` (`project.approved_request_to_draft`) con el administrador que aprobó. Es idempotente. Efecto: clientes y arquitectos dejan de ver esos proyectos hasta finalizar su configuración.

Orden: respaldo verificado → `preflight.sql` (`prisma/checks/20261114120000_approved_request_projects_to_draft/`, solo lectura: lista exactamente los proyectos que cambiarán con sus archivos, comentarios y encargados; revisar antes de continuar) → `pnpm db:migrate:status` → `pnpm db:migrate:deploy` → `postcheck.sql` → publicar backend y frontend. **No se ha aplicado en staging ni producción**: requiere autorización expresa. Ensayo local: `tests/approvedRequestProjectsToDraftMigration.integration.test.js` (PostgreSQL desechable).

## 20261119120000_project_comment_version_points (Fase 1.2, B6; aprobada como parte de B6, pendiente de aplicar)

Sustituye `project_comments_panorama_point_unique_idx` por `project_comments_panorama_version_point_unique_idx`, que añade `coalesce(file_version_id, 0)`: los puntos de panorámica se numeran por versión comentada, para que el cliente no deduzca cuántos comentarios hay en versiones que no ve. No escribe filas; con versión NULL (todo lo existente) la unicidad es idéntica. Crea el índice nuevo antes de retirar el anterior. Checksum que registra Prisma: `41b9363e31d9a956260db403c0dce11d665267b1f4921cad1c9fd70d37c83c92` (LF, fijado en `.gitattributes`).

Orden: respaldo verificado → `preflight.sql` (`prisma/checks/20261119120000_project_comment_version_points/`, solo lectura) → `pnpm db:migrate:status` → `pnpm db:migrate:deploy` → `postcheck.sql`. Reversión: en una transacción, recrear `project_comments_panorama_point_unique_idx` con su definición anterior, retirar el índice nuevo y borrar la fila de `_prisma_migrations`; solo es posible mientras no existan puntos repetidos entre versiones (con la activación apagada no se crean). **No se ha aplicado en staging ni producción**: su aplicación en entornos compartidos requiere autorización expresa. Ensayo local (PostgreSQL 18 desechable, Prisma 7.8 desde una copia sin `.env`): preflight correcto, despliegue, postcheck correcto, checksum registrado igual al SHA-256 del archivo, duplicado con versión NULL rechazado, reversión, preflight de nuevo correcto, redespliegue y postcheck, filas conservadas. Prueba automatizada: `tests/projectCommentVersionPoints.integration.test.js` (`ARCA_COMMENT_VERSION_POINTS_DB_TESTS=1` y `ARCA_COMMENT_VERSION_POINTS_TEST_DATABASE_URL` local) sobre una base detenida antes de la migración con puntos existentes: preflight y postcheck, huella de `project_comments` idéntica antes y después, checksum, unicidad con versión NULL igual a la anterior, retirados y respuestas fuera del índice, numeración aislada por versión y reversión (bloqueada con 23505 mientras haya puntos repetidos entre versiones, completa sin ellos).

## 20261124120000_quote_version_restorations (restauración comercial de cotizaciones, pendiente de aplicar)

Añade a `quote_versions` la trazabilidad de la restauración comercial: `restored_from_version_number` (FK compuesta a una versión anterior de la misma cotización), `restore_reason` VARCHAR(500) y `restore_request_id` UUID (`uq_quote_versions_restore_request`), con `chk_quote_versions_restoration` (las tres juntas o ninguna). Aditiva: columnas NULL sin valor por defecto; no modifica filas, triggers ni secuencias. Fija `lock_timeout = 3s` y `statement_timeout = 60s` en su transacción, porque el pooler de Supabase **ignora** `options` en la URL (comprobado en staging con `SHOW`, solo lectura: `lock_timeout` seguía en 0). Bloquea `quote_versions` en ACCESS EXCLUSIVE hasta el COMMIT. Checksum que registra Prisma (LF, fijado en `.gitattributes`): `21dd6005ca27ae2175c92f691b4dd55811ef51291e21f57b563a3a76fe3b0857`.

**Estado de staging verificado el 24/11/2026 (solo lectura).** PostgreSQL 17.6. `migrate status`: 50 migraciones locales y **solo esta pendiente**; `_prisma_migrations` sin intentos a medias (la única fila revertida es un intento antiguo de `20260825120000_project_request_legal_documentation`). Las migraciones `20261114120000`, `20261117120000`, `20261118120000` y `20261119120000` ya figuran aplicadas (13/11 y 20/11) aunque sus secciones anteriores digan «pendiente». Preflight en staging: todos los `ok_*` verdaderos, sin otras transacciones abiertas; 12 cotizaciones, 13 versiones, 40 conceptos y 13 PDF.

**Ensayo local (24/11/2026).** PostgreSQL 17.10 desechable (`embedded-postgres`, UTF-8 `C.UTF-8`) con todo el historial y la CLI de Prisma desde este árbol: preflight correcto, `migrate status` con solo esta pendiente, `migrate deploy` (≈2,9 s con el arranque), postcheck correcto, huellas idénticas y checksum registrado igual al del archivo. Con otra sesión leyendo `quote_versions`, el despliegue aborta en ≈3 s (55P03) sin cambios; Prisma deja la migración fallida, el preflight lo detecta (`ok_no_unfinished` falso) y tras `prisma migrate resolve --rolled-back 20261124120000_quote_version_restorations` el redespliegue y el postcheck son correctos. Pruebas: `tests/quoteVersionRestorationsMigration.integration.test.js` (historial creado con el SQL del backend anterior, preflight/postcheck, compatibilidad del backend anterior, restauración, PDF en error sin almacenamiento, concurrencia idempotente, inmutabilidad, FK, unicidad, `lock_timeout` y reversión) y `tests/quotes.integration.test.js`, con `ARCA_SERVICE_CATALOG_DB_TESTS=1` y `ARCA_SERVICE_CATALOG_TEST_DATABASE_URL` locales.

**Precaución de conexión.** `prisma.config.ts` usa `DIRECT_URL` antes que `DATABASE_URL` y carga `.env`. En un ensayo local hay que fijar **ambas** variables a la base desechable y neutralizar el `.env` (`DOTENV_CONFIG_PATH` a un archivo inexistente), y confirmar el destino con `migrate status` antes de desplegar.

Orden seguro (cada escritura requiere autorización expresa):

1. Confirmar destino e identidad de la base, `migrate status` con **solo esta** pendiente y el SHA-256 del archivo (`21dd6005…`).
2. Respaldo verificado (y restaurado en un clúster temporal) fuera del repositorio.
3. Pausar escrituras de cotizaciones (sin altas, ediciones ni recuperaciones de PDF) hasta el postcheck.
4. `psql -X -f prisma/checks/20261124120000_quote_version_restorations/preflight.sql`: todos los `ok_*` verdaderos y `other_open_transactions = 0`; guardar la salida (huellas) fuera del repositorio.
5. `pnpm db:migrate:deploy` una sola vez. Si falla por `lock_timeout` (55P03) o tiempo de sentencia, nada se aplicó: ejecutar `prisma migrate resolve --rolled-back 20261124120000_quote_version_restorations`, repetir el paso 4 y reintentar en otro momento.
6. `psql -X -f prisma/checks/20261124120000_quote_version_restorations/postcheck.sql`: todos los `ok_*` verdaderos y huellas idénticas al preflight; `pnpm db:migrate:status` sin pendientes.
7. Publicar el backend nuevo (lo necesita: lee y escribe las columnas en altas, ediciones y lecturas) y después el frontend; reanudar escrituras.

El backend publicado anterior funciona con la migración aplicada (sus INSERT nombran columnas explícitas y las nuevas quedan NULL). Reversión (solo con el backend anterior publicado y respaldo previo; con restauraciones reales se pierde su trazabilidad), en una transacción: retirar `uq_quote_versions_restore_request`, `fk_quote_versions_restored_from` y `chk_quote_versions_restoration`, las tres columnas y la fila de `_prisma_migrations`; ensayada en `quoteVersionRestorationsMigration.integration.test.js`.

## Flujo para un cambio nuevo

1. Modificar `prisma/schema.prisma` para cambios que Prisma pueda representar.
2. Ejecutar en desarrollo:

   ```powershell
   pnpm db:migrate:dev --name nombre_del_cambio
   ```

3. Revisar siempre el `migration.sql` generado antes de conservarlo.
4. Para RLS, índices por expresiones, restricciones especiales o SQL avanzado, editar ese `migration.sql` manualmente.
   Toda tabla nueva en `public` debe incluir, en la misma migración, `ALTER TABLE public.<tabla> ENABLE ROW LEVEL SECURITY;` y `REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.<tabla> FROM anon, authenticated, service_role;`. Los privilegios predeterminados de `postgres` se mantienen sin cambios a propósito y concederían esos cuatro privilegios a cada tabla nueva (ver [docs/DB_PRIVILEGES.md](../docs/DB_PRIVILEGES.md)). `tests/dbPrivileges.test.js` rechaza las migraciones posteriores a D-2 que creen una tabla sin ese `REVOKE`.
5. Validar primero sobre la base de pruebas.
6. En staging o producción ejecutar únicamente:

   ```powershell
   pnpm db:migrate:deploy
   ```

7. Confirmar el estado con:

   ```powershell
   pnpm db:migrate:status
   ```

No usar `prisma db push` ni `prisma migrate reset` sobre bases con datos. No usar `migrate dev` en producción.

## Base existente y sincronización

`pnpm db:pull` vuelve a leer la estructura real y actualiza `schema.prisma`. Debe usarse con cuidado porque Prisma no representa completamente RLS, restricciones `CHECK`, claves diferibles ni índices por expresiones. Esas características deben conservarse en SQL manual dentro de las migraciones.

Prisma mantiene su historial en la tabla `_prisma_migrations`. Los antiguos archivos SQL independientes fueron retirados porque sus cambios ya forman parte del baseline; desde ahora la única fuente de migraciones es `prisma/migrations`.

El comando `pnpm verify` ejecuta lint/JSDoc, valida el esquema, ejecuta pruebas del backend y frontend y construye el frontend sin consultar la base. `pnpm verify:db` comprueba por separado el estado de migraciones y requiere acceso a la base configurada; no aplica migraciones ni prueba por sí solo el SQL de una migración nueva.

## Despliegue futuro en VPS

Durante el despliegue:

```text
backup de PostgreSQL
→ instalar dependencias
→ pnpm db:migrate:deploy
→ pnpm db:migrate:status
→ iniciar o reiniciar el backend
```

El comando de despliegue aplica solamente migraciones pendientes. Si una falla, Prisma la registra y detiene el proceso para evitar continuar con una estructura incompleta.
