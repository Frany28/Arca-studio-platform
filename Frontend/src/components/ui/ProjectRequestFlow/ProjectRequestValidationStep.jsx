import Button from "../Button/Button.jsx";
import HintText from "../HintText/HintText.jsx";
import Input from "../Input/Input.jsx";
import ProjectRequestModalShell from "./ProjectRequestModalShell.jsx";

function SecurityIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10.0001 18.3333C9.32508 18.3333 8.65841 18.175 8.06675 17.8666L4.43341 16C2.82508 15.175 1.66675 13.3333 1.66675 11.525V6.39163C1.66675 5.34163 2.46675 4.14996 3.45008 3.75829L7.66675 2.03329C8.95008 1.50829 11.0584 1.50829 12.3417 2.03329L16.5584 3.75829C17.5334 4.15829 18.3417 5.34163 18.3417 6.39163V11.525C18.3417 13.3416 17.1834 15.175 15.5751 16L11.9417 17.8666C11.3417 18.175 10.6751 18.3333 10.0001 18.3333Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const CODE_HINTS = Object.freeze({
  error: "No pudimos enviar el código. Puedes solicitar otro.",
  idle: "Enviamos un código a tu correo",
  sending: "Enviando un código a tu correo...",
  sent: "Enviamos un código a tu correo",
});

/**
 * Paso «Validación» del envío (Figma: modal «Solicitud de Proyecto» con el campo «Código»).
 * El código lo emite el backend y llega al correo del cliente; el hint anuncia el envío y
 * «Reenviar código» pide otro. «Enviar» se habilita con seis dígitos y sin emisión en curso.
 *
 * @param {Object} props - Estado del código y acciones del modal.
 * @param {boolean} props.open - Visibilidad del modal.
 * @param {string} props.code - Código escrito.
 * @param {"idle"|"sending"|"sent"|"error"} [props.codeStatus="idle"] - Estado de la emisión.
 * @param {boolean} [props.isSubmitting=false] - Envío en curso.
 * @param {string} [props.submitError=""] - Error de la emisión o del envío.
 * @param {Function} props.onCodeChange - Actualiza el código (solo dígitos).
 * @param {Function} [props.onResendCode] - Solicita otro código.
 * @param {Function} props.onClose - Cierra el modal.
 * @param {Function} props.onPrevious - Acción «Cerrar».
 * @param {Function} props.onNext - Envía con el código.
 * @returns {import("react").ReactElement} Modal de validación.
 */
function ProjectRequestValidationStep({
  open,
  onClose,
  onPrevious,
  onNext,
  code,
  codeStatus = "idle",
  isSubmitting = false,
  submitError = "",
  onCodeChange,
  onResendCode,
}) {
  const hasNumericCode = /^\d{6}$/.test(String(code ?? "").trim());
  const isSendingCode = codeStatus === "sending";

  return (
    <ProjectRequestModalShell
      open={open}
      sectionTitle="Validación"
      onClose={onClose}
      onPrevious={onPrevious}
      onNext={() => onNext?.(code)}
      previousLabel="Cerrar"
      nextDisabled={isSubmitting || isSendingCode || !hasNumericCode}
      nextLabel={isSubmitting ? "Enviando" : "Enviar"}
    >
      <div className="flex w-full flex-col gap-[8px]">
        <Input
          label="Código"
          required={false}
          showLabelInfo={false}
          showHint
          size="S"
          type="Default input"
          placeholder="Ingresa el código"
          hintText={CODE_HINTS[codeStatus] || CODE_HINTS.idle}
          leftIcon={<SecurityIcon className="size-5" />}
          rightIcon={null}
          showLeftIcon
          showRightIcon={false}
          value={code}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="one-time-code"
          onChange={(event) => onCodeChange?.(event.target.value.replace(/\D/g, "").slice(0, 6))}
          className="w-full max-w-none"
        />
        {submitError ? (
          <HintText state="Error" hintText={submitError} className="w-full" role="alert" />
        ) : null}
        {onResendCode ? (
          <Button
            theme="Primary"
            type="Ghost"
            size="S"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            disabled={isSubmitting || isSendingCode}
            className="self-start"
            onClick={onResendCode}
          >
            Reenviar código
          </Button>
        ) : null}
      </div>
    </ProjectRequestModalShell>
  );
}

export default ProjectRequestValidationStep;
