-- Restauración comercial de cotizaciones: comprobación previa de 20261124120000_quote_version_restorations.
-- SOLO LECTURA. Ejecutar con psql -X -f y guardar el resultado fuera del repositorio (contiene recuentos y
-- huellas del entorno). Cualquier ok_* falso, error o timeout impide continuar. Mantener pausadas las
-- escrituras de cotizaciones hasta el postcheck para que las huellas sean comparables.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';

-- Historial: sin migraciones a medias, el objetivo sin aplicar y la inmediatamente anterior aplicada
-- (si falta, hay migraciones previas pendientes que `migrate deploy` aplicaría junto con esta).
SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS ok_no_unfinished,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE migration_name = '20261124120000_quote_version_restorations'
                     AND rolled_back_at IS NULL) AS ok_target_not_applied,
       EXISTS (SELECT 1 FROM public._prisma_migrations
               WHERE migration_name = '20261119120000_project_comment_version_points'
                 AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok_previous_applied;

-- Estructura previa: las columnas y restricciones nuevas no existen; la clave referenciada por la FK
-- compuesta y el trigger de inmutabilidad (que compara la fila completa) sí.
SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'quote_versions'
                     AND column_name IN ('restored_from_version_number', 'restore_reason', 'restore_request_id')) AS ok_columns_absent,
       NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.quote_versions'::regclass
                     AND conname IN ('chk_quote_versions_restoration', 'fk_quote_versions_restored_from',
                                     'uq_quote_versions_restore_request')) AS ok_constraints_absent,
       to_regclass('public.uq_quote_versions_restore_request') IS NULL AS ok_index_name_free,
       EXISTS (SELECT 1 FROM pg_constraint
               WHERE conrelid = 'public.quote_versions'::regclass AND conname = 'uq_quote_versions_quote_version'
                 AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (quote_id, version_number)') AS ok_referenced_key,
       EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
               WHERE t.tgrelid = 'public.quote_versions'::regclass AND t.tgname = 'quote_versions_immutable'
                 AND t.tgenabled = 'O' AND p.proname = 'prevent_quote_version_mutation'
                 AND p.prosrc LIKE '%to_jsonb(NEW) - ''is_current''%') AS ok_immutability_trigger;

-- Integridad del historial existente: una sola versión vigente por cotización, numeración consecutiva
-- desde 1 y conceptos en todas las versiones.
SELECT NOT EXISTS (SELECT 1 FROM public.quotes q
                   WHERE (SELECT count(*) FROM public.quote_versions v WHERE v.quote_id = q.id AND v.is_current) <> 1) AS ok_one_current_per_quote,
       NOT EXISTS (SELECT 1 FROM public.quote_versions GROUP BY quote_id
                   HAVING min(version_number) <> 1 OR max(version_number) <> count(*)) AS ok_consecutive_versions,
       NOT EXISTS (SELECT 1 FROM public.quote_versions v
                   WHERE NOT EXISTS (SELECT 1 FROM public.quote_items i WHERE i.quote_version_id = v.id)) AS ok_versions_with_items;

-- Indicadores de bloqueo, sin textos de consultas ni datos personales. Un cero no reserva la ventana.
SELECT count(*) AS other_open_transactions, count(*) = 0 AS ok_no_other_transactions
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL;

SELECT c.relname AS table_name, pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c WHERE c.oid IN ('public.quotes'::regclass, 'public.quote_versions'::regclass, 'public.quote_items'::regclass);

-- Huella del historial comercial (todas las columnas actuales), idéntica en el postcheck, que excluye
-- solo las columnas que añade la migración. De los PDF, únicamente su identidad inmutable.
SELECT 'quotes' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), '')) AS fingerprint
FROM public.quotes t
UNION ALL
SELECT 'quote_versions', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))
FROM public.quote_versions t
UNION ALL
SELECT 'quote_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))
FROM public.quote_items t
UNION ALL
SELECT 'quote_pdf_documents', count(*),
       md5(coalesce(string_agg(concat_ws('|', quote_version_id, object_key, file_name, source_hash, content_hash, size_bytes),
                               ';' ORDER BY quote_version_id), ''))
FROM public.quote_pdf_documents;

ROLLBACK;
