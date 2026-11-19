import assert from "node:assert/strict";
import test from "node:test";

import { buildVisibleFileVersionSql } from "../src/utils/projectFileAudienceSql.js";
import {
  getProjectFileCacheHeaders,
  getProjectFileRevalidationHeaders,
  matchesIfNoneMatch,
} from "../src/utils/projectFileCache.js";

test("revisión activada: caché revalidable con ETag por versión servida y representación", () => {
  assert.deepEqual(getProjectFileRevalidationHeaders({ anonymized: false, fileId: 4, versionId: 9 }), {
    cacheControl: "private, no-cache",
    etag: "\"project-file-4-version-9-direct\"",
  });
  assert.equal(getProjectFileRevalidationHeaders({ anonymized: true, fileId: 4, versionId: 9 }).etag, "\"project-file-4-version-9-showcase\"");
});

test("If-None-Match admite listas, comodín y etiquetas débiles, y no coincide con otra versión", () => {
  const etag = "\"project-file-4-version-9-direct\"";
  assert.equal(matchesIfNoneMatch(etag, etag), true);
  assert.equal(matchesIfNoneMatch(`"otra", W/${etag}`, etag), true);
  assert.equal(matchesIfNoneMatch("*", etag), true);
  assert.equal(matchesIfNoneMatch("\"project-file-4-version-8-direct\"", etag), false);
  assert.equal(matchesIfNoneMatch("\"project-file-4-version-9-showcase\"", etag), false);
  assert.equal(matchesIfNoneMatch(undefined, etag), false);
});

test("política SQL de audiencias: apagada es la unión anterior sin parámetros; encendida, parametrizada", () => {
  const off = buildVisibleFileVersionSql({ enabled: false, firstParam: 3, user: { id: 1 } });
  assert.deepEqual([off.params, off.visibleCondition, off.fileTypeSql], [[], "true", "file.file_type"]);
  assert.match(off.join, /version\.version_number = file\.current_version/);
  assert.doesNotMatch(off.join, /access_policy|audience/);
  const on = buildVisibleFileVersionSql({ enabled: true, firstParam: 3, user: { clientId: 7, id: 5, role: { code: "client" } } });
  assert.deepEqual(on.params, ["client", 5, 7]);
  assert.match(on.join, /\$3 = 'admin'/);
  assert.match(on.join, /\$5::bigint/);
  assert.match(on.join, /audience = 'client_owner' and audience_grant\.ended_at is null/);
  assert.equal(on.visibleCondition, "(file.access_policy is null or version.id is not null)");
});

test("current version project media uses a private immutable cache", () => {
  assert.deepEqual(
    getProjectFileCacheHeaders({
      currentVersionId: 9,
      fileId: 4,
      requestedVersionId: 9,
    }),
    {
      cacheControl: "private, max-age=31536000, immutable",
      etag: '"project-file-4-version-9"',
    },
  );
});

test("unversioned or stale project media keeps the short fallback cache", () => {
  assert.equal(
    getProjectFileCacheHeaders({
      currentVersionId: 9,
      fileId: 4,
      requestedVersionId: null,
    }).cacheControl,
    "private, max-age=300",
  );
  assert.equal(
    getProjectFileCacheHeaders({
      currentVersionId: 9,
      fileId: 4,
      requestedVersionId: 8,
    }).cacheControl,
    "private, max-age=300",
  );
});
