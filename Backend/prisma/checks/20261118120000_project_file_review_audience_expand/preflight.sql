-- Fase 1.2 (B3): comprobación previa de 20261118120000_project_file_review_audience_expand. SOLO LECTURA.
-- Ejecutar con psql -X -f y guardar el resultado fuera del repositorio (contiene recuentos del entorno).
-- Cualquier ok_* falso, error o timeout impide continuar.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';

SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS ok_no_unfinished,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE migration_name = '20261118120000_project_file_review_audience_expand'
                     AND rolled_back_at IS NULL) AS ok_target_not_applied,
       EXISTS (SELECT 1 FROM public._prisma_migrations
               WHERE migration_name = '20261113120000_project_draft_configuration'
                 AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok_configuration_applied;

-- Requisitos: tablas y claves que referencian las restricciones nuevas.
SELECT to_regclass('public.files') IS NOT NULL AS ok_files_present,
       to_regclass('public.file_versions') IS NOT NULL AS ok_file_versions_present,
       to_regclass('public.project_warranties') IS NOT NULL AS ok_project_warranties_present,
       to_regclass('public.projects') IS NOT NULL AND to_regclass('public.users') IS NOT NULL AS ok_projects_users_present;

-- Nada de esta migración existe todavía.
SELECT NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace
                   AND typname IN ('file_version_review_status', 'project_file_audience', 'project_file_grant_end_reason')) AS ok_types_absent,
       NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND ((table_name = 'files' AND column_name = 'access_policy')
                     OR (table_name = 'file_versions' AND column_name IN ('content_type', 'review_status', 'reviewed_by',
                         'reviewed_at', 'review_reason', 'restored_from_version_id')))) AS ok_columns_absent,
       to_regclass('public.project_file_audience_grants') IS NULL AS ok_grants_table_absent,
       to_regclass('public.project_warranty_documents') IS NULL AS ok_warranty_documents_table_absent,
       NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('uq_files_id_project', 'uq_file_versions_id_file',
                   'uq_project_warranties_id_project', 'chk_files_access_policy')) AS ok_constraints_absent;

-- Compatibilidad: las restricciones nuevas sobre filas existentes no pueden fallar. Cada id es
-- clave primaria, así que las claves compuestas (id, ...) ya son únicas; se comprueba igualmente.
SELECT NOT EXISTS (SELECT id FROM public.files GROUP BY id, project_id HAVING count(*) > 1) AS ok_files_id_project_unique,
       NOT EXISTS (SELECT id FROM public.file_versions GROUP BY id, file_id HAVING count(*) > 1) AS ok_versions_id_file_unique,
       NOT EXISTS (SELECT id FROM public.project_warranties GROUP BY id, project_id HAVING count(*) > 1) AS ok_warranties_id_project_unique;

-- Datos de referencia para la compatibilidad posterior (no bloquean): versiones por archivo,
-- versión vigente coherente y estados actuales. No incluyen nombres ni contenido.
SELECT count(*) AS files_total,
       count(*) FILTER (WHERE project_id IS NOT NULL) AS project_files,
       count(*) FILTER (WHERE status = 'archived') AS archived_files,
       count(*) FILTER (WHERE status = 'deleted' OR deleted_at IS NOT NULL) AS retired_files,
       count(*) FILTER (WHERE current_version IS NULL) AS files_without_current_version
FROM public.files;

SELECT count(*) AS file_versions_total,
       count(*) FILTER (WHERE is_current) AS current_versions,
       count(DISTINCT file_id) FILTER (WHERE deleted_at IS NULL) AS files_with_active_versions,
       (SELECT count(*) FROM (SELECT file_id FROM public.file_versions WHERE deleted_at IS NULL
          GROUP BY file_id HAVING count(*) > 1) multi) AS files_with_several_versions
FROM public.file_versions;

SELECT count(*) AS project_warranties_total, count(*) FILTER (WHERE deleted_at IS NULL) AS active_warranties
FROM public.project_warranties;

-- Indicadores de bloqueo, sin textos de consultas ni datos personales. Un cero no reserva la ventana.
SELECT count(*) AS other_open_transactions, count(*) = 0 AS ok_no_other_transactions
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL;

SELECT pg_total_relation_size('public.files'::regclass) AS files_total_bytes,
       pg_total_relation_size('public.file_versions'::regclass) AS file_versions_total_bytes,
       pg_total_relation_size('public.project_warranties'::regclass) AS project_warranties_total_bytes;

-- Huellas de las tablas que se alteran, idénticas en el postcheck (sin las columnas nuevas).
SELECT 'files' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), '')) AS fingerprint
FROM public.files t
UNION ALL
SELECT 'file_versions', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))
FROM public.file_versions t
UNION ALL
SELECT 'project_warranties', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))
FROM public.project_warranties t;

ROLLBACK;
