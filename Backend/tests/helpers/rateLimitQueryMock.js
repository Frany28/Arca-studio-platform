// Emulación compartida del contador de rate limiting (B-2) para pruebas que sustituyen pool.query.
// Reproduce la semántica del repositorio (incremento por clave, ventana fija con reinicio) en memoria,
// de modo que los middlewares limitados funcionen sin PostgreSQL y las pruebas sigan centradas en su
// propio comportamiento.

/**
 * Crea un contador en memoria con la semántica de rate_limit_buckets.
 *
 * @returns {{ handle: (sql: string, params: Array<unknown>) => object|null, rows: Map<string, object> }} Manejador y estado.
 */
export function createRateLimitQueryMock() {
  const rows = new Map();
  return {
    /**
     * Responde a las consultas de rate_limit_buckets y devuelve null para cualquier otra consulta.
     *
     * @param {string} sql - Consulta recibida por pool.query.
     * @param {Array<unknown>} params - Parámetros de la consulta.
     * @returns {{ rows: Array<object>, rowCount: number }|null} Resultado emulado, o null si no es del contador.
     */
    handle(sql, params = []) {
      if (!String(sql).includes("public.rate_limit_buckets")) return null;
      if (String(sql).includes("delete from")) return { rowCount: 0, rows: [] };
      const result = [];
      for (let index = 0; index < params.length; index += 3) {
        const keyHash = params[index];
        const windowMs = Number(params[index + 2]);
        const key = Buffer.from(keyHash).toString("hex");
        const now = Date.now();
        const current = rows.get(key);
        const next = !current || current.expiresAt <= now ? { count: 1, expiresAt: now + windowMs } : { ...current, count: current.count + 1 };
        rows.set(key, next);
        result.push({ count: next.count, key_hash: keyHash, retry_after_ms: next.expiresAt - now });
      }
      return { rowCount: result.length, rows: result };
    },
    rows,
  };
}
