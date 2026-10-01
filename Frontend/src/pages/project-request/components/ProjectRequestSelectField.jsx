import { FieldLabel } from "./FieldLabel.jsx";
import { useState } from "react";
import DropdownMenu from "../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";

export function SelectField({
  error = "",
  invalid = false,
  label,
  value,
  onChange,
  options,
  optional = false,
  info = false,
  placeholder = "Selecciona una opción",
}) {
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
