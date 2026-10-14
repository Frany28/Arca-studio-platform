import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { getAllowedOrigins } from "../config/cors.js";

// IP del cliente verificada a través del proxy firmado de Netlify (hallazgo B-2).
//
// Detrás de Netlify, Vercel sobrescribe X-Forwarded-For con la IP de Netlify, así que req.ip es la
// misma para todos los usuarios. Netlify añade X-Nf-Client-Connection-Ip con la IP real y, con
// `signed` en netlify.toml, firma cada petición proxificada con un JWS HS256 en X-Nf-Sign
// ({ iss: "netlify", exp, site_url, deploy_context, netlify_id }).
//
// Solo se confía en la IP si la firma es válida: sin ella cualquiera podría llamar directamente a
// vercel.app con una cabecera inventada. La firma no cubre la IP, por lo que antes de activar este
// mecanismo en producción hay que comprobar en staging que Netlify sobrescribe un
// X-Nf-Client-Connection-Ip enviado por el cliente (ver docs/RATE_LIMITING.md).
// Sin NETLIFY_PROXY_SIGNATURE_SECRET, la función devuelve siempre null.

const SIGNATURE_HEADER = "x-nf-sign";
const CLIENT_IP_HEADER = "x-nf-client-connection-ip";
const EXPECTED_ISSUER = "netlify";
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Decodifica un segmento base64url de un JWS como JSON.
 * Devuelve null si el segmento no es JSON válido, en lugar de lanzar.
 *
 * @param {string} segment - Segmento codificado.
 * @returns {object|null} Objeto decodificado, o null.
 */
function decodeSegment(segment) {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Verifica el JWS de Netlify: algoritmo HS256, firma con el secreto, emisor, caducidad y sitio.
 * La comparación de firmas es de tiempo constante y el sitio debe ser uno de los orígenes CORS exactos.
 *
 * @param {string|undefined} token - Valor de X-Nf-Sign.
 * @param {string} secret - Secreto compartido configurado en Netlify y en el backend.
 * @param {number} [nowSeconds] - Instante actual en segundos (inyectable en pruebas).
 * @returns {boolean} true si la petición procede del proxy firmado de nuestro sitio.
 */
export function isValidNetlifySignature(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string" || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedPayload, signature] = parts;
  const header = decodeSegment(encodedHeader);
  if (header?.alg !== "HS256") return false;

  const expected = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;

  const payload = decodeSegment(encodedPayload);
  if (payload?.iss !== EXPECTED_ISSUER) return false;
  if (!Number.isFinite(payload.exp) || payload.exp + CLOCK_TOLERANCE_SECONDS < nowSeconds) return false;
  try {
    return getAllowedOrigins().includes(new URL(payload.site_url).origin);
  } catch {
    return false;
  }
}

/**
 * Obtiene la IP del cliente solo cuando llega por el proxy firmado de Netlify.
 * Ignora X-Forwarded-For y cualquier cabecera sin firma válida; devuelve null si no hay IP verificable.
 *
 * @param {import("express").Request} req - Petición HTTP.
 * @param {Record<string, string|undefined>} [environment] - Variables de entorno.
 * @returns {string|null} IP verificada, o null.
 */
export function getVerifiedClientIp(req, environment = process.env) {
  const secret = environment.NETLIFY_PROXY_SIGNATURE_SECRET;
  if (!secret || !isValidNetlifySignature(req.headers?.[SIGNATURE_HEADER], secret)) return null;

  const raw = req.headers?.[CLIENT_IP_HEADER];
  if (typeof raw !== "string" || raw.includes(",")) return null;
  const ip = raw.trim().replace(/^\[|\]$/g, "");
  return isIP(ip) ? ip : null;
}
