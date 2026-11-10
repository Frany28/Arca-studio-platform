import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { resolveTrustProxySetting } from "../src/config/trustProxy.js";
import { getVerifiedClientIp } from "../src/utils/verifiedClientIp.js";

/**
 * Sirve una aplicación mínima que devuelve la IP que vería el rate limiting y la consulta con la
 * cabecera X-Forwarded-For indicada, desde 127.0.0.1 (como lo haría Nginx en el mismo VPS).
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @param {object} options - Escenario.
 * @param {number|boolean|string} options.trustProxy - Valor de `trust proxy`.
 * @param {Record<string, string>} options.environment - Variables que lee getVerifiedClientIp.
 * @param {string} [options.forwardedFor] - Cabecera X-Forwarded-For enviada.
 * @returns {Promise<string|null>} IP resuelta.
 */
async function resolveIp(context, { environment, forwardedFor, trustProxy }) {
  const application = express();
  application.set("trust proxy", trustProxy);
  application.get("/ip", (req, res) => res.json({ ip: getVerifiedClientIp(req, environment) }));
  const server = application.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/ip`, {
    headers: forwardedFor ? { "X-Forwarded-For": forwardedFor } : {},
  });
  return (await response.json()).ip;
}

test("sin CLIENT_IP_SOURCE no se confía en X-Forwarded-For (comportamiento anterior)", async (context) => {
  assert.equal(await resolveIp(context, { environment: {}, forwardedFor: "203.0.113.9", trustProxy: 1 }), null);
});

test("trusted-proxy detrás de un proxy local de confianza usa la IP que declara el proxy", async (context) => {
  const ip = await resolveIp(context, {
    environment: { CLIENT_IP_SOURCE: "trusted-proxy" },
    forwardedFor: "203.0.113.9",
    trustProxy: "loopback",
  });
  assert.equal(ip, "203.0.113.9");
});

test("trusted-proxy sin proxy de confianza ignora una X-Forwarded-For falsificada", async (context) => {
  const ip = await resolveIp(context, {
    environment: { CLIENT_IP_SOURCE: "trusted-proxy" },
    forwardedFor: "203.0.113.9",
    trustProxy: false,
  });
  assert.equal(ip, "127.0.0.1", "se usa la dirección real de la conexión, no la cabecera");
});

test("TRUST_PROXY: por defecto 1 salto; números, false y listas se traducen para Express", () => {
  assert.equal(resolveTrustProxySetting({}), 1);
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: " 2 " }), 2);
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "false" }), false);
  assert.equal(resolveTrustProxySetting({ TRUST_PROXY: "loopback, 10.0.0.0/8" }), "loopback, 10.0.0.0/8");
});
