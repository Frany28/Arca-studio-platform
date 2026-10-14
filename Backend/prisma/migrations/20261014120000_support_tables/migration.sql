-- Formaliza las tablas del módulo de soporte, que hasta ahora creaba en tiempo
-- de ejecución supportRepository.ensureSupportTables (hallazgo D-4).
--
-- Columnas, tipos, valores por defecto, claves primarias y la clave foránea
-- (nombre por defecto support_request_files_support_request_id_fkey, ON DELETE
-- CASCADE) reproducen exactamente aquella definición. user_id y uploaded_by se
-- mantienen sin clave foránea, igual que en runtime.
--
-- IF NOT EXISTS es deliberado: si un backend anterior ya creó las tablas en
-- algún entorno antes de aplicar esta migración, su estructura es idéntica y la
-- migración las adopta sin recrearlas ni tocar sus datos. Por eso la clave
-- foránea se declara dentro de CREATE TABLE y no con ALTER TABLE ADD CONSTRAINT.
BEGIN;

CREATE TABLE IF NOT EXISTS public.support_requests (
  id BIGSERIAL NOT NULL,
  user_id BIGINT NOT NULL,
  issue_type TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ(6),
  CONSTRAINT support_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.support_request_files (
  id BIGSERIAL NOT NULL,
  support_request_id BIGINT NOT NULL,
  uploaded_by BIGINT NOT NULL,
  original_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_extension TEXT,
  file_size BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  file_url TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ(6),
  CONSTRAINT support_request_files_pkey PRIMARY KEY (id),
  CONSTRAINT support_request_files_support_request_id_fkey
    FOREIGN KEY (support_request_id) REFERENCES public.support_requests(id)
    ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Mismo criterio que el resto de tablas: RLS activo y sin políticas. El backend
-- accede con su rol de servidor; anon y authenticated no obtienen filas.
-- Es idempotente si el event trigger de Supabase ya lo había activado.
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_request_files ENABLE ROW LEVEL SECURITY;

COMMIT;
