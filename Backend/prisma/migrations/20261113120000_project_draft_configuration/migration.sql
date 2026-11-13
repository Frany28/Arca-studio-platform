-- Configuración de proyectos draft (solicitudes aprobadas y cotizaciones).
--
-- Aprobar una solicitud crea ahora un proyecto 'draft' que el administrador configura con el
-- formulario «Nuevo Proyecto» (Figma 3727:618978) antes de confirmarlo como 'pending'. Esta
-- migración añade lo que el formulario guarda y no existía:
--
-- 1. projects: zonificación, procedimientos, condiciones y equipo utilizado (texto libre opcional
--    salvo zonificación, que exige la finalización en el servicio, no en PostgreSQL, para que un
--    borrador pueda guardarse incompleto).
-- 2. project_requests: registro real del primer contacto con el cliente (fecha y autor). Sin él,
--    el seguimiento del cliente no da por realizado el contacto.
-- 3. project_folders: carpetas jerárquicas libres de un proyecto y files.folder_id. Un archivo sin
--    carpeta queda en la raíz; los adjuntos de la solicitud se identifican por
--    origin_project_request_id.
-- 4. project_warranties: garantías opcionales del proyecto.
-- 5. Retira chk_projects_draft_without_end_date: un borrador configurado ya planifica su entrega.
--    chk_projects_dates sigue exigiendo end_date >= start_date cuando ambas existen.
--
-- No modifica filas existentes. Los proyectos pending creados por aprobaciones anteriores
-- conservan su estado.
BEGIN;

ALTER TABLE public.projects
  ADD COLUMN zoning TEXT,
  ADD COLUMN procedures TEXT,
  ADD COLUMN conditions TEXT,
  ADD COLUMN equipment TEXT,
  ADD CONSTRAINT chk_projects_configuration_text_length CHECK (
    coalesce(length(zoning), 0) <= 4000
    AND coalesce(length(procedures), 0) <= 4000
    AND coalesce(length(conditions), 0) <= 4000
    AND coalesce(length(equipment), 0) <= 4000
  );

ALTER TABLE public.projects DROP CONSTRAINT chk_projects_draft_without_end_date;

ALTER TABLE public.project_requests
  ADD COLUMN first_contact_at TIMESTAMPTZ(6),
  ADD COLUMN first_contact_by BIGINT,
  ADD CONSTRAINT fk_project_requests_first_contact_by
    FOREIGN KEY (first_contact_by) REFERENCES public.users (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT chk_project_requests_first_contact CHECK (
    (first_contact_at IS NULL AND first_contact_by IS NULL)
    OR (first_contact_at IS NOT NULL AND first_contact_by IS NOT NULL AND status = 'converted'::public.project_request_status)
  );

CREATE TABLE public.project_folders (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL,
  parent_id BIGINT,
  name VARCHAR(120) NOT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ(6),
  CONSTRAINT fk_project_folders_project FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_folders_parent FOREIGN KEY (parent_id) REFERENCES public.project_folders (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_folders_created_by FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_project_folders_name CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT chk_project_folders_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Nombre único entre hermanas (sin distinguir mayúsculas); la raíz usa parent_id NULL.
CREATE UNIQUE INDEX uq_project_folders_sibling_name
  ON public.project_folders (project_id, coalesce(parent_id, 0), lower(btrim(name)))
  WHERE deleted_at IS NULL;
CREATE INDEX idx_project_folders_project ON public.project_folders (project_id) WHERE deleted_at IS NULL;

ALTER TABLE public.files
  ADD COLUMN folder_id BIGINT,
  ADD CONSTRAINT fk_files_folder FOREIGN KEY (folder_id) REFERENCES public.project_folders (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT chk_files_folder_requires_project CHECK (folder_id IS NULL OR project_id IS NOT NULL);
CREATE INDEX idx_files_folder_id ON public.files (folder_id) WHERE folder_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE public.project_warranties (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL,
  product VARCHAR(150) NOT NULL,
  model VARCHAR(100) NOT NULL,
  code VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  service_date DATE NOT NULL,
  end_date DATE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ(6),
  CONSTRAINT fk_project_warranties_project FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_warranties_created_by FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_project_warranties_text CHECK (
    length(btrim(product)) > 0 AND length(btrim(model)) > 0 AND length(btrim(code)) > 0
  ),
  CONSTRAINT chk_project_warranties_dates CHECK (start_date <= service_date AND service_date <= end_date)
);
CREATE INDEX idx_project_warranties_project ON public.project_warranties (project_id, sort_order) WHERE deleted_at IS NULL;

-- Tablas nuevas: sin privilegios para los roles de la API de Supabase (hallazgo D-2).
DO $$
DECLARE
  role_name text;
  table_name text;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.project_folders FROM anon, authenticated, service_role';
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.project_warranties FROM anon, authenticated, service_role';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['project_folders', 'project_warranties'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
