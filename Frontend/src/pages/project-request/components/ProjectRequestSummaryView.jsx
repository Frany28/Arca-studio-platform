import { useRef, useState } from "react";

import { api } from "../../../api/http.js";
import Badge from "../../../components/ui/Badge/Badge.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";
import FileAttachmentIcons from "../../../components/ui/FileAttachmentIcons.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import Tag from "../../../components/ui/Tag/Tag.jsx";
import RequestDetailField from "../../admin-dashboard/components/admin-request-details/RequestDetailField.jsx";
import { ProjectDocumentViewerModal } from "../../projects/components/ProjectDocumentPreview.jsx";
import { formatFileSize } from "../../../utils/fileSize.js";
import { isPdfAttachment, toAttachmentViewerDocument } from "../../../utils/projectRequestAttachments.js";
import { getProjectRequestStatus } from "../../../utils/projectRequestStatus.js";
import { formatCalendarDate } from "../../../utils/relativeTime.js";
import { buildProjectRequestSummary } from "../utils/projectRequestSummary.js";
import { FormDivider } from "./ProjectRequestFormFields.jsx";
import { PROJECT_REQUEST_FOOTER_CLASS_NAME } from "../utils/projectRequestLayout.js";

const FIELD_LIST_CLASS_NAME = "m-0 flex w-full flex-col gap-[24px]";

/**
 * Deduce la extensión que muestra el icono de adjunto a partir del MIME o del nombre.
 *
 * @param {{fileType?: string|null, name?: string}} file - Adjunto persistido.
 * @returns {string} Extensión en mayúsculas (JPG, PNG, PDF, MP4...) o cadena vacía.
 */
function getAttachmentExtension(file) {
  const fromName = String(file?.name || "").split(".").pop();
  const fromMime = String(file?.fileType || "").split(";")[0].split("/").pop();
  return (fromName && fromName !== file?.name ? fromName : fromMime).toUpperCase();
}

/**
 * Filas de datos de una columna; una fila con varios datos se presenta en línea (Figma: gap 24).
 *
 * @param {Object} props - Filas construidas por `buildProjectRequestSummary`.
 * @param {Array<Array<Object>>} props.rows - Filas de datos.
 * @returns {import("react").ReactElement} Lista de descripciones.
 */
function SummaryFields({ rows }) {
  return rows.map((row) => (
    <div key={row.map((item) => item.id).join("-")} className="flex w-full flex-wrap gap-[24px]">
      {row.map((item) => (
        <RequestDetailField key={item.id} label={item.label} className={row.length === 1 ? "w-full" : undefined}>
          <SummaryValue item={item} />
        </RequestDetailField>
      ))}
    </div>
  ));
}

/**
 * Valor de un dato según su presentación: etiqueta del proyecto, estado, enlace o texto.
 *
 * @param {Object} props - Dato del resumen.
 * @param {{kind: string, value: string, badgeTheme?: string}} props.item - Dato con valor ya formateado.
 * @returns {import("react").ReactElement} Valor presentado.
 */
function SummaryValue({ item }) {
  if (item.kind === "tag") {
    return (
      <Tag label={item.value} size="S" avatar={false} closeIcon={false} count={false} className="max-w-full" />
    );
  }
  if (item.kind === "status") {
    return <Badge label={item.value} theme={item.badgeTheme} variation="Simple" size="S" />;
  }
  if (item.kind === "link") {
    return (
      <a
        href={item.value}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-[var(--color-text-200)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]"
      >
        {item.value}
      </a>
    );
  }
  return <span className="whitespace-pre-line">{item.value}</span>;
}

/**
 * Adjuntos persistidos de la solicitud (Figma: miniatura 150×90 + nombre, fecha y tamaño).
 * Los PDF se abren en el visor integrado (el backend los sirve como descarga); el resto se
 * consulta en una pestaña nueva mediante el endpoint autenticado de contenido.
 *
 * @param {Object} props - Adjuntos y solicitud.
 * @param {Array<Object>} props.files - Adjuntos devueltos por la API.
 * @param {number|string} props.projectRequestId - Solicitud propietaria.
 * @param {(event: import("react").MouseEvent, file: Object) => void} props.onOpenPdf - Abre el visor.
 * @returns {import("react").ReactElement} Lista de adjuntos o mensaje vacío.
 */
function SummaryAttachments({ files, onOpenPdf, projectRequestId }) {
  if (!files.length) {
    return <p className="text-heading-8 text-[var(--color-text-100)]">Sin archivos adjuntos</p>;
  }

  return (
    <ul className="m-0 flex w-full list-none flex-col gap-[16px] p-0">
      {files.map((file) => {
        const content = (
          <>
            <span className="flex h-[90px] w-[150px] shrink-0 items-center justify-center rounded-[var(--radius-1)] bg-[var(--color-neutral-200)] shadow-[var(--shadow-e2)]">
              <FileAttachmentIcons type={getAttachmentExtension(file)} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[4px] text-left">
              <span className="text-heading-8 break-words text-[var(--color-text-300)]">{file.name}</span>
              {file.createdAt ? (
                <span className="text-body-3 text-[var(--color-text-100)]">Subido el {formatCalendarDate(file.createdAt)}</span>
              ) : null}
              {file.size ? <span className="text-body-3 text-[var(--color-text-100)]">{formatFileSize(file.size)}</span> : null}
            </span>
          </>
        );
        const itemClassName = "flex w-full items-start gap-[12px] rounded-[var(--radius-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]";

        return (
          <li key={file.id}>
            {isPdfAttachment(file) ? (
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`Ver ${file.name}`}
                className={itemClassName}
                onClick={(event) => onOpenPdf(event, file)}
              >
                {content}
              </button>
            ) : (
              <a
                href={api.projectRequests.getFileContentUrl({ fileId: file.id, projectRequestId })}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Abrir ${file.name} en una pestaña nueva`}
                className={itemClassName}
              >
                {content}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Consulta de solo lectura de una solicitud enviada (Figma «Solicitud de proyecto», Variant15).
 * Muestra la información registrada, el estado real y los adjuntos persistidos que devuelve
 * el backend; no ofrece controles de edición. «Ver estado» vuelve al progreso de la solicitud.
 *
 * @param {Object} props - Solicitud, estado de carga y acciones de navegación.
 * @param {Object|null} props.projectRequest - Solicitud con `files` leída de la API.
 * @param {boolean} props.loading - Lectura en curso.
 * @param {string} props.error - Error de la lectura.
 * @param {Function} props.onRetry - Reintenta la lectura.
 * @param {Function} props.onViewStatus - Muestra el estado de la solicitud.
 * @param {Function} props.onBackToDashboard - Navega al dashboard del rol.
 * @returns {import("react").ReactElement} Vista de consulta.
 */
function ProjectRequestSummaryView({ error, loading, onBackToDashboard, onRetry, onViewStatus, projectRequest }) {
  // El documento se conserva al cerrar para que el visor complete su animación de salida.
  const [pdfViewer, setPdfViewer] = useState({ document: null, open: false });
  const pdfTriggerRef = useRef(null);
  const summary = buildProjectRequestSummary(projectRequest);
  const details = summary.details.map((row) => row.map((item) => (
    item.kind === "status" ? { ...item, badgeTheme: getProjectRequestStatus(projectRequest?.status).badgeTheme } : item
  )));

  const openPdfViewer = (event, file) => {
    pdfTriggerRef.current = event.currentTarget;
    setPdfViewer({ document: toAttachmentViewerDocument(file, projectRequest.id), open: true });
  };

  let content;
  if (loading) {
    content = <Loader preset="adminRequestDetails" label="Cargando solicitud" className="w-full max-w-[850px]" />;
  } else if (error || !projectRequest) {
    content = (
      <EmptyState
        className="min-h-[320px] w-full max-w-[850px]"
        title="No pudimos cargar la solicitud"
        description={error || "La solicitud no está disponible."}
        size="M"
        showFeaturedIcon
        showActions
        showSecondaryAction={false}
        primaryActionLabel="Reintentar"
        onPrimaryAction={onRetry}
      />
    );
  } else {
    content = (
      <section aria-label="Información de la solicitud" className="flex w-full max-w-[850px] flex-wrap items-start gap-[24px]">
        <dl className={`${FIELD_LIST_CLASS_NAME} min-w-[min(100%,250px)] flex-1 rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px]`}>
          <SummaryFields rows={details} />
        </dl>
        <div className="flex min-w-[min(100%,250px)] flex-1 flex-col gap-[24px] py-[16px]">
          <dl className={FIELD_LIST_CLASS_NAME}>
            <SummaryFields rows={summary.preferences} />
          </dl>
          <div className="flex w-full flex-col items-start gap-[8px]">
            <h2 className="text-heading-8 text-[var(--color-text-300)]">Imágenes y archivos</h2>
            <SummaryAttachments
              files={Array.isArray(projectRequest.files) ? projectRequest.files : []}
              projectRequestId={projectRequest.id}
              onOpenPdf={openPdfViewer}
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
      <header className="flex w-full max-w-[850px] flex-col gap-[4px]">
        <h1 className="text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">
          Solicitud de proyecto
        </h1>
        <p className="text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)] min-[768px]:text-[18px] min-[768px]:leading-[21px]">
          Cada proyecto merece ser el correcto.
        </p>
      </header>

      <FormDivider />

      {content}

      <FormDivider />

      <footer className={PROJECT_REQUEST_FOOTER_CLASS_NAME}>
        <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} className="!w-full min-[480px]:!w-auto" onClick={onViewStatus}>
          Ver estado
        </Button>
        <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon={false} showRightIcon={false} className="!w-full min-[480px]:!w-auto" onClick={onBackToDashboard}>
          Volver al Dashboard
        </Button>
      </footer>

      {pdfViewer.document ? (
        <ProjectDocumentViewerModal
          commentsEnabled={false}
          document={pdfViewer.document}
          open={pdfViewer.open}
          onClose={() => setPdfViewer((current) => ({ ...current, open: false }))}
          triggerRef={pdfTriggerRef}
        />
      ) : null}
    </div>
  );
}

export default ProjectRequestSummaryView;
