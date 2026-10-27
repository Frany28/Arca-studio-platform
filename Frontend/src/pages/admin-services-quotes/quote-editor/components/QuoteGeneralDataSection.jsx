import { Edit2, Profile } from "iconsax-react";
import { useState } from "react";

import { api } from "../../../../api/http.js";
import { useRemoteOptions } from "../hooks/useRemoteOptions.js";
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
 * «Datos generales» del formulario (Figma 5771:449998): cliente registrado y proyecto de ese
 * cliente, ambos con búsqueda en la API. Los proyectos solo se consultan tras elegir el cliente y
 * cambiar de cliente retira el proyecto elegido (lo hace el borrador).
 *
 * @param {Object} props - Selección, errores y callbacks.
 * @param {Object|null} props.client - Cliente elegido.
 * @param {Object|null} props.project - Proyecto elegido.
 * @param {(client: Object|null) => void} props.onClientChange - Elige o retira el cliente.
 * @param {(project: Object|null) => void} props.onProjectChange - Elige o retira el proyecto.
 * @param {{clientId?: string, projectId?: string}} props.errors - Errores de validación.
 * @param {boolean} props.disabled - Bloquea los campos durante el guardado.
 * @returns {import("react").ReactElement} Sección.
 */
function QuoteGeneralDataSection({ client, disabled, errors, onClientChange, onProjectChange, project }) {
  const [clientQuery, setClientQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const clients = useRemoteOptions({ enabled: !client, load: loadClients, query: clientQuery });
  const projects = useRemoteOptions({
    enabled: Boolean(client) && !project,
    load: (query) => api.quotes.listClientProjects({ ...query, clientId: client.id }).then((payload) => payload.projects),
    query: projectQuery,
    scope: String(client?.id ?? ""),
  });

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
          onChange={onClientChange}
          error={errors.clientId}
          disabled={disabled}
        />
        <QuoteEntityTagField
          id="quote-project"
          label="Nombre del proyecto"
          icon={<Edit2 size="20" color="currentColor" />}
          placeholder={client ? "Ej. “Apto. 910”" : "Selecciona primero el cliente"}
          emptyMessage="Este cliente no tiene proyectos que coincidan."
          selected={project}
          toTag={toProjectTag}
          withAvatar={false}
          remote={projects}
          query={projectQuery}
          onQueryChange={setProjectQuery}
          onChange={onProjectChange}
          error={errors.projectId}
          disabled={disabled || !client}
        />
      </div>
    </section>
  );
}

export default QuoteGeneralDataSection;
