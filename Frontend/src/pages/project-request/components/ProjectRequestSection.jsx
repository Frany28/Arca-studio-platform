export function FormDivider() {
  return (
    <div aria-hidden="true" className="relative h-0 w-full">
      <span className="absolute inset-x-0 top-0 h-px bg-[var(--color-neutral-200)]" />
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
  fieldsVariant = "stacked",
}) {
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
