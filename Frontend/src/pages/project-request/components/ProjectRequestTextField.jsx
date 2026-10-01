import { FieldLabel } from "./FieldLabel.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import TextArea from "../../../components/ui/TextArea/TextArea.jsx";
import clsx from "clsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";

export function TextField({ children, containerClassName, error = "", icon: Icon, inputRef, invalid = false, label, multiline = false, optional = false, supportingContent, ...props }) {
  const controlClass = `w-full rounded-[8px] border bg-[var(--color-neutral-100)] px-[12px] text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)] outline-none transition focus:ring-2 placeholder:text-[var(--color-text-100)] ${invalid ? "border-[var(--color-danger-100)] focus:border-[var(--color-danger-100)] focus:ring-[var(--color-danger-10)]" : "border-[var(--color-neutral-200)] focus:border-[var(--color-primary-300)] focus:ring-[var(--color-primary-10)]"}`;

  return (
    <div className={clsx("flex w-full flex-col gap-[8px]", containerClassName)}>
      <FieldLabel optional={optional}>{label}</FieldLabel>
      <div className="relative flex w-full">
        {Icon ? <Icon className="absolute left-[12px] top-[8px] size-[20px] text-[var(--color-text-100)]" aria-hidden="true" /> : null}
        {multiline ? (
          <TextArea presentation="control" inputRef={inputRef} className={`${controlClass} block min-h-[130px] resize-y py-[12px] ${Icon ? "pl-[40px]" : ""}`} required={!optional} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} {...props} />
        ) : (
          <Input presentation="control" inputRef={inputRef} className={`${controlClass} block h-[36px] ${Icon ? "pl-[40px]" : ""}`} required={!optional} aria-invalid={invalid || undefined} aria-errormessage={invalid ? "project-request-required-alert" : undefined} {...props} />
        )}
        {children}
      </div>
      {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
      {supportingContent}
    </div>
  );
}
