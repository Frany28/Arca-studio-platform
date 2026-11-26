-- Unicidad del nombre por carpeta: comprobación posterior de 20261126120000_project_files_folder_title_unique.
-- SOLO LECTURA. Todos los ok_* deben ser verdaderos y la huella de files igual a la del preflight.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

SELECT EXISTS (SELECT 1 FROM public._prisma_migrations
               WHERE migration_name = '20261126120000_project_files_folder_title_unique'
                 AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok_migration_recorded,
       (SELECT checksum FROM public._prisma_migrations
        WHERE migration_name = '20261126120000_project_files_folder_title_unique' AND rolled_back_at IS NULL
        ORDER BY started_at DESC LIMIT 1) AS recorded_checksum;

-- Índice presente, único, válido y con la definición exacta (columnas, expresiones y predicado).
SELECT EXISTS (
         SELECT 1 FROM pg_index i
         WHERE i.indexrelid = to_regclass('public.uq_files_project_folder_title')
           AND i.indrelid = 'public.files'::regclass
           AND i.indisunique AND i.indisvalid AND i.indisready
       ) AS ok_index_valid,
       pg_get_indexdef(to_regclass('public.uq_files_project_folder_title')) =
         'CREATE UNIQUE INDEX uq_files_project_folder_title ON public.files USING btree (project_id, COALESCE(folder_id, (0)::bigint), lower((title)::text)) WHERE ((project_id IS NOT NULL) AND (deleted_at IS NULL) AND (status <> ''deleted''::file_status))'
         AS ok_index_definition,
       NOT EXISTS (
         SELECT 1 FROM public.files
         WHERE project_id IS NOT NULL AND deleted_at IS NULL AND status <> 'deleted'
         GROUP BY project_id, coalesce(folder_id, 0), lower(title) HAVING count(*) > 1
       ) AS ok_no_conflicts,
       to_regclass('public.uq_files_project_request_user_title') IS NOT NULL AS ok_request_index_kept;

SELECT count(*) AS files_total,
       md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '') || ':' || coalesce(folder_id::text, '') || ':' || md5(title), ',' ORDER BY id), '')) AS files_fingerprint
FROM public.files;

COMMIT;
