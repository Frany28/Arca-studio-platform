-- Idempotencia del alta de cotizaciones.
--
-- * submission_id: UUID que el formulario genera una vez por alta y conserva en los reintentos.
-- * submission_fingerprint: SHA-256 (hex) del contenido normalizado del alta. Un reintento con el
--   mismo submission_id y la misma huella devuelve la cotización ya registrada; con otra huella se
--   rechaza (409 QUOTE_SUBMISSION_REUSED) en lugar de presentar una cotización anterior como si
--   correspondiera al contenido nuevo.
--
-- La unicidad es por autor, como project_requests (client_id, requested_by, submission_id). Las
-- cotizaciones existentes y las editadas conservan NULL: no hay relleno. El servicio serializa los
-- envíos con el mismo identificador mediante un bloqueo consultivo de transacción; el índice único
-- es la última barrera.
--
-- Solo añade columnas nulas, una restricción que las filas existentes cumplen (ambas NULL) y un
-- índice: no modifica filas (no dispara triggers), ni secuencias.
BEGIN;

ALTER TABLE public.quotes ADD COLUMN submission_id UUID;
ALTER TABLE public.quotes ADD COLUMN submission_fingerprint CHAR(64);

ALTER TABLE public.quotes
  ADD CONSTRAINT chk_quotes_submission CHECK (
    (submission_id IS NULL AND submission_fingerprint IS NULL)
    OR (submission_id IS NOT NULL AND submission_fingerprint ~ '^[0-9a-f]{64}$')
  );

CREATE UNIQUE INDEX uq_quotes_created_by_submission
  ON public.quotes (created_by, submission_id)
  WHERE submission_id IS NOT NULL;

COMMIT;
