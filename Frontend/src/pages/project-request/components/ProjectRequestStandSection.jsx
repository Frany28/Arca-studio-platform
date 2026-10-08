import { PROJECT_REQUEST_OPTIONS } from "../../../utils/projectRequestOptions.js";
import { isAdvertisingStand } from "../../../utils/projectRequestStand.js";
import { CheckboxField, DocumentTypesField, FormDivider, FormSection, SelectField } from "./ProjectRequestFormFields.jsx";

/**
 * Presenta la sección de Figma exclusivamente para el identificador de Stand publicitario.
 * Compone los controles existentes; los datos y la limpieza pertenecen al hook del formulario.
 * @param {Object} props - Formulario, errores visibles y acción compartida de edición.
 * @returns {import("react").ReactElement|null} Sección aplicable con su divisor.
 */
export default function ProjectRequestStandSection({ form, fieldErrors, hasAttemptedSubmit, update, fileErrors }) {
  if (!isAdvertisingStand(form.projectType)) return null;
  const errorProps = (field) => ({
    error: hasAttemptedSubmit ? fieldErrors[field] : "",
    invalid: hasAttemptedSubmit && Boolean(fieldErrors[field]),
  });

  return (
    <>
      <FormDivider />
      <FormSection title="Requisitos del stand" description="Indícanos las normas o requisitos del evento que puedan afectar el diseño y montaje del stand. Podrás presentar la documentación disponible durante la reunión.">
        <SelectField {...errorProps("standRequirementsStatus")} label="¿El evento cuenta con normas o requisitos para el montaje del stand?" optional info value={form.standRequirementsStatus} options={PROJECT_REQUEST_OPTIONS.standRequirementsStatus} onChange={update("standRequirementsStatus", fileErrors)} />
        <DocumentTypesField {...errorProps("standDocumentTypes")} value={form.standDocumentTypes} options={PROJECT_REQUEST_OPTIONS.standDocumentTypes} required={false} truncateLabel inlineMenu disabled={form.standRequirementsStatus !== "available"} onChange={update("standDocumentTypes", fileErrors)} />
        <SelectField {...errorProps("standSpaceStatus")} label="¿Ya tienes asignado el espacio dentro del evento?" value={form.standSpaceStatus} options={PROJECT_REQUEST_OPTIONS.standSpaceStatus} onChange={update("standSpaceStatus", fileErrors)} />
        <div className="border-t border-[var(--color-neutral-200)] py-[12px]">
          <CheckboxField className="!h-auto" label="¿Tienes las medidas o plano del espacio asignado?" value={form.hasStandSpacePlans} onChange={update("hasStandSpacePlans", fileErrors)} />
        </div>
      </FormSection>
    </>
  );
}
