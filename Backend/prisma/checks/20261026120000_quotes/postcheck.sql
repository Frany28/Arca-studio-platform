-- Comprobación posterior de la migración 20261026120000_quotes. SOLO LECTURA.
--
-- Uso (tras `pnpm db:migrate:deploy`, sobre la misma base; nunca guardar la salida en el
-- repositorio):
--   psql "$DIRECT_URL" -X -f prisma/checks/20261026120000_quotes/postcheck.sql > postcheck.txt
--
-- Cada columna ok_* debe ser true. La huella final debe coincidir con la de preflight.sql en
-- todas las tablas no volatile. La lista de nombres esperados la contrasta
-- tests/quoteMigrationChecks.test.js con migration.sql, para que no quede desactualizada.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. Prisma registró la migración como terminada.
SELECT migration_name, finished_at, rolled_back_at, left(checksum, 12) AS checksum_prefix,
       finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok_applied
FROM public._prisma_migrations
WHERE migration_name = '20261026120000_quotes';

SELECT count(*) AS unfinished_migrations, count(*) = 0 AS ok_no_unfinished
FROM public._prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

-- 2. Tablas nuevas, vacías y con RLS activo.
SELECT c.relname AS table_name, c.relrowsecurity AS ok_rls,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text::bigint = 0 AS ok_empty
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('quotes', 'quote_versions', 'quote_items')
ORDER BY c.relname;

-- 3. Restricciones esperadas (incluida la UNIQUE añadida a service_versions).
WITH expected(name) AS (
  VALUES
    ('uq_service_versions_id_service'),
    ('quotes_pkey'), ('uq_quotes_code'), ('fk_quotes_created_by'), ('fk_quotes_updated_by'), ('chk_quotes_code'),
    ('quote_versions_pkey'), ('uq_quote_versions_quote_version'), ('fk_quote_versions_quote'),
    ('fk_quote_versions_client'), ('fk_quote_versions_project'), ('fk_quote_versions_created_by'),
    ('chk_quote_versions_version_number'), ('chk_quote_versions_client_name'), ('chk_quote_versions_project_name'),
    ('chk_quote_versions_notes'), ('chk_quote_versions_services_total'), ('chk_quote_versions_currency_code'),
    ('quote_items_pkey'), ('uq_quote_items_version_line'), ('uq_quote_items_version_service'),
    ('fk_quote_items_quote_version'), ('fk_quote_items_service'), ('fk_quote_items_service_version'),
    ('chk_quote_items_line_number'), ('chk_quote_items_quantity'), ('chk_quote_items_unit_rate'),
    ('chk_quote_items_reference_rate'), ('chk_quote_items_subtotal')
)
SELECT count(*) AS expected_constraints,
       count(con.conname) AS found_constraints,
       count(*) = count(con.conname) AS ok_constraints,
       string_agg(e.name, ', ') FILTER (WHERE con.conname IS NULL) AS missing_constraints
FROM expected e
LEFT JOIN pg_constraint con
  ON con.conname = e.name AND con.connamespace = 'public'::regnamespace;

-- Todas las FK nuevas son ON DELETE RESTRICT (confdeltype = 'r') y están validadas.
SELECT conname, confdeltype = 'r' AS ok_restrict, convalidated AS ok_validated
FROM pg_constraint
WHERE contype = 'f' AND conrelid IN ('public.quotes'::regclass, 'public.quote_versions'::regclass, 'public.quote_items'::regclass)
ORDER BY conname;

-- 4. Índices esperados.
WITH expected(name) AS (
  VALUES
    ('quotes_created_cursor_idx'), ('uq_quote_versions_current'), ('quote_versions_current_total_idx'),
    ('idx_quote_versions_client_id'), ('idx_quote_versions_project_id'),
    ('idx_quote_items_service_id'), ('idx_quote_items_service_version_id')
)
SELECT count(*) AS expected_indexes,
       count(i.indexname) AS found_indexes,
       count(*) = count(i.indexname) AS ok_indexes,
       string_agg(e.name, ', ') FILTER (WHERE i.indexname IS NULL) AS missing_indexes
FROM expected e
LEFT JOIN pg_indexes i ON i.schemaname = 'public' AND i.indexname = e.name;

-- 5. Triggers de inmutabilidad activos y funciones con search_path vacío y sin EXECUTE para PUBLIC.
SELECT t.tgname, t.tgenabled = 'O' AS ok_enabled, p.proname,
       p.proconfig @> ARRAY['search_path=""'] AS ok_search_path,
       NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl WHERE acl.grantee = 0) AS ok_no_public_execute
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgname IN ('quote_versions_immutable', 'quote_items_immutable')
ORDER BY t.tgname;

-- 6. Regla D-2: con los roles de Supabase, sin TRUNCATE, TRIGGER, REFERENCES ni MAINTAIN.
SELECT r.rolname, c.relname AS table_name,
       NOT (has_table_privilege(r.oid, c.oid, 'TRUNCATE') OR has_table_privilege(r.oid, c.oid, 'TRIGGER')
            OR has_table_privilege(r.oid, c.oid, 'REFERENCES') OR has_table_privilege(r.oid, c.oid, 'MAINTAIN')) AS ok_revoked
FROM pg_roles r
CROSS JOIN pg_class c
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
  AND c.oid IN ('public.quotes'::regclass, 'public.quote_versions'::regclass, 'public.quote_items'::regclass)
ORDER BY r.rolname, c.relname;

-- 7. Huella de datos (misma consulta que preflight.sql). Las tablas nuevas aparecen vacías.
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
