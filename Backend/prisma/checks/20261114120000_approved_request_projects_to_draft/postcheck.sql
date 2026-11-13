-- Comprobación posterior de 20261114120000_approved_request_projects_to_draft. SOLO LECTURA.
--
-- Uso:
--   psql "$DIRECT_URL" -X -f prisma/checks/20261114120000_approved_request_projects_to_draft/postcheck.sql > postcheck.txt
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. Ningún proyecto de solicitud aprobada sigue en pending.
SELECT count(*) = 0 AS ok_no_pending_from_approved_requests
FROM public.projects project
JOIN public.project_requests request ON request.converted_project_id = project.id
WHERE request.status = 'converted' AND request.deleted_at IS NULL
  AND project.status = 'pending' AND project.deleted_at IS NULL;

-- 2. Cada proyecto llevado a draft tiene su historial y su auditoría (una sola vez).
SELECT count(*) AS migrated_projects,
       count(*) = count(DISTINCT history.project_id) AS ok_single_history,
       bool_and(EXISTS (
         SELECT 1 FROM public.audit_logs log
         WHERE log.action = 'project.approved_request_to_draft' AND log.entity_id = history.project_id
       )) AS ok_audited
FROM public.project_status_history history
WHERE history.previous_status = 'pending' AND history.new_status = 'draft';

-- 3. Huella de estados: comparar con el preflight. Solo deben cambiar los proyectos listados en
--    su paso 2 (pending → draft); la cantidad de proyectos es la misma.
SELECT md5(string_agg(id::text || ':' || status::text, ',' ORDER BY id)) AS projects_status_fingerprint,
       count(*) AS projects
FROM public.projects;

ROLLBACK;
