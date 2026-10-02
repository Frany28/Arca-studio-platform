/* Centraliza la comunicación HTTP del frontend con la API y adapta respuestas para la interfaz. */
import { adminApi } from "./adminApi.js";
import { authApi } from "./authApi.js";
import { environmentCommentsApi } from "./environmentCommentsApi.js";
import { projectRequestsApi } from "./projectRequestsApi.js";
import { projectsApi } from "./projectsApi.js";
import { supportApi } from "./supportApi.js";

export { adminApi } from "./adminApi.js";
export { authApi } from "./authApi.js";
export { getApiUrl } from "./client.js";
export { environmentCommentsApi } from "./environmentCommentsApi.js";
export { projectRequestsApi } from "./projectRequestsApi.js";
export { projectsApi } from "./projectsApi.js";
export { supportApi } from "./supportApi.js";

// Fachada única que agrupa todos los módulos de acceso a la API.
/**
 * Expone una fachada estable sobre los objetos de cada dominio.
 * Las peticiones y adaptaciones siguen implementadas en los m?dulos de API.
 *
 * @type {Object}
 */
export const api = {
  admin: adminApi,
  auth: authApi,
  environmentComments: environmentCommentsApi,
  projectRequests: projectRequestsApi,
  projects: projectsApi,
  support: supportApi,
};
