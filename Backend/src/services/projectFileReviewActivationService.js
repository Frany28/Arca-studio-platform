import { isProjectFileReviewRequested } from "../config/projectFileReview.js";
import { readProjectFileReviewSchemaState } from "../repositories/projectFileReviewSchemaRepository.js";
import { createDatabaseSchemaNotReadyError } from "../errors/appError.js";

/**
 * Crea un verificador con caché por instancia y deduplicación de comprobaciones concurrentes.
 * Conserva positivos 30 s y negativos 5 s; no guarda errores ni datos de usuarios o sesiones.
 *
 * @param {object} [options] - Dependencias para comprobar el catálogo y controlar el tiempo.
 * @param {Function} [options.readState] - Lectura del historial y del esquema.
 * @param {Function} [options.now] - Reloj en milisegundos.
 * @param {Function} [options.log] - Registro interno de dependencias pendientes.
 * @returns {() => Promise<boolean>} Resolución del estado efectivo; apagar la intención no consulta PostgreSQL.
 */
export function createProjectFileReviewActivation({ readState = readProjectFileReviewSchemaState, now = Date.now, log = console.warn } = {}) {
  let cached = null;
  let inFlight = null;
  let generation = 0;
  /**
   * Conserva una comprobación terminada sin ampliar el acceso a archivos con audiencias.
   * Registra dependencias ausentes y rechaza el retorno al SQL heredado cuando sería inseguro.
   *
   * @param {number} checkGeneration - Generación que inició la lectura, para descartar caché obsoleta.
   * @param {{ready: boolean, legacySafe?: boolean, missing?: string[]}} state - Resultado del repositorio.
   * @returns {boolean} Estado efectivo guardado hasta su vencimiento.
   * @throws {import("../errors/appError.js").AppError} Si el acceso heredado expondría archivos de la política nueva.
   */
  function rememberSchemaState(checkGeneration, state) {
    if (!state.ready) log(JSON.stringify({ type: "project_file_review_schema_not_ready", missing: state.missing }));
    if (!state.ready && state.legacySafe === false) throw createDatabaseSchemaNotReadyError();
    if (checkGeneration === generation) cached = { enabled: state.ready, expiresAt: now() + (state.ready ? 30000 : 5000) };
    return state.ready;
  }

  /**
   * Resuelve la intención y las dependencias sin habilitar parcialmente la funcionalidad.
   * Un cambio de bandera invalida la caché; un fallo de PostgreSQL se propaga sin almacenarlo.
   *
   * @returns {Promise<boolean>} Estado verificado que debe fijarse en el contexto de la petición.
   */
  return async function resolveActivation() {
    if (!isProjectFileReviewRequested()) {
      cached = null;
      inFlight = null;
      generation += 1;
      return false;
    }
    if (cached && cached.expiresAt > now()) return cached.enabled;
    if (!inFlight) {
      // Una lectura iniciada antes de apagar no puede repoblar la caché ni borrar otra en vuelo.
      const check = readState().then(rememberSchemaState.bind(null, generation)).finally(() => {
        if (inFlight === check) inFlight = null;
      });
      inFlight = check;
    }
    return inFlight;
  };
}

export const resolveProjectFileReviewActivation = createProjectFileReviewActivation();
