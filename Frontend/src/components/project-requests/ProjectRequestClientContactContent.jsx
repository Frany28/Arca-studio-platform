import { useState } from "react";
import { Copy, MessageNotif } from "iconsax-react";

import Button from "../ui/Button/Button.jsx";
import HintText from "../ui/HintText/HintText.jsx";
import IconContainer from "../ui/IconContainer.jsx";
import Loader from "../ui/Loader/Loader.jsx";
import { useAdminRequestClient } from "../../pages/admin-dashboard/hooks/useAdminRequestClient.js";
import {
  buildProjectRequestEmailHref,
  buildProjectRequestWhatsAppHref,
} from "../../utils/projectRequestContactLinks.js";

const CONTACT_BUTTON_CLASS_NAME = "h-[34px] min-w-0 shrink-0 px-[8px]";
const COPY_BUTTON_CLASS_NAME = "h-[34px] w-[34px] shrink-0 p-[7px]";

/**
 * Presenta una fila de contacto del diseño (Figma 3727:677375).
 * La fila nunca se parte: etiqueta y acciones conservan su ancho y el valor ocupa el resto en una
 * sola línea, recortado con «…» si no cabe (p. ej. un correo largo); el valor completo queda en
 * `title` y se puede copiar.
 * Los valores proceden del usuario registrado; cada acción es independiente
 * y ninguna envía mensajes ni modifica por sí sola el estado de la solicitud.
 *
 * @param {Object} props - Etiqueta, valor y acciones de contacto.
 * @returns {import("react").ReactElement} Fila de correo o teléfono.
 */
function RequestContactRow({
  actionLabel,
  copied,
  label,
  link,
  onCopy,
  onOpen,
  value,
}) {
  const available = typeof value === "string" && Boolean(value.trim());
  return (
    <div className="flex w-full items-center gap-[16px]" role="group" aria-label={label}>
      <span className="text-heading-8 min-w-[55px] shrink-0 text-[var(--color-text-200)]">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-[12px]">
        <span
          className="text-heading-8 min-w-0 truncate text-right text-[var(--color-text-300)]"
          title={available ? value : undefined}
        >
          {available ? value : "No registrado"}
        </span>
        <Button
          theme="Primary"
          type="Outline"
          size="S"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          className={CONTACT_BUTTON_CLASS_NAME}
          disabled={!link}
          onClick={onOpen}
        >
          {actionLabel}
        </Button>
        <Button
          theme="Primary"
          type="Link"
          size="S"
          showText={false}
          showLeftIcon
          showRightIcon={false}
          iconLeft={<Copy size="20" variant="Linear" color="currentColor" />}
          aria-label={"Copiar " + label.toLowerCase()}
          tooltip={copied ? label + " copiado" : "Copiar " + label.toLowerCase()}
          className={COPY_BUTTON_CLASS_NAME}
          disabled={!available}
          onClick={onCopy}
        />
      </div>
    </div>
  );
}

// Textos de Figma: «Solicitar información adicional» (3727:677375) y «Solicitud Aprobada» (3727:677374).
const CONTACT_MODAL_COPY = Object.freeze({
  approve: Object.freeze({
    description: "El siguiente paso es coordinar la reunión inicial con el cliente.",
    title: "Solicitud Aprobada",
  }),
  changes_requested: Object.freeze({
    description: "Se notificará al cliente para completar la información faltante.",
    title: "Solicitar información adicional",
  }),
});

/**
 * Modal administrativo de contacto con el cliente, igual que Figma: «Solicitar información
 * adicional» o «Solicitud Aprobada». Muestra correo y teléfono reales con sus acciones, sin campos
 * de texto; «Finalizar» es la única mutación (la decisión) y un error la conserva abierta.
 *
 * @param {Object} props - Solicitud vigente, propósito, estado del envío y callbacks del workflow.
 * @param {"approve"|"changes_requested"} props.purpose - Decisión que se confirma.
 * @returns {import("react").ReactElement} Modal con los contactos reales del cliente.
 */
function ProjectRequestClientContactContent({
  dialogRef,
  error = "",
  onCancel,
  onFinalize,
  open,
  projectRequest,
  purpose = "changes_requested",
  submitting,
}) {
  const copy = purpose === "approve" ? CONTACT_MODAL_COPY.approve : CONTACT_MODAL_COPY.changes_requested;
  const [copyStatus, setCopyStatus] = useState("");
  const client = useAdminRequestClient({
    enabled: Boolean(open && projectRequest),
    userId: projectRequest?.requestedBy ?? null,
  });
  const email = client.client?.email || "";
  const phone = client.client?.phone || client.client?.secondaryPhone || "";
  const projectName = projectRequest?.projectName || "";
  const emailHref = buildProjectRequestEmailHref({ email, projectName, purpose });
  const whatsAppHref = buildProjectRequestWhatsAppHref({ phone, projectName, purpose });

  /**
   * Copia datos reales del contacto al portapapeles; muestra el resultado
   * sin fingir que se envió una comunicación al cliente.
   *
   * @param {string} label - Etiqueta del dato.
   * @param {string} value - Texto que el navegador copiará.
   * @returns {Promise<void>} Finaliza el intento de copia.
   */
  async function copyContact(label, value) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopyStatus(label + " copiado");
    } catch {
      setCopyStatus("No se pudo copiar. Selecciona el dato y cópialo manualmente.");
    }
  }

  /**
   * Abre un borrador en el programa de correo; el administrador debe enviarlo
   * expresamente. No simula un envío desde ARCA Studio.
   *
   * @returns {void}
   */
  function openEmail() {
    if (emailHref) window.location.assign(emailHref);
  }

  /**
   * Abre WhatsApp en una pestaña nueva solo con número internacional válido.
   * El mensaje queda preparado para revisión, nunca se envía automáticamente.
   *
   * @returns {void}
   */
  function openWhatsApp() {
    if (whatsAppHref) window.open(whatsAppHref, "_blank", "noopener,noreferrer");
  }

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-request-client-contact-title"
      aria-describedby="project-request-client-contact-description"
      className="flex w-full max-w-[531px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e1)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex w-full items-start gap-[16px] p-[16px]">
        <IconContainer
          size="M"
          type="Outline"
          icon={<MessageNotif size="20" variant="Linear" color="currentColor" />}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-[16px]">
          <header className="flex flex-col gap-[4px]">
            <h2 id="project-request-client-contact-title" className="text-heading-6 text-[var(--color-text-300)]">
              {copy.title}
            </h2>
            <p id="project-request-client-contact-description" className="text-body-3 text-[var(--color-text-200)]">
              {copy.description}
            </p>
          </header>

          {client.loading ? (
            <div role="status" className="flex min-h-[68px] items-center">
              <Loader preset="detailValue" label="Cargando contacto del cliente" />
            </div>
          ) : (
            <div className="flex w-full flex-col gap-[16px]">
              <RequestContactRow
                label="Correo"
                value={email}
                link={emailHref}
                actionLabel="Enviar correo"
                copied={copyStatus === "Correo copiado"}
                onOpen={openEmail}
                onCopy={() => copyContact("Correo", email)}
              />
              <RequestContactRow
                label="Teléfono"
                value={phone}
                link={whatsAppHref}
                actionLabel="Abrir WhatsApp"
                copied={copyStatus === "Teléfono copiado"}
                onOpen={openWhatsApp}
                onCopy={() => copyContact("Teléfono", phone)}
              />
              {client.error || client.unavailable ? (
                <div role="status" className="flex flex-wrap items-center gap-[8px] text-body-4 text-[var(--color-text-200)]">
                  <span>{client.error || "No se pudo consultar el contacto del cliente."}</span>
                  {client.canRetry ? (
                    <Button theme="Primary" type="Link" size="S" fitContent disabled={client.loading} onClick={client.retry}>
                      Reintentar
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {phone && !whatsAppHref ? (
                <p className="text-body-4 m-0 text-[var(--color-text-200)]">
                  Para abrir WhatsApp, registra el teléfono con prefijo internacional.
                </p>
              ) : null}
            </div>
          )}
          {error ? <HintText state="Error" hintText={error} role="alert" className="w-full" /> : null}
          <span role="status" aria-live="polite" className="text-body-4 text-[var(--color-text-200)] empty:hidden">
            {copyStatus}
          </span>
        </div>
      </div>
      <footer className="flex w-full flex-wrap gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
        <Button
          theme="Primary"
          type="Outline"
          size="S"
          showLeftIcon={false}
          showRightIcon={false}
          className="h-[41px] min-w-[120px] flex-1"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          theme="Primary"
          type="Solid"
          size="S"
          showLeftIcon={false}
          showRightIcon={false}
          className="h-[41px] min-w-[120px] flex-1"
          disabled={submitting}
          aria-busy={submitting || undefined}
          onClick={onFinalize}
        >
          {submitting ? "Finalizando..." : "Finalizar"}
        </Button>
      </footer>
    </section>
  );
}

export default ProjectRequestClientContactContent;
