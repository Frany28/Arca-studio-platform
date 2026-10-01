import { authApi } from "./authApi.js";
import { adminApi } from "./adminApi.js";
import { projectsApi } from "./projectsApi.js";
import { environmentCommentsApi } from "./environmentCommentsApi.js";
import { projectRequestsApi } from "./projectRequestsApi.js";
import { supportApi } from "./supportApi.js";

export { authApi, adminApi, projectsApi, environmentCommentsApi, projectRequestsApi, supportApi };
export { getApiUrl } from "./client.js";

export const api = {
  admin: adminApi,
  auth: authApi,
  environmentComments: environmentCommentsApi,
  projectRequests: projectRequestsApi,
  projects: projectsApi,
  support: supportApi,
};
