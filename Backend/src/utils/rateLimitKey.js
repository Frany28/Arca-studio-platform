import { createHmac, hkdfSync } from "node:crypto";

import { authConfig } from "../config/auth.js";

// Clave HMAC propia del rate limiting, derivada del secreto de autenticación con HKDF para no
// reutilizar el mismo material criptográfico ni exigir una variable nueva. Rotar AUTH_TOKEN_SECRET
// reinicia los contadores, lo que es aceptable.
const RATE_LIMIT_HMAC_KEY = Buffer.from(
  hkdfSync("sha256", authConfig.tokenSecret, Buffer.alloc(0), "arca-rate-limit-key-v1", 32),
);

/**
 * Normaliza un correo para identificar la misma cuenta con independencia de mayúsculas y espacios.
 * Devuelve null para valores que no son texto o no parecen correos, de modo que no generen claves.
 *
 * @param {unknown} value - Correo recibido en el cuerpo de la petición.
 * @returns {string|null} Correo normalizado, o null si no es utilizable.
 */
export function normalizeEmailIdentity(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && email.includes("@") ? email : null;
}

/**
 * Normaliza el destinatario de un correo para que sus alias compartan el límite de envíos.
 * Solo aplica reglas verificadas en la ayuda oficial de Gmail para cuentas @gmail.com: los puntos del
 * nombre de usuario no cambian el buzón y el texto tras "+" es una etiqueta. Otros dominios (incluidos
 * Google Workspace y Outlook) solo se normalizan en mayúsculas y espacios.
 *
 * @param {unknown} value - Correo recibido en el cuerpo de la petición.
 * @returns {string|null} Destinatario normalizado, o null si no es un correo utilizable.
 */
export function normalizeEmailRecipient(value) {
  const email = normalizeEmailIdentity(value);
  if (!email) return null;
  const separator = email.lastIndexOf("@");
  const domain = email.slice(separator + 1);
  if (domain !== "gmail.com") return email;
  const localPart = email.slice(0, separator).split("+")[0].replaceAll(".", "");
  return localPart ? `${localPart}@${domain}` : null;
}

/**
 * Calcula la clave de un contador como HMAC-SHA256 del ámbito, la dimensión y el identificador.
 * El resultado no permite recuperar correos, tokens, IDs ni IP, y separa contadores de distintos ámbitos.
 *
 * @param {string} scope - Ámbito del límite (p. ej. "login").
 * @param {string} dimension - Dimensión (p. ej. "account", "account-ip", "ip").
 * @param {Array<string|number>} parts - Identificadores que componen la clave.
 * @returns {Buffer} Clave de 32 bytes.
 */
export function hashRateLimitKey(scope, dimension, parts) {
  const hmac = createHmac("sha256", RATE_LIMIT_HMAC_KEY);
  // Longitud + valor evita ambigüedades entre concatenaciones ("ab"+"c" frente a "a"+"bc").
  for (const part of [scope, dimension, ...parts.map(String)]) {
    hmac.update(`${Buffer.byteLength(part)}:${part};`);
  }
  return hmac.digest();
}
