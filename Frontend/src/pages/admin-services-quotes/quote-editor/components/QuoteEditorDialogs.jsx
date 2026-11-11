import { InfoCircle, TickCircle, Warning2 } from "iconsax-react";
import { useId } from "react";

import Button from "../../../../components/ui/Button/Button.jsx";
import Modal from "../../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";

/**
 * Confirmación tras crear una cotización (Figma 5786:314247): diálogo centrado con icono positivo
 * y la única acción «Aceptar», que vuelve al listado. Solo se muestra después de que la API
 * confirme el alta.
 *
 * @param {Object} props - Visibilidad y callback.
 * @param {boolean} props.open - Muestra el diálogo.
 * @param {() => void} props.onAccept - Cierra y vuelve al listado.
 * @returns {import("react").ReactElement} Modal en portal.
 */
export function QuoteCreatedDialog({ onAccept, open }) {
  const dialogId = useId();
  useDialogKeyboard({
    open,
    getContainer: () => document.querySelector("[data-quote-created-dialog]"),
    onEscape: onAccept,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Aceptar"),
  });
  return (
    <Modal
      visible={open}
      showDialog
      alignment="Centered"
      title={<span id={`${dialogId}-title`}>Has creado la cotización exitosamente</span>}
      description={<span id={`${dialogId}-description`}>Tu cotización ha sido guardada correctamente y está lista para ser utilizada.</span>}
      icon={<TickCircle size="20" color="currentColor" className="size-5 text-[var(--color-success-200)]" aria-hidden="true" />}
      primaryActionLabel="Aceptar"
      showSecondaryAction={false}
      onClose={onAccept}
      onPrimaryAction={onAccept}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      data-quote-created-dialog=""
    />
  );
}

/**
 * Describe una coincidencia para el administrador: correo o empresa si existen y, si no puede
 * elegirse, por qué (ficha inactiva o usuario registrado sin ficha comercial, que nunca se vincula
 * automáticamente).
 *
 * @param {{kind: string, email: string|null, companyName: string|null, status: string, exact: boolean}} match - Coincidencia.
 * @returns {string} Detalle legible.
 */
function describeClientMatch(match) {
  const parts = [match.exact ? "Mismo nombre" : "Nombre parecido"];
  if (match.email) parts.push(match.email);
  if (match.companyName) parts.push(match.companyName);
  if (match.kind === "user") parts.push("usuario registrado sin ficha de cliente");
  else if (match.status !== "active") parts.push("cliente inactivo");
  return parts.join(" · ");
}

/**
 * Coincidencias de un cliente nuevo antes de guardar: personas registradas con un nombre igual o
 * parecido. El administrador puede usar un cliente existente activo (vuelve al formulario con él
 * seleccionado) o confirmar que se trata de otra persona y guardar. Nunca se fusionan registros ni
 * se vincula un usuario existente en silencio. Mismo diálogo Modal que el resto del editor.
 *
 * @param {Object} props - Coincidencias y callbacks.
 * @param {string} props.clientName - Nombre escrito del cliente nuevo.
 * @param {Array<Object>} props.matches - Coincidencias pendientes de decisión (vacío: cerrado).
 * @param {boolean} props.busy - Bloquea las acciones mientras se guarda.
 * @param {() => void} props.onCancel - Vuelve al formulario sin guardar.
 * @param {() => void} props.onConfirmNew - Confirma que es otra persona y guarda.
 * @param {(match: Object) => void} props.onUseExisting - Usa un cliente existente.
 * @returns {import("react").ReactElement} Modal en portal.
 */
export function QuoteClientMatchesDialog({ busy, clientName, matches, onCancel, onConfirmNew, onUseExisting }) {
  const dialogId = useId();
  const open = matches.length > 0;
  useDialogKeyboard({
    open,
    getContainer: () => document.querySelector("[data-quote-client-matches-dialog]"),
    onEscape: onCancel,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Volver"),
  });
  return (
    <Modal
      visible={open}
      showDialog
      alignment="Centered"
      title={<span id={`${dialogId}-title`}>Revisa las personas con un nombre parecido</span>}
      description={(
        <span id={`${dialogId}-description`} className="flex flex-col gap-[12px]">
          <span>
            {`Antes de crear «${clientName.trim()}», comprueba si es alguna de estas personas. Si es otra persona, se creará un cliente nuevo.`}
          </span>
          <span className="flex max-h-[240px] flex-col gap-[8px] overflow-y-auto" role="list" aria-label="Coincidencias">
            {matches.map((match) => (
              <span key={`${match.kind}-${match.id}`} role="listitem" className="flex flex-col gap-[4px] rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] p-[8px]">
                <span className="text-body-3 text-[var(--color-text-300)]">{match.name}</span>
                <span className="text-body-4 text-[var(--color-text-100)]">{describeClientMatch(match)}</span>
                {match.kind === "client" && match.status === "active" ? (
                  <Button
                    theme="Primary"
                    type="Link"
                    size="S"
                    fitContent
                    showLeftIcon={false}
                    showRightIcon={false}
                    className="self-center"
                    disabled={busy}
                    aria-label={`Usar el cliente ${match.name}`}
                    onClick={() => onUseExisting(match)}
                  >
                    Usar este cliente
                  </Button>
                ) : null}
              </span>
            ))}
          </span>
        </span>
      )}
      icon={<InfoCircle size="20" color="currentColor" className="size-5 text-[var(--color-warning-200)]" aria-hidden="true" />}
      secondaryActionLabel="Volver"
      primaryActionLabel="Crear cliente nuevo"
      actionsDisabled={busy}
      primaryActionBusy={busy}
      onClose={onCancel}
      onSecondaryAction={onCancel}
      onPrimaryAction={onConfirmNew}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      data-quote-client-matches-dialog=""
    />
  );
}

/**
 * Confirmación antes de descartar un borrador con cambios sin guardar (Figma 5786:314277):
 * «Volver» conserva el borrador y «Cancelar cotización» sale sin guardar nada; en una edición la
 * versión guardada no cambia. Usa la variante Danger porque descarta el trabajo del formulario.
 *
 * @param {Object} props - Visibilidad y callbacks.
 * @param {boolean} props.open - Muestra el diálogo.
 * @param {() => void} props.onStay - Vuelve al formulario.
 * @param {() => void} props.onDiscard - Descarta y sale.
 * @returns {import("react").ReactElement} Modal en portal.
 */
export function QuoteDiscardDialog({ onDiscard, onStay, open }) {
  const dialogId = useId();
  useDialogKeyboard({
    open,
    getContainer: () => document.querySelector("[data-quote-discard-dialog]"),
    onEscape: onStay,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Volver"),
  });
  return (
    <Modal
      visible={open}
      showDialog
      alignment="Centered"
      title={<span id={`${dialogId}-title`}>¿Deseas cancelar la cotización?</span>}
      description={<span id={`${dialogId}-description`}>Si optas por cancelarla, se eliminará todo el progreso actual.</span>}
      icon={<Warning2 size="20" color="currentColor" className="size-5 text-[var(--color-danger-100)]" aria-hidden="true" />}
      secondaryActionLabel="Volver"
      primaryActionLabel="Cancelar cotización"
      secondaryActionTheme="Danger"
      primaryActionTheme="Danger"
      onClose={onStay}
      onSecondaryAction={onStay}
      onPrimaryAction={onDiscard}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-description`}
      data-quote-discard-dialog=""
    />
  );
}
