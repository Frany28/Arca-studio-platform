import { query } from "../config/db.js";

/**
 * Registra una operación en `audit_logs` con su responsable, la entidad afectada y los valores
 * nuevos y anteriores en JSONB. Solo escribe PostgreSQL; quien llama decide la acción y el
 * texto, que deben caber en las columnas VARCHAR de la tabla.
 *
 * @param {object} entry - Registro de auditoría.
 * @param {number} entry.userId - Usuario responsable.
 * @param {string} entry.action - Acción (`dominio.operacion`, máximo 100 caracteres).
 * @param {string} entry.entityType - Tipo de entidad (máximo 100 caracteres).
 * @param {number} entry.entityId - Identificador de la entidad.
 * @param {string} entry.description - Descripción legible (máximo 255 caracteres).
 * @param {object|null} [entry.newValues] - Valores resultantes.
 * @param {object|null} [entry.oldValues] - Valores anteriores.
 * @param {string|null} [entry.userAgent] - Origen de la operación (máximo 255 caracteres).
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto el pool.
 * @returns {Promise<number>} Id del registro creado.
 */
export async function insertAuditLog({ action, description, entityId, entityType, newValues = null, oldValues = null, userAgent = null, userId }, executor = { query }) {
  const result = await executor.query(
    `insert into public.audit_logs (user_id, action, entity_type, entity_id, description, new_values, old_values, user_agent)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
     returning id`,
    [
      userId,
      action,
      entityType,
      entityId,
      description,
      newValues === null ? null : JSON.stringify(newValues),
      oldValues === null ? null : JSON.stringify(oldValues),
      userAgent,
    ],
  );
  return Number(result.rows[0].id);
}
