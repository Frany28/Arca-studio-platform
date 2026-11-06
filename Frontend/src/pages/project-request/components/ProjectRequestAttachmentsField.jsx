import { useId } from "react";

import Button from "../../../components/ui/Button/Button.jsx";
import FileUploadSection from "../../../components/ui/FileUploadSection/FileUploadSection.jsx";
import { getFileUploadCardIds } from "../../../components/ui/FileUploadSection/fileUploadSectionConfig.js";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import { UPLOAD_TRANSFER_LIMIT_BYTES } from "../../../config/uploadTransferLimit.js";
import { formatTransferLimit, PROJECT_REQUEST_FILE_LIMITS } from "../../../utils/projectRequestValidation.js";
import { splitProjectRequestFileErrors, toProjectRequestFileCards } from "../utils/projectRequestFilePresentation.js";
import { FieldLabel } from "./ProjectRequestFormFields.jsx";

const ACCEPTED_FILE_TYPES = ".jpeg,.jpg,.png,.pdf,.mp4,.mov";
const ATTACHMENTS_LABEL = "Subir imágenes / archivos (opcional)";
// Con más de dos adjuntos, la lista se limita al alto de dos tarjetas (89 px cada una y 12 px de
// separación) y se desplaza con el ScrollBar de FileUploadSection, para que el campo no crezca con
// cada archivo. Con uno o dos, la lista conserva su alto natural.
const MAX_VISIBLE_FILE_CARDS = 2;
const FILE_CARD_HEIGHT = 89;
const FILE_CARD_GAP = 12;
const FILE_LIST_VIEWPORT_HEIGHT = MAX_VISIBLE_FILE_CARDS * FILE_CARD_HEIGHT + (MAX_VISIBLE_FILE_CARDS - 1) * FILE_CARD_GAP;
// Formatos y límites reales: imágenes y PDF hasta 50 MB y vídeos (MP4 y MOV) hasta su límite propio.
// Si el despliegue impone uno menor por subida (temporal), se indica para no anunciar 50 MB.
const VIDEO_LIMIT_LABEL = formatTransferLimit(PROJECT_REQUEST_FILE_LIMITS.maxVideoBytes);
const FORMATS_LABEL = UPLOAD_TRANSFER_LIMIT_BYTES
  ? `Formatos JPEG, PNG, PDF, MP4 y MOV. Hasta 50 MB y vídeos hasta ${VIDEO_LIMIT_LABEL} (en este entorno de pruebas, hasta ${formatTransferLimit(UPLOAD_TRANSFER_LIMIT_BYTES)} por archivo).`
  : `Formatos JPEG, PNG, PDF, MP4 y MOV. Hasta 50 MB y vídeos hasta ${VIDEO_LIMIT_LABEL}.`;

/**
 * Campo "Referencias" del formulario: zona de carga del sistema (`FileUploadSection`) con una
 * tarjeta por adjunto que refleja su estado real (pendiente, subiendo, subido y pendiente de
 * enviar la solicitud, o fallido con «Intenta de nuevo»). Los archivos se suben al seleccionarlos
 * (useProjectRequestFiles); quitar uno en curso cancela su transferencia.
 *
 * Errores: el motivo de un adjunto concreto (formato, tamaño, nombre, vacío, repetido) se muestra
 * en su tarjeta y se asocia a su botón «Eliminar archivo …»; los de la sección (cantidad, tamaño
 * total, selección rechazada) se muestran bajo la zona de carga, junto a «Elige un archivo». El
 * grupo expone aria-invalid y la navegación a errores (useInvalidFieldFocus) enfoca, por orden, el
 * botón para quitar el primer adjunto afectado (`data-invalid-field-control`) o, si el error es de
 * la sección, «Elige un archivo». Quitar un adjunto con el foco en el campo lleva el foco a la
 * tarjeta siguiente (o a la anterior, o a la zona de carga) para no perderlo.
 *
 * En una corrección, los adjuntos ya guardados aparecen como completados: mientras se leen se
 * anuncia la carga y, si la lectura falla, se ofrece reintentarla. Con `allowRemoteRemoval` sus
 * tarjetas muestran «Eliminar archivo», que los elimina de la solicitud.
 *
 * @param {Object} props - Adjuntos, errores y acciones del hook de archivos.
 * @param {boolean} [props.allowRemoteRemoval=false] - Permite eliminar adjuntos ya subidos.
 * @param {boolean} [props.loadingPersisted=false] - Lectura de los adjuntos guardados en curso.
 * @param {string} [props.persistedError=""] - Error de la lectura de los adjuntos guardados.
 * @param {() => void} [props.onRetryPersisted] - Reintenta la lectura de los adjuntos guardados.
 * @param {Array} props.files - Adjuntos de `useProjectRequestFiles`.
 * @param {Array<string>} props.fileErrors - Errores de validación de adjuntos.
 * @param {boolean} props.disabled - Bloquea cambios durante el envío.
 * @param {(fileList: FileList) => void} props.onFilesSelected - Agrega archivos.
 * @param {(id: string) => void} props.onRemove - Quita un adjunto (cancela, elimina o descarta).
 * @param {(id: string) => void} [props.onRetry] - Vuelve a subir un adjunto fallido.
 * @returns {import("react").ReactElement} Campo de adjuntos.
 */
function ProjectRequestAttachmentsField({
  allowRemoteRemoval = false,
  disabled,
  fileErrors,
  files,
  loadingPersisted = false,
  onFilesSelected,
  onRemove,
  onRetry,
  onRetryPersisted,
  persistedError = "",
}) {
  const baseId = useId().replace(/[^\w-]/g, "");
  const idPrefix = `project-request-attachments-${baseId}`;
  const labelId = `${idPrefix}-label`;
  const generalErrorId = (index) => `${idPrefix}-error-${index}`;
  const groupId = `${idPrefix}-group`;
  const { byFileId, general } = splitProjectRequestFileErrors(files, fileErrors);
  const invalid = fileErrors.length > 0;
  // Tras intentar enviar, el mismo motivo ya figura entre los errores de la sección.
  const persistedMessage = persistedError ? `No se pudieron cargar los archivos adjuntos: ${persistedError}` : "";
  const showPersistedMessage = Boolean(persistedMessage) && !general.includes(persistedMessage);
  // Botones para quitar los adjuntos afectados, en el orden de la lista (ids estables por adjunto).
  const invalidControlIds = files
    .filter((item) => byFileId.has(item.id))
    .map((item) => getFileUploadCardIds(idPrefix, item.id).remove)
    .join(" ");

  /**
   * Quita un adjunto y, si el foco estaba en el campo, lo lleva a la tarjeta que ocupa su lugar,
   * a la anterior o a «Elige un archivo». Se aplica tras el commit que retira la tarjeta.
   *
   * @param {string} id - Adjunto a quitar.
   * @returns {void}
   */
  function removeFile(id) {
    const index = files.findIndex((item) => item.id === id);
    // Por id y no por ref: el handler se pasa a las tarjetas durante el render.
    const focusInside = Boolean(document.getElementById(groupId)?.contains(document.activeElement));
    onRemove(id);
    if (!focusInside) return;
    const remaining = files.filter((item) => item.id !== id);
    const neighbour = remaining[index] ?? remaining[index - 1];
    window.requestAnimationFrame(() => {
      const next = (neighbour && document.getElementById(getFileUploadCardIds(idPrefix, neighbour.id).remove))
        || document.getElementById(groupId)?.querySelector("button:not(:disabled)");
      next?.focus();
    });
  }

  const fileCards = toProjectRequestFileCards(files, disabled ? undefined : removeFile, {
    allowRemoteRemoval,
    onRetry: disabled ? undefined : onRetry,
  })
    .map((card) => (byFileId.has(card.id) ? { ...card, validationMessage: byFileId.get(card.id) } : card));

  return (
    <div
      id={groupId}
      className="flex w-full flex-col gap-[8px]"
      role="group"
      aria-labelledby={labelId}
      aria-invalid={invalid || undefined}
      aria-describedby={general.length ? general.map((_, index) => generalErrorId(index)).join(" ") : undefined}
      data-invalid-field-control={invalidControlIds || undefined}
    >
      <FieldLabel asSpan optional id={labelId}>{ATTACHMENTS_LABEL}</FieldLabel>
      <FileUploadSection
        className="w-full"
        title={ATTACHMENTS_LABEL}
        aria-label={ATTACHMENTS_LABEL}
        files={fileCards}
        showUploadedFiles={fileCards.length > 0}
        viewportHeight={null}
        fileListViewportHeight={fileCards.length > MAX_VISIBLE_FILE_CARDS ? FILE_LIST_VIEWPORT_HEIGHT : null}
        disabled={disabled}
        fileInputAccept={ACCEPTED_FILE_TYPES}
        formatsLabel={FORMATS_LABEL}
        idPrefix={idPrefix}
        onFilesSelected={onFilesSelected}
        dropzoneSupportingContent={general.length || loadingPersisted || persistedError ? (
          <div className="flex w-full flex-col gap-[8px]">
            {loadingPersisted ? (
              <HintText state="Default" hintText="Cargando los archivos adjuntos de la solicitud..." className="w-full" role="status" />
            ) : null}
            {persistedError ? (
              <div className="flex w-full flex-wrap items-center gap-[8px]">
                {showPersistedMessage ? <HintText state="Error" hintText={persistedMessage} className="min-w-0 flex-1" role="alert" /> : null}
                <Button theme="Primary" type="Outline" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={disabled} onClick={onRetryPersisted}>
                  Reintentar
                </Button>
              </div>
            ) : null}
            {general.map((error, index) => (
              <HintText key={error} id={generalErrorId(index)} state="Error" hintText={error} className="w-full" role="alert" />
            ))}
          </div>
        ) : null}
      />
    </div>
  );
}

export default ProjectRequestAttachmentsField;
