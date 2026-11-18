import { fileRuleResult, pendingFileDecision } from "./projectFileDecisions.js";

// Conservación de archivos guardados (Fase 1.2, regla confirmada). Un archivo registrado —de un
// proyecto o adjunto persistido de una solicitud— conserva su registro, todas sus versiones y sus
// objetos: no se borra el objeto, no se borra ni se retira una versión y no se marca con
// status 'deleted' ni deleted_at. Lo único que se descarta es lo que nunca llegó a guardarse: una
// selección sin enviar o el objeto de una carga cuyo registro no existe. Archivar y reactivar
// dependen de DA1.

export const STORED_FILE_OPERATIONS = Object.freeze([
  "delete_stored_object",
  "delete_version",
  "retire_file",
  "archive_file",
  "unarchive_file",
  "cancel_unsaved_selection",
  "discard_unrecorded_object",
]);

/**
 * Evalúa una operación que podría hacer desaparecer un archivo o su contenido.
 * Prohíbe todo lo que afecta a un archivo guardado, permite descartar lo que nunca se registró y
 * devuelve `pending_decision` para el archivado. Ante un registro incierto, conserva el objeto.
 *
 * @param {object} request - Operación y contexto.
 * @param {string} request.operation - Una de `STORED_FILE_OPERATIONS`.
 * @param {boolean|null} [request.recorded] - Para `discard_unrecorded_object`: si existe una fila
 *   que apunta al objeto (true), si se comprobó que no existe (false) o si no se pudo comprobar (null).
 * @returns {{ outcome: "allowed"|"forbidden"|"pending_decision", reason: string, decision?: string }} Resultado.
 * @throws {Error} UNKNOWN_STORED_FILE_OPERATION si la operación no es conocida.
 */
export function evaluateStoredFileOperation({ operation, recorded = null }) {
  switch (operation) {
    case "delete_stored_object":
    case "delete_version":
    case "retire_file":
      return fileRuleResult("forbidden", "STORED_FILE_RETAINED");
    case "archive_file":
    case "unarchive_file":
      return pendingFileDecision("DA1", "FILE_ARCHIVING_UNDECIDED");
    case "cancel_unsaved_selection":
      return fileRuleResult("allowed", "NOTHING_STORED_YET");
    case "discard_unrecorded_object":
      if (recorded === false) return fileRuleResult("allowed", "OBJECT_NEVER_RECORDED");
      return fileRuleResult("forbidden", recorded === true ? "RECORDED_OBJECT_RETAINED" : "UNVERIFIED_OBJECT_RETAINED");
    default:
      throw Object.assign(new Error(`Operación de archivo desconocida: ${operation}`), { code: "UNKNOWN_STORED_FILE_OPERATION" });
  }
}
