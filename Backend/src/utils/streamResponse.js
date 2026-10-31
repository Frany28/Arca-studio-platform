import { pipeline } from "node:stream/promises";

// Entrega segura de objetos almacenados (P0-2). `pipeline` destruye ambos extremos ante cualquier
// error o cierre: un fallo del almacenamiento a mitad de la transferencia ya no queda como evento
// `error` sin oyente (que terminaba el proceso), y una descarga cancelada por el navegador libera el
// socket hacia el almacenamiento en lugar de dejarlo abierto. Las respuestas parciales (Range) se
// entregan igual: el cuerpo recibido del almacenamiento ya es solo el rango pedido.

/**
 * Indica si la transferencia terminó porque el cliente se desconectó o canceló la descarga.
 * `pipeline` informa ese caso como cierre prematuro de la respuesta; es habitual (vídeos, visores
 * que se cierran) y no es un fallo del servidor, por lo que no se registra.
 *
 * @param {Error} error - Error con el que terminó la transferencia.
 * @returns {boolean} true si la causa fue el cliente.
 */
function isClientDisconnect(error) {
  return error?.code === "ERR_STREAM_PREMATURE_CLOSE";
}

/**
 * Transmite el cuerpo de un objeto almacenado a la respuesta HTTP y libera siempre ambos extremos.
 * Nunca lanza: tras empezar el envío ya no se puede responder con otro estado, así que los fallos del
 * almacenamiento se registran sin datos sensibles y la conexión se cierra de forma controlada.
 *
 * @param {import("node:stream").Readable} body - Cuerpo devuelto por el almacenamiento.
 * @param {import("express").Response} res - Respuesta con estado y cabeceras ya establecidos.
 * @param {string} resource - Tipo de recurso, solo para los registros.
 * @returns {Promise<boolean>} true si la transferencia terminó completa.
 */
export async function streamStoredObject(body, res, resource) {
  try {
    await pipeline(body, res);
    return true;
  } catch (error) {
    if (!isClientDisconnect(error)) {
      console.warn(JSON.stringify({
        code: error?.code || error?.name || "UNKNOWN",
        headersSent: res.headersSent,
        resource,
        type: "file_stream_failed",
      }));
    }
    return false;
  }
}
