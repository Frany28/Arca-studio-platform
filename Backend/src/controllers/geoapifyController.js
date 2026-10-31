import { EXTERNAL_REQUEST_TIMEOUTS, fetchWithTimeout, isTimeoutError } from "../utils/externalRequest.js";

const GEOAPIFY_AUTOCOMPLETE_URL =
  "https://api.geoapify.com/v1/geocode/autocomplete";
const GEOAPIFY_REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";
const GEOAPIFY_DEFAULT_COUNTRY_BIAS = "ve";

/**
 * Obtiene el valor de geoapify api key para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
function getGeoapifyApiKey() {
  return process.env.GEOAPIFY_API_KEY || process.env.VITE_GEOAPIFY_API_KEY;
}

/**
 * Transforma el valor de address suggestion a la representación pública esperada.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {unknown} feature - Valor de `feature` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function toAddressSuggestion(feature) {
  const properties = feature?.properties || {};
  const coordinates = feature?.geometry?.coordinates || [];
  const [longitude, latitude] = coordinates;

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !properties.formatted
  ) {
    return null;
  }

  return {
    formattedAddress: properties.formatted,
    latitude,
    longitude,
    placeId: properties.place_id || properties.datasource?.raw?.place_id || null,
  };
}

/**
 * Interpreta el valor de coordinate text y descarta los formatos que no sean válidos.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function parseCoordinateText(value) {
  const match = String(value || "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);

  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

/**
 * Busca el valor de by coordinates mediante el proveedor externo configurado.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.apiKey - Valor de `options.apiKey` requerido por esta operación.
 * @param {number} options.latitude - Valor de `options.latitude` requerido por esta operación.
 * @param {number} options.longitude - Valor de `options.longitude` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
async function searchByCoordinates({ apiKey, latitude, longitude }) {
  const params = new URLSearchParams({
    apiKey,
    format: "geojson",
    lang: "es",
    lat: String(latitude),
    lon: String(longitude),
    limit: "1",
  });

  const response = await fetchWithTimeout(`${GEOAPIFY_REVERSE_URL}?${params}`, {}, EXTERNAL_REQUEST_TIMEOUTS.geocodingMs);

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return (data.features || []).map(toAddressSuggestion).find(Boolean) || null;
}

/**
 * Obtiene las sugerencias de dirección para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getAddressSuggestions(req, res, next) {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    const apiKey = getGeoapifyApiKey();
    const text = String(req.query?.q || "").trim();

    if (!apiKey) {
      res.status(500).json({
        code: "GEOAPIFY_API_KEY_MISSING",
        message: "Geoapify no está configurado.",
      });
      return;
    }

    if (text.length < 2) {
      res.status(200).json({
        suggestions: [],
      });
      return;
    }

    const coordinates = parseCoordinateText(text);

    if (coordinates) {
      const suggestion = await searchByCoordinates({
        apiKey,
        ...coordinates,
      });

      res.status(200).json({
        suggestions: suggestion ? [suggestion] : [],
      });
      return;
    }

    const params = new URLSearchParams({
      apiKey,
      bias: `countrycode:${GEOAPIFY_DEFAULT_COUNTRY_BIAS}`,
      format: "geojson",
      lang: "es",
      limit: "5",
      text,
    });

    const response = await fetchWithTimeout(`${GEOAPIFY_AUTOCOMPLETE_URL}?${params}`, {}, EXTERNAL_REQUEST_TIMEOUTS.geocodingMs);

    if (!response.ok) {
      const isConfigurationError = response.status === 401 || response.status === 403;
      const isRateLimited = response.status === 429;
      res.status(502).json({
        code: isConfigurationError
          ? "GEOAPIFY_CONFIGURATION_INVALID"
          : isRateLimited
            ? "GEOAPIFY_LIMIT_REACHED"
            : "GEOAPIFY_REQUEST_FAILED",
        message: isConfigurationError
          ? "El buscador de ubicaciones no está configurado correctamente."
          : isRateLimited
            ? "El buscador de ubicaciones alcanzó temporalmente su límite."
            : "No se pudieron obtener sugerencias de ubicación.",
      });
      return;
    }

    const data = await response.json();
    const seenSuggestions = new Set();
    const suggestions = (data.features || [])
      .map(toAddressSuggestion)
      .filter((suggestion) => {
        if (!suggestion) return false;
        const key = suggestion.placeId || suggestion.formattedAddress.toLowerCase();
        if (seenSuggestions.has(key)) return false;
        seenSuggestions.add(key);
        return true;
      });

    res.status(200).json({
      suggestions,
    });
  } catch (error) {
    // Plazo agotado (también al leer el cuerpo) o proveedor inalcanzable: respuesta controlada
    // con el mismo formato que los demás fallos de Geoapify, sin la URL, que incluye la clave.
    if (isTimeoutError(error)) {
      res.status(504).json({
        code: "GEOAPIFY_TIMEOUT",
        message: "El buscador de ubicaciones no respondió a tiempo.",
      });
      return;
    }

    if (error?.code === "EXTERNAL_UNAVAILABLE") {
      res.status(502).json({
        code: "GEOAPIFY_REQUEST_FAILED",
        message: "No se pudieron obtener sugerencias de ubicación.",
      });
      return;
    }

    next(error);
  }
}
