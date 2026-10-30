import { useState } from "react";

import { formatReferenceVatRate } from "../../../../../../Backend/src/domain/quoteReferenceVat.js";
import InfoHint from "../../../../components/ui/Tooltip/InfoHint.jsx";
import { formatDecimalMoney } from "../../utils/moneyFormat.js";

const REFERENCE_VAT_HINT = "Referencia informativa calculada sobre el total. No se suma al total de la cotización, no es una liquidación fiscal definitiva ni modifica las tarifas del tabulador.";
const NOT_APPLIED_VAT_HINT = "Esta cotización se guardó antes del IVA referencial y lo conserva sin calcular. El total de la cotización no cambia.";

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
 * Resumen de importes bajo «Servicios incluidos», igual en crear y editar: arriba, el IVA
 * referencial con su porcentaje y una ayuda que aclara que es solo una referencia; debajo, el
 * total de la cotización como importe principal. El IVA no se suma al total. Los importes son la
 * vista previa del motor del backend (`calculateQuotePreview`) y cambian al editar cantidades o
 * tarifas. Una cotización guardada antes del IVA referencial lo indica sin calcularlo.
 *
 * @param {Object} props - Importes e IVA aplicado.
 * @param {{total: string|null, referenceVatAmount: string|null}} props.preview - Importes.
 * @param {{enabled: boolean, rate: string|null}} props.referenceVat - IVA referencial aplicado.
 * @returns {import("react").ReactElement} Resumen.
 */
function QuoteAmountsSummary({ preview, referenceVat }) {
  const [hintOpen, setHintOpen] = useState(false);
  const applied = referenceVat.enabled;

  return (
    <dl className="flex flex-col gap-[12px]" aria-live="polite" data-quote-amounts-summary>
      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px]">
        <dt className="flex items-center gap-[4px] text-heading-8 text-[var(--color-text-200)]">
          <span>{applied ? `IVA referencial (${formatReferenceVatRate(referenceVat.rate)} %)` : "IVA referencial"}</span>
          <InfoHint
            label="Información sobre el IVA referencial"
            text={applied ? REFERENCE_VAT_HINT : NOT_APPLIED_VAT_HINT}
            open={hintOpen}
            onOpenChange={setHintOpen}
            data-reference-vat-hint
          />
        </dt>
        <dd className="text-heading-7 text-[var(--color-text-200)] tabular-nums">
          {applied ? formatAmount(preview.referenceVatAmount) : "No incluido en esta versión"}
        </dd>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px]">
        <dt className="text-heading-7 text-[var(--color-text-50)]">Total de la cotización</dt>
        <dd className="text-heading-4 text-[var(--color-text-50)] tabular-nums">{formatAmount(preview.total)}</dd>
      </div>
    </dl>
  );
}

export default QuoteAmountsSummary;
