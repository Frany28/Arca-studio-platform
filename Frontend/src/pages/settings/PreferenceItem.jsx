export default function PreferenceItem({
  icon,
  title,
  description,
  rightContent,
  className,
}) {
  return (
    <div
      className={`settings-form-section settings-preference-row flex items-center justify-between pb-[16px] ${className ?? ""}`}
    >
      <div className="flex min-w-0 items-center gap-[8px]">
        <div className="rounded-[8px] border border-[var(--color-neutral-200)] shadow-[var(--shadow-e1)]">
          <div className="flex size-[40px] items-center justify-center rounded-[8px] bg-[var(--color-neutral-100)] text-[var(--color-success-200)]">
            {icon}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-[2px]">
          <span className="text-heading-8 tracking-[-0.5px] text-[var(--color-text-300)]">
            {title}
          </span>
          <p className="text-body-4 tracking-[-0.5px] text-[var(--color-text-200)]">
            {description}
          </p>
        </div>
      </div>
      {rightContent}
    </div>
  );
}
