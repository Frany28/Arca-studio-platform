import FileUploadSection from "../../../components/ui/FileUploadSection/FileUploadSection.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import { toProjectRequestFileCards } from "../utils/projectRequestFilePresentation.js";
import { FieldLabel } from "./ProjectRequestFormFields.jsx";

const ACCEPTED_FILE_TYPES = ".jpeg,.jpg,.png,.pdf,.mp4";
const ATTACHMENTS_LABEL = "Subir imágenes / archivos (opcional)";

/**
 * Campo "Referencias" del formulario: zona de carga del sistema (`FileUploadSection`) con una
 * tarjeta por adjunto que refleja su estado real (pendiente, subiendo, completado o fallido)
 * y permite quitar los que aún no se subieron. Los uploads ocurren al enviar la solicitud.
 *
 * @param {Object} props - Adjuntos, errores y acciones del hook de archivos.
 * @param {Array} props.files - Adjuntos de `useProjectRequestFiles`.
 * @param {Array<string>} props.fileErrors - Errores de validación de adjuntos.
 * @param {boolean} props.disabled - Bloquea cambios durante el envío.
 * @param {(fileList: FileList) => void} props.onFilesSelected - Agrega archivos.
 * @param {(id: string) => void} props.onRemove - Quita un adjunto pendiente o fallido.
 * @returns {import("react").ReactElement} Campo de adjuntos.
 */
function ProjectRequestAttachmentsField({ disabled, fileErrors, files, onFilesSelected, onRemove }) {
  const fileCards = toProjectRequestFileCards(files, disabled ? undefined : onRemove);

  return (
    <div className="flex w-full flex-col gap-[8px]">
      <FieldLabel asSpan optional>{ATTACHMENTS_LABEL}</FieldLabel>
      <FileUploadSection
        className="w-full"
        title={ATTACHMENTS_LABEL}
        aria-label={ATTACHMENTS_LABEL}
        files={fileCards}
        showUploadedFiles={fileCards.length > 0}
        viewportHeight={null}
        disabled={disabled}
        fileInputAccept={ACCEPTED_FILE_TYPES}
        onFilesSelected={onFilesSelected}
      />
      {fileErrors.map((error) => (
        <HintText key={error} state="Error" hintText={error} className="w-full" role="alert" />
      ))}
    </div>
  );
}

export default ProjectRequestAttachmentsField;
