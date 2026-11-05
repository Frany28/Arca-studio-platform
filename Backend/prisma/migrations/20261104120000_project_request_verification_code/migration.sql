-- Código de validación del envío de solicitudes de proyecto.
--
-- Reutiliza las columnas existentes verification_code_hash, verification_expires_at y
-- verified_at (sin uso hasta ahora) y añade:
--
-- * verification_attempts: intentos fallidos del código vigente; se reinicia al emitir uno nuevo
--   y al consumirlo. El servicio bloquea el código al llegar al máximo.
-- * verification_sent_at: momento de la última emisión, para limitar los reenvíos.
--
-- El hash es un HMAC ligado a la solicitud, al usuario y a la operación de envío: un código no
-- sirve para otra solicitud ni para otro usuario. Solo añade columnas (una con valor por defecto
-- constante, sin reescritura de filas) y una restricción que las filas existentes cumplen.
BEGIN;

ALTER TABLE public.project_requests
  ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN verification_sent_at TIMESTAMPTZ(6),
  ADD CONSTRAINT chk_project_requests_verification_attempts CHECK (verification_attempts >= 0);

COMMIT;
