import { evaluateProjectRequestCompleteness } from "./projectRequestCompleteness.js";
import { evaluateFinancialViability } from "./projectRequestFinancialViability.js";

/**
 * Calcula al vuelo las métricas derivadas de las respuestas guardadas de una solicitud.
 * Completitud y viabilidad financiera son independientes de la compatibilidad persistida:
 * no se derivan del score ni lo modifican, y se recalculan con las reglas vigentes sin persistirse.
 *
 * @param {object} answers - Registro de la solicitud con los nombres de campo del dominio.
 * @returns {{completeness: {answered: number, applicable: number, missingFields: Array<string>, score: number}, financialViability: {findings: Array<object>, score: null, status: string}}} Métricas públicas.
 */
export function buildProjectRequestMetrics(answers) {
  return {
    completeness: evaluateProjectRequestCompleteness(answers),
    financialViability: evaluateFinancialViability(answers),
  };
}
