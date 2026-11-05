import { query } from "../config/db.js";

/**
 * Guarda el hash de un código nuevo en una solicitud propia y editable, reiniciando sus intentos.
 * La condición de reenvío se evalúa en la misma sentencia para que dos emisiones simultáneas no
 * pasen juntas el plazo mínimo entre envíos. Consulta PostgreSQL con parámetros.
 *
 * @param {object} options - Datos de la emisión.
 * @param {number|string} options.projectRequestId - Solicitud que se va a enviar.
 * @param {{ id: number, clientId: number }} options.user - Cliente autenticado propietario.
 * @param {string} options.codeHash - HMAC del código emitido.
 * @param {Date} options.expiresAt - Vencimiento del código.
 * @param {number} options.resendCooldownSeconds - Segundos mínimos entre emisiones.
 * @returns {Promise<{ id: number, sentAt: Date }|null>} Emisión registrada o null si no procede.
 */
export async function storeProjectRequestVerificationCode({
  codeHash,
  expiresAt,
  projectRequestId,
  resendCooldownSeconds,
  user,
}) {
  const result = await query(
    `
      update public.project_requests
      set
        verification_code_hash = $4,
        verification_expires_at = $5,
        verification_attempts = 0,
        verification_sent_at = now()
      where id = $1
        and client_id = $2
        and requested_by = $3
        and deleted_at is null
        and status in ('draft', 'changes_requested')
        and (
          verification_sent_at is null
          or verification_sent_at <= now() - make_interval(secs => $6)
        )
      returning id, verification_sent_at
    `,
    [projectRequestId, user.clientId, user.id, codeHash, expiresAt, resendCooldownSeconds],
  );
  const row = result.rows[0];
  return row ? { id: Number(row.id), sentAt: row.verification_sent_at } : null;
}

/**
 * Lee el momento del último envío de código de una solicitud propia, para calcular cuándo
 * se podrá solicitar otro. Consulta PostgreSQL con parámetros.
 *
 * @param {number|string} projectRequestId - Solicitud consultada.
 * @param {{ id: number, clientId: number }} user - Cliente autenticado propietario.
 * @returns {Promise<Date|null>} Fecha del último envío o null.
 */
export async function findProjectRequestVerificationSentAt(projectRequestId, user) {
  const result = await query(
    `
      select verification_sent_at
      from public.project_requests
      where id = $1 and client_id = $2 and requested_by = $3 and deleted_at is null
      limit 1
    `,
    [projectRequestId, user.clientId, user.id],
  );
  return result.rows[0]?.verification_sent_at || null;
}

/**
 * Anula un código cuyo correo no se pudo entregar, solo si sigue siendo el mismo, para que el
 * cliente pueda pedir otro de inmediato. Consulta PostgreSQL con parámetros.
 *
 * @param {number|string} projectRequestId - Solicitud del código.
 * @param {string} codeHash - Hash del código no entregado.
 * @returns {Promise<void>} Finaliza tras la actualización condicional.
 */
export async function discardProjectRequestVerificationCode(projectRequestId, codeHash) {
  await query(
    `
      update public.project_requests
      set verification_code_hash = null, verification_expires_at = null, verification_sent_at = null
      where id = $1 and verification_code_hash = $2
    `,
    [projectRequestId, codeHash],
  );
}

/**
 * Bloquea la fila de la solicitud dentro de la transacción del envío y devuelve el estado del
 * código vigente. El bloqueo serializa verificaciones simultáneas del mismo código.
 *
 * @param {{ query: Function }} executor - Cliente de la transacción.
 * @param {number|string} projectRequestId - Solicitud enviada.
 * @param {{ id: number, clientId: number }} user - Cliente autenticado propietario.
 * @returns {Promise<{ attempts: number, codeHash: string|null, expiresAt: Date|null, status: string }|null>}
 *   Estado del código o null si la solicitud no es accesible.
 */
export async function lockProjectRequestVerification(executor, projectRequestId, user) {
  const result = await executor.query(
    `
      select status, verification_code_hash, verification_expires_at, verification_attempts
      from public.project_requests
      where id = $1 and client_id = $2 and requested_by = $3 and deleted_at is null
      for update
    `,
    [projectRequestId, user.clientId, user.id],
  );
  const row = result.rows[0];
  return row
    ? {
      attempts: Number(row.verification_attempts || 0),
      codeHash: row.verification_code_hash || null,
      expiresAt: row.verification_expires_at || null,
      status: row.status,
    }
    : null;
}

/**
 * Registra un intento fallido del código vigente dentro de la transacción del envío.
 *
 * @param {{ query: Function }} executor - Cliente de la transacción.
 * @param {number|string} projectRequestId - Solicitud enviada.
 * @returns {Promise<number>} Intentos fallidos acumulados.
 */
export async function recordProjectRequestVerificationFailure(executor, projectRequestId) {
  const result = await executor.query(
    `
      update public.project_requests
      set verification_attempts = verification_attempts + 1
      where id = $1
      returning verification_attempts
    `,
    [projectRequestId],
  );
  return Number(result.rows[0]?.verification_attempts || 0);
}

/**
 * Consume el código verificado (uso único): elimina su hash y registra la verificación, dentro
 * de la misma transacción que cambia el estado de la solicitud.
 *
 * @param {{ query: Function }} executor - Cliente de la transacción.
 * @param {number|string} projectRequestId - Solicitud enviada.
 * @returns {Promise<void>} Finaliza tras la actualización.
 */
export async function consumeProjectRequestVerificationCode(executor, projectRequestId) {
  await executor.query(
    `
      update public.project_requests
      set
        verification_code_hash = null,
        verification_expires_at = null,
        verification_attempts = 0,
        verified_at = now()
      where id = $1
    `,
    [projectRequestId],
  );
}
