import Button from "../../../components/ui/Button/Button.jsx";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowDown2, ArrowUp2 } from "iconsax-react";

import Badge from "../../../components/ui/Badge/Badge.jsx";
import DropdownMenu from "../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import Tooltip from "../../../components/ui/Tooltip/Tooltip.jsx";
import {
  PROJECT_WARRANTIES,
  PROJECT_WARRANTY_FILTER_ITEMS,
} from "../projectWarrantyData.js";

function WarrantyChevronIcon({ expanded }) {
  const Icon = expanded ? ArrowUp2 : ArrowDown2;

  return (
    <Icon
      size={20}
      variant="Linear"
      color="currentColor"
      aria-hidden="true"
    />
  );
}

function WarrantySearchInput({ value, onChange, disabled = false }) {
  return (
    <Input
      type="Search bar"
      size="M"
      value={value}
      onChange={onChange}
      disabled={disabled}
      showLabel={false}
      showHint={false}
      showRightIcon={false}
      required={false}
      placeholder="Buscar..."
      className="w-full max-w-[320px] shrink-0 gap-0"
      inputClassName="font-medium"
      aria-label="Buscar garantías"
    />
  );
}

function WarrantyFilterMenu({
  filters,
  selectedFilterId,
  selectedFilter,
  onSelect,
  disabled = false,
}) {
  return (
    <DropdownMenu
      type="Text"
      label="Filtrar por:"
      supportingText=""
      items={filters.map((item) => ({ ...item, type: "Text" }))}
      selectedItemId={selectedFilterId}
      onItemSelect={(item) => onSelect(item.id)}
      interactive={!disabled}
      className={clsx("w-full max-w-[320px] shrink-0", disabled && "opacity-60")}
      triggerClassName={disabled ? "cursor-not-allowed bg-[var(--color-neutral-200)]" : undefined}
      triggerHeightClassName="h-[40px]"
      triggerPaddingXClassName="px-[8px]"
      contentPaddingClassName="px-[8px] pb-[8px] pt-[6px]"
      aria-label={`Filtrar garantías${selectedFilter ? `: ${selectedFilter.label}` : ""}`}
    />
  );
}

function WarrantyDateBadge({ children }) {
  return <Badge label={children} theme="Neutral" size="S" variation="Simple" />;
}

function WarrantyField({ children, className }) {
  return (
    <span
      className={clsx(
        "min-w-0 flex-1 truncate text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

function WarrantyRow({ warranty, expanded, onToggle }) {
  const detailsId = `${warranty.id}-warranty-details`;

  return (
    <article className="flex w-full flex-col">
      <div className="grid min-h-[56px] grid-cols-[minmax(160px,1fr)_minmax(100px,1fr)_minmax(140px,1fr)_minmax(170px,1fr)_auto_auto] items-center gap-[20px] border-b border-[var(--color-neutral-200)] py-[12px] max-lg:grid-cols-[minmax(150px,1.2fr)_minmax(90px,0.8fr)_minmax(140px,1fr)_auto_auto] max-md:grid-cols-[minmax(0,1fr)_auto]">
        <WarrantyField>{warranty.item}</WarrantyField>
        <WarrantyField className="max-md:hidden">{warranty.code}</WarrantyField>
        <WarrantyField className="max-lg:hidden">{warranty.serial}</WarrantyField>
        <WarrantyField className="max-md:hidden">{warranty.period}</WarrantyField>

        <Badge
          label={warranty.status}
          theme={warranty.statusTheme}
          size="S"
          variation="Simple"
          className="justify-self-end"
        />

        <Tooltip
          asChild
          portal
          showTip
          text={expanded ? "Contraer garantía" : "Expandir garantía"}
          tipPosition="Top right"
        >
          <Button layout="content"
            htmlType="button"
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-2)] text-[var(--color-text-200)] transition-colors hover:bg-[var(--color-neutral-10)] hover:text-[var(--color-text-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]"
            aria-label={expanded ? "Contraer garantía" : "Expandir garantía"}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={onToggle}
          >
            <WarrantyChevronIcon expanded={expanded} />
          </Button>
        </Tooltip>
      </div>

      {expanded ? (
        <div id={detailsId} className="flex w-full flex-col">
          {warranty.details.map((detail) => (
            <div
              key={`${warranty.id}-${detail.label}`}
              className="flex min-h-[44px] items-center justify-between gap-[20px] border-b border-[var(--color-neutral-200)] px-[56px] py-[12px] max-md:px-[16px]"
            >
              <span className="w-[262px] max-w-full text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)]">
                {detail.label}
              </span>
              <WarrantyDateBadge>{detail.value}</WarrantyDateBadge>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default function ProjectWarrantiesPanel({
  warranties = PROJECT_WARRANTIES,
  filters = PROJECT_WARRANTY_FILTER_ITEMS,
  empty = false,
}) {
  const resolvedWarranties = empty ? [] : warranties;
  const [query, setQuery] = useState("");
  const [selectedFilterId, setSelectedFilterId] = useState(filters[0]?.id);
  const [expandedIds, setExpandedIds] = useState(() => {
    return new Set(
      resolvedWarranties
        .filter((warranty) => warranty.defaultExpanded)
        .map((warranty) => warranty.id),
    );
  });

  const hasWarranties = resolvedWarranties.length > 0;
  const selectedFilter = filters.find((item) => item.id === selectedFilterId);
  const normalizedQuery = query.trim().toLowerCase();

  const visibleWarranties = useMemo(() => {
    return resolvedWarranties.filter((warranty) => {
      const matchesQuery = [
        warranty.item,
        warranty.code,
        warranty.serial,
        warranty.period,
        warranty.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

      const matchesFilter =
        selectedFilterId === "all" ||
        (selectedFilterId === "active" && warranty.status === "Activa") ||
        (selectedFilterId === "maintenance" && warranty.details?.length > 0) ||
        selectedFilterId === warranty.status?.toLowerCase();

      return matchesQuery && matchesFilter;
    });
  }, [normalizedQuery, selectedFilterId, resolvedWarranties]);

  function toggleWarranty(warrantyId) {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(warrantyId)) {
        next.delete(warrantyId);
      } else {
        next.add(warrantyId);
      }

      return next;
    });
  }

  return (
    <section className="flex w-full flex-col gap-[24px]" aria-label="Garantías">
      <div className="flex w-full flex-wrap items-start gap-[8px]">
        <WarrantySearchInput
          value={query}
          disabled={!hasWarranties}
          onChange={(event) => setQuery(event.target.value)}
        />

        <WarrantyFilterMenu
          filters={filters}
          selectedFilterId={selectedFilterId}
          selectedFilter={selectedFilter}
          disabled={!hasWarranties}
          onSelect={setSelectedFilterId}
        />
      </div>

      {visibleWarranties.length > 0 ? (
        <div className="flex w-full flex-col">
          {visibleWarranties.map((warranty) => (
            <WarrantyRow
              key={warranty.id}
              warranty={warranty}
              expanded={expandedIds.has(warranty.id)}
              onToggle={() => toggleWarranty(warranty.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          className="min-h-[360px]"
          title="No se encontraron garantías"
          description="Aún no hay información."
          showSecondaryAction={false}
        />
      )}
    </section>
  );
}
