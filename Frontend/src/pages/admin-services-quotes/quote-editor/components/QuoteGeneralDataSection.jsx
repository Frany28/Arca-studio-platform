import { Edit2, Profile } from "iconsax-react";
import { useState } from "react";

import { api } from "../../../../api/http.js";
import { useRemoteOptions } from "../hooks/useRemoteOptions.js";
import { PROJECT_KIND, describeExistingProjectMatch } from "../utils/quoteDraft.js";
import QuoteEntityTagField from "./QuoteEntityTagField.jsx";

/**
 * Consulta clientes activos para el selector de cliente.
 *
 * @param {{search?: string, limit: number, signal: AbortSignal}} query - Búsqueda.
 * @returns {Promise<Array<Object>>} Clientes.
 */
async function loadClients(query) {
  return (await api.quotes.listClients(query)).clients;
}

/**
 * Tag de un cliente: su nombre y la foto de su usuario de contacto, si existe.
 *
 * @param {{id: number, name: string, profilePhotoUrl?: string}} client - Cliente.
 * @returns {{id: number, label: string, avatarSrc: string}} Tag.
 */
function toClientTag(client) {
  return { avatarSrc: client.profilePhotoUrl || "", id: client.id, label: client.name };
}

/**
 * Tag de un proyecto: solo su nombre (Figma lo muestra sin avatar).
 *
 * @param {{id: number, name: string}} project - Proyecto.
 * @returns {{id: number, label: string}} Tag.
 */
function toProjectTag(project) {
  return { id: project.id, label: project.name };
}

/**
 * Aviso del campo de proyecto mientras se escribe un nombre nuevo (solo en el alta): pide elegir
 * la coincidencia exacta con un proyecto existente o confirma que se creará como Draft al guardar.
 *
 * @param {{newProjectName: string, exactMatch: Object|null}} projectField - Estado del campo.
 * @returns {{error: string, status: string}} Error o aviso informativo (vacíos si no aplica).
 */
function describeNewProjectName({ exactMatch, newProjectName }) {
  if (!newProjectName.trim()) return { error: "", status: "" };
  if (exactMatch) return { error: describeExistingProjectMatch(exactMatch), status: "" };
  return { error: "", status: "Se creará como proyecto Draft al guardar la cotización." };
}

/**
 * «Datos generales» del formulario (Figma 5771:449998): cliente registrado y proyecto de ese
 * cliente, ambos con búsqueda en la API. Los proyectos solo se consultan tras elegir el cliente y
 * cambiar de cliente retira el proyecto elegido o escrito (lo hace el borrador) y la búsqueda. En el
 * alta, un nombre que no corresponde a ningún proyecto se guarda como proyecto nuevo (Draft); la
 * selección de un proyecto existente es siempre explícita.
 *
 * @param {Object} props - Selección, errores y callbacks.
 * @param {Object|null} props.client - Cliente elegido.
 * @param {(client: Object|null) => void} props.onClientChange - Elige o retira el cliente.
 * @param {ReturnType<typeof import("../hooks/useQuoteProjectField.js").useQuoteProjectField>} props.projectField - Campo de proyecto.
 * @param {(project: Object|null) => void} props.onProjectChange - Elige o retira el proyecto.
 * @param {{clientId?: string, projectId?: string, newProjectName?: string}} props.errors - Errores de validación.
 * @param {boolean} props.disabled - Bloquea los campos durante el guardado.
 * @returns {import("react").ReactElement} Sección.
 */
function QuoteGeneralDataSection({ client, disabled, errors, onClientChange, onProjectChange, projectField }) {
  const [clientQuery, setClientQuery] = useState("");
  const clients = useRemoteOptions({ enabled: !client, load: loadClients, query: clientQuery });
  const newProject = describeNewProjectName(projectField);

  return (
    <section className="flex flex-col gap-[16px]" aria-labelledby="quote-general-data-title">
      <h2 id="quote-general-data-title" className="text-heading-5 text-[var(--color-text-300)]">Datos generales</h2>
      <div className="flex flex-wrap items-start gap-[24px]">
        <QuoteEntityTagField
          id="quote-client"
          label="Nombre del cliente"
          icon={<Profile size="20" color="currentColor" />}
          placeholder="Ej. “Leonel Pérez”"
          emptyMessage="No hay clientes activos que coincidan."
          selected={client}
          toTag={toClientTag}
          withAvatar
          remote={clients}
          query={clientQuery}
          onQueryChange={setClientQuery}
          onChange={(nextClient) => {
            projectField.resetSearch();
            onClientChange(nextClient);
          }}
          error={errors.clientId}
          disabled={disabled}
        />
        <QuoteEntityTagField
          id="quote-project"
          label="Nombre del proyecto"
          icon={<Edit2 size="20" color="currentColor" />}
          placeholder={client ? "Ej. “Apto. 910”" : "Selecciona primero el cliente"}
          emptyMessage="Este cliente no tiene proyectos que coincidan."
          selected={projectField.selectedProject}
          toTag={toProjectTag}
          withAvatar={false}
          remote={projectField.remote}
          query={projectField.query}
          onQueryChange={projectField.changeQuery}
          onChange={(project) => onProjectChange(project ? { id: project.id, kind: PROJECT_KIND.EXISTING, name: project.name } : null)}
          error={errors.projectId || errors.newProjectName || newProject.error}
          statusHint={newProject.status}
          explicitSelection
          disabled={disabled || !client}
        />
      </div>
    </section>
  );
}

export default QuoteGeneralDataSection;
