-- Unicidad del nombre por carpeta: comprobación previa de 20261126120000_project_files_folder_title_unique.
-- SOLO LECTURA. Ejecutar con psql -X -f y guardar el resultado fuera del repositorio (contiene recuentos e
-- identificadores del entorno, nunca nombres de archivo). Cualquier ok_* falso, error o timeout impide
-- continuar. Mantener pausadas las cargas y movimientos de archivos hasta el postcheck.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';

-- Historial: sin migraciones a medias, el objetivo sin aplicar y la anterior aplicada.
SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS ok_no_unfinished,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE migration_name = '20261126120000_project_files_folder_title_unique'
                     AND rolled_back_at IS NULL) AS ok_target_not_applied,
       EXISTS (SELECT 1 FROM public._prisma_migrations
               WHERE migration_name = '20261124120000_quote_version_restorations'
                 AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok_previous_applied,
       to_regclass('public.uq_files_project_folder_title') IS NULL AS ok_index_name_free;

-- 1. Conflictos que harían abortar la migración: homónimos vigentes en una misma ubicación.
SELECT NOT EXISTS (
         SELECT 1 FROM public.files
         WHERE project_id IS NOT NULL AND deleted_at IS NULL AND status <> 'deleted'
         GROUP BY project_id, coalesce(folder_id, 0), lower(title) HAVING count(*) > 1
       ) AS ok_no_conflicts;

-- Detalle de los conflictos (vacío si ok_no_conflicts): ubicación, ids y origen, sin nombres.
SELECT file.project_id,
       coalesce(file.folder_id::text, 'raíz') AS location,
       folder.system_key,
       array_agg(file.id ORDER BY file.id) AS file_ids,
       count(*) FILTER (WHERE file.origin_project_request_id IS NOT NULL) AS request_attachments
FROM public.files file
LEFT JOIN public.project_folders folder ON folder.id = file.folder_id
WHERE file.project_id IS NOT NULL AND file.deleted_at IS NULL AND file.status <> 'deleted'
GROUP BY file.project_id, coalesce(file.folder_id::text, 'raíz'), folder.system_key, lower(file.title)
HAVING count(*) > 1
ORDER BY file.project_id, location;

-- 2. Archivos heredados sin carpeta (raíz, pendientes de clasificación): no bloquean si sus nombres
--    son únicos en la raíz; la sincronización los ubica con sufijo si hiciera falta.
SELECT count(*) AS unfoldered_files,
       count(*) FILTER (WHERE origin_project_request_id IS NOT NULL) AS unfoldered_request_attachments
FROM public.files
WHERE project_id IS NOT NULL AND folder_id IS NULL AND deleted_at IS NULL AND status <> 'deleted';

-- 3. Solicitudes aún no convertidas con adjuntos homónimos de autores distintos: no bloquean; al
--    aprobarlas, la conversión les asigna un nombre lógico con sufijo («nombre (2).ext»).
SELECT count(DISTINCT project_request_id) AS requests_with_homonym_attachments
FROM (
  SELECT project_request_id FROM public.files
  WHERE project_request_id IS NOT NULL AND deleted_at IS NULL AND status <> 'deleted'
  GROUP BY project_request_id, lower(title) HAVING count(*) > 1
) homonyms;

-- 4. Comparación sin distinguir mayúsculas: lower() sigue el LC_CTYPE de la base, igual en la
--    aplicación y en el índice. Con «C», solo pliega ASCII («Á» ≠ «á»); con un locale UTF-8, también tildes.
SELECT datctype AS database_ctype, lower('Á') = 'á' AS folds_accented_letters
FROM pg_database WHERE datname = current_database();

-- Huella de files (para comparar con el postcheck: la migración no cambia filas).
SELECT count(*) AS files_total,
       md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '') || ':' || coalesce(folder_id::text, '') || ':' || md5(title), ',' ORDER BY id), '')) AS files_fingerprint
FROM public.files;

SELECT count(*) AS other_open_transactions
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle' AND xact_start IS NOT NULL;

COMMIT;
