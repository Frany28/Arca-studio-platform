/**
 * Transforma el valor de number a la representación pública esperada.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Transforma el valor de administrativo panel activity a la representación estable utilizada por la aplicación.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
export function mapAdminDashboardActivity(row = {}) {
  return {
    createdAt: row.created_at || null,
    id: row.activity_id == null ? null : `${row.activity_kind}-${row.activity_id}`,
    projectId: toNumber(row.project_id),
    projectName: row.project_name || "Proyecto",
    title: row.activity_title || "Actividad registrada",
    userName: row.user_name || "Usuario",
    userRoleCode: row.user_role_code || null,
  };
}

/**
 * Transforma el valor de administrativo panel solicitud a la representación estable utilizada por la aplicación.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
export function mapAdminDashboardRequest(row = {}) {
  return {
    assignees: Array.isArray(row.assignees)
      ? row.assignees.map((assignee) => ({
          hasProfilePhoto: Boolean(assignee.hasProfilePhoto),
          id: toNumber(assignee.id),
          name: assignee.name || "Empleado",
          roleCode: assignee.roleCode || null,
          roleName: assignee.roleName || "Empleado",
        }))
      : [],
    createdAt: row.created_at || null,
    id: toNumber(row.id),
    projectName: row.project_name || "Solicitud de proyecto",
    projectType: row.project_type || null,
    requestedBy: toNumber(row.requested_by),
    status: row.status || null,
  };
}
