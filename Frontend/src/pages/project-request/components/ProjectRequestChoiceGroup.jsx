import { FieldLabel } from "./FieldLabel.jsx";
import { useId } from "react";
import Button from "../../../components/ui/Button/Button.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";

export function ChoiceGroup({
  error = "",
  invalid = false,
  label,
  value,
  options,
  onChange,
  info = false,
  optional = false,
  orientation = "horizontal",
}) {
  const labelId = useId();

  return (
    <div role="group" aria-labelledby={labelId} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} aria-required={!optional} className="flex w-full flex-col gap-[8px]">
      <FieldLabel asSpan id={labelId} info={info} optional={optional}>{label}</FieldLabel>
      <div className={orientation === "vertical" ? "flex flex-col items-start gap-[8px]" : "flex flex-wrap gap-[8px]"}>
        {options.map((option) => (
          <Button layout="content"
            key={option.value}
            htmlType="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`${orientation === "vertical" && value === option.value ? "h-[33px] py-[7px]" : "h-[36px] py-[8px]"} rounded-[8px] border px-[12px] text-[14px] font-medium leading-[17px] tracking-[-0.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)] ${value === option.value ? "border-transparent bg-[var(--color-neutral-200)] text-[var(--color-text-300)]" : invalid ? "border-[var(--color-danger-100)] bg-transparent text-[var(--color-text-100)]" : "border-[var(--color-neutral-200)] bg-transparent text-[var(--color-text-100)] hover:border-[var(--color-neutral-300)] hover:text-[var(--color-text-300)]"}`}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
    </div>
  );
}
