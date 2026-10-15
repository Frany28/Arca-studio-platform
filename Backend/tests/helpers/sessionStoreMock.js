import crypto from "node:crypto";

/**
 * Simula en memoria la tabla `user_sessions` (B-3) para pruebas que sustituyen `pool.query`.
 * Reconoce las sentencias de `sessionRepository` y el filtro de sesión de `findActiveSessionUser`;
 * la semántica SQL real se comprueba en `userSessions.integration.test.js` contra PostgreSQL.
 *
 * @returns {object} Almacén con `handle`, `filterSessionUserRows`, `create` y el mapa `sessions`.
 */
export function createSessionStoreMock() {
  const sessions = new Map();

  /**
   * Registra una sesión activa como lo haría `createSession`.
   *
   * @param {number|string} userId - Usuario propietario.
   * @returns {{ id: string, expires_at: Date }} Fila insertada.
   */
  function create(userId) {
    const row = { expires_at: new Date(Date.now() + 3_600_000), id: crypto.randomUUID(), revoked_reason: null, user_id: String(userId) };
    sessions.set(row.id, row);
    return row;
  }

  /**
   * Atiende las sentencias de escritura sobre `user_sessions`; devuelve null para cualquier otra.
   *
   * @param {string} sql - Sentencia recibida.
   * @param {Array<unknown>} params - Parámetros posicionales.
   * @returns {{ rows: Array<object>, rowCount: number }|null} Resultado simulado.
   */
  function handle(sql, params = []) {
    if (sql.includes("insert into public.user_sessions")) {
      const row = create(params[0]);
      return { rowCount: 1, rows: [{ expires_at: row.expires_at, id: row.id }] };
    }
    if (sql.includes("update public.user_sessions") && sql.includes("where id = $1")) {
      const row = sessions.get(params[0]);
      if (!row || row.revoked_reason) return { rowCount: 0, rows: [] };
      row.revoked_reason = params[1];
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("update public.user_sessions") && sql.includes("where user_id = $1")) {
      let rowCount = 0;
      for (const row of sessions.values()) {
        if (row.user_id === String(params[0]) && !row.revoked_reason && row.id !== params[2]) {
          row.revoked_reason = params[1];
          rowCount += 1;
        }
      }
      return { rowCount, rows: [] };
    }
    if (sql.includes("delete from public.user_sessions")) return { rowCount: 0, rows: [] };
    return null;
  }

  /**
   * Aplica el filtro de sesión vigente de `findActiveSessionUser` a las filas de usuario simuladas.
   *
   * @param {string} sql - Consulta de usuario recibida.
   * @param {Array<unknown>} params - `[userId, sessionId]` cuando la consulta exige sesión.
   * @param {Array<object>} rows - Filas que devolvería la consulta sin el filtro de sesión.
   * @returns {Array<object>} Filas visibles para esa sesión.
   */
  function filterSessionUserRows(sql, params, rows) {
    if (!sql.includes("public.user_sessions s")) return rows;
    const session = sessions.get(params[1]);
    const valid = session && !session.revoked_reason && session.user_id === String(params[0]);
    return valid ? rows.filter((row) => String(row.id) === String(params[0])) : [];
  }

  return { create, filterSessionUserRows, handle, sessions };
}

/**
 * Sustituye `pool.connect` por un cliente que delega en `pool.query` (ya simulado) para que los
 * repositorios transaccionales funcionen en pruebas unitarias; begin/commit/rollback no hacen nada.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @param {import("pg").Pool} pool - Pool compartido de la aplicación.
 * @returns {void} Finalización de la operación.
 */
export function mockPoolTransactions(context, pool) {
  context.mock.method(pool, "connect", async () => ({
    query: (sql, params) => (/^\s*(begin|commit|rollback)\s*$/i.test(sql)
      ? Promise.resolve({ rowCount: 0, rows: [] })
      : pool.query(sql, params)),
    release() {},
  }));
}
