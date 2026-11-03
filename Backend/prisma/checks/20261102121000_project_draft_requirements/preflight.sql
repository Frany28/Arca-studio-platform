-- Comprobación previa de 20261102120000_project_draft_status, 20261102121000_project_draft_requirements
-- y 20261102122000_quote_submission_id. SOLO LECTURA.
--
-- Uso (psql 17+, con la URL de la base que se va a migrar; nunca guardar la salida en el
-- repositorio):
--   psql "$DIRECT_URL" -X -f prisma/checks/20261102121000_project_draft_requirements/preflight.sql > preflight.txt
--
-- Toda la ejecución ocurre en una transacción READ ONLY que termina con ROLLBACK.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. Ninguna migración a medias.
SELECT count(*) AS unfinished_migrations, count(*) = 0 AS ok_no_unfinished
FROM public._prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

-- 2. Objetos nuevos todavía ausentes.
SELECT NOT EXISTS (
         SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'project_status' AND e.enumlabel = 'draft'
       ) AS ok_draft_absent,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname IN ('chk_projects_draft_requirements', 'chk_projects_draft_without_end_date',
                           'chk_project_stages_status_not_draft', 'chk_project_milestones_status_not_draft',
                           'chk_quotes_submission')
       ) AS ok_constraints_absent,
       NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'quotes'
           AND column_name IN ('submission_id', 'submission_fingerprint')
       ) AS ok_quote_columns_absent;

-- 3. Las filas existentes cumplirán las restricciones nuevas al validarlas.
SELECT count(*) FILTER (WHERE start_date IS NULL OR project_type IS NULL OR location IS NULL OR has_plans IS NULL)
         AS projects_missing_required,
       count(*) FILTER (WHERE start_date IS NULL OR project_type IS NULL OR location IS NULL OR has_plans IS NULL) = 0
         AS ok_projects_complete
FROM public.projects;

-- 4. Huella para comparar con el postcheck: los datos existentes no deben cambiar.
SELECT 'projects' AS table_name, count(*) AS row_count,
       md5(string_agg(id::text || ':' || status::text || ':' || coalesce(archived_from_status::text, '') || ':' ||
           start_date::text || ':' || project_type::text || ':' || location || ':' || has_plans::text, ',' ORDER BY id)) AS fingerprint
FROM public.projects
UNION ALL
SELECT 'quotes', count(*), md5(string_agg(id::text || ':' || code, ',' ORDER BY id)) FROM public.quotes
UNION ALL
SELECT 'project_stages', count(*), md5(string_agg(id::text || ':' || status::text, ',' ORDER BY id)) FROM public.project_stages
UNION ALL
SELECT 'project_milestones', count(*), md5(string_agg(id::text || ':' || status::text, ',' ORDER BY id)) FROM public.project_milestones;

ROLLBACK;
