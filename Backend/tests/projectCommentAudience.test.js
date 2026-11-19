import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMENT_AUDIENCE_SCOPE,
  canReceiveCommentAudience,
  classifyCommentAudience,
} from "../src/domain/projectCommentAudience.js";
import {
  buildCommentVersionAccessSql,
  buildCommentVisibilitySql,
  commentTargetFileIdSql,
} from "../src/utils/projectCommentAudienceSql.js";
import { publishProjectEvent, publishProjectEventToRecipients, subscribeToProjectEvents } from "../src/services/projectEvents.js";

// Fase 1.2 (B6): audiencia de comentarios y eventos SSE por destinatario, sin PostgreSQL.

// El repositorio solo se importa por su función pura; nunca consulta esta base ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
const { parseCommentTargetFileId } = await import("../src/repositories/projectCommentAudienceRepository.js");

const admin = { id: 1, role: { code: "admin" } };
const architect = { id: 2, role: { code: "architect" } };
const owner = { id: 3, role: { code: "client" } };
const coOwner = { id: 4, role: { code: "client" } };

test("clasificación: general, heredado, versión concreta y comentario 1.2 sin versión inequívoca", () => {
  assert.equal(classifyCommentAudience({ authorId: 3, file: null, fileVersionId: null }).scope, COMMENT_AUDIENCE_SCOPE.PROJECT);
  assert.equal(classifyCommentAudience({ authorId: 3, file: { accessPolicy: null }, fileVersionId: 9 }).scope, COMMENT_AUDIENCE_SCOPE.PROJECT,
    "heredado: conserva su significado histórico");
  assert.equal(classifyCommentAudience({ authorId: 3, file: { accessPolicy: 1 }, fileVersionId: null }).scope, COMMENT_AUDIENCE_SCOPE.AMBIGUOUS);
  assert.deepEqual(classifyCommentAudience({ authorId: 2, clientVersionId: 5, file: { accessPolicy: 1 }, fileVersionId: 9, versionUploadedBy: 2 }), {
    authorId: 2, clientVersionId: 5, fileVersionId: 9, scope: COMMENT_AUDIENCE_SCOPE.VERSION, versionUploadedBy: 2,
  });
});

test("destinatarios: el equipo recibe todo; el cliente, solo la versión compartida, la suya o su comentario ambiguo", () => {
  const project = classifyCommentAudience({ authorId: 2, file: null, fileVersionId: null });
  const internal = classifyCommentAudience({ authorId: 2, clientVersionId: 5, file: { accessPolicy: 1 }, fileVersionId: 9, versionUploadedBy: 2 });
  const shared = classifyCommentAudience({ authorId: 2, clientVersionId: 9, file: { accessPolicy: 1 }, fileVersionId: 9, versionUploadedBy: 2 });
  const ownUpload = classifyCommentAudience({ authorId: 2, clientVersionId: null, file: { accessPolicy: 1 }, fileVersionId: 9, versionUploadedBy: 3 });
  const ambiguous = classifyCommentAudience({ authorId: 3, file: { accessPolicy: 1 }, fileVersionId: null });
  for (const staff of [admin, architect]) {
    for (const audience of [project, internal, shared, ownUpload, ambiguous]) assert.equal(canReceiveCommentAudience(audience, staff), true);
  }
  assert.deepEqual([project, internal, shared, ownUpload, ambiguous].map((audience) => canReceiveCommentAudience(audience, owner)), [true, false, true, true, true]);
  // Otro usuario del mismo cliente: no subió la versión ni es autor (pendiente de B9).
  assert.deepEqual([internal, ownUpload, ambiguous].map((audience) => canReceiveCommentAudience(audience, coOwner)), [false, false, false]);
  assert.equal(canReceiveCommentAudience({ scope: "desconocido" }, owner), false, "falla cerrado");
});

test("destino de galería: solo imagen, video y panorámica con id numérico identifican un archivo", () => {
  assert.equal(parseCommentTargetFileId("image", "42"), 42);
  assert.equal(parseCommentTargetFileId("panorama", "project-file-7"), 7);
  assert.equal(parseCommentTargetFileId("image", "render-portada"), null);
  assert.equal(parseCommentTargetFileId("general", "42"), null);
  assert.match(commentTargetFileIdSql("pc"), /'\^\(project-file-\)\?\[0-9\]\{1,18\}\$'/, "el SQL usa el mismo patrón");
});

test("activación apagada: sin uniones, condiciones ni parámetros (SQL anterior)", () => {
  assert.deepEqual(buildCommentVisibilitySql({ enabled: false, firstParam: 4, user: owner }), { condition: "true", join: "", params: [] });
  assert.deepEqual(buildCommentVersionAccessSql({ enabled: false, firstParam: 4, user: owner }), { condition: "true", params: [] });
  const on = buildCommentVisibilitySql({ enabled: true, firstParam: 4, user: owner });
  assert.deepEqual(on.params, ["client", 3]);
  assert.match(on.condition, /comment_file\.access_policy is null/);
  assert.match(on.condition, /audience = 'client_owner' and audience_grant\.ended_at is null/);
});

/**
 * Respuesta SSE simulada que registra escrituras y cierre.
 *
 * @returns {object} Respuesta con `chunks` y estado `writableEnded`.
 */
function fakeStream() {
  return {
    chunks: [],
    destroyed: false,
    end() { this.writableEnded = true; },
    on() {},
    writableEnded: false,
    write(chunk) { this.chunks.push(chunk); },
  };
}

test("publicación por destinatario: cada stream recibe lo que puede ver; quien perdió el acceso se cierra", async (context) => {
  const streams = { admin: fakeStream(), owner: fakeStream(), removed: fakeStream(), legacy: fakeStream() };
  const subscribe = (response, recipient, userId) => subscribeToProjectEvents({
    projectId: 515151, resolveRecipient: async () => recipient, response, userId,
  });
  const unsubscribers = [
    subscribe(streams.admin, admin, 1),
    subscribe(streams.owner, owner, 3),
    subscribe(streams.removed, null, 2),
    // Sin resolución de destinatario no se puede filtrar: no recibe eventos por destinatario.
    subscribeToProjectEvents({ projectId: 515151, response: streams.legacy, userId: 9 }),
  ];
  context.after(() => unsubscribers.forEach((unsubscribe) => unsubscribe()));
  const internal = classifyCommentAudience({ authorId: 2, clientVersionId: null, file: { accessPolicy: 1 }, fileVersionId: 9, versionUploadedBy: 2 });
  const result = await publishProjectEventToRecipients({
    eventName: "project.comment.created",
    projectId: 515151,
    selectPayload: (recipient) => (canReceiveCommentAudience(internal, recipient) ? { comment: { content: "interno" } } : null),
  });
  assert.equal(result.delivered, 1);
  assert.match(streams.admin.chunks.join(""), /interno/);
  assert.doesNotMatch(streams.owner.chunks.join(""), /interno/);
  assert.equal(streams.removed.writableEnded, true, "cambio de asignación: se cierra al publicar");
  assert.doesNotMatch(streams.legacy.chunks.join(""), /interno/);
  // La difusión anterior (activación apagada) sigue llegando a todos los streams abiertos.
  publishProjectEvent({ eventName: "project.comment.created", payload: { comment: { content: "general" } }, projectId: 515151 });
  assert.match(streams.legacy.chunks.join(""), /general/);
});

test("publicación por destinatario: un fallo con un destinatario no bloquea a los demás y se propaga", async (context) => {
  const healthy = fakeStream();
  const failing = fakeStream();
  const unsubscribers = [
    subscribeToProjectEvents({ projectId: 525252, resolveRecipient: async () => admin, response: healthy, userId: 1 }),
    subscribeToProjectEvents({ projectId: 525252, resolveRecipient: async () => { throw new Error("db down"); }, response: failing, userId: 2 }),
  ];
  context.after(() => unsubscribers.forEach((unsubscribe) => unsubscribe()));
  await assert.rejects(
    publishProjectEventToRecipients({ eventName: "project.access.changed", projectId: 525252, selectPayload: () => ({ projectId: 525252 }) }),
    /db down/,
  );
  assert.match(healthy.chunks.join(""), /project\.access\.changed/);
  assert.doesNotMatch(failing.chunks.join(""), /project\.access\.changed/, "falla cerrado");
});
