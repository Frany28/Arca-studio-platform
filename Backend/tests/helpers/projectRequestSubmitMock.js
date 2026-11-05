export const VALID_VERIFICATION_CODE = "482913";

/**
 * Simula la transacción del envío de solicitudes con un código de validación vigente.
 * `pool.connect` entrega un cliente que resuelve BEGIN/COMMIT/ROLLBACK, el bloqueo del código
 * y su consumo, y delega el resto de sentencias en `pool.query` (que cada prueba simula), para
 * que las pruebas de puntuación sigan comprobando la evaluación persistida.
 *
 * Carga el servicio de verificación de forma diferida: las pruebas fijan DATABASE_URL antes
 * de importar el pool.
 *
 * @param {import("node:test").TestContext} context - Prueba propietaria de los mocks.
 * @param {import("pg").Pool} pool - Pool compartido que la prueba ya simula.
 * @param {object} options - Solicitud y usuario del código.
 * @param {number} options.projectRequestId - Solicitud enviada.
 * @param {number} options.userId - Usuario autenticado.
 * @param {string} [options.status="draft"] - Estado leído con la fila bloqueada.
 * @returns {Promise<Array<string>>} Sentencias ejecutadas en la transacción, en orden.
 */
export async function mockVerifiedSubmitTransaction(context, pool, { projectRequestId, status = "draft", userId }) {
  const { hashVerificationCode } = await import("../../src/services/projectRequestVerificationService.js");
  const statements = [];
  const codeHash = hashVerificationCode({ code: VALID_VERIFICATION_CODE, projectRequestId, userId });
  context.mock.method(pool, "connect", async () => ({
    async query(sql, values) {
      const text = String(sql).trim();
      statements.push(text);
      if (/^(begin|commit|rollback)$/i.test(text)) return { rows: [] };
      if (/verification_code_hash, verification_expires_at, verification_attempts/.test(text)) {
        return {
          rows: [{
            status,
            verification_attempts: 0,
            verification_code_hash: codeHash,
            verification_expires_at: new Date(Date.now() + 60_000),
          }],
        };
      }
      if (/verified_at = now\(\)/.test(text)) return { rows: [] };
      return pool.query(sql, values);
    },
    release() {},
  }));
  return statements;
}
