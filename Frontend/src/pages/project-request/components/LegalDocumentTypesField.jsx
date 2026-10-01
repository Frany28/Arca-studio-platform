import { FieldLabel } from "./FieldLabel.jsx";
import { useState } from "react";
import { ArrowDown2 } from "iconsax-react";
import clsx from "clsx";
import Button from "../../../components/ui/Button/Button.jsx";
import Checkbox from "../../../components/ui/Checkbox/Checkbox.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import { PROJECT_REQUEST_OPTIONS } from "../../../utils/projectRequestOptions.js";

export function LegalDocumentTypesField({
  error = "",
  invalid = false,
  value,
  onChange,
  disabled,
}) {
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
        <Button layout="content"
          htmlType="button"
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
        </Button>
        {isOpen && !disabled ? (
          <div
            role="listbox"
            aria-multiselectable="true"
            className="mt-[4px] flex w-full flex-col gap-[4px] rounded-[12px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[6px] shadow-[var(--shadow-e1)]"
          >
            {PROJECT_REQUEST_OPTIONS.legalDocumentTypes.map((option) => {
              const selected = selectedValues.includes(option.value);
              return (
                <Button layout="content"
                  key={option.value}
                  htmlType="button"
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
                </Button>
              );
            })}
          </div>
        ) : null}
      </div>
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
    </div>
  );
}
