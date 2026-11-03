-- Comprobación posterior de 20261102120000_project_draft_status, 20261102121000_project_draft_requirements
-- y 20261102122000_quote_submission_id. SOLO LECTURA.
--
-- Uso: psql "$DIRECT_URL" -X -f prisma/checks/20261102121000_project_draft_requirements/postcheck.sql > postcheck.txt
-- Comparar la huella del punto 4 con la del preflight: debe ser idéntica.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. Valor del enum en su posición (antes de 'pending').
SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) AS project_status_values,
       (array_agg(e.enumlabel ORDER BY e.enumsortorder))[1] = 'draft' AS ok_draft_first
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'project_status';

-- 2. Restricciones creadas y validadas.
WITH expected(name) AS (
  VALUES ('chk_projects_draft_requirements'), ('chk_projects_draft_without_end_date'),
         ('chk_project_stages_status_not_draft'), ('chk_project_milestones_status_not_draft'),
         ('chk_quotes_submission')
)
SELECT e.name, con.conname IS NOT NULL AS ok_exists, coalesce(con.convalidated, false) AS ok_validated
FROM expected e
LEFT JOIN pg_constraint con ON con.conname = e.name AND con.connamespace = 'public'::regnamespace
ORDER BY e.name;

-- 3. Nulabilidad e índice de idempotencia.
SELECT column_name, is_nullable = 'YES' AS ok_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'projects' AND column_name IN ('start_date', 'project_type', 'location', 'has_plans'))
    OR (table_name = 'quotes' AND column_name IN ('submission_id', 'submission_fingerprint')))
ORDER BY table_name, column_name;

SELECT EXISTS (
  SELECT 1 FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_quotes_created_by_submission'
) AS ok_submission_index;

-- 4. Huella de los datos existentes (igual que en el preflight).
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
