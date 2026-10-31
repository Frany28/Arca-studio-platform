import { objectStorage } from "./objectStorage.js";

// Cargas sin conexiones retenidas (P0-1): el objeto se transfiere primero, sin ninguna conexión de
// PostgreSQL ni bloqueo abiertos, y después se registra en una transacción corta que vuelve a
// comprobar estado, duplicados y límites bajo bloqueo.
//
// Invariante: solo existe una fila activa si su objeto se almacenó antes. Si el registro falla, el
// objeto se elimina únicamente cuando su fila no existe: ante un COMMIT de resultado incierto (por
// ejemplo, conexión perdida al confirmar) se conserva, porque borrarlo dejaría una fila apuntando a un
// archivo inexistente. Los objetos que no se pueden verificar o eliminar se registran como huérfanos
// para su limpieza; nunca se pierde un archivo ya registrado.

/**
 * Registra un objeto que no se pudo compensar, con lo necesario para limpiarlo.
 * Solo incluye la clave, el motivo y el código del error, nunca el contenido ni credenciales.
 *
 * @param {object} event - Datos del evento.
 * @param {string} event.key - Clave del objeto en el almacenamiento.
 * @param {string} event.reason - Motivo por el que no se eliminó.
 * @param {string} event.scope - Tipo de carga.
 * @param {Error} [event.error] - Error que impidió la compensación.
 * @returns {void}
 */
function logOrphanCandidate({ error, key, reason, scope }) {
  console.warn(JSON.stringify({
    code: error?.code || error?.name || null,
    key,
    reason,
    scope,
    type: "storage_orphan_candidate",
  }));
}

/**
 * Elimina el objeto de una carga fallida si su fila no llegó a registrarse.
 * Nunca lanza: la compensación no debe ocultar el error original de la carga.
 *
 * @param {object} options - Opciones de la compensación.
 * @param {() => Promise<boolean>} options.isRecorded - Indica si la fila del objeto existe.
 * @param {string} options.key - Clave del objeto.
 * @param {string} options.scope - Tipo de carga, para los registros.
 * @returns {Promise<void>} Finaliza cuando la compensación termina o queda registrada.
 */
export async function discardUnrecordedObject({ isRecorded, key, scope }) {
  let recorded;
  try {
    recorded = await isRecorded();
  } catch (error) {
    logOrphanCandidate({ error, key, reason: "record_check_failed", scope });
    return;
  }
  if (recorded) return;

  try {
    await objectStorage.delete(key);
  } catch (error) {
    logOrphanCandidate({ error, key, reason: "delete_failed", scope });
  }
}

/**
 * Transfiere un objeto y después lo registra; si cualquiera de los dos pasos falla, compensa.
 * La transferencia no retiene conexiones: `record` debe abrir su propia transacción corta.
 *
 * @template T
 * @param {object} options - Pasos de la carga.
 * @param {string} options.key - Clave del objeto, derivada de un identificador ya reservado.
 * @param {() => Promise<unknown>} options.store - Transfiere el contenido al almacenamiento.
 * @param {() => Promise<T>} options.record - Registra el objeto en PostgreSQL.
 * @param {() => Promise<boolean>} options.isRecorded - Indica si el registro llegó a confirmarse.
 * @param {string} options.scope - Tipo de carga, para los registros.
 * @returns {Promise<T>} Resultado del registro.
 * @throws {Error} El error original de la transferencia o del registro.
 */
export async function storeThenRecord({ isRecorded, key, record, scope, store }) {
  try {
    await store();
    return await record();
  } catch (error) {
    // También tras un fallo de transferencia: un plazo agotado puede ocurrir después de que el
    // proveedor guardara el objeto, y borrar una clave inexistente no tiene efecto.
    await discardUnrecordedObject({ isRecorded, key, scope });
    throw error;
  }
}
