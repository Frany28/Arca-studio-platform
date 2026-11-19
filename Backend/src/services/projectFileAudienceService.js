import { withTransaction } from "../config/db.js";
import { FILE_ACCESS_POLICY, FILE_STATUS, evaluateFileAudienceChange } from "../domain/projectFileAccess.js";
import { ConflictError, NotFoundError } from "../errors/appError.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import {
  endActiveAudienceGrants,
  insertAudienceGrant,
  listAudienceGrants,
} from "../repositories/projectFileAudienceRepository.js";
import { findProjectFileContext, listFileVersions } from "../repositories/projectFileVersionRepository.js";
import { assertMutableProjectState } from "./projectMutationPolicy.js";

// Audiencias de archivos de proyecto (Fase 1.2, B5). Solo con la activación coordinada encendida.
// Reglas confirmadas: solo el administrador comparte con el cliente y autoriza el escaparate (D3);
// cliente y escaparate son independientes (AU1); compartir exige una versión aprobada del mismo
// archivo (AU2); el cliente consulta la autorización activa y las sustituidas quedan como historial
// (D4); aprobar no comparte (DA3). Autorizar otra versión sustituye la activa de esa audiencia
// (D4 en el cliente; propuesta PR6 en el escaparate, ver SUPERSEDE_RULE). Nada se borra: retirar el
// acceso cierra la autorización.

const AUDIENCES = Object.freeze({ client: "client_owner", showcase: "showcase" });

// Regla que justifica cerrar como `superseded` la autorización activa al conceder otra versión:
// D4 (confirmada) en el cliente; en el escaparate, la propuesta PR6, todavía sin aprobar. Es el único
// punto que la aplica: PostgreSQL no la impone (solo hay índice único activo para el cliente) y las
// lecturas ya admiten varias versiones activas en el escaparate. Se registra en la auditoría.
const SUPERSEDE_RULE = Object.freeze({ client_owner: "D4", showcase: "PR6" });

/**
 * Traduce el segmento de la ruta a la audiencia almacenada.
 * Solo admite `client` y `showcase`; la validación de la ruta ya lo garantiza.
 *
 * @param {"client"|"showcase"} audience - Audiencia de la ruta.
 * @returns {"client_owner"|"showcase"} Audiencia en PostgreSQL.
 */
function toStoredAudience(audience) {
  return AUDIENCES[audience];
}

/**
 * Bloquea el archivo y comprueba que admite cambios de audiencia: archivo activo con la política 1.2
 * y proyecto que no esté archivado (un draft o un proyecto finalizado sí admiten compartir).
 *
 * @param {{ query: Function }} client - Cliente de la transacción.
 * @param {{ fileId: number, projectId: number, user: object }} options - Archivo, proyecto y usuario.
 * @returns {Promise<{ file: object, project: object }>} Contexto bloqueado.
 * @throws {NotFoundError|ConflictError} Si el archivo no existe o no admite audiencias.
 */
async function lockFileForAudience(client, { fileId, projectId, user }) {
  const context = await findProjectFileContext({ fileId, lock: true, projectId, userId: Number(user.id) }, client);
  if (!context || context.file.deletedAt || context.file.status === FILE_STATUS.DELETED) {
    throw new NotFoundError("FILE_NOT_FOUND", "No se encontro el archivo en este proyecto.");
  }
  assertMutableProjectState(context.project);
  if (context.file.accessPolicy !== FILE_ACCESS_POLICY.PHASE_1_2) {
    throw new ConflictError(
      "FILE_AUDIENCE_UNAVAILABLE",
      "Este archivo usa todavía la regla de acceso anterior; sus audiencias se gestionan al completar su compatibilidad.",
    );
  }
  return context;
}

/**
 * Traduce el rechazo del dominio a su error público.
 * Un motivo desconocido responde 404 para no revelar el estado del archivo.
 *
 * @param {{ reason: string, outcome: string }} result - Resultado del dominio.
 * @returns {Error} Error de aplicación.
 */
function toAudienceError(result) {
  switch (result.reason) {
    case "VERSION_NOT_APPROVED":
      return new ConflictError("FILE_VERSION_NOT_APPROVED", "Solo se puede compartir una versión aprobada.");
    case "SHOWCASE_REQUIRES_PUBLIC_FINISHED_PROJECT":
      return new ConflictError("SHOWCASE_REQUIRES_PUBLIC_FINISHED_PROJECT", "El escaparate solo admite proyectos finalizados y públicos.");
    case "SHOWCASE_MEDIA_ONLY":
      return new ConflictError("SHOWCASE_MEDIA_ONLY", "El escaparate solo admite imágenes y videos.");
    case "ARCHIVED_FILE_AUDIENCE_UNDECIDED":
      return new ConflictError("FILE_AUDIENCE_UNAVAILABLE", "El archivo no admite cambios de audiencia.");
    default:
      return new NotFoundError("FILE_NOT_FOUND", "No se encontro el archivo en este proyecto.");
  }
}

/**
 * Representa el estado de audiencias de un archivo: la autorización activa de cada audiencia y el
 * historial completo, de la más reciente a la más antigua.
 *
 * @param {object[]} grants - Autorizaciones del archivo.
 * @returns {{ client: object|null, showcase: object|null, history: object[] }} Estado.
 */
function toAudienceState(grants) {
  return { client: findActiveGrant(grants, "client_owner"), history: grants, showcase: findActiveGrant(grants, "showcase") };
}

/**
 * Busca la autorización activa (sin cierre) de una audiencia entre las de un archivo.
 * Con la fila del archivo bloqueada al escribir, hay como máximo una por audiencia.
 *
 * @param {object[]} grants - Autorizaciones del archivo.
 * @param {"client_owner"|"showcase"} audience - Audiencia.
 * @returns {object|null} Autorización activa o null.
 */
function findActiveGrant(grants, audience) {
  return grants.find((grant) => grant.audience === audience && !grant.endedAt) ?? null;
}

/**
 * Autoriza una versión aprobada para una audiencia (cliente propietario o escaparate). Si ya estaba
 * autorizada no cambia nada; si había otra activa, la cierra como sustituida y crea la nueva, todo en
 * una transacción con el archivo bloqueado y auditada.
 *
 * @param {{ projectId: number, fileId: number, audience: "client"|"showcase", versionId: number, user: object }} request - Autorización.
 * @returns {Promise<{ changed: boolean, client: object|null, showcase: object|null, history: object[] }>} Estado resultante.
 * @throws {NotFoundError|ConflictError} Si la versión o el archivo no lo admiten.
 */
export async function grantProjectFileAudience({ audience, fileId, projectId, user, versionId }) {
  const storedAudience = toStoredAudience(audience);
  return withTransaction(async (client) => {
    const context = await lockFileForAudience(client, { fileId, projectId, user });
    const version = (await listFileVersions(fileId, client)).find((candidate) => candidate.id === Number(versionId));
    if (!version || version.deletedAt) throw new NotFoundError("FILE_VERSION_NOT_FOUND", "No se encontró la versión.");
    const decision = evaluateFileAudienceChange({
      action: storedAudience === "client_owner" ? "share_with_client" : "set_showcase",
      actor: { clientId: user.clientId ?? null, id: Number(user.id), role: user.role?.code },
      file: context.file,
      project: context.project,
      version,
    });
    if (decision.outcome !== "allowed") throw toAudienceError(decision);

    const before = toAudienceState(await listAudienceGrants(fileId, client));
    const current = storedAudience === "client_owner" ? before.client : before.showcase;
    if (current?.versionId === version.id) return { ...before, changed: false };

    const superseded = await endActiveAudienceGrants(client, { audience: storedAudience, endedBy: Number(user.id), fileId, reason: "superseded" });
    const granted = await insertAudienceGrant(client, { audience: storedAudience, fileId, grantedBy: Number(user.id), projectId, versionId: version.id });
    await insertAuditLog({
      action: "project_file.audience_granted",
      description: storedAudience === "client_owner" ? "Versión compartida con el cliente propietario." : "Versión autorizada en el escaparate.",
      entityId: granted.id,
      entityType: "project_file_audience_grant",
      newValues: { audience: storedAudience, fileId, projectId, versionId: version.id, versionNumber: version.versionNumber },
      oldValues: superseded.length
        ? { rule: SUPERSEDE_RULE[storedAudience], supersededGrantIds: superseded.map((grant) => grant.id), versionId: superseded[0].versionId }
        : null,
      userId: Number(user.id),
    }, client);
    return { ...toAudienceState(await listAudienceGrants(fileId, client)), changed: true };
  });
}

/**
 * Retira el acceso de una audiencia cerrando su autorización activa como revocada. La fila queda
 * como historial y la siguiente revalidación de la descarga ya no se autoriza.
 *
 * @param {{ projectId: number, fileId: number, audience: "client"|"showcase", user: object }} request - Revocación.
 * @returns {Promise<{ client: object|null, showcase: object|null, history: object[] }>} Estado resultante.
 * @throws {NotFoundError} FILE_AUDIENCE_NOT_FOUND si la audiencia no tenía autorización activa.
 */
export async function revokeProjectFileAudience({ audience, fileId, projectId, user }) {
  const storedAudience = toStoredAudience(audience);
  return withTransaction(async (client) => {
    await lockFileForAudience(client, { fileId, projectId, user });
    const revoked = await endActiveAudienceGrants(client, { audience: storedAudience, endedBy: Number(user.id), fileId, reason: "revoked" });
    if (!revoked.length) throw new NotFoundError("FILE_AUDIENCE_NOT_FOUND", "La audiencia no tiene ninguna versión autorizada.");
    await insertAuditLog({
      action: "project_file.audience_revoked",
      description: storedAudience === "client_owner" ? "Acceso del cliente propietario retirado." : "Versión retirada del escaparate.",
      entityId: revoked[0].id,
      entityType: "project_file_audience_grant",
      newValues: { audience: storedAudience, fileId, projectId, revokedGrantIds: revoked.map((grant) => grant.id) },
      oldValues: { versionId: revoked[0].versionId },
      userId: Number(user.id),
    }, client);
    return toAudienceState(await listAudienceGrants(fileId, client));
  });
}

/**
 * Devuelve el estado de audiencias de un archivo para el administrador: autorizaciones activas e
 * historial completo.
 *
 * @param {{ projectId: number, fileId: number, user: object }} request - Archivo y administrador.
 * @returns {Promise<{ client: object|null, showcase: object|null, history: object[] }>} Estado.
 * @throws {NotFoundError} Si el archivo no existe en el proyecto.
 */
export async function getProjectFileAudiences({ fileId, projectId, user }) {
  const context = await findProjectFileContext({ fileId, projectId, userId: Number(user.id) });
  if (!context || context.file.deletedAt || context.file.status === FILE_STATUS.DELETED) {
    throw new NotFoundError("FILE_NOT_FOUND", "No se encontro el archivo en este proyecto.");
  }
  return toAudienceState(await listAudienceGrants(fileId));
}
