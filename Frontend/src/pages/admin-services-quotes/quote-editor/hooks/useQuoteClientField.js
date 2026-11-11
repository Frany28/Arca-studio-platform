import { useState } from "react";

import { api } from "../../../../api/http.js";
import { clientNameKey } from "../../../../../../Backend/src/domain/clientName.js";
import { CLIENT_KIND, NO_ACKNOWLEDGED_MATCHES, isNewClient } from "../utils/quoteDraft.js";
import { useRemoteOptions } from "./useRemoteOptions.js";

/**
 * Lee clientes activos para el selector de la cotización.
 *
 * @param {{search?: string, limit: number, signal: AbortSignal}} query - Búsqueda y cancelación.
 * @returns {Promise<Array<Object>>} Clientes.
 */
async function loadClients(query) {
  return (await api.quotes.listClients(query)).clients;
}

/**
 * Lee las personas registradas con un nombre igual o parecido al escrito.
 *
 * @param {{search?: string, signal: AbortSignal}} query - Nombre escrito y cancelación.
 * @returns {Promise<Array<Object>>} Coincidencias, exactas primero.
 */
async function loadMatches({ search, signal }) {
  return (await api.quotes.listClientMatches({ name: search, signal })).matches;
}

/**
 * Estado del campo «Nombre del cliente». El cliente vive en el borrador: uno existente elegido en
 * las sugerencias o, solo en el alta, el nombre escrito de uno nuevo (`{kind: "new", name}`) que el
 * backend registra con una cuenta pendiente al guardar (nunca al escribir). Mientras se escribe un
 * nombre nuevo se consultan las coincidencias (mayúsculas, acentos y espacios no cuentan) para
 * advertir de posibles duplicados; la confirmación se pide al guardar. En la edición el texto es solo
 * una búsqueda local.
 *
 * @param {Object} params - Borrador y modo.
 * @param {boolean} params.allowNewClient - Permite escribir un cliente nuevo (solo en el alta).
 * @param {Object|null} params.client - Cliente del borrador.
 * @param {(client: Object|null) => void} params.onClientChange - Cambia el cliente del borrador.
 * @returns {{query: string, remote: Object, selectedClient: Object|null, newClientName: string,
 *   matches: {options: Array<Object>, loading: boolean, error: string}, changeQuery: (text: string) => void}} Estado y acciones.
 */
export function useQuoteClientField({ allowNewClient, client, onClientChange }) {
  const [search, setSearch] = useState("");
  const selectedClient = client && !isNewClient(client) ? client : null;
  const newClientName = isNewClient(client) ? client.name : "";
  const query = allowNewClient ? newClientName : search;
  const remote = useRemoteOptions({ enabled: !selectedClient, load: loadClients, query });
  const matches = useRemoteOptions({
    enabled: allowNewClient && clientNameKey(newClientName).length >= 2,
    load: loadMatches,
    query: newClientName,
  });

  return {
    changeQuery(text) {
      if (!allowNewClient) {
        setSearch(text);
        return;
      }
      // Escribir otro nombre descarta las confirmaciones de coincidencias del nombre anterior.
      onClientChange(text.trim() ? { acknowledged: NO_ACKNOWLEDGED_MATCHES, kind: CLIENT_KIND.NEW, name: text } : null);
    },
    matches,
    newClientName,
    query,
    remote,
    selectedClient,
  };
}
