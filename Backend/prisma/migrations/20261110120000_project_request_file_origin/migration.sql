-- Origen de los archivos de un proyecto creado al aprobar una solicitud.
--
-- chk_files_owner exige que un archivo pertenezca a un proyecto o a una solicitud, nunca a ambos.
-- La aprobación asignaba project_id sin liberar project_request_id, así que aprobar una solicitud
-- con adjuntos violaba la restricción y revertía la transacción (500). Ahora la aprobación pasa el
-- archivo al proyecto (project_id) y libera project_request_id, y esta columna conserva la
-- trazabilidad hacia la solicitud original sin duplicar filas ni objetos del almacenamiento.
--
-- Aditiva: añade una columna anulable, su clave foránea y un índice parcial. No reescribe filas.
BEGIN;

ALTER TABLE public.files
  ADD COLUMN origin_project_request_id BIGINT,
  ADD CONSTRAINT fk_files_origin_project_request
    FOREIGN KEY (origin_project_request_id) REFERENCES public.project_requests (id)
    ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX idx_files_origin_project_request_id
  ON public.files (origin_project_request_id)
  WHERE origin_project_request_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;
