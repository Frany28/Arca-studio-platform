import { query } from "../config/db.js";
import {
  PROJECT_FILE_REVIEW_COLUMNS,
  PROJECT_FILE_REVIEW_CONSTRAINTS,
  PROJECT_FILE_REVIEW_INDEXES,
  PROJECT_FILE_REVIEW_MIGRATIONS,
  PROJECT_FILE_REVIEW_UNIQUE_INDEXES,
} from "../config/projectFileReviewSchema.js";

/**
 * Contrasta el catálogo PostgreSQL con las dependencias de revisión, audiencias y carpetas.
 * Comprueba si el SQL heredado conservaría el acceso; no referencia columnas antes de verificar su existencia.
 *
 * @param {{query: Function}} [executor] - Pool compartido o cliente de una transacción de comprobación.
 * @returns {Promise<{ready: boolean, legacySafe: boolean, missing: string[]}>} Dependencias y posibilidad de conservar lecturas heredadas.
 */
export async function readProjectFileReviewSchemaState(executor = { query }) {
  const columns = Object.entries(PROJECT_FILE_REVIEW_COLUMNS).flatMap(([table, names]) => names.map((name) => `${table}.${name}`));
  const structure = await executor.query(
    `select to_regclass('public._prisma_migrations') is not null as history_available,
       array(select required from unnest($1::text[]) required
         where not exists (select 1 from pg_attribute a join pg_class t on t.oid = a.attrelid
           where t.relnamespace = 'public'::regnamespace and t.relname = split_part(required, '.', 1)
             and a.attname = split_part(required, '.', 2) and a.attnum > 0 and not a.attisdropped)) as missing_columns,
       array(select required from unnest($2::text[]) required
         where not exists (select 1 from pg_index i join pg_class idx on idx.oid = i.indexrelid
           where idx.relnamespace = 'public'::regnamespace and idx.relname = required
             and i.indisvalid and i.indisready
             and (not (required = any($5::text[])) or i.indisunique))) as missing_indexes,
       array(select required from unnest($3::text[]) required
         where not exists (select 1 from pg_constraint c where c.connamespace = 'public'::regnamespace
           and c.conname = required and c.convalidated)) as missing_constraints,
       array(select required from unnest($4::text[]) required
         where not exists (select 1 from pg_type t join pg_enum e on e.enumtypid = t.oid
           where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'
             and t.typname = split_part(required, '.', 1) and e.enumlabel = split_part(required, '.', 2))) as missing_types`,
    [columns, PROJECT_FILE_REVIEW_INDEXES, PROJECT_FILE_REVIEW_CONSTRAINTS,
      ["file_version_review_status.pending", "file_version_review_status.approved", "file_version_review_status.rejected",
        "project_file_audience.client_owner", "project_file_audience.showcase",
        "project_file_grant_end_reason.superseded", "project_file_grant_end_reason.revoked"], PROJECT_FILE_REVIEW_UNIQUE_INDEXES],
  );
  const row = structure.rows[0];
  const missing = [...row.missing_columns, ...row.missing_indexes, ...row.missing_constraints, ...row.missing_types];
  const history = row.history_available ? await executor.query(
    `select migration_name, checksum, finished_at, rolled_back_at from public._prisma_migrations
     where migration_name = any($1::text[]) or (finished_at is null and rolled_back_at is null)`,
    [PROJECT_FILE_REVIEW_MIGRATIONS.map(([name]) => name)],
  ) : { rows: [] };
  if (!row.history_available) missing.push("_prisma_migrations");
  for (const [name, checksum] of PROJECT_FILE_REVIEW_MIGRATIONS) {
    const applied = history.rows.filter((entry) => entry.migration_name === name && entry.rolled_back_at === null);
    if (applied.length !== 1 || !applied[0].finished_at || applied[0].checksum !== checksum) missing.push(`migration:${name}`);
  }
  if (history.rows.some((entry) => !entry.finished_at && !entry.rolled_back_at)) missing.push("unfinished_migration");
  let legacySafe = true;
  if (missing.length && !row.missing_columns.includes("files.access_policy")) {
    // Si ya existen archivos con audiencias, volver al SQL heredado ampliaría su acceso.
    const policies = await executor.query("select exists(select 1 from public.files where access_policy is not null) as has_review_files");
    legacySafe = !policies.rows[0].has_review_files;
  }
  return { legacySafe, missing, ready: missing.length === 0 };
}
