-- Comprobación previa de la migración 20261026120000_quotes. SOLO LECTURA.
--
-- Uso (psql 17+, con la URL de la base que se va a migrar; nunca guardar la salida en el
-- repositorio):
--   psql "$DIRECT_URL" -X -f prisma/checks/20261026120000_quotes/preflight.sql > preflight.txt
--
-- Toda la ejecución ocurre en una transacción READ ONLY que termina con ROLLBACK: PostgreSQL
-- rechaza cualquier escritura. La huella final lee todas las filas de cada tabla; ejecutarla en
-- un momento de poca actividad.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. Versión: las migraciones previas usan pg_c_utf8 (PostgreSQL 17+).
SELECT current_setting('server_version') AS server_version,
       current_setting('server_version_num')::int >= 170000 AS ok_version;

-- 2. Historial de Prisma: ninguna migración a medias y lista completa para comparar con
--    `pnpm db:migrate:status`. migrate deploy aplicará TODAS las pendientes, en orden.
SELECT count(*) AS unfinished_migrations, count(*) = 0 AS ok_no_unfinished
FROM public._prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

SELECT migration_name, finished_at, rolled_back_at, left(checksum, 12) AS checksum_prefix
FROM public._prisma_migrations
ORDER BY migration_name;

-- 3. La migración solo crea objetos nuevos: ninguno debe existir todavía.
SELECT to_regclass('public.quotes') IS NULL
         AND to_regclass('public.quote_versions') IS NULL
         AND to_regclass('public.quote_items') IS NULL AS ok_tables_absent,
       to_regprocedure('public.prevent_quote_version_mutation()') IS NULL
         AND to_regprocedure('public.prevent_quote_item_mutation()') IS NULL AS ok_functions_absent,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'uq_service_versions_id_service'
       ) AS ok_constraint_absent;

-- 4. Claves referenciadas por las FK nuevas: deben existir y ser bigint.
SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS column_type,
       format_type(a.atttypid, a.atttypmod) = 'bigint' AS ok_bigint
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT a.attisdropped
  AND (c.relname, a.attname) IN (
    ('users', 'id'), ('clients', 'id'), ('projects', 'id'),
    ('services', 'id'), ('service_versions', 'id'), ('service_versions', 'service_id')
  )
ORDER BY c.relname, a.attname;

-- 5. service_versions conserva su trigger de inmutabilidad (la migración no lo toca).
SELECT EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgname = 'service_versions_immutable' AND tgrelid = 'public.service_versions'::regclass
) AS ok_service_versions_trigger;

-- 6. Roles de Supabase: si existen los tres, la migración aplica el REVOKE de D-2.
SELECT count(*) AS supabase_roles, count(*) = 3 AS revoke_block_will_run
FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role');

-- 7. ADD CONSTRAINT UNIQUE sobre service_versions necesita un bloqueo exclusivo breve: no debe
--    haber otras sesiones reteniendo bloqueos sobre la tabla al aplicar.
SELECT count(*) AS other_locks_on_service_versions, count(*) = 0 AS ok_no_locks
FROM pg_locks l
WHERE l.relation = 'public.service_versions'::regclass AND l.pid <> pg_backend_pid();

SELECT count(*) AS service_versions_rows FROM public.service_versions;

-- 8. Huella de datos de todas las tablas existentes (filas y md5 del contenido ordenado).
--    Se repite en postcheck.sql: las tablas existentes deben quedar idénticas. Las marcadas como
--    volatile cambian con el uso normal (sesiones y límites de peticiones) y se comparan aparte.
SELECT c.relname AS table_name,
       c.relname IN ('rate_limit_buckets', 'user_sessions') AS volatile,
       (xpath('/row/n/text()', x))[1]::text::bigint AS row_count,
       (xpath('/row/h/text()', x))[1]::text AS content_md5
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL query_to_xml(
  format('SELECT count(*) AS n, md5(coalesce(string_agg(t::text, %L ORDER BY t::text), %L)) AS h FROM public.%I t', E'\n', '', c.relname),
  false, true, ''
) AS x
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'
ORDER BY c.relname;

ROLLBACK;
