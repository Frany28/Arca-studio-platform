import { deepFreeze } from "./fileContexts.js";

// Decisiones funcionales abiertas del dominio de archivos de proyecto (Fase 1.2, B2). Las reglas que
// dependen de ellas no tienen comportamiento implícito: devuelven `pending_decision` con el
// identificador, y ningún flujo debe interpretar ese resultado como permitido ni como prohibido sin
// la aprobación correspondiente. Las decisiones de carpetas viven en `projectFolderCatalog.js`.

// Resueltas en B4: DA2, DA3 y DA5. Resueltas en B5: D3 (solo el administrador gestiona audiencias)
// y D4 (el cliente solo consulta la autorización activa).
export const FILE_PENDING_DECISIONS = deepFreeze({
  DA1: "Archivado: si existe archivar y reactivar, quién puede hacerlo, si exige motivo y si retira o conserva el acceso del cliente y del escaparate.",
  DA4: "Restricciones nuevas por estado del proyecto: proyecto cancelado de solo lectura para archivos (D10) y bloqueo de «Finalizar configuración» con archivos heredados sin resolver (D8).",
});

// Reglas aprobadas: B4 (PR1, PR2, PR4, DA2, DA3, DA5) y B5 (D3, D4, AU1, AU2).
export const FILE_CONFIRMED_RULES = deepFreeze({
  PR1: "Cada archivo admite una sola versión pendiente de revisión.",
  PR2: "Restaurar exige una versión aprobada (o heredada): crea una versión nueva pendiente, registra su procedencia y reutiliza el objeto almacenado.",
  PR4: "Rechazar exige un motivo de hasta 500 caracteres.",
  DA2: "Toda versión nueva pasa por revisión, incluidas las subidas del administrador.",
  DA3: "Aprobar no comparte: la autorización del cliente es independiente.",
  DA5: "Solo el administrador aprueba y rechaza versiones.",
  D3: "Solo el administrador comparte versiones con el cliente y autoriza su publicación en el escaparate.",
  D4: "El cliente consulta la versión con autorización activa; las autorizaciones sustituidas quedan como historial sin dar acceso.",
  AU1: "Cliente propietario y escaparate tienen autorizaciones independientes.",
  AU2: "Compartir exige una versión aprobada del mismo archivo.",
});

// Reglas propuestas sin confirmación expresa. El código las identifica con estos códigos y
// PostgreSQL no las impone. PR3 (el escaparate dependía del cliente) se retiró en B5 por AU1.
export const FILE_PROPOSED_RULES = deepFreeze({
  PR5: "Reemplazar y restaurar: quien tiene acceso de equipo al proyecto o el autor del archivo mientras conserve el acceso al proyecto.",
  PR6: "Una sola versión autorizada por audiencia: autorizar otra versión en el escaparate sustituye la anterior, como en el cliente.",
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
