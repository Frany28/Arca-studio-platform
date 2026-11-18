import { isFileVersionObjectRecorded } from "../../src/repositories/fileRepository.js";
import { discardUnrecordedObject } from "../../src/services/storedUpload.js";

/**
 * Compensa las cargas fallidas de los scripts de mantenimiento sin borrar archivos registrados.
 * Antes de eliminar cada objeto comprueba, con una conexión nueva, si alguna versión apunta a su
 * clave: ante un COMMIT de resultado incierto la fila puede existir y entonces el objeto se
 * conserva. Si la comprobación o el borrado fallan, el objeto se registra como candidato a huérfano.
 * Nunca lanza, para no ocultar el error original de la carga.
 *
 * @param {Iterable<string>} storageKeys - Claves transferidas por la ejecución fallida.
 * @param {string} scope - Tipo de carga, para los registros.
 * @returns {Promise<void>} Finaliza cuando todas las claves quedan compensadas o registradas.
 */
export async function discardUnrecordedScriptObjects(storageKeys, scope) {
  for (const key of new Set(storageKeys)) {
    await discardUnrecordedObject({ isRecorded: () => isFileVersionObjectRecorded(key), key, scope });
  }
}
