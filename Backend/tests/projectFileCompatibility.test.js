import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPATIBILITY_REASONS,
  EXPECTED_GAINS,
  buildCompatibilityActors,
  hasPointCollision,
  mapHistoricalComments,
  planLegacyFileConversion,
} from "../src/domain/projectFileCompatibility.js";

// Fase 1.2 (B9): planificación de la compatibilidad de archivos heredados, sin PostgreSQL.

const project = (overrides = {}) => ({ archivedFromStatus: null, assignedArchitectId: 20, assigneeIds: [], clientId: 7, isPublic: false, status: "in_process", ...overrides });
const actors = buildCompatibilityActors({ clientId: 7, clientUserIds: [30, 31], staffIds: [20] });
const version = (id, number, overrides = {}) => ({ contentType: null, createdAt: `2026-01-0${number}T00:00:00.000Z`, deletedAt: null, id, reviewStatus: null, uploadedBy: 20, versionNumber: number, ...overrides });
const file = (overrides = {}) => ({ currentVersion: 1, fileType: "application/pdf", id: 1, status: "active", ...overrides });

test("un heredado vigente se convierte con la autorización del cliente para todos sus usuarios", () => {
  const plan = planLegacyFileConversion({ actors, comments: [], file: file(), project: project(), versions: [version(11, 1)] });
  assert.equal(plan.decision, "convert");
  assert.deepEqual(plan.actions.grants, { clientVersionId: 11, showcaseVersionId: null });
  for (const user of [30, 31]) assert.equal(plan.beforeAccess[`in_process|client:${user}|11`], "direct", "ambos usuarios del cliente ya lo veían");
  assert.equal(plan.differences.accessLosses.length, 0);
});

test("escaparate: autorizado solo si hoy se ve; público sin finalizar queda en revisión por pérdida", () => {
  const image = file({ fileType: "image/png" });
  const finished = planLegacyFileConversion({ actors, comments: [], file: image, project: project({ isPublic: true, status: "finished" }), versions: [version(11, 1)] });
  assert.deepEqual(finished.actions.grants, { clientVersionId: 11, showcaseVersionId: 11 });
  assert.equal(finished.beforeAccess["finished|outsider:client|11"], "anonymized");
  const unfinished = planLegacyFileConversion({ actors, comments: [], file: image, project: project({ isPublic: true }), versions: [version(11, 1)] });
  assert.deepEqual([unfinished.decision, unfinished.reasons], ["review", [COMPATIBILITY_REASONS.ACCESS_LOSS]]);
});

test("draft: se compara también tras finalizar la configuración", () => {
  const plan = planLegacyFileConversion({ actors, comments: [], file: file(), project: project({ status: "draft" }), versions: [version(11, 1, { uploadedBy: 30 })] });
  assert.equal(plan.decision, "convert");
  assert.equal(plan.beforeAccess["draft|client:30|11"], undefined, "en draft el cliente no lo ve");
  assert.equal(plan.beforeAccess["pending|client:31|11"], "direct", "tras finalizar, también el otro usuario");
});

test("ganancias esperadas: el equipo ve el historial y el autor sus versiones; no bloquean", () => {
  const plan = planLegacyFileConversion({ actors, comments: [], file: file({ currentVersion: 2 }), project: project(), versions: [version(11, 1, { uploadedBy: 30 }), version(12, 2)] });
  assert.equal(plan.decision, "convert");
  const categories = new Set(plan.differences.gains.map((gain) => gain.category));
  assert.deepEqual([...categories].sort(), [EXPECTED_GAINS.AUTHOR_OWN_VERSION, EXPECTED_GAINS.TEAM_VERSION_HISTORY].sort());
});

test("comentarios históricos: versión única o vigente al crearse; si no, revisión explícita", () => {
  const versions = [version(11, 1), version(12, 2)];
  const comment = (id, createdAt, overrides = {}) => ({ commentType: "image", createdAt, deletedAt: null, fileVersionId: null, id, parentCommentId: null, targetId: "1", userId: 20, ...overrides });
  assert.deepEqual(mapHistoricalComments({ comments: [comment(1, "2026-01-05T00:00:00.000Z"), comment(2, "2026-01-06T00:00:00.000Z", { parentCommentId: 1, userId: 30 })], currentVersionId: 12, versions }),
    { reasons: [], updates: [{ commentId: 1, fileVersionId: 12 }, { commentId: 2, fileVersionId: 12 }] });
  assert.deepEqual(mapHistoricalComments({ comments: [comment(3, "2026-01-01T12:00:00.000Z")], currentVersionId: 12, versions }).reasons, [COMPATIBILITY_REASONS.COMMENT_ON_PREVIOUS_VERSION]);
  assert.deepEqual(mapHistoricalComments({ comments: [comment(4, "2025-12-01T00:00:00.000Z")], currentVersionId: 12, versions }).reasons, [COMPATIBILITY_REASONS.COMMENT_BEFORE_FIRST_VERSION]);
  assert.deepEqual(mapHistoricalComments({ comments: [comment(5, "2025-12-01T00:00:00.000Z")], currentVersionId: 11, versions: [version(11, 1)] }).updates, [{ commentId: 5, fileVersionId: 11 }], "versión única");
  assert.deepEqual(mapHistoricalComments({ comments: [comment(6, "2026-01-05T00:00:00.000Z", { commentType: "document", fileVersionId: 11 })], currentVersionId: 12, versions }).reasons,
    [COMPATIBILITY_REASONS.DOCUMENT_COMMENT_ON_PREVIOUS_VERSION]);
  // Tras asignar la vigente, el comentario del equipo sigue llegando a los dos usuarios del cliente.
  const plan = planLegacyFileConversion({ actors, comments: [comment(1, "2026-01-05T00:00:00.000Z")], file: file({ currentVersion: 2 }), project: project(), versions });
  assert.equal(plan.decision, "convert");
  assert.deepEqual(Object.keys(plan.beforeComments).sort(), ["1|admin", "1|client:30", "1|client:31", "1|staff:20"]);
});

test("motivos de revisión: sin vigente, archivados (DA1), autorizaciones previas y choque de puntos", () => {
  const reasonsOf = (input) => planLegacyFileConversion({ actors, comments: [], file: file(), project: project(), versions: [version(11, 1)], ...input }).reasons;
  assert.deepEqual(reasonsOf({ file: file({ currentVersion: null }) }), [COMPATIBILITY_REASONS.NO_CURRENT_VERSION]);
  assert.deepEqual(reasonsOf({ file: file({ status: "archived" }) }), [COMPATIBILITY_REASONS.FILE_ARCHIVED_DA1]);
  assert.deepEqual(reasonsOf({ project: project({ status: "archived" }) }), [COMPATIBILITY_REASONS.PROJECT_ARCHIVED_DA1]);
  assert.deepEqual(reasonsOf({ existingGrantCount: 1 }), [COMPATIBILITY_REASONS.EXISTING_AUDIENCE_GRANTS]);
  assert.deepEqual(reasonsOf({ versions: [version(11, 1), version(12, 2)] }), [COMPATIBILITY_REASONS.CURRENT_VERSION_MISMATCH], "la vigente heredada no es la de mayor número");
  const root = (id, fileVersionId) => ({ commentType: "panorama", deletedAt: null, fileVersionId, id, parentCommentId: null, pointNumber: 1, targetId: "1" });
  assert.equal(hasPointCollision({ comments: [root(1, null), root(2, 11)], updates: [{ commentId: 1, fileVersionId: 11 }] }), true);
  assert.equal(hasPointCollision({ comments: [root(1, null)], updates: [{ commentId: 1, fileVersionId: 11 }] }), false);
});
