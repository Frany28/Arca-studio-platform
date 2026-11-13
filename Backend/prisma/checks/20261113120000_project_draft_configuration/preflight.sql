-- Fase 1.1, alternativa B. Comprobación previa de la migración original intacta. SOLO LECTURA.
-- Ejecutar con psql -X -f y guardar el resultado fuera del repositorio.
-- Cualquier ok_* falso, error o timeout impide continuar. Ver PRISMA_MIGRATIONS.md.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';

SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       (current_setting('is_superuser') = 'on' OR pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')) AS ok_activity_visibility,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS ok_no_unfinished,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE migration_name = '20261113120000_project_draft_configuration'
                     AND rolled_back_at IS NULL) AS ok_target_not_applied;

SELECT to_regclass('public.project_folders') IS NULL AS ok_folders_absent,
       to_regclass('public.project_warranties') IS NULL AS ok_warranties_absent,
       NOT EXISTS (
         SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
           AND ((table_name = 'projects' AND column_name IN ('zoning', 'procedures', 'conditions', 'equipment'))
             OR (table_name = 'project_requests' AND column_name IN ('first_contact_at', 'first_contact_by'))
             OR (table_name = 'files' AND column_name = 'folder_id'))
       ) AS ok_columns_absent,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace
           AND conname IN ('chk_projects_configuration_text_length', 'chk_project_requests_first_contact',
                           'fk_project_requests_first_contact_by', 'fk_files_folder', 'chk_files_folder_requires_project')
       ) AS ok_constraints_absent,
       NOT EXISTS (
         SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
           AND relname IN ('uq_project_folders_sibling_name', 'idx_project_folders_project',
                           'idx_files_folder_id', 'idx_project_warranties_project')
       ) AS ok_indexes_absent;

WITH expected(name) AS (
  VALUES ('chk_projects_draft_without_end_date'), ('chk_projects_draft_requirements'), ('chk_projects_dates')
)
SELECT e.name, coalesce(c.convalidated, false) AS ok_prerequisite
FROM expected e LEFT JOIN pg_constraint c ON c.conname = e.name AND c.conrelid = 'public.projects'::regclass;

-- Las columnas nuevas serán NULL. Las tablas nuevas estarán vacías. Comprobar también la regla retirada.
SELECT NOT EXISTS (
  SELECT 1 FROM public.projects WHERE end_date IS NOT NULL
    AND (status = 'draft' OR (status = 'archived' AND archived_from_status = 'draft'))
) AS ok_existing_drafts,
NOT EXISTS (SELECT 1 FROM public.projects WHERE end_date < start_date) AS ok_existing_project_dates;

-- Indicadores de bloqueo, sin textos de consultas ni datos personales. Un cero no reserva la ventana.
SELECT count(*) AS other_open_transactions, count(*) = 0 AS ok_no_other_transactions
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL;

SELECT c.relname AS table_name, pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c WHERE c.oid IN ('public.projects'::regclass, 'public.project_requests'::regclass, 'public.files'::regclass);

-- Huella de todas las columnas originales, incluyendo filas retiradas, idéntica en el postcheck.
SELECT 'projects' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(md5((to_jsonb(t) - ARRAY['zoning','procedures','conditions','equipment'])::text), '' ORDER BY id), '')) AS fingerprint
FROM public.projects t
UNION ALL
SELECT 'project_requests', count(*),
       md5(coalesce(string_agg(md5((to_jsonb(t) - ARRAY['first_contact_at','first_contact_by'])::text), '' ORDER BY id), ''))
FROM public.project_requests t
UNION ALL
SELECT 'files', count(*), md5(coalesce(string_agg(md5((to_jsonb(t) - 'folder_id')::text), '' ORDER BY id), '')) FROM public.files t
UNION ALL
SELECT 'file_versions', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), '')) FROM public.file_versions t;

ROLLBACK;
