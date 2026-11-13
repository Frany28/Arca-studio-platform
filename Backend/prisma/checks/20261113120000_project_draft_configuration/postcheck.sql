-- Comprobación inmediatamente después de migrar y antes de reabrir escrituras. SOLO LECTURA.
-- Todo ok_* debe ser verdadero y las cuatro huellas deben coincidir con el preflight.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';

SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                   WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS ok_no_unfinished,
       EXISTS (SELECT 1 FROM public._prisma_migrations
               WHERE migration_name = '20261113120000_project_draft_configuration'
                 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
                 AND checksum = '7e5aa94035425b39ea49d325c0c9eba050b44c3c3b8c53ecaeb06eeea2475635') AS ok_migration_record;

WITH expected(table_name, column_name, data_type) AS (
  VALUES ('projects','zoning','text'), ('projects','procedures','text'),
    ('projects','conditions','text'), ('projects','equipment','text'),
    ('project_requests','first_contact_at','timestamp with time zone'),
    ('project_requests','first_contact_by','bigint'), ('files','folder_id','bigint')
)
SELECT e.table_name, e.column_name,
       coalesce(c.data_type = e.data_type AND c.is_nullable = 'YES', false) AS ok_column
FROM expected e LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = e.table_name AND c.column_name = e.column_name;

WITH expected(table_name, column_name, data_type, nullable) AS (
  VALUES ('project_folders','id','bigint','NO'), ('project_folders','project_id','bigint','NO'),
    ('project_folders','parent_id','bigint','YES'), ('project_folders','name','character varying','NO'),
    ('project_folders','created_by','bigint','NO'), ('project_folders','created_at','timestamp with time zone','NO'),
    ('project_folders','updated_at','timestamp with time zone','NO'), ('project_folders','deleted_at','timestamp with time zone','YES'),
    ('project_warranties','id','bigint','NO'), ('project_warranties','project_id','bigint','NO'),
    ('project_warranties','product','character varying','NO'), ('project_warranties','model','character varying','NO'),
    ('project_warranties','code','character varying','NO'), ('project_warranties','start_date','date','NO'),
    ('project_warranties','service_date','date','NO'), ('project_warranties','end_date','date','NO'),
    ('project_warranties','sort_order','integer','NO'), ('project_warranties','created_by','bigint','NO'),
    ('project_warranties','created_at','timestamp with time zone','NO'),
    ('project_warranties','updated_at','timestamp with time zone','NO'),
    ('project_warranties','deleted_at','timestamp with time zone','YES')
)
SELECT e.table_name, e.column_name,
       coalesce(c.data_type = e.data_type AND c.is_nullable = e.nullable, false) AS ok_new_table_column
FROM expected e LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = e.table_name AND c.column_name = e.column_name;

WITH expected(table_name, name) AS (
  VALUES ('projects','chk_projects_configuration_text_length'), ('projects','chk_projects_dates'),
    ('projects','chk_projects_draft_requirements'), ('project_requests','fk_project_requests_first_contact_by'),
    ('project_requests','chk_project_requests_first_contact'), ('files','fk_files_folder'),
    ('files','chk_files_folder_requires_project'), ('project_folders','project_folders_pkey'),
    ('project_folders','fk_project_folders_project'), ('project_folders','fk_project_folders_parent'),
    ('project_folders','fk_project_folders_created_by'), ('project_folders','chk_project_folders_name'),
    ('project_folders','chk_project_folders_not_self_parent'), ('project_warranties','project_warranties_pkey'),
    ('project_warranties','fk_project_warranties_project'), ('project_warranties','fk_project_warranties_created_by'),
    ('project_warranties','chk_project_warranties_text'), ('project_warranties','chk_project_warranties_dates')
)
SELECT e.table_name, e.name, coalesce(c.convalidated, false) AS ok_validated
FROM expected e LEFT JOIN pg_constraint c
  ON c.conname = e.name AND c.conrelid = to_regclass('public.' || e.table_name);

SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.projects'::regclass
                   AND conname = 'chk_projects_draft_without_end_date') AS ok_old_constraint_removed;

WITH expected(name) AS (
  VALUES ('uq_project_folders_sibling_name'), ('idx_project_folders_project'),
         ('idx_files_folder_id'), ('idx_project_warranties_project')
)
SELECT e.name, coalesce(i.indisvalid AND i.indisready, false) AS ok_index
FROM expected e LEFT JOIN pg_class c ON c.relname = e.name AND c.relnamespace = 'public'::regnamespace
LEFT JOIN pg_index i ON i.indexrelid = c.oid;

WITH expected(name) AS (VALUES ('project_folders'), ('project_warranties'))
SELECT e.name, coalesce(c.relrowsecurity, false) AS ok_rls,
       c.oid IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         LEFT JOIN pg_roles r ON r.oid = a.grantee
         WHERE a.grantee = 0 OR r.rolname IN ('anon','authenticated','service_role')
       ) AS ok_api_and_public_revoked
FROM expected e LEFT JOIN pg_class c ON c.relname = e.name AND c.relnamespace = 'public'::regnamespace;

SELECT NOT EXISTS (SELECT 1 FROM public.project_folders) AS ok_folders_empty,
       NOT EXISTS (SELECT 1 FROM public.project_warranties) AS ok_warranties_empty,
       NOT EXISTS (SELECT 1 FROM public.projects WHERE zoning IS NOT NULL OR procedures IS NOT NULL
                   OR conditions IS NOT NULL OR equipment IS NOT NULL) AS ok_project_values_null,
       NOT EXISTS (SELECT 1 FROM public.project_requests WHERE first_contact_at IS NOT NULL
                   OR first_contact_by IS NOT NULL) AS ok_contact_values_null,
       NOT EXISTS (SELECT 1 FROM public.files WHERE folder_id IS NOT NULL) AS ok_folder_values_null;

SELECT 'projects' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(md5((to_jsonb(t) - ARRAY['zoning','procedures','conditions','equipment'])::text), '' ORDER BY id), '')) AS fingerprint
FROM public.projects t
UNION ALL
SELECT 'project_requests', count(*),
       md5(coalesce(string_agg(md5((to_jsonb(t) - ARRAY['first_contact_at','first_contact_by'])::text), '' ORDER BY id), ''))
FROM public.project_requests t
UNION ALL
SELECT 'files', count(*), md5(coalesce(string_agg(md5((to_jsonb(t) - 'folder_id')::text), '' ORDER BY id), '')) FROM public.files t
UNION ALL
SELECT 'file_versions', count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), '')) FROM public.file_versions t;

ROLLBACK;
