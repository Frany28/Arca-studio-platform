/**
 * Transforma el valor de administrativo usuario a la representación estable utilizada por la aplicación.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
export function mapAdminUser(row = {}) {
  return {
    id: Number(row.id),
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    role: {
      code: row.role_code,
      name: row.role_name,
    },
    status: row.status,
    hasProfilePhoto: Boolean(row.has_profile_photo ?? row.hasProfilePhoto),
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
  };
}

/**
 * Transforma el detalle de un usuario administrado a la representación estable utilizada por la aplicación.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
export function mapAdminUserDetails(row = {}) {
  return {
    ...mapAdminUser(row),
    companyName: row.company_name || null,
    phone: row.phone || null,
    secondaryPhone: row.secondary_phone || null,
    notes: (Array.isArray(row.notes) ? row.notes : []).map(mapAdminUserNote),
    notesTotal: Number(row.notes_total || 0),
    projects: (Array.isArray(row.projects) ? row.projects : []).map((project) => ({
      id: Number(project.id),
      name: project.name,
    })),
  };
}

/**
 * Transforma una nota de usuario administrado a la representación estable utilizada por la aplicación.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
export function mapAdminUserNote(row = {}) {
  return {
    id: Number(row.id),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Transforma el valor de administrativo usuario métricas a la representación estable utilizada por la aplicación.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} [row] - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
export function mapAdminUserMetrics(row = {}) {
  return {
    total: Number(row.total || 0),
    active: Number(row.active || 0),
    suspended: Number(row.suspended || 0),
    disabled: Number(row.disabled || 0),
    pending: Number(row.pending || 0),
  };
}
