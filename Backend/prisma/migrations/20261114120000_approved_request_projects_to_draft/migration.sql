-- Proyectos de solicitudes aprobadas antes del nuevo ciclo de vida: pending → draft.
--
-- Hasta 20261113120000_project_draft_configuration, aprobar una solicitud creaba el proyecto
-- directamente en 'pending' («En espera»). El estado real tras aprobar es 'draft': el borrador
-- interno que el administrador configura y confirma con «Finalizar configuración». Esta migración
-- de datos lleva a draft solo los proyectos que:
--   * nacieron de una solicitud aprobada (project_requests.status = 'converted' y
--     converted_project_id apunta a ellos),
--   * siguen exactamente en 'pending' (no se tocan in_process, finished, cancelled ni archived),
--   * no están eliminados.
-- No borra ni modifica otros datos: fechas, responsables, archivos y comentarios se conservan.
-- Cada cambio queda en project_status_history y audit_logs con el administrador que aprobó.
-- Consecuencia esperada: el cliente y los arquitectos dejan de ver esos proyectos hasta que se
-- finalice su configuración (draft → pending), igual que un proyecto aprobado a partir de ahora.
--
-- Comprobaciones de solo lectura: prisma/checks/20261114120000_approved_request_projects_to_draft.
BEGIN;

WITH converted AS (
  SELECT DISTINCT ON (request.converted_project_id)
    request.converted_project_id AS project_id,
    request.id AS project_request_id,
    request.reviewed_by
  FROM public.project_requests request
  WHERE request.status = 'converted'::public.project_request_status
    AND request.converted_project_id IS NOT NULL
    AND request.deleted_at IS NULL
  ORDER BY request.converted_project_id, request.id
),
moved AS (
  UPDATE public.projects project
  SET status = 'draft'::public.project_status,
      updated_at = now()
  FROM converted
  WHERE project.id = converted.project_id
    AND project.status = 'pending'::public.project_status
    AND project.deleted_at IS NULL
  RETURNING project.id, project.created_by, converted.reviewed_by, converted.project_request_id
),
history AS (
  INSERT INTO public.project_status_history (project_id, changed_by, previous_status, new_status, note)
  SELECT id, coalesce(reviewed_by, created_by), 'pending', 'draft',
    'Solicitud aprobada: el proyecto vuelve a borrador hasta finalizar su configuración'
  FROM moved
  RETURNING project_id
)
INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, description, old_values, new_values)
SELECT coalesce(reviewed_by, created_by), 'project.approved_request_to_draft', 'project', id,
  'Proyecto de solicitud aprobada llevado a draft (migración 20261114120000)',
  jsonb_build_object('status', 'pending'),
  jsonb_build_object('status', 'draft', 'projectRequestId', project_request_id)
FROM moved;

COMMIT;
