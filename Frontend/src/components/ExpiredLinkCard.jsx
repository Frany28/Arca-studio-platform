import group1Logo from "../assets/logos/Group 1.svg";
import Button from "./ui/Button/Button.jsx";

/**
 * Tarjeta de enlace vencido de las páginas de autenticación. Sin `onRequestNewLink` (p. ej. la
 * activación, cuyo enlace reenvía ARCA Studio) no ofrece pedir otro y muestra `requestHint`.
 *
 * @param {Object} props - Textos y acciones.
 * @param {string} props.description - Motivo del vencimiento.
 * @param {() => void} [props.onRequestNewLink] - Pide un enlace nuevo; sin él no se muestra la acción.
 * @param {() => void} props.onReturnToLogin - Vuelve al inicio de sesión.
 * @param {string} [props.requestHint] - Cómo obtener un enlace nuevo.
 * @returns {import("react").ReactElement} Tarjeta.
 */
function ExpiredLinkCard({ description, onRequestNewLink, onReturnToLogin, requestHint = "Puedes solicitar uno nuevo en cualquier momento." }) {
  return (
    <section className="box-border flex w-full max-w-[688px] shrink-0 items-center rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)]">
      <div className="flex w-full flex-col items-start justify-center gap-[16px] p-[24px] sm:p-[40px] lg:p-[56px]">
        <div className="flex w-full flex-col items-start gap-[8px] border-b border-[var(--color-neutral-200)] pb-[16px]">
          <img src={group1Logo} alt="ARCA Studio" className="h-[48px] w-[50.64px] object-contain" />
          <h1 className="text-heading-3 m-0 text-[var(--color-text-300)] max-sm:text-[36px] max-sm:leading-[42px]">
            El enlace ha expirado
          </h1>
        </div>

        <div className="flex w-full flex-col gap-[4px] text-[var(--color-text-300)]">
          <p className="text-heading-6 m-0">{description}</p>
          <p className="text-body-2 m-0">{requestHint}</p>
        </div>

        <div className="flex w-full flex-col gap-[8px] sm:flex-row">
          <Button theme="Primary" type="Outline" size="L" fitContent={false} showLeftIcon={false} showRightIcon={false} className="w-full sm:flex-1" onClick={onReturnToLogin}>
            Volver al inicio de sesión
          </Button>
          {onRequestNewLink ? (
            <Button theme="Primary" type="Solid" size="L" fitContent={false} showLeftIcon={false} showRightIcon={false} className="w-full sm:flex-1" onClick={onRequestNewLink}>
              Solicitar nuevo enlace
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default ExpiredLinkCard;
