-- Borradores creados al adjuntar el primer archivo de una solicitud de proyecto.
--
-- El formulario sube los adjuntos en cuanto se seleccionan; para asociarlos, crea antes un
-- borrador vacío (solo cliente, autor, estado draft y submission_id idempotente), sin rellenar
-- con datos ficticios los campos que el cliente aún no completó. Por eso nombre, tipo y
-- ubicación admiten NULL, pero solo mientras la solicitud es un borrador: la restricción exige
-- los tres en cualquier otro estado, y el envío valida además el registro completo antes de
-- consumir el código (services/projectRequestService.js).
--
-- Solo relaja tres NOT NULL y añade una restricción que todas las filas existentes cumplen
-- (hasta ahora las tres columnas eran obligatorias): no reescribe filas.
BEGIN;

ALTER TABLE public.project_requests
  ALTER COLUMN project_name DROP NOT NULL,
  ALTER COLUMN project_type DROP NOT NULL,
  ALTER COLUMN location DROP NOT NULL,
  ADD CONSTRAINT chk_project_requests_identity_after_draft CHECK (
    status = 'draft'
    OR (project_name IS NOT NULL AND project_type IS NOT NULL AND location IS NOT NULL)
  );

COMMIT;
