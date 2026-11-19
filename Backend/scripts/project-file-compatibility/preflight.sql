-- Fase 1.2 (B9): comprobación previa de la compatibilidad de archivos heredados. SOLO LECTURA.
-- Ejecutar con psql -X -f justo antes de --plan y guardar el resultado fuera del repositorio.
-- Cualquier ok_* falso, error o timeout impide continuar. Las huellas deben coincidir con el postcheck,
-- salvo las de archivos y comentarios, que cambian solo en las filas convertidas.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';

SELECT current_setting('transaction_read_only') = 'on' AS ok_read_only,
       NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS ok_no_unfinished,
       EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261118120000_project_file_review_audience_expand'
               AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok_review_expansion_applied,
       EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261119120000_project_comment_version_points'
               AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok_comment_points_applied;

-- Archivos heredados de proyectos vigentes, por situación (lo que el plan clasificará).
SELECT count(*) AS legacy_files,
       count(*) FILTER (WHERE f.origin_project_request_id IS NOT NULL) AS transferred_attachments,
       count(*) FILTER (WHERE p.status = 'draft') AS in_draft_projects,
       count(*) FILTER (WHERE p.status = 'archived' OR f.status = 'archived') AS archived,
       count(*) FILTER (WHERE p.is_public) AS in_public_projects,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.project_warranty_documents l WHERE l.file_id = f.id)) AS warranty_linked,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.project_file_audience_grants g WHERE g.file_id = f.id)) AS with_grants,
       count(*) FILTER (WHERE (SELECT count(*) FROM public.file_versions v WHERE v.file_id = f.id AND v.deleted_at IS NULL) > 1) AS with_several_versions
FROM public.files f
JOIN public.projects p ON p.id = f.project_id AND p.deleted_at IS NULL
WHERE f.access_policy IS NULL AND f.deleted_at IS NULL AND f.status <> 'deleted';

-- Huellas que la conversión no debe cambiar.
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
