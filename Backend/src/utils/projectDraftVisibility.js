import { PROJECT_STATUS } from "../domain/projectStatus.js";

/*
 * Visibilidad de los proyectos draft. Un draft (también archivado desde draft) es un proyecto
 * preliminar creado desde una cotización y solo lo ve administración: clientes y arquitectos no lo
 * reciben en listados, detalle, archivos, comentarios, eventos ni observaciones de entorno, y sus
 * rutas responden 404 como un recurso inaccesible. Todas las condiciones de acceso no
 * administrativas deben componer este fragmento.
 */

/**
 * Devuelve la condición SQL que excluye los drafts para un alias de public.projects. No usa
 * parámetros: los códigos son constantes del dominio, nunca entradas del usuario.
 *
 * @param {string} projectAlias - Alias de la tabla de proyectos en la consulta.
 * @returns {string} Condición SQL verdadera para los proyectos que no son draft.
 */
export function nonDraftProjectCondition(projectAlias) {
  return `(${projectAlias}.status <> '${PROJECT_STATUS.DRAFT}'::public.project_status
    and ${projectAlias}.archived_from_status is distinct from '${PROJECT_STATUS.DRAFT}'::public.project_status)`;
}
