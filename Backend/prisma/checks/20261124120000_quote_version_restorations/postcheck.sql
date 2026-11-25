-- Restauración comercial de cotizaciones: comprobación posterior de 20261124120000_quote_version_restorations.
-- SOLO LECTURA. Ejecutar con psql -X -f justo después de migrar y antes de publicar el backend nuevo
-- (después, las restauraciones crean filas con las columnas nuevas informadas). Cualquier ok_* falso,
-- error o timeout impide continuar. Las huellas deben ser idénticas a las del preflight.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';

-- Historial: aplicada una sola vez, terminada y con el SHA-256 de los bytes LF del archivo.
SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS ok_no_unfinished,
       (SELECT count(*) = 1 FROM public._prisma_migrations
        WHERE migration_name = '20261124120000_quote_version_restorations'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL
          AND checksum = '21dd6005ca27ae2175c92f691b4dd55811ef51291e21f57b563a3a76fe3b0857') AS ok_migration_record;

-- Columnas nuevas: tipos exactos y opcionales.
SELECT (SELECT count(*) = 3 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'quote_versions' AND is_nullable = 'YES' AND column_default IS NULL
          AND ((column_name = 'restored_from_version_number' AND data_type = 'integer')
            OR (column_name = 'restore_reason' AND data_type = 'character varying' AND character_maximum_length = 500)
            OR (column_name = 'restore_request_id' AND data_type = 'uuid'))) AS ok_columns;

-- Restricciones validadas con su definición exacta.
SELECT coalesce((SELECT convalidated AND pg_get_constraintdef(oid) = 'CHECK ((((restored_from_version_number IS NULL) AND (restore_reason IS NULL) AND (restore_request_id IS NULL)) OR ((restored_from_version_number IS NOT NULL) AND (restore_reason IS NOT NULL) AND (restore_request_id IS NOT NULL) AND (restored_from_version_number >= 1) AND (restored_from_version_number < version_number) AND (btrim((restore_reason)::text) <> ''''::text))))'
                 FROM pg_constraint WHERE conrelid = 'public.quote_versions'::regclass AND conname = 'chk_quote_versions_restoration'), false) AS ok_check,
       coalesce((SELECT convalidated AND contype = 'f' AND confrelid = 'public.quote_versions'::regclass
                   AND confdeltype = 'r' AND confupdtype = 'a' AND confmatchtype = 's'
                   AND pg_get_constraintdef(oid) = 'FOREIGN KEY (quote_id, restored_from_version_number) REFERENCES quote_versions(quote_id, version_number) ON DELETE RESTRICT'
                 FROM pg_constraint WHERE conrelid = 'public.quote_versions'::regclass AND conname = 'fk_quote_versions_restored_from'), false) AS ok_foreign_key,
       coalesce((SELECT contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (quote_id, restore_request_id)'
                 FROM pg_constraint WHERE conrelid = 'public.quote_versions'::regclass AND conname = 'uq_quote_versions_restore_request'), false) AS ok_unique,
       coalesce((SELECT indisunique AND indisvalid AND indisready FROM pg_index
                 WHERE indexrelid = to_regclass('public.uq_quote_versions_restore_request')), false) AS ok_unique_index_valid;

-- Protecciones previas intactas: trigger de inmutabilidad, vigencia única, RLS y D-2 (si existen los roles).
SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
               WHERE t.tgrelid = 'public.quote_versions'::regclass AND t.tgname = 'quote_versions_immutable'
                 AND t.tgenabled = 'O' AND p.proname = 'prevent_quote_version_mutation') AS ok_immutability_trigger,
       coalesce((SELECT indisunique AND indisvalid FROM pg_index WHERE indexrelid = to_regclass('public.uq_quote_versions_current')), false) AS ok_current_index,
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.quote_versions'::regclass) AS ok_rls,
       NOT EXISTS (SELECT 1 FROM pg_roles r
                   WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
                     AND (has_table_privilege(r.oid, 'public.quote_versions', 'TRUNCATE')
                       OR has_table_privilege(r.oid, 'public.quote_versions', 'TRIGGER')
                       OR has_table_privilege(r.oid, 'public.quote_versions', 'REFERENCES'))) AS ok_api_roles_revoked;

-- Ninguna versión existente queda marcada como restaurada; el historial sigue íntegro.
SELECT NOT EXISTS (SELECT 1 FROM public.quote_versions
                   WHERE restored_from_version_number IS NOT NULL OR restore_reason IS NOT NULL
                      OR restore_request_id IS NOT NULL) AS ok_existing_rows_unrestored,
       NOT EXISTS (SELECT 1 FROM public.quotes q
                   WHERE (SELECT count(*) FROM public.quote_versions v WHERE v.quote_id = q.id AND v.is_current) <> 1) AS ok_one_current_per_quote,
       NOT EXISTS (SELECT 1 FROM public.quote_versions GROUP BY quote_id
                   HAVING min(version_number) <> 1 OR max(version_number) <> count(*)) AS ok_consecutive_versions;

-- Huella idéntica a la del preflight (excluye solo las columnas añadidas).
SELECT 'quotes' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), '')) AS fingerprint
FROM public.quotes t
UNION ALL
SELECT 'quote_versions', count(*),
       md5(coalesce(string_agg(md5((to_jsonb(t) - ARRAY['restored_from_version_number', 'restore_reason', 'restore_request_id'])::text), '' ORDER BY id), ''))
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
