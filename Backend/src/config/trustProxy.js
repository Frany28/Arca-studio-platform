// Configuración de `trust proxy` de Express. Determina qué saltos de X-Forwarded-For se aceptan al
// calcular req.ip, req.protocol y req.secure. Por defecto se conserva el valor histórico (1 salto),
// adecuado detrás de la plataforma de despliegue actual. En un VPS con Nginx en el mismo servidor se
// recomienda `TRUST_PROXY=loopback`, de modo que solo el proxy local pueda declarar la IP del cliente.

/**
 * Traduce `TRUST_PROXY` al valor que acepta `app.set("trust proxy", …)`: un número de saltos, `false`
 * para no confiar en ningún proxy, o una lista de direcciones/subredes/nombres (`loopback`,
 * `10.0.0.0/8`, …). Un valor ausente conserva el comportamiento anterior (1 salto).
 *
 * @param {Record<string, string|undefined>} [environment] - Variables de entorno.
 * @returns {number|boolean|string} Valor de `trust proxy` para Express.
 */
export function resolveTrustProxySetting(environment = process.env) {
  const raw = String(environment.TRUST_PROXY ?? "").trim();
  if (!raw) return 1;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw.toLowerCase() === "false") return false;
  return raw;
}
