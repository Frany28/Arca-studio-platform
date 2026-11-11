-- Cuentas de cliente pendientes (creadas al guardar una cotización con un cliente nuevo).
--
-- users.email y users.password_hash admiten NULL SOLO en una cuenta pending: así no se inventan
-- correos ni contraseñas. Cualquier otro estado los sigue exigiendo (chk_users_identity_unless_pending)
-- y una cuenta pending nunca tiene contraseña (chk_users_pending_without_password): no puede iniciar
-- sesión por construcción. clients.email pasa a ser opcional: es el contacto comercial, no una
-- identidad de acceso, y un cliente creado desde una cotización todavía no lo tiene.
--
-- person_name_key normaliza nombres para buscar coincidencias sin distinguir mayúsculas, acentos
-- (NFD sin marcas combinantes U+0300–U+036F) ni espacios repetidos. Usa pg_c_utf8, como las
-- unidades de medida, para no depender del locale. El índice NO es único: dos personas distintas
-- pueden llamarse igual; la aplicación pide confirmación explícita ante coincidencias.
--
-- Las restricciones se añaden NOT VALID y se validan después: las filas existentes ya cumplen
-- (columnas antes NOT NULL, ningún 'pending'); prisma/checks/20261110131000_pending_client_accounts
-- lo comprueba antes de aplicar. No modifica filas, triggers ni secuencias.
BEGIN;

ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE public.clients ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.users
  ADD CONSTRAINT chk_users_identity_unless_pending CHECK (
    status = 'pending'::public.user_status
    OR (email IS NOT NULL AND password_hash IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT chk_users_pending_without_password CHECK (
    status <> 'pending'::public.user_status OR password_hash IS NULL
  ) NOT VALID;

ALTER TABLE public.users VALIDATE CONSTRAINT chk_users_identity_unless_pending;
ALTER TABLE public.users VALIDATE CONSTRAINT chk_users_pending_without_password;

CREATE FUNCTION public.person_name_key(value text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE STRICT PARALLEL SAFE
  RETURN lower(
    btrim(regexp_replace(regexp_replace(normalize(value, NFD), '[' || chr(768) || '-' || chr(879) || ']', '', 'g'), '\s+', ' ', 'g'))
    COLLATE pg_c_utf8
  );

CREATE INDEX idx_clients_name_key
  ON public.clients (public.person_name_key(name))
  WHERE deleted_at IS NULL;

COMMIT;
