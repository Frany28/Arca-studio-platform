-- Fase 1.2: claves funcionales estables de las carpetas predeterminadas de un proyecto.
--
-- Las 17 carpetas del catálogo (Backend/src/domain/projectFolderCatalog.js, Figma 3727:618978) se
-- crean al dar de alta un proyecto draft y se identifican por su clave (`renders.images.execution`),
-- nunca por su nombre visible. Las carpetas personalizadas conservan system_key NULL.
--
-- Aditiva: una columna anulable sin valor por defecto (solo metadatos), una restricción de formato,
-- una restricción que impide retirar una carpeta predeterminada y un índice único parcial. No modifica
-- filas existentes: las carpetas actuales quedan como personalizadas y los proyectos existentes no
-- reciben carpetas (su tratamiento depende de la estrategia de compatibilidad).
--
-- Comprobaciones de solo lectura: prisma/checks/20261117120000_project_folder_system_keys.
BEGIN;

ALTER TABLE public.project_folders
  ADD COLUMN system_key VARCHAR(80),
  ADD CONSTRAINT chk_project_folders_system_key_format CHECK (
    system_key IS NULL OR system_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
  ),
  -- Una carpeta predeterminada no se retira: la aplicación lo rechaza y PostgreSQL lo garantiza.
  ADD CONSTRAINT chk_project_folders_system_not_deleted CHECK (
    system_key IS NULL OR deleted_at IS NULL
  );

-- Una sola carpeta activa por clave y proyecto: es el árbitro de la creación idempotente
-- (INSERT ... ON CONFLICT DO NOTHING) ante repeticiones y ejecuciones concurrentes.
CREATE UNIQUE INDEX uq_project_folders_system_key
  ON public.project_folders (project_id, system_key)
  WHERE system_key IS NOT NULL AND deleted_at IS NULL;

COMMIT;
