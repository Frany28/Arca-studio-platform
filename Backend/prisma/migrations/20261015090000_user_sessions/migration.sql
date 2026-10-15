-- Hallazgo B-3: sesiones revocables. Cada JWT de sesión lleva el identificador
-- de su fila (claim `sid`); el backend valida en cada petición, en la misma
-- consulta que carga al usuario, que la sesión no esté revocada ni caducada.
--
-- * No guarda IP, user agent ni el token: solo el identificador aleatorio,
--   el usuario, las fechas y el motivo de revocación.
-- * Tabla nueva y vacía: no modifica datos existentes. Los JWT emitidos antes
--   de esta migración no tienen `sid` y dejan de ser válidos (nuevo inicio de
--   sesión), según lo aprobado.
BEGIN;

CREATE TABLE public.user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  revoked_at TIMESTAMPTZ(6),
  revoked_reason VARCHAR(40),
  CONSTRAINT user_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT fk_user_sessions_user
    FOREIGN KEY (user_id) REFERENCES public.users(id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT chk_user_sessions_expiration CHECK (expires_at > created_at),
  CONSTRAINT chk_user_sessions_revocation CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

-- Revocación de todas las sesiones activas de un usuario.
CREATE INDEX user_sessions_active_user_idx ON public.user_sessions (user_id) WHERE revoked_at IS NULL;
-- Limpieza por lotes de sesiones caducadas.
CREATE INDEX user_sessions_expires_at_idx ON public.user_sessions (expires_at);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Regla de D-2 para tablas nuevas, solo si existen los roles de Supabase.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.user_sessions FROM anon, authenticated, service_role';
  END IF;
END
$$;

COMMIT;
