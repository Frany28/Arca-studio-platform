import { deepFreeze } from "./fileContexts.js";

// Decisiones funcionales abiertas del dominio de archivos de proyecto (Fase 1.2, B2). Las reglas que
// dependen de ellas no tienen comportamiento implícito: devuelven `pending_decision` con el
// identificador, y ningún flujo debe interpretar ese resultado como permitido ni como prohibido sin
// la aprobación correspondiente. Las decisiones de carpetas viven en `projectFolderCatalog.js`.

export const FILE_PENDING_DECISIONS = deepFreeze({
  D3: "Quién comparte una versión con el cliente propietario y quién la autoriza en el escaparate.",
  D4: "Si el cliente conserva el acceso a las versiones que se le compartieron antes de la vigente.",
  DA1: "Archivado: si existe archivar y reactivar, quién puede hacerlo, si exige motivo y si retira o conserva el acceso del cliente y del escaparate.",
  DA2: "Aprobación automática: si las subidas, reemplazos y restauraciones del administrador o del cliente nacen aprobados o pasan por revisión.",
  DA3: "Publicación al aprobar: si aprobar una versión la comparte automáticamente con el cliente propietario.",
  DA4: "Restricciones nuevas por estado del proyecto: proyecto cancelado de solo lectura para archivos (D10) y bloqueo de «Finalizar configuración» con archivos heredados sin resolver (D8).",
  DA5: "Quién aprueba y rechaza versiones: solo el administrador o también el arquitecto asignado.",
});

// Reglas propuestas por el plan v3 y aplicadas en el dominio de B2 sin confirmación expresa. Siguen
// siendo propuestas pendientes de aprobación: el código las identifica con estos códigos y PostgreSQL
// no las impone (la migración de expansión de B3 no añade ninguna restricción que dependa de ellas).
export const FILE_PROPOSED_RULES = deepFreeze({
  PR1: "Un archivo tiene como máximo una versión pendiente de revisión.",
  PR2: "Solo se restauran versiones aprobadas (o heredadas) distintas de la vigente.",
  PR3: "El escaparate exige que el archivo tenga una versión compartida con el cliente propietario.",
  PR4: "El motivo de rechazo admite como máximo 500 caracteres.",
});

/**
 * Crea el resultado de una regla que depende de una decisión abierta.
 * Exige que la decisión esté registrada para que ninguna regla apunte a un identificador inventado.
 *
 * @param {string} decision - Identificador registrado en `FILE_PENDING_DECISIONS`.
 * @param {string} reason - Código estable del caso concreto.
 * @returns {{ outcome: "pending_decision", decision: string, reason: string }} Resultado pendiente.
 * @throws {Error} UNKNOWN_FILE_DECISION si la decisión no está registrada.
 */
export function pendingFileDecision(decision, reason) {
  if (!Object.hasOwn(FILE_PENDING_DECISIONS, decision)) {
    throw Object.assign(new Error(`Decisión de archivos desconocida: ${decision}`), { code: "UNKNOWN_FILE_DECISION" });
  }
  return { decision, outcome: "pending_decision", reason };
}

/**
 * Crea un resultado confirmado (permitido o prohibido) con su motivo estable.
 * Centraliza la forma de los resultados que comparten las reglas del dominio de archivos.
 *
 * @param {"allowed"|"forbidden"} outcome - Resultado confirmado.
 * @param {string} reason - Código estable del motivo.
 * @param {object} [details] - Datos adicionales del resultado (por ejemplo, la audiencia).
 * @returns {{ outcome: "allowed"|"forbidden", reason: string }} Resultado.
 */
export function fileRuleResult(outcome, reason, details = {}) {
  return { ...details, outcome, reason };
}
