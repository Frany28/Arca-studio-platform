import { PROJECT_STATUS } from "../domain/projectStatus.js";

/*
 * Escritura de proyectos draft creados desde una cotización. Solo PostgreSQL y siempre con el
 * cliente de la transacción de la cotización: si cualquier paso posterior falla, el proyecto se
 * revierte con ella. Las lecturas de proyectos siguen en projectRepository.
 */

/**
 * Reserva el id del próximo proyecto desde la secuencia de `projects.id`, para componer su
 * identificador público antes de insertar. La reserva no se revierte si la transacción falla.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @returns {Promise<number>} Id reservado.
 */
export async function reserveProjectId(client) {
  const result = await client.query("select nextval(pg_get_serial_sequence('public.projects', 'id')) as id");
  return Number(result.rows[0].id);
}

/**
 * Inserta un proyecto draft con los datos mínimos: nombre, cliente, autor, progreso 0, sin
 * visibilidad pública y fechas de registro del sistema. Tipo, ubicación, fecha de inicio y planos
 * quedan NULL («todavía desconocidos»), como permite chk_projects_draft_requirements solo en draft.
 * La unicidad del nombre por cliente (uq_projects_client_active_name) es la última barrera ante
 * altas simultáneas.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} project - Datos del proyecto.
 * @param {number} project.id - Id reservado.
 * @param {number} project.clientId - Cliente propietario.
 * @param {string} project.name - Nombre normalizado.
 * @param {string} project.publicSlug - Identificador público generado.
 * @param {number} project.userId - Administrador que lo crea.
 * @returns {Promise<{ id: number, name: string }>} Proyecto creado.
 */
export async function insertDraftProject(client, { clientId, id, name, publicSlug, userId }) {
  const result = await client.query(
    `insert into public.projects (id, client_id, created_by, name, status, progress, is_public, has_plans, public_slug)
     values ($1, $2, $3, $4, $5::public.project_status, 0, false, null, $6)
     returning id, name`,
    [id, clientId, userId, name, PROJECT_STATUS.DRAFT, publicSlug],
  );
  const row = result.rows[0];
  return { id: Number(row.id), name: row.name };
}
