import { deepFreeze } from "./fileContexts.js";

// Decisiones funcionales abiertas del dominio de archivos de proyecto (Fase 1.2, B2). Las reglas que
// dependen de ellas no tienen comportamiento implícito: devuelven `pending_decision` con el
// identificador, y ningún flujo debe interpretar ese resultado como permitido ni como prohibido sin
// la aprobación correspondiente. Las decisiones de carpetas viven en `projectFolderCatalog.js`.

// Resueltas en B4: DA2 (toda versión nueva pasa por revisión, también la del administrador), DA3
// (aprobar no comparte) y DA5 (solo el administrador aprueba y rechaza).
export const FILE_PENDING_DECISIONS = deepFreeze({
  D3: "Quién comparte una versión con el cliente propietario y quién la autoriza en el escaparate.",
  D4: "Si el cliente conserva el acceso a las versiones que se le compartieron antes de la vigente.",
  DA1: "Archivado: si existe archivar y reactivar, quién puede hacerlo, si exige motivo y si retira o conserva el acceso del cliente y del escaparate.",
  DA4: "Restricciones nuevas por estado del proyecto: proyecto cancelado de solo lectura para archivos (D10) y bloqueo de «Finalizar configuración» con archivos heredados sin resolver (D8).",
});

// Reglas aprobadas para B4 (antes propuestas PR1, PR2 y PR4, y decisiones DA2, DA3 y DA5).
export const FILE_CONFIRMED_RULES = deepFreeze({
  PR1: "Cada archivo admite una sola versión pendiente de revisión.",
  PR2: "Restaurar exige una versión aprobada (o heredada): crea una versión nueva pendiente, registra su procedencia y reutiliza el objeto almacenado.",
  PR4: "Rechazar exige un motivo de hasta 500 caracteres.",
  DA2: "Toda versión nueva pasa por revisión, incluidas las subidas del administrador.",
  DA3: "Aprobar no comparte: la autorización del cliente es independiente.",
  DA5: "Solo el administrador aprueba y rechaza versiones.",
});

// Reglas propuestas sin confirmación expresa. El código las identifica con estos códigos y
// PostgreSQL no las impone. PR5 es la regla de permisos que B4 aplica para reemplazar y restaurar,
// a falta de una decisión explícita.
export const FILE_PROPOSED_RULES = deepFreeze({
  PR3: "El escaparate exige que el archivo tenga una versión compartida con el cliente propietario.",
  PR5: "Reemplazar y restaurar: quien tiene acceso de equipo al proyecto o el autor del archivo mientras conserve el acceso al proyecto.",
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
