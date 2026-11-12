import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { decodeCursor, encodeCursor, pageResult, parsePageLimit, preciseCursorTimestampSql } from "../src/utils/pagination.js";

test("el cursor por fecha conserva microsegundos en UTC", () => {
  assert.equal(
    preciseCursorTimestampSql("u.created_at"),
    `to_char(u.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  );
  // Regresión de la página 2 vacía en Gestión de usuarios: el cursor de usuarios y notas no debe
  // volver a construirse desde un Date (milisegundos). Integración: adminUserPagination.integration.test.js.
  const repository = readFileSync(new URL("../src/repositories/adminUserRepository.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/adminUserService.js", import.meta.url), "utf8");
  assert.equal(repository.match(/preciseCursorTimestampSql\("(?:u\.)?created_at"\)\} as cursor_created_at/g)?.length, 2);
  assert.equal(service.match(/pageResult\([^)]*toCreatedAtCursor\)/g)?.length, 2);
});

test("pagination limits are bounded", () => {
  assert.equal(parsePageLimit(undefined), 25);
  assert.equal(parsePageLimit("0"), 25);
  assert.equal(parsePageLimit("200"), 100);
  assert.equal(parsePageLimit("50"), 50);
});

test("cursor is opaque and rejects malformed values", () => {
  const cursor = encodeCursor(["2026-07-13T00:00:00.000Z", "42"]);
  assert.deepEqual(decodeCursor(cursor), ["2026-07-13T00:00:00.000Z", "42"]);
  assert.equal(decodeCursor("not-a-cursor"), null);
});

test("pageResult returns one extra row as next cursor", () => {
  const result = pageResult([{ id: 3 }, { id: 2 }, { id: 1 }], 2, (row) => row.id, (row) => [row.id, row.id]);
  assert.deepEqual(result.items, [3, 2]);
  assert.deepEqual(decodeCursor(result.nextCursor), [2, 2]);
});
