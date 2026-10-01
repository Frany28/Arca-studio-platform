import assert from "node:assert/strict";
import test from "node:test";
import { mergeCommentsById, upsertCommentById } from "../src/utils/commentCollection.js";
import { getEnvironmentCommentId, normalizeProjectIds, toDrawerComment } from "../src/utils/commentMappers.js";

test("refresh merging preserves conversation namespaces, latest versions and chronology", () => {
  const first = { id: 1, content: "Anterior", createdAt: "2026-01-01" };
  const updated = { ...first, content: "Actualizado" };
  const environment = { id: "environment:1", createdAt: "2026-01-02" };
  const current = [environment, first];
  assert.deepEqual(mergeCommentsById(current, [updated]), [updated, environment]);
  assert.deepEqual(current, [environment, first]);
  assert.deepEqual(upsertCommentById(current, updated), [environment, updated]);
  assert.equal(upsertCommentById(current, null), current);
});

test("observation identifiers keep project scope separate from environment replies", () => {
  assert.deepEqual(normalizeProjectIds([12, "12", 0, -1, "invalid", 14, 1.5]), [12, 14]);
  assert.equal(getEnvironmentCommentId("environment:12"), 12);
  assert.equal(getEnvironmentCommentId(12), 12);
  assert.equal(getEnvironmentCommentId("environment:invalid"), null);
  const comment = toDrawerComment({
    id: 12, scope: "environment", parentCommentId: 11, commentType: "video", content: "Revisar",
    fileId: 3, fileVersionId: 9, targetId: 3, selection: { type: "video-time", time: 15 },
    createdAt: "2026-01-01T00:00:00Z", author: { id: 1, name: "Cliente" },
  }, { id: 1 });
  assert.equal(comment.id, "environment:12");
  assert.equal(comment.parentCommentId, "environment:11");
  assert.equal(comment.fileId, 3);
  assert.equal(comment.fileVersionId, 9);
  assert.deepEqual(comment.selection, { type: "video-time", time: 15 });
  assert.equal(comment.message, "Revisar");
});
