import { useState } from "react";

import { formatReferenceVatRate } from "../../../../../../Backend/src/domain/quoteReferenceVat.js";
import Button from "../../../../components/ui/Button/Button.jsx";
import InfoHint from "../../../../components/ui/Tooltip/InfoHint.jsx";
import { formatDecimalMoney } from "../../utils/moneyFormat.js";

const REFERENCE_VAT_HINT = "Estimación informativa calculada sobre el total de servicios. No es una liquidación fiscal definitiva ni modifica las tarifas del tabulador.";
const PENDING_VAT_HINT = "Aún no hay una tasa de IVA configurada. La cotización se guardará sin IVA referencial; el total de servicios no cambia.";

/**
 * Importe para mostrar, o «—» si no puede calcularse (una línea inválida).
 *
 * @param {string|null} amount - Importe como texto decimal.
 * @returns {string} Importe formateado.
 */
function formatAmount(amount) {
  return amount === null ? "—" : formatDecimalMoney(amount, { alwaysShowCents: true });
}

/**
 * Resumen de importes bajo «Servicios incluidos», igual en crear y editar: total de servicios
 * (sin IVA), el IVA referencial con su porcentaje y una ayuda que aclara que es una estimación, y
 * el total estimado con IVA, separado del total de servicios. Los importes son la vista previa del
 * motor del backend (`calculateQuotePreview`) y cambian al editar cantidades o tarifas. Sin tasa
 * configurada, el IVA figura como pendiente de configuración en lugar de inventar un porcentaje.
 *
 * @param {Object} props - Importes y estado del IVA.
 * @param {{total: string|null, referenceVatAmount: string|null, estimatedTotalWithVat: string|null}} props.preview - Importes.
 * @param {{status: "loading"|"error"|"pending"|"ready", referenceVat: {rate: string}|null, retry: () => void}} props.vat - IVA aplicado.
 * @returns {import("react").ReactElement} Resumen.
 */
function QuoteAmountsSummary({ preview, vat }) {
  const [hintOpen, setHintOpen] = useState(false);
  const ready = vat.status === "ready";
  const vatLabel = ready ? `IVA referencial (${formatReferenceVatRate(vat.referenceVat.rate)} %)` : "IVA referencial";
  let vatValue = formatAmount(preview.referenceVatAmount);
  if (vat.status === "loading") vatValue = "Cargando…";
  else if (vat.status === "pending") vatValue = "Pendiente de configuración";
  else if (vat.status === "error") vatValue = "No disponible";

  return (
    <dl className="flex flex-col gap-[12px]" aria-live="polite" data-quote-amounts-summary>
      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px]">
        <dt className="text-heading-7 text-[var(--color-text-50)]">Total de servicios (sin IVA)</dt>
        <dd className="text-heading-4 text-[var(--color-text-50)] tabular-nums">{formatAmount(preview.total)}</dd>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px]">
        <dt className="flex items-center gap-[4px] text-heading-8 text-[var(--color-text-200)]">
          <span>{vatLabel}</span>
          <InfoHint
            label="Información sobre el IVA referencial"
            text={vat.status === "pending" ? PENDING_VAT_HINT : REFERENCE_VAT_HINT}
            open={hintOpen}
            onOpenChange={setHintOpen}
            data-reference-vat-hint
          />
        </dt>
        <dd className="flex items-center gap-[8px] text-heading-7 text-[var(--color-text-200)] tabular-nums">
          {vatValue}
          {vat.status === "error" ? (
            <Button theme="Primary" type="Ghost" size="S" fitContent showLeftIcon={false} showRightIcon={false} onClick={vat.retry}>
              Reintentar
            </Button>
          ) : null}
        </dd>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px]">
        <dt className="text-heading-8 text-[var(--color-text-200)]">Total estimado con IVA (informativo)</dt>
        <dd className="text-heading-6 text-[var(--color-text-300)] tabular-nums">{ready ? formatAmount(preview.estimatedTotalWithVat) : "—"}</dd>
      </div>
    </dl>
  );
}

export default QuoteAmountsSummary;
