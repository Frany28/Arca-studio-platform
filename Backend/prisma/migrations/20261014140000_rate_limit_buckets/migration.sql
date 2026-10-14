-- Hallazgo B-2: contadores de rate limiting compartidos entre instancias del
-- backend (Vercel ejecuta instancias independientes; los contadores en memoria
-- se multiplicaban por instancia).
--
-- * key_hash: HMAC-SHA256 de ámbito + dimensión + identificador (correo, token,
--   usuario o IP verificada). Nunca se guardan datos personales en claro.
-- * La ventana es fija: el backend reinicia count y expires_at en la misma
--   sentencia atómica (INSERT ... ON CONFLICT DO UPDATE) cuando ha expirado.
-- * Las filas caducadas se eliminan por lotes desde el backend; el índice de
--   expires_at hace barata esa limpieza.
-- * Tabla nueva y vacía: no modifica datos existentes.
BEGIN;

CREATE TABLE public.rate_limit_buckets (
  key_hash BYTEA NOT NULL,
  scope VARCHAR(64) NOT NULL,
  count INTEGER NOT NULL,
  window_started_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (key_hash),
  CONSTRAINT chk_rate_limit_buckets_key_hash CHECK (octet_length(key_hash) = 32),
  CONSTRAINT chk_rate_limit_buckets_count CHECK (count >= 1)
);

CREATE INDEX rate_limit_buckets_expires_at_idx ON public.rate_limit_buckets (expires_at);

-- Mismo criterio que el resto de tablas: RLS activo y sin políticas.
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- Regla de D-2 para tablas nuevas. Se ejecuta solo si existen los roles de
-- Supabase (PostgreSQL 17+), para que la migración también aplique en una base
-- local o en la base sombra de Prisma.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.rate_limit_buckets FROM anon, authenticated, service_role';
  END IF;
END
$$;

COMMIT;
