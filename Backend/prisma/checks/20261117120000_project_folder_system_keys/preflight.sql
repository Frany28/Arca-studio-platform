-- Fase 1.2: comprobación previa de 20261117120000_project_folder_system_keys. SOLO LECTURA.
-- Ejecutar con psql -X -f y guardar el resultado fuera del repositorio.
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
                   WHERE migration_name = '20261117120000_project_folder_system_keys'
                     AND rolled_back_at IS NULL) AS ok_target_not_applied;

-- Requisito: la tabla de carpetas de la Fase 1.1 y su índice de nombres entre hermanas.
SELECT to_regclass('public.project_folders') IS NOT NULL AS ok_folders_table_present,
       to_regclass('public.uq_project_folders_sibling_name') IS NOT NULL AS ok_sibling_index_present;

-- Nada de esta migración existe todavía.
SELECT NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'project_folders' AND column_name = 'system_key'
       ) AS ok_column_absent,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conrelid = 'public.project_folders'::regclass
           AND conname IN ('chk_project_folders_system_key_format', 'chk_project_folders_system_not_deleted')
       ) AS ok_constraints_absent,
       to_regclass('public.uq_project_folders_system_key') IS NULL AS ok_index_absent;

-- Indicadores de bloqueo, sin textos de consultas ni datos personales. Un cero no reserva la ventana.
SELECT count(*) AS other_open_transactions, count(*) = 0 AS ok_no_other_transactions
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL;

SELECT pg_total_relation_size('public.project_folders'::regclass) AS project_folders_total_bytes;

-- Huella de las carpetas existentes, idéntica en el postcheck (sin la columna nueva).
SELECT 'project_folders' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), '')) AS fingerprint
FROM public.project_folders t;

ROLLBACK;
