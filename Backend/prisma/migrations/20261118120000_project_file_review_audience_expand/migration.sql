-- Fase 1.2 (B3): expansión estructural para revisión de versiones, audiencias y documentos de garantía.
--
-- Solo añade estructura. No escribe ni modifica filas existentes y el backend actual no la usa:
-- columnas anulables sin valor por defecto, tablas nuevas vacías, restricciones que las filas
-- actuales ya cumplen e índices. Activar el comportamiento corresponde a entregas posteriores.
--
-- Solo se imponen reglas confirmadas. No dependen de esta migración (siguen pendientes): una sola
-- versión pendiente por archivo (PR1), restaurar solo versiones aprobadas (PR2), que el escaparate
-- exija una autorización del cliente (PR3), la longitud máxima del motivo de rechazo (PR4), que una
-- autorización exija una versión aprobada, una sola versión en el escaparate, el archivado (DA1),
-- la aprobación automática (DA2) y quién revisa (DA5).
--
-- Bloqueos: ACCESS EXCLUSIVE breve sobre files, file_versions y project_warranties (columnas nuevas
-- y restricciones UNIQUE/CHECK, que recorren sus filas) y SHARE ROW EXCLUSIVE sobre projects, users,
-- files, file_versions y project_warranties al crear las claves foráneas. Si no obtiene un bloqueo en
-- 3 s o una sentencia supera 60 s, la transacción completa se revierte sin cambios.
--
-- Comprobaciones de solo lectura: prisma/checks/20261118120000_project_file_review_audience_expand.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Estado de revisión de una versión. NULL en file_versions.review_status significa versión
-- heredada (anterior a la revisión), que conserva el acceso actual.
CREATE TYPE public.file_version_review_status AS ENUM ('pending', 'approved', 'rejected');
-- Audiencias autorizadas explícitamente, independientes entre sí.
CREATE TYPE public.project_file_audience AS ENUM ('client_owner', 'showcase');
-- Cierre de una autorización: sustituida por otra versión o revocada.
CREATE TYPE public.project_file_grant_end_reason AS ENUM ('superseded', 'revoked');

-- files: política de acceso (NULL = regla heredada exacta; 1 = reglas de la Fase 1.2) y clave
-- compuesta para que las tablas nuevas exijan que el archivo pertenezca a su mismo proyecto.
ALTER TABLE public.files
  ADD COLUMN access_policy SMALLINT,
  ADD CONSTRAINT chk_files_access_policy CHECK (access_policy IS NULL OR access_policy = 1),
  ADD CONSTRAINT uq_files_id_project UNIQUE (id, project_id);

-- file_versions: clave compuesta (versión de un archivo concreto), formato propio de cada versión,
-- datos de revisión y procedencia de una restauración.
ALTER TABLE public.file_versions
  ADD CONSTRAINT uq_file_versions_id_file UNIQUE (id, file_id);

ALTER TABLE public.file_versions
  ADD COLUMN content_type VARCHAR(255),
  ADD COLUMN review_status public.file_version_review_status,
  ADD COLUMN reviewed_by BIGINT,
  ADD COLUMN reviewed_at TIMESTAMPTZ(6),
  ADD COLUMN review_reason TEXT,
  ADD COLUMN restored_from_version_id BIGINT,
  ADD CONSTRAINT fk_file_versions_reviewed_by FOREIGN KEY (reviewed_by)
    REFERENCES public.users (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  -- Restaurar solo apunta a otra versión del mismo archivo (reutiliza su objeto almacenado).
  ADD CONSTRAINT fk_file_versions_restored_from FOREIGN KEY (restored_from_version_id, file_id)
    REFERENCES public.file_versions (id, file_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT chk_file_versions_restored_from_other CHECK (
    restored_from_version_id IS NULL OR restored_from_version_id <> id
  ),
  ADD CONSTRAINT chk_file_versions_content_type CHECK (
    content_type IS NULL OR length(btrim(content_type)) > 0
  ),
  -- Heredada o pendiente: sin datos de revisión. Revisada: con fecha. Rechazada: con motivo.
  -- Un CHECK que evalúa a NULL se acepta, y `review_status = '...'` es NULL en una versión heredada.
  -- `IS TRUE` convierte cualquier NULL en falso: solo pasan las combinaciones explícitamente válidas.
  ADD CONSTRAINT chk_file_versions_review_state CHECK ((
    (review_status IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
    OR (review_status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
    OR (review_status = 'approved' AND reviewed_at IS NOT NULL)
    OR (review_status = 'rejected' AND reviewed_at IS NOT NULL
        AND review_reason IS NOT NULL AND length(btrim(review_reason)) > 0)
  ) IS TRUE);

-- Colas de «Pendientes» y «Rechazados» (no único: una pendiente por archivo es la propuesta PR1).
CREATE INDEX idx_file_versions_review_queue
  ON public.file_versions (review_status, created_at DESC, id DESC)
  WHERE review_status IN ('pending', 'rejected') AND deleted_at IS NULL;

-- Autorizaciones de audiencia por versión, con historial. Cliente y escaparate son independientes.
-- Una fila activa (ended_at NULL) autoriza su versión; al compartir otra versión la anterior se
-- cierra como 'superseded' y al retirar el acceso, como 'revoked'. El historial permite aplicar la
-- decisión D4 sin cambiar el esquema.
CREATE TABLE public.project_file_audience_grants (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL,
  file_id BIGINT NOT NULL,
  file_version_id BIGINT NOT NULL,
  audience public.project_file_audience NOT NULL,
  granted_by BIGINT,
  granted_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_by BIGINT,
  ended_at TIMESTAMPTZ(6),
  end_reason public.project_file_grant_end_reason,
  CONSTRAINT fk_project_file_audience_grants_project FOREIGN KEY (project_id)
    REFERENCES public.projects (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_file_audience_grants_file FOREIGN KEY (file_id, project_id)
    REFERENCES public.files (id, project_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_file_audience_grants_version FOREIGN KEY (file_version_id, file_id)
    REFERENCES public.file_versions (id, file_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_file_audience_grants_granted_by FOREIGN KEY (granted_by)
    REFERENCES public.users (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_file_audience_grants_ended_by FOREIGN KEY (ended_by)
    REFERENCES public.users (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_project_file_audience_grants_end CHECK (
    (ended_at IS NULL) = (end_reason IS NULL)
    AND (ended_by IS NULL OR ended_at IS NOT NULL)
    AND (ended_at IS NULL OR ended_at >= granted_at)
  )
);

-- El cliente propietario recibe una sola versión compartida a la vez (regla confirmada).
CREATE UNIQUE INDEX uq_project_file_audience_grants_client_active
  ON public.project_file_audience_grants (file_id)
  WHERE audience = 'client_owner' AND ended_at IS NULL;
CREATE INDEX idx_project_file_audience_grants_file
  ON public.project_file_audience_grants (file_id, audience, granted_at DESC);
CREATE INDEX idx_project_file_audience_grants_version
  ON public.project_file_audience_grants (file_version_id);
CREATE INDEX idx_project_file_audience_grants_project_active
  ON public.project_file_audience_grants (project_id, audience)
  WHERE ended_at IS NULL;

-- Vínculos entre documentos y garantías del mismo proyecto. Un documento puede respaldar varias
-- garantías; desvincular conserva la fila.
ALTER TABLE public.project_warranties
  ADD CONSTRAINT uq_project_warranties_id_project UNIQUE (id, project_id);

CREATE TABLE public.project_warranty_documents (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL,
  warranty_id BIGINT NOT NULL,
  file_id BIGINT NOT NULL,
  linked_by BIGINT NOT NULL,
  linked_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unlinked_by BIGINT,
  unlinked_at TIMESTAMPTZ(6),
  CONSTRAINT fk_project_warranty_documents_project FOREIGN KEY (project_id)
    REFERENCES public.projects (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_warranty_documents_warranty FOREIGN KEY (warranty_id, project_id)
    REFERENCES public.project_warranties (id, project_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_warranty_documents_file FOREIGN KEY (file_id, project_id)
    REFERENCES public.files (id, project_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_warranty_documents_linked_by FOREIGN KEY (linked_by)
    REFERENCES public.users (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_project_warranty_documents_unlinked_by FOREIGN KEY (unlinked_by)
    REFERENCES public.users (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT chk_project_warranty_documents_unlink CHECK (
    (unlinked_by IS NULL OR unlinked_at IS NOT NULL)
    AND (unlinked_at IS NULL OR unlinked_at >= linked_at)
  )
);

CREATE UNIQUE INDEX uq_project_warranty_documents_active
  ON public.project_warranty_documents (warranty_id, file_id)
  WHERE unlinked_at IS NULL;
CREATE INDEX idx_project_warranty_documents_file
  ON public.project_warranty_documents (file_id)
  WHERE unlinked_at IS NULL;

-- Tablas nuevas: sin privilegios para los roles de la API de Supabase (hallazgo D-2).
DO $$
DECLARE
  role_name text;
  table_name text;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.project_file_audience_grants FROM anon, authenticated, service_role';
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.project_warranty_documents FROM anon, authenticated, service_role';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['project_file_audience_grants', 'project_warranty_documents'] LOOP
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
