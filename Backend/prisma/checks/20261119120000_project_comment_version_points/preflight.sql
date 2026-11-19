-- Fase 1.2 (B6): comprobación previa de 20261119120000_project_comment_version_points. SOLO LECTURA.
-- Ejecutar con psql -X -f y guardar el resultado fuera del repositorio (contiene recuentos del entorno).
-- Cualquier ok_* falso, error o timeout impide continuar.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS ok_no_unfinished,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE migration_name = '20261119120000_project_comment_version_points'
                     AND rolled_back_at IS NULL) AS ok_target_not_applied,
       EXISTS (SELECT 1 FROM public._prisma_migrations
               WHERE migration_name = '20261118120000_project_file_review_audience_expand'
                 AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok_previous_applied;

-- El índice anterior existe y el nuevo todavía no.
SELECT to_regclass('public.project_comments_panorama_point_unique_idx') IS NOT NULL AS ok_old_index_present,
       to_regclass('public.project_comments_panorama_version_point_unique_idx') IS NULL AS ok_new_index_absent;

-- Ninguna fila rompería el índice nuevo (equivale a que se cumpla el anterior, porque hoy no hay
-- comentarios de panorámica con versión).
SELECT NOT EXISTS (
         SELECT 1 FROM public.project_comments
         WHERE deleted_at IS NULL AND parent_comment_id IS NULL
           AND comment_type = 'panorama'::public.comment_type AND target_metadata ? 'pointNumber'
         GROUP BY project_id, comment_type, coalesce(target_id, ''), coalesce(file_version_id, 0),
                  ((target_metadata->>'pointNumber')::integer)
         HAVING count(*) > 1
       ) AS ok_no_duplicate_points,
       (SELECT count(*) FROM public.project_comments
        WHERE comment_type = 'panorama'::public.comment_type AND file_version_id IS NOT NULL) AS panorama_points_with_version;

ROLLBACK;
