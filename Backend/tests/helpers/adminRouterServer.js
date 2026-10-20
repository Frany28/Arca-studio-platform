import { createRateLimitQueryMock } from "./rateLimitQueryMock.js";

/**
 * Levanta routers administrativos en un puerto efímero con una sesión controlada por la prueba.
 * Sustituye el pool: emula el contador de rate limit y registra cualquier otra consulta, que se
 * responde con `respond` (por defecto falla, para demostrar que no se accede a PostgreSQL).
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor y restaura mocks.
 * @param {object} options - Configuración del servidor.
 * @param {import("pg").Pool} options.pool - Pool real de la aplicación que se simula.
 * @param {Array<[string, import("express").Router]>} options.routes - Rutas de montaje y routers.
 * @param {(sql: string) => object} [options.respond] - Respuesta a consultas que no son del rate limit.
 * @returns {Promise<{ send: Function, setUser: Function, queries: Array<string> }>} Cliente HTTP y estado.
 */
export async function startAdminRouterServer(context, { pool, respond, routes }) {
  const { default: express } = await import("express");
  const { normalizeError } = await import("../../src/errors/appError.js");
  const reply = respond ?? (() => { throw new Error("No debe acceder a PostgreSQL"); });
  let user = null;
  const queries = [];
  const rateLimitQueries = createRateLimitQueryMock();
  const handle = async (sql, params) => {
    const rateLimit = rateLimitQueries.handle(sql, params);
    if (rateLimit) return rateLimit;
    queries.push(String(sql));
    return reply(String(sql));
  };
  context.mock.method(pool, "query", handle);
  context.mock.method(pool, "connect", async () => ({ query: handle, release() {} }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { isAuthenticated: Boolean(user) };
    req.user = user;
    next();
  });
  for (const [mountPath, router] of routes) app.use(mountPath, router);
  app.use((error, _req, res, _next) => {
    const normalized = normalizeError(error);
    res.status(normalized.status).json({ code: normalized.code, message: normalized.publicMessage, fields: normalized.fields });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

  const send = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { body: await response.json(), headers: response.headers, status: response.status };
  };
  return { queries, send, setUser: (value) => { user = value; } };
}
