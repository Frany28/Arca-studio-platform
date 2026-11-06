/**
 * Límite temporal de tamaño por subida impuesto por el despliegue actual, distinto del límite
 * funcional del sistema (50 MB por archivo, que valida el backend).
 *
 * El backend de staging se ejecuta como función de Vercel, cuya documentación limita el cuerpo de
 * cada petición a 4,5 MB: un archivo mayor no llega a Express y la plataforma responde 413. Para no
 * anunciar que un archivo de hasta 50 MB se sube por este recorrido, el formulario aplica este
 * límite en el build de producción (Netlify → Vercel). En desarrollo (Express local) no se aplica.
 *
 * Configuración temporal (AGENTS.md §2 y §15): `VITE_UPLOAD_TRANSFER_LIMIT_BYTES` la sustituye y
 * `0` la desactiva, p. ej. al pasar a un servidor sin ese límite o a subidas directas al
 * almacenamiento. Debe revisarse antes de producción.
 */
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4_500_000;

/**
 * Resuelve el límite por subida a partir de las variables de Vite.
 *
 * @param {{PROD?: boolean, VITE_UPLOAD_TRANSFER_LIMIT_BYTES?: string}} [environment] - Variables de Vite.
 * @returns {number|null} Bytes máximos por subida en este entorno, o null si no hay límite propio.
 */
export function resolveUploadTransferLimit(environment = import.meta.env || {}) {
  const configured = environment.VITE_UPLOAD_TRANSFER_LIMIT_BYTES;
  if (configured !== undefined && String(configured).trim() !== "") {
    const bytes = Number(configured);
    return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
  }
  return environment.PROD ? VERCEL_FUNCTION_BODY_LIMIT_BYTES : null;
}

export const UPLOAD_TRANSFER_LIMIT_BYTES = resolveUploadTransferLimit();
