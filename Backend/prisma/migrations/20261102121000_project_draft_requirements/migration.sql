-- Datos mínimos de un proyecto draft (creado desde una cotización): nombre, cliente, autor,
-- estado draft, progreso 0, visibilidad pública desactivada y fechas de registro.
--
-- start_date, project_type, location y has_plans dejan de ser obligatorios SOLO para los drafts
-- (también archivados desde draft, que al desarchivar vuelven a draft): un draft guarda NULL
-- como «todavía desconocido» en lugar de valores ficticios. Cualquier otro estado los sigue
-- exigiendo mediante chk_projects_draft_requirements, la condición que deberá cumplir la futura
-- transición draft → pending. has_plans conserva DEFAULT false para los escritores existentes
-- (la aprobación de solicitudes lo informa explícitamente); el draft inserta NULL.
--
-- Un draft no tiene fecha de entrega (chk_projects_draft_without_end_date): chk_projects_dates
-- no la comprueba cuando start_date es NULL.
--
-- 'draft' es exclusivo de projects: etapas e hitos comparten el enum y no pueden usarlo.
--
-- Las restricciones se añaden NOT VALID y se validan después: las filas existentes ya cumplen
-- todas (columnas antes NOT NULL, ningún 'draft'); prisma/checks/20261102121000_project_draft_requirements
-- lo comprueba antes de aplicar. No modifica filas, triggers ni secuencias.
BEGIN;

ALTER TABLE public.projects ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN project_type DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN location DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN has_plans DROP NOT NULL;

ALTER TABLE public.projects
  ADD CONSTRAINT chk_projects_draft_requirements CHECK (
    status = 'draft'::public.project_status
    OR (status = 'archived'::public.project_status AND archived_from_status = 'draft'::public.project_status)
    OR (start_date IS NOT NULL AND project_type IS NOT NULL AND location IS NOT NULL AND has_plans IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT chk_projects_draft_without_end_date CHECK (
    end_date IS NULL
    OR NOT (
      status = 'draft'::public.project_status
      OR (status = 'archived'::public.project_status AND archived_from_status = 'draft'::public.project_status)
    )
  ) NOT VALID;

ALTER TABLE public.project_stages
  ADD CONSTRAINT chk_project_stages_status_not_draft CHECK (status <> 'draft'::public.project_status) NOT VALID;
ALTER TABLE public.project_milestones
  ADD CONSTRAINT chk_project_milestones_status_not_draft CHECK (status <> 'draft'::public.project_status) NOT VALID;

ALTER TABLE public.projects VALIDATE CONSTRAINT chk_projects_draft_requirements;
ALTER TABLE public.projects VALIDATE CONSTRAINT chk_projects_draft_without_end_date;
ALTER TABLE public.project_stages VALIDATE CONSTRAINT chk_project_stages_status_not_draft;
ALTER TABLE public.project_milestones VALIDATE CONSTRAINT chk_project_milestones_status_not_draft;

COMMIT;
