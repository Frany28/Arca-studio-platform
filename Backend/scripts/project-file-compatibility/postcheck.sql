-- Fase 1.2 (B9): comprobación posterior de la compatibilidad de archivos heredados. SOLO LECTURA.
-- Ejecutar con psql -X -f justo después de --apply (y antes de --verify). Cualquier ok_* falso impide
-- dar por buena la ejecución. Las huellas deben ser idénticas a las del preflight: la conversión solo
-- cambia files.access_policy, crea autorizaciones y asigna versión a comentarios históricos.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';

WITH converted AS (
  SELECT DISTINCT entity_id AS file_id FROM public.audit_logs
  WHERE action = 'project_file.compatibility_converted' AND entity_type = 'file'
)
SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       NOT EXISTS (SELECT 1 FROM converted c JOIN public.files f ON f.id = c.file_id WHERE f.access_policy IS DISTINCT FROM 1) AS ok_converted_policy,
       NOT EXISTS (
         SELECT 1 FROM converted c
         WHERE (SELECT count(*) FROM public.project_file_audience_grants g
                WHERE g.file_id = c.file_id AND g.audience = 'client_owner' AND g.ended_at IS NULL) <> 1
       ) AS ok_converted_one_client_grant,
       NOT EXISTS (
         SELECT 1 FROM converted c
         JOIN public.files f ON f.id = c.file_id
         JOIN public.project_file_audience_grants g ON g.file_id = f.id AND g.audience = 'client_owner' AND g.ended_at IS NULL
         JOIN public.file_versions v ON v.id = g.file_version_id
         WHERE v.version_number IS DISTINCT FROM f.current_version
       ) AS ok_client_grant_is_current,
       NOT EXISTS (
         SELECT 1 FROM public.project_comments pc
         JOIN converted c ON c.file_id = coalesce(pc.file_id, CASE
           WHEN pc.comment_type IN ('image', 'video', 'panorama') AND pc.target_id ~ '^(project-file-)?[0-9]{1,18}$'
             THEN substring(pc.target_id FROM '([0-9]+)$')::bigint END)
         JOIN public.files f ON f.id = c.file_id AND f.project_id = pc.project_id
         WHERE pc.deleted_at IS NULL AND pc.file_version_id IS NULL
       ) AS ok_converted_comments_have_version,
       NOT EXISTS (
         SELECT 1 FROM public.audit_logs
         WHERE action = 'project_file.compatibility_converted'
         GROUP BY entity_id, new_values->>'planSha256' HAVING count(*) > 1
       ) AS ok_single_marker_per_plan;

SELECT (SELECT count(DISTINCT entity_id) FROM public.audit_logs WHERE action = 'project_file.compatibility_converted') AS converted_files,
       (SELECT count(*) FROM public.files f JOIN public.projects p ON p.id = f.project_id AND p.deleted_at IS NULL
        WHERE f.access_policy IS NULL AND f.deleted_at IS NULL AND f.status <> 'deleted') AS remaining_legacy_files;

-- Mismas huellas que el preflight.
SELECT 'file_versions' AS table_name, count(*) AS row_count,
       md5(coalesce(string_agg(concat_ws('|', id, file_id, version_number, file_name, file_size, review_status, reviewed_at, deleted_at, restored_from_version_id), ';' ORDER BY id), '')) AS fingerprint
FROM public.file_versions
UNION ALL
SELECT 'project_warranty_documents', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, warranty_id, file_id, linked_at, unlinked_at), ';' ORDER BY id), ''))
FROM public.project_warranty_documents
UNION ALL
SELECT 'project_folders', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, project_id, parent_id, name, system_key, deleted_at), ';' ORDER BY id), ''))
FROM public.project_folders
UNION ALL
SELECT 'files_location_origin', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, project_id, project_request_id, origin_project_request_id, folder_id, current_version, status, deleted_at), ';' ORDER BY id), ''))
FROM public.files
UNION ALL
SELECT 'project_requests_review', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, status, reviewed_at, converted_project_id), ';' ORDER BY id), ''))
FROM public.project_requests
UNION ALL
SELECT 'project_comments_content', count(*),
       md5(coalesce(string_agg(concat_ws('|', id, project_id, user_id, parent_comment_id, comment_type, content, target_id, target_metadata::text, deleted_at), ';' ORDER BY id), ''))
FROM public.project_comments;

ROLLBACK;
