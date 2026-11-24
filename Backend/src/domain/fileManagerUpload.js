import { evaluateFolderContent, getSystemFolder } from "./projectFolderCatalog.js";

// Sección funcional de «Panorámicas» (clave conservada `renders.models`, sección `models_3d`): sus
// imágenes son equirectangulares de 360° y se abren con el visor panorámico.
const PANORAMA_SECTION = "models_3d";

/**
 * Categoría de un archivo subido desde el administrador. Conserva la regla de siempre (imagen,
 * vídeo o documento según el formato) y clasifica como `panorama` las imágenes que caen en
 * «Panorámicas» o en una de sus subcarpetas, para que el proyecto y el administrador las abran con
 * el visor 360. Un vídeo o documento en «Panorámicas» conserva su categoría: la ubicación lógica no
 * cambia la categoría técnica, que refleja el contenido real.
 *
 * @param {string|null} classificationKey - Clave de la carpeta predeterminada más cercana.
 * @param {string} fileType - Tipo MIME normalizado.
 * @returns {"image"|"video"|"document"|"panorama"} Categoría.
 */
export function resolveManagedFileCategory(classificationKey, fileType) {
  const type = String(fileType || "");
  if (type.startsWith("image/")) return getSystemFolder(classificationKey)?.section === PANORAMA_SECTION ? "panorama" : "image";
  if (type.startsWith("video/")) return "video";
  return "document";
}

/**
 * Decide si una carpeta admite un archivo más con las reglas de contenido confirmadas del catálogo:
 * solo la portada las tiene (una imagen JPG o PNG que se reemplaza). El resto de carpetas y la raíz
 * (D14 resuelta) admiten cualquier formato que acepte la subida.
 *
 * @param {{ systemKey: string|null, fileCount: number }} target - Carpeta destino.
 * @param {string} extension - Extensión del archivo.
 * @returns {{ allowed: boolean, reason: string, decision?: string }} Veredicto.
 */
export function evaluateManagedUpload(target, extension) {
  const verdict = evaluateFolderContent({ systemKey: target.systemKey }, { currentFileCount: target.fileCount, extension });
  if (verdict.outcome === "forbidden") return { allowed: false, reason: verdict.reason };
  return { allowed: true, reason: verdict.reason, ...(verdict.decision ? { decision: verdict.decision } : {}) };
}
