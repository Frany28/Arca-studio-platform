import { createHash } from "node:crypto";

import {
  COMPATIBILITY_REASONS,
  buildCompatibilityActors,
  compareAccessMatrices,
  evaluateAccessMatrix,
  evaluateCommentMatrix,
  planLegacyFileConversion,
} from "../domain/projectFileCompatibility.js";
import {
  assignCommentVersions,
  hasConversionMarker,
  insertCompatibilityGrant,
  insertConversionAudit,
  isActiveAdmin,
  loadFileStates,
  lockFileForCompatibility,
  setPhaseOnePolicy,
} from "../repositories/projectFileCompatibilityRepository.js";

// Herramienta de compatibilidad de archivos heredados (Fase 1.2, B9). Tres pasos:
// 1. plan (solo lectura, instantánea REPEATABLE READ READ ONLY): clasifica cada archivo heredado en
//    `convert` o `review` con su motivo, guarda la huella de su estado y la visión anterior de cada
//    actor, versión y comentario;
// 2. aplicación explícita: exige el plan y su SHA-256; convierte cada archivo en su propia transacción
//    con el proyecto (FOR SHARE) y el archivo (FOR UPDATE) bloqueados, rechaza los que cambiaron desde
//    el plan, vuelve a verificar la equivalencia antes de confirmar y deja una marca de auditoría con la
//    huella del plan (idempotencia: repetir o reanudar no aplica dos veces);
// 3. verificación (solo lectura): comprueba cada conversión contra la visión anterior guardada.
// No usa el pool de la API ni lee .env: recibe el cliente del comando. Los archivos en revisión no
// cambian y siguen con su política actual.

export const PLAN_KIND = "arca-project-file-compatibility-plan";
export const PLAN_FORMAT = 1;

/**
 * Serializa un valor con las claves ordenadas, para que la misma información produzca la misma huella.
 *
 * @param {unknown} value - Valor.
 * @returns {string} JSON canónico.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Calcula el SHA-256 hexadecimal de un texto o de bytes.
 *
 * @param {string|Buffer} content - Contenido.
 * @returns {string} Huella.
 */
export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Agrupa filas por el valor numérico de una columna, conservando su orden.
 * Lo usa la conversión de filas leídas en estados por archivo.
 *
 * @param {object[]} rows - Filas.
 * @param {string} key - Columna.
 * @returns {Map<number, object[]>} Valor → filas.
 */
function groupBy(rows, key) {
  const grouped = new Map();
  for (const row of rows) grouped.set(Number(row[key]), [...(grouped.get(Number(row[key])) || []), row]);
  return grouped;
}

/**
 * Convierte las filas leídas en el estado del dominio de cada archivo, con sus actores y huellas.
 * La huella cubre todo lo que decide la conversión: archivo, proyecto, equipo, usuarios del cliente,
 * versiones (con su clave de almacenamiento), comentarios, autorizaciones y vínculos de garantías.
 *
 * @param {object} raw - Resultado de loadFileStates.
 * @returns {Map<number, object>} Archivo → estado.
 */
export function toFileStates(raw) {
  const versionsByFile = groupBy(raw.versions, "file_id");
  const commentsByFile = groupBy(raw.comments, "resolved_file_id");
  const grantsByFile = groupBy(raw.grants, "file_id");
  const linksByFile = groupBy(raw.links, "file_id");
  const assigneesByProject = groupBy(raw.assignees, "project_id");
  const usersByClient = groupBy(raw.clientUsers, "client_id");
  const states = new Map();
  for (const row of raw.files) {
    const fileId = Number(row.id);
    const project = {
      archivedFromStatus: row.archived_from_status ?? null,
      assignedArchitectId: row.assigned_architect_id === null ? null : Number(row.assigned_architect_id),
      assigneeIds: (assigneesByProject.get(Number(row.project_id)) || []).map((assignee) => Number(assignee.user_id)),
      clientId: Number(row.client_id),
      isPublic: row.is_public === true,
      status: row.project_status,
    };
    const file = {
      accessPolicy: row.access_policy === null ? null : Number(row.access_policy),
      currentVersion: row.current_version === null ? null : Number(row.current_version),
      fileType: row.file_type,
      folderId: row.folder_id === null ? null : Number(row.folder_id),
      id: fileId,
      originProjectRequestId: row.origin_project_request_id === null ? null : Number(row.origin_project_request_id),
      originReviewedAt: row.origin_reviewed_at ?? null,
      projectId: Number(row.project_id),
      status: row.status,
    };
    const versionRows = versionsByFile.get(fileId) || [];
    const versions = versionRows.map((version) => ({
      contentType: version.content_type ?? null,
      createdAt: version.created_at,
      deletedAt: version.deleted ? true : null,
      id: Number(version.id),
      reviewStatus: version.review_status ?? null,
      uploadedBy: Number(version.uploaded_by),
      versionNumber: Number(version.version_number),
    }));
    const comments = (commentsByFile.get(fileId) || []).map((comment) => ({
      commentType: comment.comment_type,
      createdAt: comment.created_at,
      deletedAt: comment.deleted ? true : null,
      fileId: comment.file_id === null ? null : Number(comment.file_id),
      fileVersionId: comment.file_version_id === null ? null : Number(comment.file_version_id),
      id: Number(comment.id),
      parentCommentId: comment.parent_comment_id === null ? null : Number(comment.parent_comment_id),
      pointNumber: comment.point_number,
      targetId: comment.target_id,
      userId: Number(comment.user_id),
    }));
    const grants = (grantsByFile.get(fileId) || []).map((grant) => ({ audience: grant.audience, ended: grant.ended, fileVersionId: Number(grant.file_version_id), id: Number(grant.id) }));
    const links = (linksByFile.get(fileId) || []).map((link) => ({ id: Number(link.id), unlinked: link.unlinked, warrantyId: Number(link.warranty_id) }));
    const clientUserIds = (usersByClient.get(project.clientId) || []).map((user) => Number(user.id));
    const staffIds = [project.assignedArchitectId, ...project.assigneeIds].filter((id) => id !== null);
    const storedVersions = versionRows.map((version) => ({
      deleted: version.deleted, fileName: version.file_name, fileSize: String(version.file_size), id: Number(version.id),
      restoredFrom: version.restored_from_version_id === null ? null : Number(version.restored_from_version_id),
      reviewStatus: version.review_status ?? null, versionNumber: Number(version.version_number),
    }));
    states.set(fileId, {
      actors: buildCompatibilityActors({ clientId: project.clientId, clientUserIds, staffIds }),
      comments,
      file,
      fingerprint: sha256(canonicalJson({ clientUserIds, comments, file, grants, links, project, versions: storedVersions })),
      grants,
      links,
      linksHash: sha256(canonicalJson(links)),
      project,
      versions,
      versionsHash: sha256(canonicalJson(storedVersions)),
    });
  }
  return states;
}

/**
 * Planifica un archivo y lo resume para el plan: acciones y visión anterior si se convierte; motivos
 * y recuentos de diferencias si queda en revisión.
 *
 * @param {object} state - Estado del archivo (toFileStates).
 * @returns {object} Entrada del plan.
 */
function toPlanEntry(state) {
  const result = planLegacyFileConversion({
    actors: state.actors,
    comments: state.comments,
    existingGrantCount: state.grants.length,
    file: state.file,
    project: state.project,
    versions: state.versions,
  });
  const base = {
    decision: result.decision,
    fileId: state.file.id,
    fingerprint: state.fingerprint,
    projectId: state.file.projectId,
  };
  const differences = {
    accessLosses: result.differences?.accessLosses.length ?? 0,
    commentLosses: result.differences?.commentLosses.length ?? 0,
    gains: (result.differences?.gains ?? []).reduce((counts, gain) => ({ ...counts, [gain.category]: (counts[gain.category] || 0) + 1 }), {}),
  };
  if (result.decision !== "convert") return { ...base, differences, reasons: result.reasons };
  return {
    ...base,
    actions: result.actions,
    beforeAccess: result.beforeAccess,
    beforeComments: result.beforeComments,
    differences,
    folderId: state.file.folderId,
    linksHash: state.linksHash,
    originProjectRequestId: state.file.originProjectRequestId,
    originReviewedAt: state.file.originReviewedAt,
    versionsHash: state.versionsHash,
  };
}

/**
 * Resume las entradas del plan: archivos, convertibles, en revisión por motivo y diferencias.
 * Son los recuentos que muestran el comando y el informe.
 *
 * @param {object[]} entries - Entradas.
 * @returns {object} Recuentos.
 */
function summarizePlan(entries) {
  const reasons = {};
  const gains = {};
  for (const entry of entries) {
    for (const reason of entry.reasons || []) reasons[reason] = (reasons[reason] || 0) + 1;
    for (const [category, count] of Object.entries(entry.differences?.gains || {})) gains[category] = (gains[category] || 0) + count;
  }
  return {
    convert: entries.filter((entry) => entry.decision === "convert").length,
    expectedGains: gains,
    legacyFiles: entries.length,
    review: entries.filter((entry) => entry.decision === "review").length,
    reviewReasons: reasons,
  };
}

/**
 * Prepara el plan en una instantánea de solo lectura. No escribe nada.
 *
 * @param {{ query: Function }} client - Cliente de la herramienta.
 * @param {{ target: string, now?: Date }} options - Destino confirmado y fecha.
 * @returns {Promise<object>} Plan.
 */
export async function buildCompatibilityPlan(client, { now = new Date(), target }) {
  await client.query("begin isolation level repeatable read read only");
  try {
    const states = toFileStates(await loadFileStates(client));
    const entries = [...states.values()].map(toPlanEntry);
    return { entries, format: PLAN_FORMAT, generatedAt: now.toISOString(), kind: PLAN_KIND, summary: summarizePlan(entries), target };
  } finally {
    await client.query("rollback");
  }
}

/**
 * Lee un plan guardado y comprueba su huella y su formato antes de usarlo.
 *
 * @param {string} text - Contenido del archivo del plan.
 * @param {string} expectedSha256 - Huella indicada por el operador.
 * @returns {object} Plan.
 * @throws {Error} Si la huella no coincide o el formato no es el esperado.
 */
export function readPlan(text, expectedSha256) {
  if (sha256(text) !== String(expectedSha256 || "").toLowerCase()) throw Object.assign(new Error("La huella del plan no coincide."), { code: "PLAN_SHA256_MISMATCH" });
  const plan = JSON.parse(text);
  if (plan.kind !== PLAN_KIND || plan.format !== PLAN_FORMAT || !Array.isArray(plan.entries)) {
    throw Object.assign(new Error("El archivo no es un plan de compatibilidad válido."), { code: "PLAN_FORMAT_INVALID" });
  }
  return plan;
}

/**
 * Comprueba un archivo ya convertido contra su entrada del plan: política, autorizaciones,
 * comentarios asignados, integridad (versiones, objetos, vínculos, carpeta y procedencia) y la
 * misma visión para cada actor, versión y comentario que antes, salvo las ganancias esperadas.
 *
 * @param {object} state - Estado actual del archivo.
 * @param {object} entry - Entrada `convert` del plan.
 * @returns {{ problems: string[] }} Problemas encontrados (vacío si es equivalente).
 */
export function verifyConvertedState(state, entry) {
  const problems = [];
  const clientGrants = state.grants.filter((grant) => grant.audience === "client_owner" && !grant.ended);
  const showcaseGrants = state.grants.filter((grant) => grant.audience === "showcase" && !grant.ended);
  if (state.file.accessPolicy !== 1) problems.push("ACCESS_POLICY_NOT_CONVERTED");
  if (clientGrants.length !== 1 || clientGrants[0].fileVersionId !== entry.actions.grants.clientVersionId) problems.push("CLIENT_GRANT_MISMATCH");
  const expectedShowcase = entry.actions.grants.showcaseVersionId;
  if (expectedShowcase ? showcaseGrants.length !== 1 || showcaseGrants[0].fileVersionId !== expectedShowcase : showcaseGrants.length !== 0) problems.push("SHOWCASE_GRANT_MISMATCH");
  const commentsById = new Map(state.comments.map((comment) => [comment.id, comment]));
  if (entry.actions.commentUpdates.some((update) => commentsById.get(update.commentId)?.fileVersionId !== update.fileVersionId)) problems.push("COMMENT_VERSION_MISMATCH");
  if (state.versionsHash !== entry.versionsHash) problems.push("VERSIONS_CHANGED");
  if (state.linksHash !== entry.linksHash) problems.push("WARRANTY_LINKS_CHANGED");
  if (state.file.folderId !== entry.folderId) problems.push("FOLDER_CHANGED");
  if (state.file.originProjectRequestId !== entry.originProjectRequestId || state.file.originReviewedAt !== entry.originReviewedAt) problems.push("ORIGIN_CHANGED");
  const grants = { clientVersionId: clientGrants[0]?.fileVersionId ?? null, showcaseVersionId: showcaseGrants[0]?.fileVersionId ?? null };
  const after = evaluateAccessMatrix({ actors: state.actors, file: state.file, grants, mode: "converted", project: state.project, versions: state.versions });
  const access = compareAccessMatrices({ actors: state.actors, after, before: entry.beforeAccess, versions: state.versions });
  if (access.losses.length) problems.push(COMPATIBILITY_REASONS.ACCESS_LOSS);
  if (access.gains.some((gain) => gain.category === COMPATIBILITY_REASONS.ACCESS_GAIN_UNEXPECTED)) problems.push(COMPATIBILITY_REASONS.ACCESS_GAIN_UNEXPECTED);
  const afterComments = evaluateCommentMatrix({ actors: state.actors, clientVersionId: grants.clientVersionId, comments: state.comments, mode: "converted", versions: state.versions });
  if (Object.keys(entry.beforeComments).some((key) => !afterComments[key])) problems.push(COMPATIBILITY_REASONS.COMMENT_ACCESS_LOSS);
  return { problems };
}

/**
 * Lee el estado de un archivo dentro de la transacción en curso.
 * Usa la misma carga y las mismas huellas que el plan.
 *
 * @param {{ query: Function }} client - Cliente.
 * @param {number} fileId - Archivo.
 * @returns {Promise<object|null>} Estado o null si ya no existe.
 */
async function loadState(client, fileId) {
  return toFileStates(await loadFileStates(client, { fileIds: [fileId] })).get(fileId) ?? null;
}

/**
 * Bloquea el archivo y decide si la entrada se puede aplicar ahora. Devuelve el motivo para omitirla
 * (`missing`, `already_applied`, `not_legacy`, `stale` o `review_now`) o null si procede convertir.
 *
 * @param {{ query: Function }} client - Cliente en transacción.
 * @param {{ entry: object, planSha256: string }} input - Entrada y huella del plan.
 * @returns {Promise<string|null>} Motivo para omitirla o null.
 */
async function checkEntryBeforeApply(client, { entry, planSha256 }) {
  if (!(await lockFileForCompatibility(client, { fileId: entry.fileId, projectId: entry.projectId }))) return "missing";
  if (await hasConversionMarker(client, { fileId: entry.fileId, planSha256 })) return "already_applied";
  const state = await loadState(client, entry.fileId);
  if (!state) return "missing";
  if (state.file.accessPolicy !== null) return "not_legacy";
  if (state.fingerprint !== entry.fingerprint) return "stale";
  return toPlanEntry(state).decision === "convert" ? null : "review_now";
}

/**
 * Convierte un archivo del plan en su propia transacción. Resultados: `converted`, `already_applied`
 * (marca de este plan), `not_legacy` (ya no es heredado), `stale` (cambió desde el plan), `review_now`
 * (hoy ya no es convertible), `missing` o `error` (con rollback completo).
 *
 * @param {{ query: Function }} client - Cliente de la herramienta.
 * @param {{ entry: object, planSha256: string, operatorUserId: number }} input - Entrada y firma.
 * @returns {Promise<{ fileId: number, outcome: string, code?: string }>} Resultado.
 */
async function applyEntry(client, { entry, operatorUserId, planSha256 }) {
  const fileId = entry.fileId;
  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '60s'");
    const skipped = await checkEntryBeforeApply(client, { entry, planSha256 });
    if (skipped) {
      await client.query("rollback");
      return { fileId, outcome: skipped };
    }

    await setPhaseOnePolicy(client, fileId);
    const { clientVersionId, showcaseVersionId } = entry.actions.grants;
    await insertCompatibilityGrant(client, { audience: "client_owner", fileId, grantedBy: operatorUserId, projectId: entry.projectId, versionId: clientVersionId });
    if (showcaseVersionId) await insertCompatibilityGrant(client, { audience: "showcase", fileId, grantedBy: operatorUserId, projectId: entry.projectId, versionId: showcaseVersionId });
    const assigned = await assignCommentVersions(client, { fileId, updates: entry.actions.commentUpdates });
    if (assigned !== entry.actions.commentUpdates.length) throw Object.assign(new Error("Comentarios distintos de los planificados."), { code: "COMMENT_UPDATE_MISMATCH" });

    const { problems } = verifyConvertedState(await loadState(client, fileId), entry);
    if (problems.length) throw Object.assign(new Error(`Verificación fallida: ${problems.join(", ")}`), { code: "POST_VERIFY_FAILED" });
    await insertConversionAudit(client, {
      fileId,
      newValues: { accessPolicy: 1, commentUpdates: assigned, grants: entry.actions.grants, planSha256 },
      userId: operatorUserId,
    });
    await client.query("commit");
    return { fileId, outcome: "converted" };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return { code: error?.code || error?.name || "UNKNOWN", fileId, outcome: "error" };
  }
}

/**
 * Aplica un plan verificado: solo las entradas `convert`, cada una en su transacción. Exige que el
 * plan sea del mismo destino y que el operador sea un administrador activo. Con `maxFiles` procesa
 * solo las primeras (ejecución por tandas o simulación de una interrupción).
 *
 * @param {{ query: Function }} client - Cliente de la herramienta.
 * @param {{ plan: object, planSha256: string, operatorUserId: number, target: string, maxFiles?: number }} input - Plan y firma.
 * @returns {Promise<{ results: object[], summary: Record<string, number> }>} Resultados.
 * @throws {Error} Si el destino o el operador no son válidos.
 */
export async function applyCompatibilityPlan(client, { maxFiles = Number.POSITIVE_INFINITY, operatorUserId, plan, planSha256, target }) {
  if (plan.target !== target) throw Object.assign(new Error("El plan se preparó para otro destino."), { code: "PLAN_TARGET_MISMATCH" });
  if (!(await isActiveAdmin(client, operatorUserId))) throw Object.assign(new Error("El operador debe ser un administrador activo."), { code: "OPERATOR_NOT_ADMIN" });
  const results = [];
  for (const entry of plan.entries.filter((candidate) => candidate.decision === "convert")) {
    if (results.length >= maxFiles) break;
    results.push(await applyEntry(client, { entry, operatorUserId, planSha256 }));
  }
  const summary = results.reduce((counts, result) => ({ ...counts, [result.outcome]: (counts[result.outcome] || 0) + 1 }), {});
  return { results, summary };
}

/**
 * Verifica, en solo lectura, cada entrada del plan: las convertidas por este plan contra su visión
 * anterior e integridad; las pendientes, que sigan heredadas; las de revisión, que no se tocaran.
 *
 * @param {{ query: Function }} client - Cliente de la herramienta.
 * @param {{ plan: object, planSha256: string }} input - Plan y huella.
 * @returns {Promise<{ results: object[], summary: Record<string, number> }>} Resultados.
 */
export async function verifyCompatibilityPlan(client, { plan, planSha256 }) {
  await client.query("begin isolation level repeatable read read only");
  try {
    const results = [];
    for (const entry of plan.entries) {
      const state = await loadState(client, entry.fileId);
      if (!state) {
        results.push({ fileId: entry.fileId, outcome: "missing" });
        continue;
      }
      if (entry.decision === "review") {
        results.push({ fileId: entry.fileId, outcome: state.file.accessPolicy === null ? "review_unchanged" : "review_changed" });
        continue;
      }
      if (!(await hasConversionMarker(client, { fileId: entry.fileId, planSha256 }))) {
        results.push({ fileId: entry.fileId, outcome: state.file.accessPolicy === null ? "not_applied" : "converted_elsewhere" });
        continue;
      }
      const { problems } = verifyConvertedState(state, entry);
      results.push(problems.length ? { fileId: entry.fileId, outcome: "verification_failed", problems } : { fileId: entry.fileId, outcome: "verified" });
    }
    const summary = results.reduce((counts, result) => ({ ...counts, [result.outcome]: (counts[result.outcome] || 0) + 1 }), {});
    return { results, summary };
  } finally {
    await client.query("rollback");
  }
}

/**
 * Construye el informe redactado de una ejecución: modo, destino, huella del plan, recuentos y la
 * lista revisable (ids y motivos). No contiene nombres, correos, títulos ni claves de almacenamiento.
 *
 * @param {{ mode: string, plan: object, planSha256?: string|null, run?: object|null, runId: string, startedAt: string }} input - Datos.
 * @returns {object} Informe.
 */
export function buildCompatibilityReport({ mode, plan, planSha256 = null, run = null, runId, startedAt }) {
  return {
    mode,
    plan: { generatedAt: plan.generatedAt, sha256: planSha256, summary: plan.summary, target: plan.target },
    results: run ? { failures: run.results.filter((result) => !["converted", "already_applied", "verified", "review_unchanged"].includes(result.outcome)), summary: run.summary } : null,
    reviewList: plan.entries.filter((entry) => entry.decision === "review").map((entry) => ({
      accessLosses: entry.differences.accessLosses, commentLosses: entry.differences.commentLosses, fileId: entry.fileId, projectId: entry.projectId, reasons: entry.reasons,
    })),
    runId,
    startedAt,
  };
}
