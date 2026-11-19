-- Fase 1.2 (B6): comprobación posterior de 20261119120000_project_comment_version_points. SOLO LECTURA.
-- Ejecutar con psql -X -f justo después de migrar. Cualquier ok_* falso, error o timeout impide continuar.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       EXISTS (SELECT 1 FROM public._prisma_migrations
               WHERE migration_name = '20261119120000_project_comment_version_points'
                 AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok_target_applied;

-- Índice nuevo único, válido y con la definición exacta; el anterior ya no existe.
SELECT to_regclass('public.project_comments_panorama_point_unique_idx') IS NULL AS ok_old_index_absent,
       coalesce((SELECT i.indisunique AND i.indisvalid AND i.indisready
                 FROM pg_index i
                 WHERE i.indexrelid = to_regclass('public.project_comments_panorama_version_point_unique_idx')), false) AS ok_new_index_valid,
       coalesce(pg_get_indexdef(to_regclass('public.project_comments_panorama_version_point_unique_idx')) LIKE
         '%(project_id, comment_type, COALESCE(target_id, ''''::text), COALESCE(file_version_id, (0)::bigint), (((target_metadata ->> ''pointNumber''::text))::integer))%', false)
         AS ok_new_index_columns,
       coalesce(pg_get_indexdef(to_regclass('public.project_comments_panorama_version_point_unique_idx')) LIKE
         '%WHERE ((deleted_at IS NULL) AND (parent_comment_id IS NULL) AND (comment_type = ''panorama''::comment_type) AND (target_metadata ? ''pointNumber''::text))', false)
         AS ok_new_index_predicate;

ROLLBACK;
