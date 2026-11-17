-- Fase 1.2: comprobación posterior de 20261117120000_project_folder_system_keys. SOLO LECTURA.
-- Ejecutar con psql -X -f justo después de migrar y antes de publicar el backend que la usa.
-- Cualquier ok_* falso, error o timeout impide continuar. La huella debe ser idéntica al preflight.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';

SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only;

-- Columna anulable, sin valor por defecto y con la longitud prevista.
SELECT coalesce(bool_and(data_type = 'character varying' AND character_maximum_length = 80
                         AND is_nullable = 'YES' AND column_default IS NULL), false) AS ok_column
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'project_folders' AND column_name = 'system_key';

WITH expected(name) AS (
  VALUES ('chk_project_folders_system_key_format'), ('chk_project_folders_system_not_deleted')
)
SELECT e.name, coalesce(c.convalidated AND c.contype = 'c', false) AS ok_constraint
FROM expected e
LEFT JOIN pg_constraint c ON c.conname = e.name AND c.conrelid = 'public.project_folders'::regclass;

-- Índice único, válido, parcial y sobre (project_id, system_key).
SELECT coalesce(i.indisunique AND i.indisvalid AND i.indisready, false) AS ok_index_unique_valid,
       coalesce(pg_get_indexdef(i.indexrelid) LIKE '%(project_id, system_key)%', false) AS ok_index_columns,
       coalesce(pg_get_expr(i.indpred, i.indrelid) LIKE '%system_key IS NOT NULL%'
                AND pg_get_expr(i.indpred, i.indrelid) LIKE '%deleted_at IS NULL%', false) AS ok_index_predicate
FROM (SELECT to_regclass('public.uq_project_folders_system_key') AS oid) target
LEFT JOIN pg_index i ON i.indexrelid = target.oid;

-- Las filas existentes no cambian: ninguna recibe clave hasta que la aplicación cree carpetas nuevas.
SELECT NOT EXISTS (SELECT 1 FROM public.project_folders WHERE system_key IS NOT NULL) AS ok_existing_rows_without_key;

-- La tabla conserva RLS y las revocaciones de la Fase 1.1.
SELECT c.relrowsecurity AS ok_rls,
       NOT EXISTS (
         SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         LEFT JOIN pg_roles r ON r.oid = a.grantee
         WHERE a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role')
       ) AS ok_api_and_public_revoked
FROM pg_class c WHERE c.oid = 'public.project_folders'::regclass;

-- Registro de Prisma terminado (comparar el checksum con el documentado en ARCHITECTURE.md).
SELECT count(*) = 1 AS ok_migration_recorded, max(checksum) AS recorded_checksum
FROM public._prisma_migrations
WHERE migration_name = '20261117120000_project_folder_system_keys'
  AND finished_at IS NOT NULL AND rolled_back_at IS NULL;

-- Huella sin la columna nueva: debe coincidir con la del preflight.
SELECT 'project_folders' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(md5((to_jsonb(t) - 'system_key')::text), '' ORDER BY id), '')) AS fingerprint
FROM public.project_folders t;

ROLLBACK;
