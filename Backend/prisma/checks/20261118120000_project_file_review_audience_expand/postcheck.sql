-- Fase 1.2 (B3): comprobación posterior de 20261118120000_project_file_review_audience_expand. SOLO LECTURA.
-- Ejecutar con psql -X -f justo después de migrar y antes de reabrir el servicio.
-- Cualquier ok_* falso, error o timeout impide continuar. Las huellas deben ser idénticas al preflight.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';

SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only;

-- Enums con sus valores exactos y en orden.
WITH expected(name, labels) AS (
  VALUES ('file_version_review_status', ARRAY['pending', 'approved', 'rejected']),
         ('project_file_audience', ARRAY['client_owner', 'showcase']),
         ('project_file_grant_end_reason', ARRAY['superseded', 'revoked'])
)
SELECT e.name,
       coalesce((SELECT array_agg(enumlabel::text ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = t.oid) = e.labels, false) AS ok_enum
FROM expected e
LEFT JOIN pg_type t ON t.typname = e.name AND t.typnamespace = 'public'::regnamespace;

-- Columnas nuevas: anulables y sin valor por defecto (el backend actual no las escribe).
WITH expected(table_name, column_name, data_type) AS (
  VALUES ('files', 'access_policy', 'smallint'),
         ('file_versions', 'content_type', 'character varying'),
         ('file_versions', 'review_status', 'USER-DEFINED'),
         ('file_versions', 'reviewed_by', 'bigint'),
         ('file_versions', 'reviewed_at', 'timestamp with time zone'),
         ('file_versions', 'review_reason', 'text'),
         ('file_versions', 'restored_from_version_id', 'bigint')
)
SELECT e.table_name, e.column_name,
       coalesce(c.data_type = e.data_type AND c.is_nullable = 'YES' AND c.column_default IS NULL, false) AS ok_column
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = e.table_name AND c.column_name = e.column_name;

-- Restricciones nuevas, validadas, con su tipo.
WITH expected(table_name, name, contype) AS (
  VALUES ('files', 'chk_files_access_policy', 'c'),
         ('files', 'uq_files_id_project', 'u'),
         ('file_versions', 'uq_file_versions_id_file', 'u'),
         ('file_versions', 'fk_file_versions_reviewed_by', 'f'),
         ('file_versions', 'fk_file_versions_restored_from', 'f'),
         ('file_versions', 'chk_file_versions_restored_from_other', 'c'),
         ('file_versions', 'chk_file_versions_content_type', 'c'),
         ('file_versions', 'chk_file_versions_review_state', 'c'),
         ('project_warranties', 'uq_project_warranties_id_project', 'u'),
         ('project_file_audience_grants', 'fk_project_file_audience_grants_project', 'f'),
         ('project_file_audience_grants', 'fk_project_file_audience_grants_file', 'f'),
         ('project_file_audience_grants', 'fk_project_file_audience_grants_version', 'f'),
         ('project_file_audience_grants', 'fk_project_file_audience_grants_granted_by', 'f'),
         ('project_file_audience_grants', 'fk_project_file_audience_grants_ended_by', 'f'),
         ('project_file_audience_grants', 'chk_project_file_audience_grants_end', 'c'),
         ('project_warranty_documents', 'fk_project_warranty_documents_project', 'f'),
         ('project_warranty_documents', 'fk_project_warranty_documents_warranty', 'f'),
         ('project_warranty_documents', 'fk_project_warranty_documents_file', 'f'),
         ('project_warranty_documents', 'fk_project_warranty_documents_linked_by', 'f'),
         ('project_warranty_documents', 'fk_project_warranty_documents_unlinked_by', 'f'),
         ('project_warranty_documents', 'chk_project_warranty_documents_unlink', 'c')
)
SELECT e.table_name, e.name, coalesce(c.convalidated AND c.contype::text = e.contype, false) AS ok_constraint
FROM expected e
LEFT JOIN pg_constraint c ON c.conname = e.name AND c.conrelid = to_regclass('public.' || e.table_name);

-- La regla de revisión no tolera NULL: toda la expresión va envuelta en IS TRUE (una versión heredada
-- con fecha, revisor o motivo se rechaza).
-- pg_get_constraintdef la devuelve como «CHECK ((( ... ) IS TRUE))».
SELECT coalesce(pg_get_constraintdef(c.oid) LIKE 'CHECK (%) IS TRUE))', false) AS ok_review_state_null_safe
FROM (SELECT 1) target
LEFT JOIN pg_constraint c ON c.conname = 'chk_file_versions_review_state' AND c.conrelid = 'public.file_versions'::regclass;

-- Las claves foráneas compuestas usan exactamente las columnas previstas (mismo archivo, mismo proyecto).
WITH expected(name, definition) AS (
  VALUES ('fk_file_versions_restored_from', 'FOREIGN KEY (restored_from_version_id, file_id) REFERENCES file_versions(id, file_id)'),
         ('fk_project_file_audience_grants_file', 'FOREIGN KEY (file_id, project_id) REFERENCES files(id, project_id)'),
         ('fk_project_file_audience_grants_version', 'FOREIGN KEY (file_version_id, file_id) REFERENCES file_versions(id, file_id)'),
         ('fk_project_warranty_documents_warranty', 'FOREIGN KEY (warranty_id, project_id) REFERENCES project_warranties(id, project_id)'),
         ('fk_project_warranty_documents_file', 'FOREIGN KEY (file_id, project_id) REFERENCES files(id, project_id)')
)
SELECT e.name, coalesce(pg_get_constraintdef(c.oid) = e.definition, false) AS ok_foreign_key_columns
FROM expected e
LEFT JOIN pg_constraint c ON c.conname = e.name;

-- Índices válidos; los parciales con su predicado. El único índice único nuevo de las tablas es el
-- de la autorización activa del cliente y el del vínculo activo garantía-documento.
WITH expected(name, is_unique, predicate) AS (
  VALUES ('idx_file_versions_review_queue', false, 'review_status'),
         ('uq_project_file_audience_grants_client_active', true, 'client_owner'),
         ('idx_project_file_audience_grants_file', false, NULL),
         ('idx_project_file_audience_grants_version', false, NULL),
         ('idx_project_file_audience_grants_project_active', false, 'ended_at IS NULL'),
         ('uq_project_warranty_documents_active', true, 'unlinked_at IS NULL'),
         ('idx_project_warranty_documents_file', false, 'unlinked_at IS NULL')
)
SELECT e.name,
       coalesce(i.indisvalid AND i.indisready AND i.indisunique = e.is_unique
                AND (e.predicate IS NULL OR pg_get_expr(i.indpred, i.indrelid) LIKE '%' || e.predicate || '%'), false) AS ok_index
FROM expected e
LEFT JOIN pg_index i ON i.indexrelid = to_regclass('public.' || e.name);

-- Ningún índice único impone las propuestas pendientes (una pendiente por archivo, un escaparate).
SELECT NOT EXISTS (
         SELECT 1 FROM pg_index i
         WHERE i.indrelid IN ('public.file_versions'::regclass, 'public.project_file_audience_grants'::regclass)
           AND i.indisunique
           AND (pg_get_expr(i.indpred, i.indrelid) LIKE '%pending%' OR pg_get_expr(i.indpred, i.indrelid) LIKE '%showcase%')
       ) AS ok_no_pending_proposals_enforced;

-- Las filas existentes no cambian: todas las columnas nuevas siguen en NULL y las tablas nuevas están vacías.
SELECT NOT EXISTS (SELECT 1 FROM public.files WHERE access_policy IS NOT NULL) AS ok_files_untouched,
       NOT EXISTS (SELECT 1 FROM public.file_versions
                   WHERE content_type IS NOT NULL OR review_status IS NOT NULL OR reviewed_by IS NOT NULL
                      OR reviewed_at IS NOT NULL OR review_reason IS NOT NULL OR restored_from_version_id IS NOT NULL) AS ok_versions_untouched,
       NOT EXISTS (SELECT 1 FROM public.project_file_audience_grants) AS ok_grants_empty,
       NOT EXISTS (SELECT 1 FROM public.project_warranty_documents) AS ok_warranty_documents_empty;

-- Tablas nuevas con RLS y sin privilegios para PUBLIC ni para los roles de la API.
SELECT c.relname AS table_name, c.relrowsecurity AS ok_rls,
       NOT EXISTS (
         SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         LEFT JOIN pg_roles r ON r.oid = a.grantee
         WHERE a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role')
       ) AS ok_api_and_public_revoked
FROM pg_class c
WHERE c.oid IN ('public.project_file_audience_grants'::regclass, 'public.project_warranty_documents'::regclass);

-- Registro de Prisma terminado (comparar el checksum con el documentado en ARCHITECTURE.md).
SELECT count(*) = 1 AS ok_migration_recorded, max(checksum) AS recorded_checksum
FROM public._prisma_migrations
WHERE migration_name = '20261118120000_project_file_review_audience_expand'
  AND finished_at IS NOT NULL AND rolled_back_at IS NULL;

-- Huellas sin las columnas nuevas: deben coincidir con las del preflight.
SELECT 'files' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(md5((to_jsonb(t) - 'access_policy')::text), '' ORDER BY id), '')) AS fingerprint
FROM public.files t
UNION ALL
SELECT 'file_versions', count(*),
       md5(coalesce(string_agg(md5((to_jsonb(t) - ARRAY['content_type', 'review_status', 'reviewed_by', 'reviewed_at',
         'review_reason', 'restored_from_version_id'])::text), '' ORDER BY id), ''))
FROM public.file_versions t
UNION ALL
SELECT 'project_warranties', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))
FROM public.project_warranties t;

ROLLBACK;
