import { PROJECT_REQUEST_OPTIONS } from "../../../../utils/projectRequestOptions.js";
import { isAdvertisingStand } from "../../../../utils/projectRequestStand.js";
import RequestDetailField from "./RequestDetailField.jsx";

/**
 * Presenta declaraciones del cliente sobre el evento, sin tratarlas como verificaciones.
 * Distingue información no aplicable de respuestas aún no registradas o no cargadas.
 * @param {Object} props - Tipo de proyecto, información declarada y carga parcial.
 * @returns {import("react").ReactElement} Detalle informativo del stand.
 */
export default function AdminRequestStandRequirements({ projectType, standRequirements, isPartial }) {
  if (!isAdvertisingStand(projectType)) {
    return <dl className="m-0"><RequestDetailField label="Requisitos del stand">No aplica a este tipo de proyecto</RequestDetailField></dl>;
  }
  if (isPartial || !standRequirements) {
    return <dl className="m-0"><RequestDetailField label="Requisitos del stand">{isPartial ? "Información no disponible" : "Sin información registrada"}</RequestDetailField></dl>;
  }
  const optionLabel = (field, value) => PROJECT_REQUEST_OPTIONS[field].find((option) => option.value === value)?.label || "Sin respuesta";
  const documents = (standRequirements.documentTypes || []).map((value) => optionLabel("standDocumentTypes", value));
  return (
    <section aria-label="Requisitos del stand" className="flex flex-col gap-[16px]">
      <p className="text-body-4 m-0 text-[var(--color-text-100)]">Información declarada por el cliente, pendiente de revisión durante la reunión.</p>
      <dl className="m-0 flex flex-col gap-[24px]">
        <RequestDetailField label="Requisitos del evento">{optionLabel("standRequirementsStatus", standRequirements.requirementsStatus)}</RequestDetailField>
        <RequestDetailField label="Documentación disponible">{documents.length ? documents.join(", ") : "Sin documentos declarados"}</RequestDetailField>
        <RequestDetailField label="Espacio dentro del evento">{optionLabel("standSpaceStatus", standRequirements.spaceStatus)}</RequestDetailField>
        <RequestDetailField label="Medidas o plano del espacio asignado">{standRequirements.hasSpacePlans === true ? "Sí" : standRequirements.hasSpacePlans === false ? "No" : "Sin respuesta"}</RequestDetailField>
      </dl>
    </section>
  );
}
