// Activación coordinada de la revisión de versiones de archivos de proyecto (Fase 1.2, B4).
//
// Apagada por defecto: el backend conserva exactamente su comportamiento anterior. Las cargas crean
// la v1 vigente con la regla de acceso heredada, la descarga ignora `versionId` y las rutas de
// versiones y revisión responden 404. Encendida (`PROJECT_FILE_REVIEW_ENABLED=true`): las cargas
// nuevas crean archivos con la política 1.2 y una primera versión pendiente, y se habilitan
// reemplazar, restaurar, aprobar, rechazar, el historial y la descarga por versión.
//
// No debe encenderse en un entorno compartido hasta completar las dependencias de activación
// documentadas en Backend/ARCHITECTURE.md (audiencias en listados, miniaturas, comentarios, SSE y
// caché; compatibilidad de archivos heredados; scripts de subida; frontend).

/**
 * Indica si la revisión de versiones de archivos de proyecto está activada en este proceso.
 * Se lee en cada llamada para que las pruebas puedan cambiarla sin reiniciar el proceso.
 *
 * @returns {boolean} true solo con PROJECT_FILE_REVIEW_ENABLED=true.
 */
export function isProjectFileReviewEnabled() {
  return String(process.env.PROJECT_FILE_REVIEW_ENABLED ?? "").trim().toLowerCase() === "true";
}
