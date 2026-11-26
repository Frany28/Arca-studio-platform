-- Unicidad del nombre lógico de los archivos de proyecto dentro de cada carpeta.
--
-- Dos archivos independientes de un proyecto pueden llamarse igual si están en carpetas distintas;
-- dentro de una misma ubicación no. La raíz del proyecto (folder_id NULL) es una ubicación propia:
-- coalesce(folder_id, 0) la convierte en un valor comparable (los ids de carpeta son positivos), así
-- un índice UNIQUE no la deja pasar como haría con NULL. El nombre se compara sin distinguir
-- mayúsculas (lower(title)), igual que la aplicación (fileRepository.findExistingProjectFile).
--
-- Alcance: solo archivos de proyecto vigentes (project_id no nulo, sin borrado lógico y con estado
-- distinto de 'deleted'). Los adjuntos de solicitudes (project_id NULL) siguen con su propio índice
-- uq_files_project_request_user_title; los PDF de Cotizaciones viven en quote_pdf_documents y no se
-- tocan. No modifica filas, versiones ni objetos de almacenamiento.
--
-- Si ya hay homónimos en una misma ubicación la migración aborta sin cambios con un mensaje sin datos
-- (el preflight los enumera); no los renombra por su cuenta. La aplicación ya impide crearlos bajo el
-- bloqueo del proyecto; el índice es la garantía final frente a cualquier vía de escritura y la
-- aplicación traduce su violación (23505) a 409 DUPLICATE_PROJECT_FILE.
--
-- Bloqueos: CREATE INDEX toma SHARE sobre files hasta el COMMIT (bloquea escrituras de archivos, no
-- lecturas). Los límites se fijan aquí porque el pooler de Supabase ignora `options` de la conexión.
-- Comprobaciones de solo lectura: prisma/checks/20261126120000_project_files_folder_title_unique.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  conflicting_groups integer;
BEGIN
  SELECT count(*) INTO conflicting_groups
  FROM (
    SELECT 1
    FROM public.files
    WHERE project_id IS NOT NULL AND deleted_at IS NULL AND status <> 'deleted'
    GROUP BY project_id, coalesce(folder_id, 0), lower(title)
    HAVING count(*) > 1
  ) duplicated;
  IF conflicting_groups > 0 THEN
    RAISE EXCEPTION 'uq_files_project_folder_title: % grupos de archivos con el mismo nombre en una misma ubicación. Resuélvelos antes de aplicar (ver preflight.sql).', conflicting_groups
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

CREATE UNIQUE INDEX uq_files_project_folder_title
  ON public.files (project_id, (coalesce(folder_id, 0)), (lower(title)))
  WHERE project_id IS NOT NULL AND deleted_at IS NULL AND status <> 'deleted';

COMMIT;
