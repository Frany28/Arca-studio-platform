import { InfoCircle } from "iconsax-react";

export function FieldLabel({ asSpan = false, children, optional = false, info = false, ...props }) {
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
