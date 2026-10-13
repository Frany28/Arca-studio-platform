import { useId, useRef } from "react";
import { GlobalEdit, Notification } from "iconsax-react";

import Button from "../../../components/ui/Button/Button.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import IconContainer from "../../../components/ui/IconContainer.jsx";
import Label from "../../../components/ui/Label/Label.jsx";
import Modal from "../../../components/ui/Modal/Modal.jsx";
import Toggle from "../../../components/ui/Toggle/Toggle.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import {
  getPendingProjectSettingIds,
  getProjectSettings,
  getProjectSettingsAvailability,
  PENDING_PROJECT_SETTINGS,
  PROJECT_SETTING_IDS,
} from "../utils/projectSettings.js";

// Textos de Figma (3727:686869) en su orden visual.
const SETTING_ROWS = [
  {
    id: PROJECT_SETTING_IDS.portfolio,
    label: "Mostrar en el portafolio público",
    description: "Permite que este proyecto aparezca en el portafolio público del sitio web de ARCA Studio.",
  },
  {
    id: PROJECT_SETTING_IDS.featured,
    label: "Destacar en la página principal",
    description: "Muestra este proyecto en las secciones destacadas del Home y otras áreas promocionales.",
  },
  {
    id: PROJECT_SETTING_IDS.clientAccess,
    label: "Permitir acceso al cliente",
    description: "Permite que el cliente acceda al proyecto desde su panel para consultar avances y documentación.",
    information: true,
  },
  {
    id: PROJECT_SETTING_IDS.archived,
    label: "Archivar proyecto",
    description: "Oculta el proyecto de las listas principales sin eliminar su información del sistema, solo es visible para el administrador.",
  },
];

/**
 * Resuelve valor, bloqueo y ayuda visibles de una fila del modal.
 * Las opciones sin contrato muestran su valor efectivo bloqueado con el motivo pendiente.
 * @param {string} settingId - Opción de la fila.
 * @param {Object} context - Borrador, disponibilidad, cambios pendientes y guardado.
 * @returns {{value: boolean, disabled: boolean, hint: string, pending: boolean}} Presentación.
 */
function getSettingRowState(settingId, { availability, draft, pendingIds, submitting }) {
  const unsupported = PENDING_PROJECT_SETTINGS[settingId];
  if (unsupported) {
    return { value: unsupported.value, disabled: true, hint: unsupported.reason, pending: false };
  }

  const rule = availability[settingId];
  return {
    value: Boolean(draft[settingId]),
    disabled: submitting || rule.disabled,
    hint: rule.reason,
    pending: pendingIds.has(settingId),
  };
}

/**
 * Presenta "Configuración del proyecto" con los componentes compartidos Modal, Toggle,
 * IconContainer, Label, HintText y Button. No guarda estado propio: recibe el snapshot
 * del proyecto y el borrador del coordinador, y deriva disponibilidad y cambios pendientes.
 * Conserva la animación fade-scale de Modal (también al cerrar) y el teclado de diálogo.
 *
 * @param {Object} props - Estado del diálogo y callbacks del coordinador.
 * @param {boolean} props.open - Visibilidad animada del modal.
 * @param {Object|null} props.project - Snapshot del proyecto confirmado por el servidor.
 * @param {{portfolio: boolean, archived: boolean}|null} props.draft - Borrador temporal.
 * @param {boolean} props.submitting - Guardado en curso.
 * @param {boolean} props.hasPendingChanges - Habilita Confirmar solo con cambios.
 * @param {string} [props.error] - Error del último intento de guardado.
 * @param {(settingId: string, value: boolean) => void} props.onSettingChange - Cambio temporal.
 * @param {() => void} props.onCancel - Descarta el borrador.
 * @param {() => void} props.onConfirm - Persiste el borrador.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function ProjectSettingsModal({
  draft,
  error = "",
  hasPendingChanges,
  onCancel,
  onConfirm,
  onSettingChange,
  open,
  project,
  submitting,
}) {
  const baseId = useId();
  const dialogRef = useRef(null);
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const resolvedDraft = draft || getProjectSettings(project);
  const context = {
    availability: getProjectSettingsAvailability(project, resolvedDraft),
    draft: resolvedDraft,
    pendingIds: getPendingProjectSettingIds(project, resolvedDraft),
    submitting,
  };

  useDialogKeyboard({
    open,
    getContainer: () => dialogRef.current,
    onEscape: onCancel,
    getInitialFocus: (elements) => elements.find((element) => element.getAttribute("role") === "switch"),
  });

  return (
    <Modal
      visible={open}
      alignment="Centered"
      overlayVariant="blurred"
      transitionPreset="fade-scale"
      onClose={onCancel}
    >
      {project ? (
        <section
          ref={dialogRef}
          className="flex max-h-[calc(100dvh-72px)] w-full max-w-[532px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={submitting || undefined}
          data-project-settings-modal={project.id}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex min-h-0 flex-1 flex-col items-center gap-[16px] overflow-y-auto p-[16px]">
            <IconContainer size="M" type="Outline" icon={<GlobalEdit size="20" variant="Linear" color="currentColor" />} />
            <div className="flex w-full flex-col items-center gap-[4px] text-center">
              <h2 id={titleId} className="text-heading-6 text-[var(--color-text-300)]">
                Configuración del proyecto
              </h2>
              <p id={descriptionId} className="text-body-3 text-[var(--color-text-200)]">
                Controla cómo y dónde será visible este proyecto dentro de la plataforma y en el sitio web público.
              </p>
            </div>

            <ul className="flex w-full flex-col gap-[16px]" aria-label="Opciones de visibilidad">
              {SETTING_ROWS.map((row) => {
                const state = getSettingRowState(row.id, context);
                const toggleId = `${baseId}-${row.id}`;
                const descriptionIds = [`${toggleId}-description`, state.hint || state.pending ? `${toggleId}-hint` : null]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <li
                    key={row.id}
                    className="flex w-full items-center gap-[16px] border-b border-[var(--color-neutral-200)] pb-[16px]"
                    data-setting={row.id}
                    data-pending={state.pending ? "true" : undefined}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-[8px]">
                      <IconContainer
                        size="M"
                        type="Outline"
                        icon={<Notification size="20" variant="Linear" color="currentColor" className="text-[var(--color-success-200)]" />}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-[2px] text-left">
                        <Label
                          id={`${toggleId}-label`}
                          htmlFor={toggleId}
                          label={row.label}
                          required={false}
                          information={Boolean(row.information)}
                          state={state.disabled && !submitting ? "Disabled" : "Default"}
                          className="max-w-full [&>span:first-child]:whitespace-normal"
                        />
                        <p id={`${toggleId}-description`} className="text-body-3 text-[var(--color-text-200)]">
                          {row.description}
                        </p>
                        {state.pending ? (
                          <HintText id={`${toggleId}-hint`} state="Success" hintText="Cambio pendiente de confirmación." />
                        ) : state.hint ? (
                          <HintText id={`${toggleId}-hint`} state="Default" hintText={state.hint} />
                        ) : null}
                      </div>
                    </div>
                    <Toggle
                      id={toggleId}
                      size="M"
                      active={state.value}
                      disabled={state.disabled}
                      onActiveChange={(value) => onSettingChange(row.id, value)}
                      role="switch"
                      aria-checked={state.value}
                      aria-disabled={state.disabled || undefined}
                      aria-labelledby={`${toggleId}-label`}
                      aria-describedby={descriptionIds}
                    />
                  </li>
                );
              })}
            </ul>

            {error ? <HintText state="Error" hintText={error} className="w-full" role="alert" /> : null}
          </div>

          <footer className="flex w-full shrink-0 items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
            <Button
              theme="Primary"
              type="Outline"
              size="S"
              showLeftIcon={false}
              showRightIcon={false}
              disabled={submitting}
              className="h-[41px] min-w-0 flex-1"
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
              disabled={submitting || !hasPendingChanges}
              aria-busy={submitting}
              className="h-[41px] min-w-0 flex-1"
              onClick={onConfirm}
            >
              {submitting ? "Confirmando..." : "Confirmar"}
            </Button>
          </footer>
        </section>
      ) : null}
    </Modal>
  );
}

export default ProjectSettingsModal;
