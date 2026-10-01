import Button from "../../../../components/ui/Button/Button.jsx";
import { useState } from "react";
import DropdownMenu from "../../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import EmptyState from "../../../../components/ui/EmptyState.jsx";
import Tooltip from "../../../../components/ui/Tooltip/Tooltip.jsx";

const EMPTY_COMPARISON_ITEMS = [
  { id: "empty-comparison-left", label: "Levantamiento" },
  { id: "empty-comparison-right", label: "Render" },
];

function InfoCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path
        d="M9 5.8V9.55"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="9" cy="11.85" r="1" fill="white" />
    </svg>
  );
}

function ComparisonCard({ item }) {
  const [selectedItemId, setSelectedItemId] = useState(item.selectedOptionId);
  const selectedLabel =
    item.options.find((option) => option.id === selectedItemId)?.label ??
    item.options[0]?.label ??
    "";

  return (
    <article className="flex min-w-0 flex-1 flex-col gap-[12px]">
      <div className="relative h-[350px] w-full overflow-hidden rounded-[var(--radius-2)]">
        <img
          src={item.image}
          alt={item.title}
          className="h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.02)_0%,rgba(0,0,0,0.12)_40%,rgba(0,0,0,0.56)_100%)]" />
        <p className="absolute bottom-[10px] left-[10px] text-heading-8 text-[var(--color-neutral-100-uniform)]">
          {item.title}
        </p>
      </div>

      <DropdownMenu
        type="Text"
        label={selectedLabel}
        supportingText=""
        items={item.options}
        selectedItemId={selectedItemId}
        onItemSelect={(option) => setSelectedItemId(option.id)}
        interactive
        className="w-full max-w-[320px]"
        aria-label={`Etapa para ${item.title}`}
      />
    </article>
  );
}

function EmptyComparisonCard({ item }) {
  return (
    <article className="flex min-w-0 flex-1 flex-col gap-[12px]">
      <div className="relative flex h-[350px] w-full items-center justify-center overflow-hidden rounded-[var(--radius-2)]">
        <EmptyState title="Título Principal" showSecondaryAction={false} />
      </div>

      <DropdownMenu
        type="Text"
        label={item.label}
        supportingText=""
        items={[{ id: item.id, label: item.label, type: "Text" }]}
        selectedItemId={item.id}
        interactive={false}
        className="w-full max-w-[320px] opacity-60"
        triggerClassName="cursor-not-allowed bg-[var(--color-neutral-200)] text-[var(--color-text-100)]"
        aria-label={`${item.label} sin información`}
      />
    </article>
  );
}

export default function ProjectTrackingComparisonGallery({ items = [] }) {
  const hasItems = Array.isArray(items) && items.length > 0;

  return (
    <section className="flex w-full flex-col gap-[16px]">
      <div className="flex items-center">
        <div className="inline-flex items-center gap-[2px]">
          <span className="text-heading-8 tracking-[-0.5px] text-[var(--color-text-300)]">
            Comparativa de resultados
          </span>
          <Tooltip
            asChild
            text="Compara las distintas etapas del proyecto."
            showTip
            portal
            tipPosition="Top center"
          >
            <Button layout="content"
              htmlType="button"
              className="inline-flex size-[18px] cursor-help items-center justify-center text-[var(--color-text-100)]"
              aria-label="Información sobre comparativa"
            >
              <InfoCircleIcon className="size-[15px] shrink-0" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        {hasItems
          ? items.map((item) => <ComparisonCard key={item.id} item={item} />)
          : EMPTY_COMPARISON_ITEMS.map((item) => (
              <EmptyComparisonCard key={item.id} item={item} />
            ))}
      </div>
    </section>
  );
}
