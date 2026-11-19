import { query } from "../config/db.js";

// Autorizaciones de audiencia de archivos de proyecto (Fase 1.2, B5): cliente propietario
// (`client_owner`) y escaparate (`showcase`), independientes. Solo PostgreSQL. Las filas nunca se
// borran: compartir otra versión cierra la anterior como `superseded` y retirar el acceso, como
// `revoked`. Debe llamarse con la fila del archivo bloqueada (findProjectFileContext con `lock`).

const poolExecutor = { query };

/**
 * Convierte una fila de autorización en su representación de servicio.
 * Incluye los nombres de quien concedió y de quien cerró la autorización.
 *
 * @param {object} row - Fila de public.project_file_audience_grants.
 * @returns {object} Autorización.
 */
function toGrant(row) {
  return {
    audience: row.audience,
    endReason: row.end_reason ?? null,
    endedAt: row.ended_at ?? null,
    endedBy: row.ended_by === null || row.ended_by === undefined ? null : { id: Number(row.ended_by), name: row.ended_by_name ?? null },
    grantedAt: row.granted_at,
    grantedBy: row.granted_by === null || row.granted_by === undefined ? null : { id: Number(row.granted_by), name: row.granted_by_name ?? null },
    id: Number(row.id),
    versionId: Number(row.file_version_id),
    versionNumber: row.version_number === undefined ? null : Number(row.version_number),
  };
}

/**
 * Cierra la autorización activa de una audiencia de un archivo con el motivo indicado.
 * Conserva la fila como historial; con la fila del archivo bloqueada, como máximo hay una. Usa la
 * hora real tras el bloqueo (`clock_timestamp()`): `now()` es el inicio de la transacción y puede
 * ser anterior a la autorización que otra transacción concurrente acaba de confirmar.
 *
 * @param {{ query: Function }} client - Cliente de la transacción.
 * @param {{ fileId: number, audience: "client_owner"|"showcase", endedBy: number, reason: "superseded"|"revoked" }} options - Cierre.
 * @returns {Promise<object[]>} Autorizaciones cerradas.
 */
export async function endActiveAudienceGrants(client, { audience, endedBy, fileId, reason }) {
  const result = await client.query(
    `update public.project_file_audience_grants
     set ended_at = greatest(clock_timestamp(), granted_at), ended_by = $3, end_reason = $4::public.project_file_grant_end_reason
     where file_id = $1 and audience = $2::public.project_file_audience and ended_at is null
     returning id, audience::text as audience, file_version_id, granted_by, granted_at, ended_by, ended_at, end_reason::text as end_reason`,
    [fileId, audience, endedBy, reason],
  );
  return result.rows.map(toGrant);
}

/**
 * Crea la autorización activa de una audiencia para una versión. Las claves compuestas de
 * PostgreSQL exigen que la versión sea del archivo y el archivo del proyecto; el índice único
 * impide dos autorizaciones activas del cliente para el mismo archivo.
 *
 * @param {{ query: Function }} client - Cliente de la transacción.
 * @param {{ projectId: number, fileId: number, versionId: number, audience: string, grantedBy: number }} options - Autorización.
 * @returns {Promise<object>} Autorización creada.
 */
export async function insertAudienceGrant(client, { audience, fileId, grantedBy, projectId, versionId }) {
  const result = await client.query(
    `insert into public.project_file_audience_grants (project_id, file_id, file_version_id, audience, granted_by, granted_at)
     values ($1, $2, $3, $4::public.project_file_audience, $5, clock_timestamp())
     returning id, audience::text as audience, file_version_id, granted_by, granted_at, ended_by, ended_at, end_reason::text as end_reason`,
    [projectId, fileId, versionId, audience, grantedBy],
  );
  return toGrant(result.rows[0]);
}

/**
 * Lista todas las autorizaciones de un archivo, activas e históricas, de la más reciente a la más
 * antigua, con el número de versión y los nombres de quienes las concedieron y cerraron.
 *
 * @param {number} fileId - Archivo.
 * @param {{ query: Function }} [executor] - Pool o cliente.
 * @returns {Promise<object[]>} Autorizaciones.
 */
export async function listAudienceGrants(fileId, executor = poolExecutor) {
  const result = await executor.query(
    `select grant_row.id, grant_row.audience::text as audience, grant_row.file_version_id, version.version_number,
       grant_row.granted_by, grant_row.granted_at, grant_row.ended_by, grant_row.ended_at, grant_row.end_reason::text as end_reason,
       nullif(concat_ws(' ', granter.first_name, granter.last_name), '') as granted_by_name,
       nullif(concat_ws(' ', ender.first_name, ender.last_name), '') as ended_by_name
     from public.project_file_audience_grants grant_row
     inner join public.file_versions version on version.id = grant_row.file_version_id
     left join public.users granter on granter.id = grant_row.granted_by
     left join public.users ender on ender.id = grant_row.ended_by
     where grant_row.file_id = $1
     order by grant_row.granted_at desc, grant_row.id desc`,
    [fileId],
  );
  return result.rows.map(toGrant);
}
