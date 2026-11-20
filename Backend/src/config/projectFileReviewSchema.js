// Dependencias mínimas de la activación conjunta B4–B8. No se leen archivos en el runtime.
export const PROJECT_FILE_REVIEW_MIGRATIONS = Object.freeze([
  ["20261117120000_project_folder_system_keys", "d71840d8b0837aae5b0427ff0555380c452d88060102b633082f869c8e67cefd"],
  ["20261118120000_project_file_review_audience_expand", "405291f62106b4216aff8929814524d5d7fc4da8eb619a4909a289a883848ac2"],
  ["20261119120000_project_comment_version_points", "41b9363e31d9a956260db403c0dce11d665267b1f4921cad1c9fd70d37c83c92"],
]);

export const PROJECT_FILE_REVIEW_COLUMNS = Object.freeze({
  files: ["access_policy", "origin_project_request_id"],
  file_versions: ["content_type", "review_status", "reviewed_by", "reviewed_at", "review_reason", "restored_from_version_id"],
  project_folders: ["system_key"],
  project_comments: ["file_id", "file_version_id"],
  project_file_audience_grants: ["id", "project_id", "file_id", "file_version_id", "audience", "granted_by", "granted_at", "ended_by", "ended_at", "end_reason"],
  project_warranty_documents: ["id", "project_id", "warranty_id", "file_id", "linked_by", "linked_at", "unlinked_by", "unlinked_at"],
});

export const PROJECT_FILE_REVIEW_INDEXES = Object.freeze([
  "uq_project_folders_system_key", "idx_file_versions_review_queue",
  "uq_project_file_audience_grants_client_active", "idx_project_file_audience_grants_file",
  "idx_project_file_audience_grants_version", "idx_project_file_audience_grants_project_active",
  "uq_project_warranty_documents_active", "idx_project_warranty_documents_file",
  "project_comments_panorama_version_point_unique_idx",
]);

export const PROJECT_FILE_REVIEW_UNIQUE_INDEXES = Object.freeze([
  "uq_project_folders_system_key", "uq_project_file_audience_grants_client_active",
  "uq_project_warranty_documents_active", "project_comments_panorama_version_point_unique_idx",
]);

export const PROJECT_FILE_REVIEW_CONSTRAINTS = Object.freeze([
  "chk_project_folders_system_key_format", "chk_project_folders_system_not_deleted",
  "chk_files_access_policy", "uq_files_id_project", "uq_file_versions_id_file",
  "fk_file_versions_reviewed_by", "fk_file_versions_restored_from", "chk_file_versions_restored_from_other",
  "chk_file_versions_content_type", "chk_file_versions_review_state", "uq_project_warranties_id_project",
  "fk_project_file_audience_grants_project", "fk_project_file_audience_grants_file",
  "fk_project_file_audience_grants_version", "fk_project_file_audience_grants_granted_by",
  "fk_project_file_audience_grants_ended_by", "chk_project_file_audience_grants_end",
  "fk_project_warranty_documents_project", "fk_project_warranty_documents_warranty",
  "fk_project_warranty_documents_file", "fk_project_warranty_documents_linked_by",
  "fk_project_warranty_documents_unlinked_by", "chk_project_warranty_documents_unlink",
]);
