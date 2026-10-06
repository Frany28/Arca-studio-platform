import { useId, useState } from "react";
import { InfoCircle } from "iconsax-react";
import clsx from "clsx";

import Checkbox from "../../../components/ui/Checkbox/Checkbox.jsx";
import DropdownMenu from "../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import TextArea from "../../../components/ui/TextArea/TextArea.jsx";
import {
  fromLegalDocumentItems,
  getLegalDocumentsSummary,
  toLegalDocumentItems,
} from "../utils/projectRequestLegalDocuments.js";

function FieldLabel({ asSpan = false, children, optional = false, info = false, ...props }) {
  const content = (
    <>
      {children}{optional ? null : <span aria-hidden="true">*</span>}
      {info ? <InfoCircle size="18" color="currentColor" aria-hidden="true" /> : null}
    </>
  );
  const className = "flex items-center gap-[2px] text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)]";

  return asSpan
    ? <span {...props} className={className}>{content}</span>
    : <label {...props} className={className}>{content}</label>;
}

// Alto total del área de texto en Figma (130 px) menos su padding vertical de 12 + 12.
const DESCRIPTION_TEXTAREA_MIN_HEIGHT = 106;

/**
 * Campo de texto del formulario compuesto con los componentes compartidos `Input` y
 * `TextArea`, que aportan label asociado, estados hover/focus/error, icono y hint accesible.
 * `children` se ancla bajo el campo (p. ej. sugerencias de ubicación) y `supportingContent`
 * agrega ayudas propias del flujo después del hint de error.
 *
 * @param {Object} props - Etiqueta, valor, error y atributos nativos del control.
 * @param {string} [props.error] - Mensaje visible cuando el campo es inválido.
 * @param {import("react").ComponentType} [props.icon] - Icono Iconsax del lado izquierdo.
 * @param {boolean} [props.invalid] - Activa el estado Error.
 * @param {boolean} [props.multiline] - Usa `TextArea` en lugar de `Input`.
 * @param {boolean} [props.optional] - Omite el asterisco y el `required` nativo.
 * @returns {import("react").ReactElement} Campo completo.
 */
function TextField({ children, containerClassName, error = "", icon: Icon, invalid = false, label, multiline = false, optional = false, supportingContent, ...props }) {
  const errorProps = {
    hintText: error,
    showHint: Boolean(error),
    state: invalid ? "Error" : "Default",
    // La página enfoca el primer [aria-invalid="true"]; TextArea no lo deriva de state.
    "aria-invalid": invalid || undefined,
    "aria-errormessage": invalid ? "project-request-required-alert" : undefined,
  };

  return (
    <div className={clsx("flex w-full flex-col gap-[8px]", containerClassName)}>
      <div className="relative w-full">
        {multiline ? (
          <TextArea
            {...props}
            {...errorProps}
            label={label}
            required={!optional}
            showLabelInfo={false}
            minHeight={DESCRIPTION_TEXTAREA_MIN_HEIGHT}
            resize
            className="max-w-none"
          />
        ) : (
          <Input
            {...props}
            {...errorProps}
            label={label}
            required={!optional}
            showLabelInfo={false}
            showLeftIcon={Boolean(Icon)}
            leftIcon={Icon ? <Icon size="20" color="currentColor" aria-hidden="true" /> : null}
            showRightIcon={false}
            className="max-w-none"
          />
        )}
        {children}
      </div>
      {supportingContent}
    </div>
  );
}

function SelectField({ error = "", invalid = false, label, value, onChange, options, optional = false, info = false, placeholder = "Selecciona una opción" }) {
  const [isOpen, setIsOpen] = useState(false);
  const items = options.map((option) => ({
    id: option.value,
    label: option.label,
    supportingText: "",
    type: "Text",
  }));

  return (
    <div className="flex w-full flex-col gap-[8px]">
      <FieldLabel optional={optional} info={info}>{label}</FieldLabel>
      <DropdownMenu
        type="Text"
        label={options.find((option) => option.value === value)?.label || placeholder}
        supportingText=""
        items={items}
        selectedItemId={value}
        open={isOpen}
        onOpenChange={setIsOpen}
        onItemSelect={(item) => {
          onChange(item.id);
          setIsOpen(false);
        }}
        interactive
        triggerHeightClassName="h-[37px]"
        triggerWrapperClassName={invalid ? "!border-[var(--color-danger-100)]" : undefined}
        className="w-full max-w-none"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-errormessage={invalid ? "project-request-required-alert" : undefined}
        aria-required={!optional}
      />
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
    </div>
  );
}

function ChoiceGroup({ error = "", invalid = false, label, value, options, onChange, info = false, optional = false }) {
  const labelId = useId();

  return (
    <div role="group" aria-labelledby={labelId} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} aria-required={!optional} className="flex w-full flex-col gap-[8px]">
      <FieldLabel asSpan id={labelId} info={info} optional={optional}>{label}</FieldLabel>
      <div className="flex flex-wrap gap-[8px]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`h-[36px] py-[8px] rounded-[8px] border px-[12px] text-[14px] font-medium leading-[17px] tracking-[-0.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)] ${value === option.value ? "border-transparent bg-[var(--color-neutral-200)] text-[var(--color-text-300)]" : invalid ? "border-[var(--color-danger-100)] bg-transparent text-[var(--color-text-100)]" : "border-[var(--color-neutral-200)] bg-transparent text-[var(--color-text-100)] hover:border-[var(--color-neutral-300)] hover:text-[var(--color-text-300)]"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
    </div>
  );
}

function CheckboxField({ label, value, onChange }) {
  return (
    <div className="flex h-[41px] w-full items-center justify-between gap-[16px]">
      <FieldLabel optional>{label}</FieldLabel>
      <Checkbox
        checked={value}
        size="S"
        interactive
        aria-label={label}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/**
 * Selección múltiple de documentos legales con `DropdownMenu` (ítems Checkbox), el patrón
 * del sistema para opciones múltiples. Es obligatoria solo cuando el usuario declara tener
 * documentación disponible; en los demás estados se deshabilita y no muestra asterisco.
 *
 * @param {Object} props - Valores, error y habilitación.
 * @param {Array<string>} props.value - Documentos marcados.
 * @param {(values: Array<string>) => void} props.onChange - Recibe la nueva selección.
 * @param {boolean} props.disabled - true si la documentación no está disponible.
 * @returns {import("react").ReactElement} Campo de documentos.
 */
function LegalDocumentTypesField({ error = "", invalid = false, value, onChange, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const labelId = useId();

  return (
    <div className="flex w-full flex-col gap-[8px]">
      <FieldLabel asSpan id={labelId} optional={disabled}>Documentación disponible</FieldLabel>
      <DropdownMenu
        type="Text"
        label={getLegalDocumentsSummary(value)}
        supportingText=""
        items={toLegalDocumentItems(value)}
        multiple
        disabled={disabled}
        open={isOpen}
        onOpenChange={setIsOpen}
        onItemsChange={(items) => onChange(fromLegalDocumentItems(items))}
        interactive
        rowHeightClassName="h-[35px]"
        triggerHeightClassName="h-[37px]"
        triggerWrapperClassName={invalid ? "!border-[var(--color-danger-100)]" : undefined}
        className="w-full max-w-none"
        aria-label="Documentación disponible"
        aria-invalid={invalid || undefined}
        aria-errormessage={invalid ? "project-request-required-alert" : undefined}
        aria-required={!disabled}
      />
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
    </div>
  );
}

function FormDivider() {
  return (
    <div aria-hidden="true" className="relative h-0 w-full">
      <span className="absolute inset-x-0 top-0 h-px bg-[var(--color-neutral-200)]" />
    </div>
  );
}

/**
 * Sección del formulario: descripción a la izquierda y campos a la derecha (Figma 401 | 48 | 401).
 * Ambas columnas parten de 401 px y crecen; cuando el contenedor no alcanza 850 px se apilan
 * a ancho completo, sin breakpoints propios ni scroll horizontal.
 *
 * @param {Object} props - Título, descripción y campos.
 * @returns {import("react").ReactElement} Sección semántica.
 */
function FormSection({ title, description, children }) {
  return (
    <section className="flex w-full max-w-[850px] flex-wrap content-start items-start gap-[48px]">
      <div className="flex min-w-0 flex-[1_1_401px] flex-col gap-[16px] text-[var(--color-text-200)]">
        <h2 className="text-[16px] font-bold leading-[19px] tracking-[-0.5px]">{title}</h2>
        <p className="text-[14px] leading-[17px] tracking-[-0.5px]">{description}</p>
      </div>
      <div className="flex min-w-0 flex-[1_1_401px] flex-col gap-[16px]">{children}</div>
    </section>
  );
}

export {
  CheckboxField,
  ChoiceGroup,
  FieldLabel,
  FormDivider,
  FormSection,
  LegalDocumentTypesField,
  SelectField,
  TextField,
};
