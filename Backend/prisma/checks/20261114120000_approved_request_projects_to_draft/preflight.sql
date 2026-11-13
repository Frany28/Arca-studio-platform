-- Comprobación previa de 20261114120000_approved_request_projects_to_draft. SOLO LECTURA.
--
-- Uso (con la URL de la base que se va a migrar; nunca guardar la salida en el repositorio):
--   psql "$DIRECT_URL" -X -f prisma/checks/20261114120000_approved_request_projects_to_draft/preflight.sql > preflight.txt
--
-- Toda la ejecución ocurre en una transacción READ ONLY que termina con ROLLBACK.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. Ninguna migración a medias y la configuración de borradores ya aplicada.
SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) = 0 AS ok_no_unfinished,
       coalesce(bool_or(migration_name = '20261113120000_project_draft_configuration' AND finished_at IS NOT NULL), false)
         AS ok_draft_configuration_applied,
       NOT coalesce(bool_or(migration_name = '20261114120000_approved_request_projects_to_draft'), false) AS ok_target_not_applied
FROM public._prisma_migrations;

-- 2. Proyectos que pasarán a draft (revisar antes de aplicar): solicitud aprobada + pending.
SELECT project.id AS project_id, project.name, project.client_id, request.id AS project_request_id,
       (SELECT count(*) FROM public.files file WHERE file.project_id = project.id AND file.deleted_at IS NULL) AS files,
       (SELECT count(*) FROM public.project_comments comment WHERE comment.project_id = project.id AND comment.deleted_at IS NULL) AS comments,
       (SELECT count(*) FROM public.project_assignees assignee WHERE assignee.project_id = project.id) AS assignees
FROM public.projects project
JOIN public.project_requests request ON request.converted_project_id = project.id
WHERE request.status = 'converted' AND request.deleted_at IS NULL
  AND project.status = 'pending' AND project.deleted_at IS NULL
ORDER BY project.id;

-- 3. Proyectos de solicitudes aprobadas que NO cambiarán (ya avanzados o en otro estado).
SELECT project.status, count(*) AS projects
FROM public.projects project
JOIN public.project_requests request ON request.converted_project_id = project.id
WHERE request.status = 'converted' AND request.deleted_at IS NULL AND project.deleted_at IS NULL
GROUP BY project.status ORDER BY project.status;

-- 4. Huella para comparar con el postcheck (todo salvo status/updated_at de los proyectos afectados).
SELECT md5(string_agg(id::text || ':' || status::text, ',' ORDER BY id)) AS projects_status_fingerprint,
       count(*) AS projects
FROM public.projects;

ROLLBACK;
