import { useId } from "react";

import Button from "../../../components/ui/Button/Button.jsx";
import { ADMIN_REQUEST_DECISION_ACTIONS } from "../../../utils/projectRequestAdminActions.js";

// Figma: en escritorio (≥1024) cada acción ajusta su ancho al texto en una sola fila. En tablet
// (3727:687677) y móvil (3727:687788) el resumen ocupa su fila, centrado con un máximo de 311 px,
// y debajo las acciones comparten el ancho (Rechazar ≥84 px, Aprobar ≥76 px); en móvil, Aprobar
// pasa a su propia fila a ancho completo.
//
// Ancho y posición: en todas las variantes la barra ocupa el contenedor principal completo (1364 px
// en escritorio, 948 en 1024, 638 en tablet vertical y 375 en móvil), no la columna de 1200 px, con
// la superficie a 24 px del borde (16 en móvil). Por eso es hija directa del contenedor de scroll del
// layout y usa `sticky bottom-0`: queda al pie del viewport mientras se desplaza el contenido y, al
// final, ocupa su propio espacio, de modo que nunca tapa el último contenido.
const WRAPPED_ACTION = "max-[1023px]:min-w-[84px] max-[1023px]:flex-1";
const WRAPPED_FIXED_ACTION = "max-[1023px]:shrink-0";

/**
 * Barra inferior fija de la consulta administrativa (Figma 3727:687292; tablet 3727:687677;
 * móvil 3727:687788; con «Crear cotización», 5749:491810): superficie `primary-10` translúcida
 * con desenfoque, radio 12 y padding 16. A la izquierda, «Ver resumen & recomendación»; a la
 * derecha, las acciones que permite el estado de la solicitud (`getAdminProjectRequestActions`):
 * Rechazar, Solicitar más información y Aprobar, o bien Ver proyecto y Crear cotización en una
 * solicitud convertida. Las decisiones solo abren el modal de confirmación del consumidor.
 *
 * @param {Object} props - Acciones disponibles.
 * @param {Function} props.onOpenSummary - Abre el drawer «Detalles de Solicitud».
 * @param {{disabled: boolean, notice: string}|null} [props.decisions] - Decisiones; null las oculta.
 * @param {(action: "reject"|"changes_requested"|"approve") => void} [props.onDecision] - Abre la decisión.
 * @param {Function|null} [props.onOpenProject] - Abre el proyecto creado; null lo oculta.
 * @param {Function|null} [props.onCreateQuote] - Inicia una cotización del proyecto; null la oculta.
 * @returns {import("react").ReactElement} Barra de acciones.
 */
function AdminProjectRequestActionBar({
  decisions = null,
  onCreateQuote = null,
  onDecision,
  onOpenProject = null,
  onOpenSummary,
}) {
  const noticeId = useId();
  const notice = decisions?.notice || "";
  const hasActions = Boolean(decisions || onOpenProject || onCreateQuote);

  return (
    <div className="sticky bottom-0 z-[5] w-full shrink-0 p-[16px] min-[768px]:p-[24px]">
      <div
        role="group"
        aria-label="Acciones de la solicitud"
        className="flex flex-wrap items-center justify-between gap-[16px] rounded-[var(--radius-3)] bg-[var(--color-primary-10)] p-[16px] backdrop-blur-[12px] max-[1023px]:items-start"
      >
        <div className="flex max-[1023px]:basis-full max-[1023px]:justify-center">
          <Button
            theme="Primary"
            type="Outline"
            size="M"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            aria-haspopup="dialog"
            className="max-[1023px]:!w-full max-[1023px]:max-w-[311px]"
            onClick={onOpenSummary}
          >
            Ver resumen &amp; recomendación
          </Button>
        </div>

        {hasActions ? (
          <div className="flex flex-wrap items-center gap-[16px] max-[1023px]:basis-full">
            {decisions
              ? ADMIN_REQUEST_DECISION_ACTIONS.map((action) => (
                  <Button
                    key={action.id}
                    theme={action.theme}
                    type={action.type}
                    size="M"
                    fitContent
                    showLeftIcon={false}
                    showRightIcon={false}
                    disabled={decisions.disabled}
                    aria-haspopup="dialog"
                    aria-describedby={notice ? noticeId : undefined}
                    className={action.id === "changes_requested" ? WRAPPED_FIXED_ACTION : WRAPPED_ACTION}
                    onClick={() => onDecision?.(action.id)}
                  >
                    {action.label}
                  </Button>
                ))
              : null}
            {onOpenProject ? (
              <Button
                theme="Primary"
                type="Outline"
                size="M"
                fitContent
                showLeftIcon={false}
                showRightIcon={false}
                className={WRAPPED_ACTION}
                onClick={onOpenProject}
              >
                Ver proyecto
              </Button>
            ) : null}
            {onCreateQuote ? (
              <Button
                theme="Primary"
                type="Solid"
                size="M"
                fitContent
                showLeftIcon={false}
                showRightIcon={false}
                className={WRAPPED_ACTION}
                onClick={onCreateQuote}
              >
                Crear cotización
              </Button>
            ) : null}
          </div>
        ) : null}

        {notice ? (
          <p id={noticeId} className="text-body-4 m-0 basis-full text-[var(--color-text-200)] min-[1024px]:text-right">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default AdminProjectRequestActionBar;
