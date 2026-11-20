import { AsyncLocalStorage } from "node:async_hooks";

const activationContext = new AsyncLocalStorage();

// Activación coordinada de la revisión de versiones de archivos de proyecto (Fase 1.2, B4).
//
// Apagada por defecto: el backend conserva su comportamiento anterior. Las cargas crean
// la v1 vigente con la regla de acceso heredada, la descarga ignora `versionId` y las rutas de
// versiones y revisión responden 404. Solicitada (`PROJECT_FILE_REVIEW_ENABLED=true`) y verificada: las cargas
// nuevas crean archivos con la política 1.2 y una primera versión pendiente, y se habilitan
// reemplazar, restaurar, aprobar, rechazar, el historial y la descarga por versión.
//
// El middleware comprueba historial y estructura antes de fijar el estado de la petición.
// No debe solicitarse en un entorno compartido hasta completar las dependencias de activación
// documentadas en Backend/ARCHITECTURE.md (audiencias en listados, miniaturas, comentarios, SSE y
// caché; compatibilidad de archivos heredados; scripts de subida; frontend).

/**
 * Lee la intención de activar la revisión sin habilitar consultas ni rutas nuevas.
 * El servicio contrasta esta intención con el historial y el catálogo de PostgreSQL.
 *
 * @returns {boolean} true solo con PROJECT_FILE_REVIEW_ENABLED=true.
 */
export function isProjectFileReviewRequested() {
  return String(process.env.PROJECT_FILE_REVIEW_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Expone el estado efectivo verificado para la operación asíncrona actual.
 * Fuera de un contexto verificado permanece apagado; ninguna bandera habilita SQL por sí sola.
 *
 * @returns {boolean} Activación común para rutas, servicios, consultas y eventos.
 */
export function isProjectFileReviewEnabled() {
  return activationContext.getStore() === true;
}

/**
 * Mantiene estable la activación durante una petición y sus operaciones asíncronas.
 * El llamador debe obtener el estado mediante la comprobación de dependencias del servicio.
 *
 * @template T
 * @param {boolean} enabled - Resultado efectivo de la comprobación de esquema e historial.
 * @param {() => T} work - Operación que comparte este estado con sus consumidores.
 * @returns {T} Resultado de la operación.
 */
export function withProjectFileReviewState(enabled, work) {
  return activationContext.run(enabled, work);
}
