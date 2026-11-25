-- Restauración comercial de versiones de cotizaciones (solo administradores).
--
-- Restaurar una versión histórica crea una versión NUEVA y vigente con el contenido comercial de la
-- versión de origen (cliente, proyecto, conceptos, cantidades, tarifas, IVA referencial y notas). Las
-- versiones existentes no se modifican. Esta migración solo añade la trazabilidad de esa operación:
--
-- * restored_from_version_number: número de la versión de origen, de la MISMA cotización (FK compuesta
--   sobre uq_quote_versions_quote_version) y anterior a la versión creada.
-- * restore_reason: motivo obligatorio escrito por el administrador (1–500 caracteres, sin solo espacios).
-- * restore_request_id: UUID del envío, para que un reintento de la misma restauración devuelva la
--   versión ya creada en lugar de crear otra (uq_quote_versions_restore_request por cotización).
--
-- Las tres columnas se informan juntas (chk_quote_versions_restoration) y son NULL en los guardados
-- normales y en todas las versiones existentes. El autor y la fecha son created_by y created_at.
--
-- Solo añade columnas sin valor por defecto (NULL) y restricciones que las filas existentes cumplen: no
-- modifica filas (el trigger quote_versions_immutable no se dispara; compara to_jsonb completo, por lo
-- que también protege las columnas nuevas), no desactiva triggers ni toca secuencias.
--
-- Bloqueos: ACCESS EXCLUSIVE sobre quote_versions hasta el COMMIT (bloquea lecturas y escrituras de
-- cotizaciones mientras valida las restricciones, sobre una tabla pequeña). Los límites se fijan aquí
-- porque el pooler de Supabase ignora `options` de la conexión: si no obtiene un bloqueo en 3 s o una
-- sentencia supera 60 s, la transacción completa se revierte sin cambios (Prisma la marca fallida y
-- requiere `migrate resolve --rolled-back` antes de reintentar).
--
-- Comprobaciones de solo lectura: prisma/checks/20261124120000_quote_version_restorations.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.quote_versions ADD COLUMN restored_from_version_number INTEGER;
ALTER TABLE public.quote_versions ADD COLUMN restore_reason VARCHAR(500);
ALTER TABLE public.quote_versions ADD COLUMN restore_request_id UUID;

ALTER TABLE public.quote_versions
  ADD CONSTRAINT chk_quote_versions_restoration CHECK (
    (restored_from_version_number IS NULL AND restore_reason IS NULL AND restore_request_id IS NULL)
    OR (restored_from_version_number IS NOT NULL AND restore_reason IS NOT NULL AND restore_request_id IS NOT NULL
      AND restored_from_version_number >= 1 AND restored_from_version_number < version_number
      AND btrim(restore_reason) <> '')
  ),
  ADD CONSTRAINT fk_quote_versions_restored_from
    FOREIGN KEY (quote_id, restored_from_version_number)
    REFERENCES public.quote_versions (quote_id, version_number)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT uq_quote_versions_restore_request UNIQUE (quote_id, restore_request_id);

COMMIT;
