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
-- migración las adopta sin recrearlas ni tocar sus datos, tras verificar que
-- su estructura coincide (bloque DO posterior). Por eso la clave foránea se
-- declara dentro de CREATE TABLE y no con ALTER TABLE ADD CONSTRAINT.
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

-- Con IF NOT EXISTS, una tabla previa se adoptaría sin importar su forma. Se
-- verifica que columnas, tipos, nulabilidad, claves primarias y clave foránea
-- coincidan con la definición anterior; cualquier diferencia aborta la
-- migración (y su transacción) sin modificar nada. Los valores por defecto no
-- se comparan: now() y CURRENT_TIMESTAMP son equivalentes pero se almacenan
-- con texto distinto.
DO $$
DECLARE
  expected_columns text[] := ARRAY[
    'support_request_files.created_at:timestamp with time zone:NO',
    'support_request_files.deleted_at:timestamp with time zone:YES',
    'support_request_files.file_extension:text:YES',
    'support_request_files.file_size:bigint:NO',
    'support_request_files.file_type:text:NO',
    'support_request_files.file_url:text:NO',
    'support_request_files.id:bigint:NO',
    'support_request_files.original_name:text:NO',
    'support_request_files.storage_key:text:NO',
    'support_request_files.support_request_id:bigint:NO',
    'support_request_files.uploaded_by:bigint:NO',
    'support_requests.created_at:timestamp with time zone:NO',
    'support_requests.deleted_at:timestamp with time zone:YES',
    'support_requests.description:text:NO',
    'support_requests.id:bigint:NO',
    'support_requests.issue_type:text:YES',
    'support_requests.status:text:NO',
    'support_requests.subject:text:NO',
    'support_requests.updated_at:timestamp with time zone:NO',
    'support_requests.user_id:bigint:NO'
  ];
  actual_columns text[];
BEGIN
  SELECT array_agg(format('%s.%s:%s:%s', table_name, column_name, data_type, is_nullable)
                   ORDER BY format('%s.%s:%s:%s', table_name, column_name, data_type, is_nullable) COLLATE "C")
    INTO actual_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('support_requests', 'support_request_files');

  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION 'D-4: la estructura de las tablas de soporte no coincide con la esperada: %', actual_columns;
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE contype = 'p'
         AND conrelid IN ('public.support_requests'::regclass, 'public.support_request_files'::regclass)
         AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') <> 2 THEN
    RAISE EXCEPTION 'D-4: falta la clave primaria (id) en alguna tabla de soporte.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE contype = 'f'
       AND conname = 'support_request_files_support_request_id_fkey'
       AND conrelid = 'public.support_request_files'::regclass
       AND confrelid = 'public.support_requests'::regclass
       AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'D-4: falta la clave foránea support_request_files_support_request_id_fkey con ON DELETE CASCADE.';
  END IF;
END
$$;

-- Mismo criterio que el resto de tablas: RLS activo y sin políticas. El backend
-- accede con su rol de servidor; anon y authenticated no obtienen filas.
-- Es idempotente si el event trigger de Supabase ya lo había activado.
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_request_files ENABLE ROW LEVEL SECURITY;

COMMIT;
