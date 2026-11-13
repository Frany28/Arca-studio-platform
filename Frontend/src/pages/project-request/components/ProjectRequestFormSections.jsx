import { Edit2, Link21, Location } from "iconsax-react";

import HintText from "../../../components/ui/HintText/HintText.jsx";
import ProjectLocationSuggestions from "../../../components/ui/ProjectRequestFlow/ProjectLocationSuggestions.jsx";
import { hasApplicableProperty, requiresPropertyAvailability } from "../../../utils/projectRequestApplicability.js";
import { PROJECT_REQUEST_OPTIONS } from "../../../utils/projectRequestOptions.js";
import ProjectRequestAttachmentsField from "./ProjectRequestAttachmentsField.jsx";
import {
  CheckboxField,
  ChoiceGroup,
  FormDivider,
  FormSection,
  LegalDocumentTypesField,
  SelectField,
  TextField,
} from "./ProjectRequestFormFields.jsx";
import ProjectRequestStandSection from "./ProjectRequestStandSection.jsx";

/**
 * Secciones del formulario de solicitud de proyecto (detalles, stand, documentación legal,
 * viabilidad financiera, compatibilidad y referencias). Es el único formulario de solicitudes:
 * lo usan la creación del cliente (ProjectRequestPage) y la edición administrativa
 * (AdminProjectRequestEditPage), que solo cambian el encabezado, las acciones y la navegación.
 *
 * Las secciones condicionales se derivan del formulario: en Stand publicitario el inmueble no
 * aplica, y la sección legal solo se monta con inmueble aplicable y disponible
 * (useProjectRequestForm restablece sus valores al cambiar el tipo o la respuesta).
 *
 * @param {Object} props - Estado del formulario, ubicación y adjuntos.
 * @param {Object} props.attachments - Props de ProjectRequestAttachmentsField salvo `fileErrors`.
 * @param {Array<string>} props.fileErrors - Errores visibles de los adjuntos.
 * @param {Object} props.formState - Resultado de useProjectRequestForm.
 * @param {Object} props.locationSearch - Sugerencias de dirección (useAddressSuggestions) y `onSelect`.
 * @returns {import("react").ReactElement} Secciones del formulario.
 */
function ProjectRequestFormSections({ attachments, fileErrors, formState, locationSearch }) {
  const {
    fieldErrors,
    form,
    hasAttemptedSubmit,
    isLocationInputFocused,
    setIsLocationInputFocused,
    update,
    updateLandStatus,
    updateLegalDocumentationStatus,
    updateLocation,
  } = formState;
  const {
    error: locationSuggestionsError,
    hasSearched: hasSearchedLocation,
    isSearching: isLocationSearching,
    onSelect: selectLocationSuggestion,
    suggestions: locationSuggestions,
  } = locationSearch;
  // Estado derivado: en Stand publicitario el inmueble no aplica; en otros tipos la sección
  // legal depende de la respuesta sobre el terreno.
  const showLandStatusQuestion = requiresPropertyAvailability(form.projectType);
  const showPropertyLegalSection = hasApplicableProperty(form);

  return (
    <>
      <FormSection title="Detalles del proyecto" description="Cuéntanos qué deseas desarrollar. Esta información nos ayudará a comprender el alcance, los objetivos y las características generales de tu proyecto antes de la primera reunión.">
        <TextField error={hasAttemptedSubmit ? fieldErrors.projectName : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectName)} label="Nombre del proyecto" icon={Edit2} placeholder='Ej. “Apto. Noventa y Uno”' value={form.projectName} onChange={update("projectName", fileErrors)} />
        <SelectField error={hasAttemptedSubmit ? fieldErrors.projectType : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectType)} label="Tipo de proyecto" value={form.projectType} onChange={update("projectType", fileErrors)} options={PROJECT_REQUEST_OPTIONS.projectType} />
        <TextField
          error={hasAttemptedSubmit ? fieldErrors.location : ""}
          invalid={hasAttemptedSubmit && Boolean(fieldErrors.location)}
          label="Ubicación del proyecto"
          icon={Location}
          placeholder='Ej. “Maracaibo, Estado Zulia.”'
          value={form.location}
          onFocus={() => setIsLocationInputFocused(true)}
          onBlur={() => {
            window.setTimeout(() => setIsLocationInputFocused(false), 120);
          }}
          onChange={(event) => updateLocation(event, fileErrors)}
          onKeyDown={(event) => {
            // Escape cierra las sugerencias como los demás desplegables; el texto se conserva
            // y escribir de nuevo las vuelve a mostrar.
            if (event.key === "Escape" && isLocationInputFocused && locationSuggestions.length) {
              setIsLocationInputFocused(false);
            }
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={
            isLocationInputFocused && locationSuggestions.length > 0
          }
          containerClassName="relative z-20"
          supportingContent={
            isLocationSearching ? (
              <HintText
                state="Default"
                hintText="Buscando direcciones..."
                className="w-full"
                role="status"
              />
            ) : locationSuggestionsError ? (
              <HintText
                state="Error"
                hintText={locationSuggestionsError}
                className="w-full"
                role="alert"
              />
            ) : hasSearchedLocation && locationSuggestions.length === 0 ? (
              <HintText
                state="Default"
                hintText="No encontramos coincidencias. Puedes escribir una dirección más específica o continuar con la dirección manual."
                className="w-full"
                role="status"
              />
            ) : null
          }
        >
          {isLocationInputFocused && locationSuggestions.length ? (
            <ProjectLocationSuggestions
              suggestions={locationSuggestions}
              onSelect={selectLocationSuggestion}
            />
          ) : null}
        </TextField>
        <TextField error={hasAttemptedSubmit ? fieldErrors.description : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.description)} label="Descripción del proyecto" multiline minLength={30} maxLength={100} placeholder="Describe brevemente qué quieres lograr, dónde está el inmueble, y cualquier detalle relevante." value={form.description} onChange={update("description", fileErrors)} />
        <SelectField error={hasAttemptedSubmit ? fieldErrors.projectSize : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectSize)} label="Tamaño aproximado del proyecto" optional value={form.projectSize} onChange={update("projectSize", fileErrors)} options={PROJECT_REQUEST_OPTIONS.projectSize} />
        <SelectField error={hasAttemptedSubmit ? fieldErrors.developmentMode : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.developmentMode)} label="¿Cómo desea desarrollar el proyecto?" info value={form.developmentMode} onChange={update("developmentMode", fileErrors)} options={PROJECT_REQUEST_OPTIONS.developmentMode} />
        {showLandStatusQuestion ? (
          <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.landStatus : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.landStatus)} label="¿Tiene terreno o inmueble disponible?" value={form.landStatus} onChange={(status) => updateLandStatus(status, fileErrors)} options={PROJECT_REQUEST_OPTIONS.landStatus} />
        ) : null}
      </FormSection>

      <ProjectRequestStandSection form={form} fieldErrors={fieldErrors} hasAttemptedSubmit={hasAttemptedSubmit} update={update} fileErrors={fileErrors} />

      {/* Solo aplica con inmueble aplicable y disponible: se desmonta (no se oculta con CSS)
      y useProjectRequestForm restablece sus valores al cambiar el tipo o la respuesta. */}
      {showPropertyLegalSection ? (
        <>
          <FormDivider />

          <FormSection title="Documentación legal del inmueble" description="Por favor, proporciona detalles sobre el estado legal de la propiedad que deseas intervenir. Esta información es crucial para evaluar la viabilidad del proyecto y asegurarnos de que se cumplan todos los requisitos legales antes de proceder.">
            <SelectField error={hasAttemptedSubmit ? fieldErrors.legalDocumentationStatus : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.legalDocumentationStatus)} label="¿Cuenta con documentación que acredite la situación legal del inmueble?" value={form.legalDocumentationStatus} onChange={(status) => updateLegalDocumentationStatus(status, fileErrors)} options={PROJECT_REQUEST_OPTIONS.legalDocumentationStatus} />
            <LegalDocumentTypesField error={hasAttemptedSubmit ? fieldErrors.legalDocumentTypes : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.legalDocumentTypes)} value={form.legalDocumentTypes} onChange={update("legalDocumentTypes", fileErrors)} disabled={form.legalDocumentationStatus !== "available"} />
            <div className="flex w-full flex-col gap-[8px]">
              <SelectField error={hasAttemptedSubmit ? fieldErrors.multipleOwners : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.multipleOwners)} label="¿El inmueble tiene más de un propietario?" value={form.multipleOwners} onChange={update("multipleOwners", fileErrors)} options={PROJECT_REQUEST_OPTIONS.multipleOwners} />
              <HintText state="Default" hintText="La documentación podrá ser presentada posteriormente durante la reunión inicial." className="w-full" />
            </div>
            <div className="border-t border-[var(--color-neutral-200)] pt-[12px]">
              <CheckboxField label="¿Dispone de planos del lugar?" value={form.hasBlueprints} onChange={update("hasBlueprints", fileErrors)} />
            </div>
          </FormSection>
        </>
      ) : null}

      <FormDivider />

      <FormSection title="Viabilidad financiera" description="Conocer el presupuesto y la disponibilidad del capital nos permite proponerte soluciones acordes.">
        <SelectField error={hasAttemptedSubmit ? fieldErrors.investmentRange : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.investmentRange)} label="Rango de inversión estimado" value={form.investmentRange} onChange={update("investmentRange", fileErrors)} options={PROJECT_REQUEST_OPTIONS.investmentRange} />
        <SelectField error={hasAttemptedSubmit ? fieldErrors.capitalAvailability : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.capitalAvailability)} label="Disponibilidad del capital" value={form.capitalAvailability} onChange={update("capitalAvailability", fileErrors)} options={PROJECT_REQUEST_OPTIONS.capitalAvailability} />
      </FormSection>

      <FormDivider />

      <FormSection title="Compatibilidad" description="Estas preguntas nos ayudan a conocer tus expectativas, tiempos y experiencia previa para ofrecerte un proceso de trabajo más personalizado y eficiente.">
        <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.startTime : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.startTime)} label="¿Cuándo espera iniciar el proyecto?" value={form.startTime} onChange={update("startTime", fileErrors)} options={PROJECT_REQUEST_OPTIONS.startTime} />
        <SelectField error={hasAttemptedSubmit ? fieldErrors.decisionMaker : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.decisionMaker)} label="¿Quién toma la decisión final del proyecto?" optional value={form.decisionMaker} onChange={update("decisionMaker", fileErrors)} options={PROJECT_REQUEST_OPTIONS.decisionMaker} />
        <SelectField error={hasAttemptedSubmit ? fieldErrors.quality : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.quality)} label="Expectativa de estilo / nivel de calidad" optional info value={form.quality} onChange={update("quality", fileErrors)} options={PROJECT_REQUEST_OPTIONS.quality} />
        <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.experience : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.experience)} label="¿Ha trabajado con un arquitecto o diseñador antes?" optional value={form.experience} onChange={update("experience", fileErrors)} options={PROJECT_REQUEST_OPTIONS.experience} />
      </FormSection>

      <FormDivider />

      <FormSection title="Referencias" description="Comparte imágenes, enlaces o cualquier material de referencia que represente tu visión del proyecto. Esto nos ayudará a comprender mejor el estilo, la atmósfera y los acabados que deseas lograr.">
        <ProjectRequestAttachmentsField {...attachments} fileErrors={fileErrors} />
        <TextField error={hasAttemptedSubmit ? fieldErrors.referenceLink : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.referenceLink)} label="Link de referencia (Pinterest, web, etc.)" optional icon={Link21} placeholder='Ej. “https://es.pinterest.com/pin”' value={form.referenceLink} onChange={update("referenceLink", fileErrors)} />
      </FormSection>
    </>
  );
}

export default ProjectRequestFormSections;
