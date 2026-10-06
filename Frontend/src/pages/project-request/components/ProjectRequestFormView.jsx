import { CloudPlus, Edit2, Link21, Location } from "iconsax-react";

import Button from "../../../components/ui/Button/Button.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import ProjectLocationSuggestions from "../../../components/ui/ProjectRequestFlow/ProjectLocationSuggestions.jsx";
import { PROJECT_REQUEST_OPTIONS } from "../../../utils/projectRequestOptions.js";
import {
  CheckboxField,
  ChoiceGroup,
  FieldLabel,
  FormDivider,
  FormSection,
  LegalDocumentTypesField,
  SelectField,
  TextField,
} from "./ProjectRequestFormFields.jsx";

/**
 * Renderiza exclusivamente la presentación del formulario de solicitud.
 * El estado, la validación, archivos y navegación permanecen en ProjectRequestPage
 * para que este componente no duplique reglas de negocio ni llamadas a la API.
 *
 * @param {Object} props - Estado y acciones ya coordinados por la página.
 * @param {Object} props.form - Valores actuales del formulario.
 * @param {Object} props.fieldErrors - Errores de validación por campo.
 * @param {boolean} props.hasAttemptedSubmit - Indica si deben mostrarse errores.
 * @param {Array} props.fileErrors - Errores actuales de los archivos.
 * @param {Array} props.files - Archivos seleccionados con su estado de carga.
 * @param {React.RefObject<HTMLFormElement>} props.formRef - Referencia al formulario.
 * @param {React.RefObject<HTMLInputElement>} props.fileInputRef - Input de archivos oculto.
 * @param {boolean} props.isSubmitting - Bloquea acciones mientras se envía.
 * @returns {import("react").ReactElement} Formulario completo de solicitud.
 */
export default function ProjectRequestFormView({
  fieldErrors,
  fileErrors,
  fileInputRef,
  files,
  form,
  formRef,
  handleFilesChange,
  handleFrontendSubmit,
  hasAttemptedSubmit,
  hasSearchedLocation,
  isLocationInputFocused,
  isLocationSearching,
  isSubmitting,
  locationSuggestions,
  locationSuggestionsError,
  requestReset,
  selectLocationSuggestion,
  setIsLocationInputFocused,
  update,
  updateLegalDocumentationStatus,
  updateLocation,
}) {
  return (
  <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
  <header className="flex w-full max-w-[850px] flex-wrap items-end justify-between gap-x-[24px] gap-y-[16px]">
    <div className="min-w-0">
      <h1 className="text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">Solicitud de proyecto</h1>
      <p className="mt-[4px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)] min-[768px]:text-[18px] min-[768px]:leading-[21px]">Cada proyecto merece ser el correcto.</p>
    </div>
    <p className="hidden shrink-0 text-right text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)] min-[480px]:block">Tiempo estimado<br />3–5 minutos</p>
  </header>

  <FormDivider />

  <form ref={formRef} noValidate className="flex w-full flex-col items-center gap-[48px]" onSubmit={(event) => { event.preventDefault(); handleFrontendSubmit(); }}>
    <FormSection title="Detalles del proyecto" description="Cuéntanos qué deseas desarrollar. Esta información nos ayudará a comprender el alcance, los objetivos y las características generales de tu proyecto antes de la primera reunión.">
      <TextField error={hasAttemptedSubmit ? fieldErrors.projectName : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectName)} label="Nombre del proyecto" icon={Edit2} placeholder='Ej. “Apto. Noventa y Uno”' value={form.projectName} onChange={update("projectName", fileErrors)} />
      <SelectField error={hasAttemptedSubmit ? fieldErrors.projectType : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectType)} label="Tipo de proyecto" value={form.projectType} onChange={update("projectType", fileErrors)} options={PROJECT_REQUEST_OPTIONS.projectType} />
      <TextField
        error={hasAttemptedSubmit ? fieldErrors.location : ""}
        invalid={hasAttemptedSubmit && Boolean(fieldErrors.location)}
        label="Ubicación del proyecto"
        icon={Location}
        placeholder='Ej. “Maracaibo, Estado Zulia”'
        value={form.location}
        onFocus={() => setIsLocationInputFocused(true)}
        onBlur={() => {
          window.setTimeout(() => setIsLocationInputFocused(false), 120);
        }}
        onChange={(event) => updateLocation(event, fileErrors)}
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
      <TextField error={hasAttemptedSubmit ? fieldErrors.description : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.description)} label="Descripción del proyecto" multiline minLength={30} maxLength={100} placeholder="Describe brevemente qué quieres lograr, dónde está el inmueble y cualquier detalle relevante." value={form.description} onChange={update("description", fileErrors)} />
      <SelectField error={hasAttemptedSubmit ? fieldErrors.projectSize : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.projectSize)} label="Tamaño aproximado del proyecto" optional value={form.projectSize} onChange={update("projectSize", fileErrors)} options={PROJECT_REQUEST_OPTIONS.projectSize} />
      <SelectField error={hasAttemptedSubmit ? fieldErrors.developmentMode : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.developmentMode)} label="¿Cómo prefiere desarrollar el proyecto?" info value={form.developmentMode} onChange={update("developmentMode", fileErrors)} options={PROJECT_REQUEST_OPTIONS.developmentMode} />
      <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.landStatus : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.landStatus)} label="¿Tiene terreno o inmueble disponible?" optional value={form.landStatus} onChange={update("landStatus", fileErrors)} options={PROJECT_REQUEST_OPTIONS.landStatus} />
    </FormSection>

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

    <FormDivider />

    <FormSection fieldsVariant="responsive-grid" title="Viabilidad financiera" description="Conocer tu presupuesto y la disponibilidad de capital nos permite proponerte soluciones acordes.">
      <SelectField error={hasAttemptedSubmit ? fieldErrors.investmentRange : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.investmentRange)} label="Rango de inversión estimado" value={form.investmentRange} onChange={update("investmentRange", fileErrors)} options={PROJECT_REQUEST_OPTIONS.investmentRange} />
      <SelectField error={hasAttemptedSubmit ? fieldErrors.capitalAvailability : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.capitalAvailability)} label="Disponibilidad de capital" value={form.capitalAvailability} onChange={update("capitalAvailability", fileErrors)} options={PROJECT_REQUEST_OPTIONS.capitalAvailability} />
    </FormSection>

    <FormDivider />

    <FormSection title="Compatibilidad" description="Estas preguntas nos ayudan a conocer tus expectativas, tiempos y experiencia previa para ofrecerte un proceso de trabajo más personalizado y eficiente.">
      <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.startTime : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.startTime)} label="¿Cuándo espera iniciar el proyecto?" orientation="vertical" value={form.startTime} onChange={update("startTime", fileErrors)} options={PROJECT_REQUEST_OPTIONS.startTime} />
      <SelectField error={hasAttemptedSubmit ? fieldErrors.decisionMaker : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.decisionMaker)} label="¿Quién toma la decisión final del proyecto?" optional value={form.decisionMaker} onChange={update("decisionMaker", fileErrors)} options={PROJECT_REQUEST_OPTIONS.decisionMaker} />
      <SelectField error={hasAttemptedSubmit ? fieldErrors.quality : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.quality)} label="Expectativa de estilo / nivel de calidad" optional info value={form.quality} onChange={update("quality", fileErrors)} options={PROJECT_REQUEST_OPTIONS.quality} />
      <ChoiceGroup error={hasAttemptedSubmit ? fieldErrors.experience : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.experience)} label="¿Ha trabajado con un arquitecto o diseñador antes?" optional value={form.experience} onChange={update("experience", fileErrors)} options={PROJECT_REQUEST_OPTIONS.experience} />
    </FormSection>

    <FormDivider />

    <FormSection title="Referencias" description="Comparte imágenes, enlaces o cualquier material de referencia que represente tu visión del proyecto. Esto nos ayudará a comprender mejor el estilo, la atmósfera y los acabados que deseas lograr.">
      <div className="flex flex-col gap-[8px]">
        <FieldLabel optional>Subir imágenes o archivos (opcional)</FieldLabel>
        <button type="button" disabled={isSubmitting} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFilesChange(event.dataTransfer.files); }} className="flex min-h-[177px] w-full flex-col items-center justify-center gap-[12px] rounded-[12px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[24px] py-[32px] text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)] disabled:cursor-not-allowed disabled:opacity-60 min-[480px]:h-[177px]">
          <span className="flex size-[40px] items-center justify-center rounded-[8px] border border-[var(--color-neutral-200)] text-[var(--color-text-100)] shadow-[var(--shadow-e1)]"><CloudPlus size="20" color="currentColor" /></span>
          <span className="flex w-full flex-col items-center gap-[8px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-100)]">
            <span className="flex min-h-[36px] flex-wrap items-center justify-center gap-[8px]">
              <span className="text-[var(--color-text-300)] underline">Elige un archivo</span>
              <span>O</span>
              <span>Arrastra y suelta</span>
            </span>
            <span>Formatos JPEG, PNG, PDF y MP4, hasta 50 MB.</span>
          </span>
        </button>
        <input ref={fileInputRef} type="file" multiple accept=".jpeg,.jpg,.png,.pdf,.mp4" className="sr-only" onChange={(event) => handleFilesChange(event.target.files)} />
        {files.length ? (
          <ul className="flex flex-col gap-[4px] text-[14px] text-[var(--color-text-200)]" aria-live="polite">
            {files.map((item) => <li key={item.id}>{item.file.name} · {item.status === "uploading" ? `${item.progress}%` : item.status === "uploaded" ? "Cargado" : item.status === "error" ? item.error : "Listo para cargar"}</li>)}
          </ul>
        ) : null}
        {fileErrors.map((error) => <HintText key={error} state="Error" hintText={error} className="w-full" role="alert" />)}
      </div>
      <TextField error={hasAttemptedSubmit ? fieldErrors.referenceLink : ""} invalid={hasAttemptedSubmit && Boolean(fieldErrors.referenceLink)} label="Links de referencia (Pinterest, web, etc.) (opcional)" optional icon={Link21} placeholder='Ej. “https://es.pinterest.com/pin”' value={form.referenceLink} onChange={update("referenceLink", fileErrors)} />
    </FormSection>

    <FormDivider />

    <div className="w-full max-w-[850px]">
      <p className="text-[16px] leading-[19px] tracking-[-0.5px] text-[var(--color-text-100)]">Al enviar este formulario, nuestro equipo revisará la información y se pondrá en contacto contigo en un plazo aproximado de 24–48 horas.</p>
    </div>
    <footer className="flex w-full max-w-[850px] flex-col-reverse gap-[8px] min-[480px]:flex-row min-[480px]:justify-end">
      <Button theme="Primary" type="Outline" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto" onClick={requestReset}>Limpiar formulario</Button>
      <Button disabled={isSubmitting} theme="Primary" type="Solid" htmlType="submit" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto">{isSubmitting ? "Enviando" : "Enviar"}</Button>
    </footer>
  </form>
  </div>
  );
}
