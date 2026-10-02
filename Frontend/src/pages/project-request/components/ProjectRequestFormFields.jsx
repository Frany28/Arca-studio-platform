import { useId, useState } from "react";
import { ArrowDown2, InfoCircle } from "iconsax-react";
import clsx from "clsx";

import Checkbox from "../../../components/ui/Checkbox/Checkbox.jsx";
import DropdownMenu from "../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import { PROJECT_REQUEST_OPTIONS } from "../../../utils/projectRequestOptions.js";

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

function TextField({ children, containerClassName, error = "", icon: Icon, inputRef, invalid = false, label, multiline = false, optional = false, supportingContent, ...props }) {
  const controlClass = `w-full rounded-[8px] border bg-[var(--color-neutral-100)] px-[12px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)] outline-none transition focus:ring-2 placeholder:text-[var(--color-text-100)] ${invalid ? "border-[var(--color-danger-100)] focus:border-[var(--color-danger-100)] focus:ring-[var(--color-danger-10)]" : "border-[var(--color-neutral-200)] focus:border-[var(--color-primary-300)] focus:ring-[var(--color-primary-10)]"}`;

  return (
    <div className={clsx("flex w-full flex-col gap-[8px]", containerClassName)}>
      <FieldLabel optional={optional}>{label}</FieldLabel>
      <div className="relative flex w-full">
        {Icon ? <Icon className="absolute left-[12px] top-[8px] size-[20px] text-[var(--color-text-100)]" aria-hidden="true" /> : null}
        {multiline ? (
          <textarea ref={inputRef} className={`${controlClass} block min-h-[130px] resize-y py-[12px] ${Icon ? "pl-[40px]" : ""}`} required={!optional} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} {...props} />
        ) : (
          <input ref={inputRef} className={`${controlClass} block h-[36px] ${Icon ? "pl-[40px]" : ""}`} required={!optional} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} {...props} />
        )}
        {children}
      </div>
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
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

function ChoiceGroup({ error = "", invalid = false, label, value, options, onChange, info = false, optional = false, orientation = "horizontal" }) {
  const labelId = useId();

  return (
    <div role="group" aria-labelledby={labelId} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} aria-required={!optional} className="flex w-full flex-col gap-[8px]">
      <FieldLabel asSpan id={labelId} info={info} optional={optional}>{label}</FieldLabel>
      <div className={orientation === "vertical" ? "flex flex-col items-start gap-[8px]" : "flex flex-wrap gap-[8px]"}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`${orientation === "vertical" && value === option.value ? "h-[33px] py-[7px]" : "h-[36px] py-[8px]"} rounded-[8px] border px-[12px] text-[14px] font-medium leading-[17px] tracking-[-0.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)] ${value === option.value ? "border-transparent bg-[var(--color-neutral-200)] text-[var(--color-text-300)]" : invalid ? "border-[var(--color-danger-100)] bg-transparent text-[var(--color-text-100)]" : "border-[var(--color-neutral-200)] bg-transparent text-[var(--color-text-100)] hover:border-[var(--color-neutral-300)] hover:text-[var(--color-text-300)]"}`}
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

function LegalDocumentTypesField({ error = "", invalid = false, value, onChange, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredDocumentType, setHoveredDocumentType] = useState(null);
  const selectedValues = Array.isArray(value) ? value : [];
  const selectedLabels = PROJECT_REQUEST_OPTIONS.legalDocumentTypes
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);

  const toggleDocument = (documentType) => {
    const nextValues = selectedValues.includes(documentType)
      ? selectedValues.filter((valueToKeep) => valueToKeep !== documentType)
      : [...selectedValues, documentType];
    onChange(nextValues);
  };

  return (
    <div className="flex w-full flex-col gap-[8px]">
      <FieldLabel>Documentación disponible</FieldLabel>
      <div className="relative w-full">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          onClick={() => {
            setIsOpen((current) => !current);
            setHoveredDocumentType(null);
          }}
          className={clsx(
            "flex h-[37px] w-full items-center justify-between gap-[8px] rounded-[12px] border bg-[var(--color-neutral-100)] px-[12px] text-left text-[14px] text-[var(--color-text-300)] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)] disabled:cursor-not-allowed disabled:opacity-60",
            invalid ? "border-[var(--color-danger-100)]" : "border-[var(--color-neutral-200)]",
          )}
        >
          <span className="truncate">
            {selectedLabels.length ? selectedLabels.join(", ") : "Selecciona la documentación"}
          </span>
          <ArrowDown2
            size="18"
            color="currentColor"
            aria-hidden="true"
            className={clsx("shrink-0 transition-transform", isOpen && "rotate-180")}
          />
        </button>
        {isOpen && !disabled ? (
          <div
            role="listbox"
            aria-multiselectable="true"
            className="mt-[4px] flex w-full flex-col gap-[4px] rounded-[12px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[6px] shadow-[var(--shadow-e1)]"
          >
            {PROJECT_REQUEST_OPTIONS.legalDocumentTypes.map((option) => {
              const selected = selectedValues.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => toggleDocument(option.value)}
                  onMouseEnter={() => setHoveredDocumentType(option.value)}
                  onMouseLeave={() => setHoveredDocumentType(null)}
                  className={clsx(
                    "flex min-h-[32px] w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[6px] text-left text-[14px] text-[var(--color-text-300)] hover:bg-[var(--color-neutral-200)] focus-visible:bg-[var(--color-neutral-200)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
                    selected && "bg-[var(--color-neutral-200)]",
                  )}
                >
                  <Checkbox
                    checked={selected ? "Yes" : "No"}
                    size="S"
                    state={hoveredDocumentType === option.value ? "Hover" : undefined}
                  />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
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

function FormSection({ title, description, children, fieldsVariant = "stacked" }) {
  const fieldsClassName = fieldsVariant === "responsive-grid"
    ? "flex min-w-[214.5px] flex-1 flex-wrap items-start gap-[16px] [&>*]:min-w-[214.5px] [&>*]:basis-[214.5px] [&>*]:grow"
    : "flex w-full min-w-0 max-w-[445px] flex-col gap-[16px] min-[480px]:w-[445px]";

  return (
    <section className="flex w-full max-w-[850px] flex-wrap content-start items-start gap-[48px]">
      <div className="flex w-full min-w-0 flex-col gap-[16px] text-[var(--color-text-200)] min-[480px]:min-w-[300px] min-[480px]:w-[350px]">
        <h2 className="text-[16px] font-bold leading-[19px] tracking-[-0.5px]">{title}</h2>
        <p className="text-[14px] leading-[17px] tracking-[-0.5px]">{description}</p>
      </div>
      <div className={fieldsClassName}>{children}</div>
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
