import clsx from "clsx";
import AvatarLabel from "../ui/AvatarLabel/AvatarLabel.jsx";
import Button from "../ui/Button/Button.jsx";
import FileAttachmentIcons from "../ui/FileAttachmentIcons/FileAttachmentIcons.jsx";
import { getFileDisplayName } from "../../utils/fileDisplayName.js";

/**
 * Encabezado de un documento abierto: icono del tipo, nombre, tamaño y fecha, y su responsable.
 * Lo comparten los documentos de proyecto y el visor de cotizaciones. `keepExtension` muestra el
 * nombre completo del archivo (`COT-001.pdf`, como Figma 5812:283654) en lugar de quitarle la extensión.
 * La variante `modal` (visor del administrador de archivos, Figma 3727:682968) alinea el responsable a
 * la derecha a 24 px del nombre, reserva el hueco de la X solo si hay `onClose` y, por debajo de
 * 520 px, conserva una sola fila mostrando únicamente el avatar (su nombre queda accesible).
 *
 * @param {Object} props - Documento, variante y cierre opcional.
 * @param {Object|null} props.document - Datos del documento (name, fileType, size, uploadedAt, owner, ownerAvatarSrc).
 * @param {"default"|"modal"} [props.variant="default"] - Presentación.
 * @param {import("react").ReactNode} [props.closeIcon] - Icono del botón de cierre (variante modal).
 * @param {() => void} [props.onClose] - Cierra el visor (variante modal).
 * @param {boolean} [props.keepExtension=false] - Conserva la extensión en el nombre visible.
 * @returns {import("react").ReactElement|null} Encabezado del documento.
 */
export default function DocumentFileCard({ closeIcon = null, document, keepExtension = false, onClose, variant = "default" }) {
  if (!document) {
    return null;
  }

  const isEmptyState = document.emptyState === true;
  const isModal = variant === "modal";

  return (
    <article
      className={clsx(
        "relative flex w-full items-center bg-[var(--color-neutral-100)] p-[16px]",
        isModal
          ? clsx("min-h-[72px] gap-[24px] max-[520px]:gap-[12px]", onClose && "pr-[56px]")
          : "gap-[24px] max-[720px]:flex-wrap max-[520px]:gap-[16px]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-[12px]">
        <FileAttachmentIcons
          type={document.fileType}
          className={clsx(
            "h-[40px] w-[35px] shrink-0",
            isEmptyState && "opacity-50",
          )}
        />

        <div className="flex min-w-0 flex-col">
          <p
            className={clsx(
              "truncate text-heading-8",
              isEmptyState
                ? "text-[var(--color-neutral-400)]"
                : "text-[var(--color-text-300)]",
            )}
          >
            {keepExtension ? String(document.name || "").trim() || "Archivo" : getFileDisplayName(document.name)}
          </p>
          {!isEmptyState ? (
            <p className="truncate text-body-3 text-[var(--color-text-100)]">
              {document.size}
              {document.uploadedAt ? ` • ${document.uploadedAt}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {!isEmptyState ? (
        <AvatarLabel
          size="S"
          label={document.owner}
          showSubtitle={false}
          avatarTheme="Neutral"
          avatarContent={document.ownerAvatarSrc ? "Image" : "Text"}
          avatarSrc={document.ownerAvatarSrc}
          avatarName={document.owner}
          avatarDecorative={false}
          className="shrink-0"
          textClassName={clsx("text-[var(--color-text-300)]", isModal && "max-[520px]:sr-only")}
        />
      ) : null}

      {isModal && onClose ? (
        <div className="absolute right-0 top-0 p-[8px]">
          <Button
            aria-label="Cerrar visor"
            className="text-[var(--color-text-300)]"
            fitContent
            iconLeft={closeIcon}
            showText={false}
            size="S"
            theme="Primary"
            tooltip={false}
            type="Ghost"
            onClick={onClose}
          />
        </div>
      ) : null}
    </article>
  );
}
