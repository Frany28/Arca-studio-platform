import { useMemo, useRef, useState } from "react";

import AlertToast from "../../../components/ui/AlertToast/AlertToast.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import ProjectRequestCancelModal from "../../../components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx";
import useAddressSuggestions from "../../../hooks/useAddressSuggestions.js";
import { useInvalidFieldFocus } from "../../../hooks/useInvalidFieldFocus.js";
import { useUnsavedChangesGuard } from "../../../hooks/useUnsavedChangesGuard.js";
import { FormDivider } from "../../project-request/components/ProjectRequestFormFields.jsx";
import ProjectRequestFormHeader from "../../project-request/components/ProjectRequestFormHeader.jsx";
import ProjectRequestFormSections from "../../project-request/components/ProjectRequestFormSections.jsx";
import ProjectRequestRequiredAlert from "../../project-request/components/ProjectRequestRequiredAlert.jsx";
import useProjectRequestForm from "../../project-request/hooks/useProjectRequestForm.js";
import { toPersistedProjectRequestFileItem } from "../../project-request/utils/projectRequestFilePresentation.js";
import { PROJECT_REQUEST_FOOTER_CLASS_NAME } from "../../project-request/utils/projectRequestLayout.js";
import useAdminProjectRequestSave from "../hooks/useAdminProjectRequestSave.js";
import {
  ADMIN_EDIT_ATTACHMENT_LABEL,
  ADMIN_EDIT_ATTACHMENTS_MESSAGE,
  getProjectRequestFormFingerprint,
} from "../utils/adminProjectRequestEdit.js";

// La edición no añade ni quita adjuntos: sin errores ni acciones de archivos (referencias estables).
const NO_FILE_ERRORS = [];
const IGNORE_FILE_ACTION = () => {};

/**
 * Formulario «Editar solicitud» del administrador. Es el mismo formulario de creación
 * (`ProjectRequestFormSections` y `useProjectRequestForm`) inicializado con la solicitud ya leída
 * del backend: el padre solo lo monta con los datos recibidos, de modo que nunca se inicializa
 * vacío para rellenarse después. Cambian el encabezado y las acciones («Cancelar» y «Guardar
 * cambios»).
 *
 * - Cambios: se comparan con la huella del cuerpo que se enviaría (`getProjectRequestFormFingerprint`),
 *   así que volver al valor original deja el formulario sin cambios.
 * - Salida con cambios: `useUnsavedChangesGuard` detiene la navegación interna (pide confirmar con
 *   el modal de salida) y la recarga o el cierre de la pestaña (confirmación del navegador).
 * - Guardar: valida con las mismas reglas del formulario y llama a `useAdminProjectRequestSave`;
 *   no envía, aprueba ni cambia el estado. Tras la confirmación del backend se libera la salida y
 *   `onSaved` navega. Un error se muestra como aviso y conserva lo ingresado.
 * - Ubicación: las sugerencias solo se buscan mientras se edita el campo, para no consultar al
 *   proveedor al abrir una solicitud sin coordenadas.
 * - Respuestas condicionales: cambiar el tipo o la respuesta del inmueble oculta sus secciones, pero
 *   sus datos se retienen y vuelven si la sección vuelve a aplicar (`retainHiddenAnswers`).
 * - Adjuntos: se muestran los guardados, sin añadir ni eliminar (se conservan al guardar).
 *
 * @param {Object} props - Solicitud editable y acciones de la página.
 * @param {Object} props.projectRequest - Respuesta de `GET /admin/project-requests/:id/form`.
 * @param {() => void} props.onCancel - Vuelve a la consulta (el guard confirma si hay cambios).
 * @param {() => void} props.onReload - Vuelve a leer la solicitud tras un conflicto.
 * @param {(result: {changedFields: Array<string>, projectRequest: Object}) => void} props.onSaved - Recibe la versión guardada.
 * @returns {import("react").ReactElement} Formulario de edición.
 */
function AdminProjectRequestEditForm({ onCancel, onReload, onSaved, projectRequest }) {
  const [showRequiredAlert, setShowRequiredAlert] = useState(false);
  const formState = useProjectRequestForm({
    initialRequest: projectRequest,
    retainHiddenAnswers: true,
    setShowRequiredAlert,
  });
  const { applyLocationSuggestion, form, isLocationInputFocused, validateForSubmit } = formState;
  // Huella de apertura: el primer estado del formulario es la solicitud tal como llegó del backend.
  const [initialFingerprint] = useState(() => getProjectRequestFormFingerprint(form));
  const hasChanges = getProjectRequestFormFingerprint(form) !== initialFingerprint;
  const guard = useUnsavedChangesGuard({ when: hasChanges });
  const formRef = useRef(null);
  const focusInvalidField = useInvalidFieldFocus({ getContainer: () => formRef.current });
  const addressSuggestions = useAddressSuggestions({
    enabled: isLocationInputFocused,
    query: form.location,
    selected: form.locationLatitude !== null && form.locationLatitude !== undefined,
  });
  const files = useMemo(
    () => (projectRequest.files || []).map((file) => toPersistedProjectRequestFileItem(file)),
    [projectRequest.files],
  );
  const saver = useAdminProjectRequestSave({
    expectedUpdatedAt: projectRequest.updatedAt,
    onSaved: (result) => {
      guard.allowNavigation();
      onSaved(result);
    },
    projectRequestId: projectRequest.id,
  });

  /**
   * Valida y guarda. Con errores enfoca el primer campo inválido y no llama a la API.
   *
   * @param {import("react").FormEvent} event - Envío del formulario.
   * @returns {void}
   */
  const handleSubmit = (event) => {
    event.preventDefault();
    if (saver.saving || !hasChanges) return;
    if (validateForSubmit(NO_FILE_ERRORS)) {
      focusInvalidField();
      return;
    }
    void saver.save(form);
  };

  return (
    <>
      <ProjectRequestFormHeader
        title="Editar solicitud"
        subtitle="Actualiza la información de la solicitud. Guardar no cambia su estado."
      />

      <FormDivider />

      <form ref={formRef} noValidate className="flex w-full flex-col items-center gap-[48px]" onSubmit={handleSubmit} aria-busy={saver.saving || undefined}>
        <ProjectRequestFormSections
          attachments={{
            completedLabel: ADMIN_EDIT_ATTACHMENT_LABEL,
            files,
            onFilesSelected: IGNORE_FILE_ACTION,
            onRemove: IGNORE_FILE_ACTION,
            readOnlyMessage: ADMIN_EDIT_ATTACHMENTS_MESSAGE,
          }}
          fileErrors={NO_FILE_ERRORS}
          formState={formState}
          locationSearch={{
            error: addressSuggestions.error,
            hasSearched: addressSuggestions.hasSearched,
            isSearching: addressSuggestions.isSearching,
            onSelect: (suggestion) => {
              applyLocationSuggestion(suggestion, NO_FILE_ERRORS);
              addressSuggestions.clear();
            },
            suggestions: addressSuggestions.suggestions,
          }}
        />

        <FormDivider />

        <footer className={PROJECT_REQUEST_FOOTER_CLASS_NAME}>
          <Button theme="Primary" type="Outline" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto" disabled={saver.saving} onClick={onCancel}>Cancelar</Button>
          <Button theme="Primary" type="Solid" htmlType="submit" size="M" fitContent={false} showLeftIcon={false} showRightIcon={false} className="h-[41px] w-full min-[480px]:w-auto" disabled={saver.saving || !hasChanges}>{saver.saving ? "Guardando" : "Guardar cambios"}</Button>
        </footer>
      </form>

      <ProjectRequestRequiredAlert visible={showRequiredAlert} onDismiss={() => setShowRequiredAlert(false)} />
      <ProjectRequestCancelModal
        open={guard.blocked}
        onCancel={guard.reset}
        onConfirm={guard.proceed}
        title="¿Deseas descartar los cambios?"
        description="Los cambios que no guardaste en la solicitud se perderán."
        primaryActionLabel="Descartar"
        ariaLabel="Confirmar salida sin guardar los cambios"
      />
      {saver.failure ? (
        <AlertToast
          trigger={saver.failure.id}
          theme="Danger"
          title={saver.failure.title}
          description={saver.failure.description}
          showActions={saver.failure.canReload}
          secondaryActionLabel="Ahora no"
          primaryActionLabel="Recargar"
          onPrimaryAction={onReload}
          onDismiss={saver.dismissFailure}
          aria-label={saver.failure.title}
        />
      ) : null}
    </>
  );
}

export default AdminProjectRequestEditForm;
