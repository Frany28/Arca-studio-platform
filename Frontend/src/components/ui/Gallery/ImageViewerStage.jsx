import clsx from "clsx";
import MainLogo from "../../../assets/logos/MainLogo.jsx";
import Button from "../../ui/Button/Button.jsx";
import Tooltip from "../../ui/Tooltip/Tooltip.jsx";
import ImageHighlighter from "./ImageHighlighter.jsx";

function CloseIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.195262 0.195262C0.455612 -0.0650874 0.877722 -0.0650874 1.13807 0.195262L6 5.05719L10.8619 0.195263C11.1223 -0.0650867 11.5444 -0.0650866 11.8047 0.195263C12.0651 0.455612 12.0651 0.877722 11.8047 1.13807L6.94281 6L11.8047 10.8619C12.0651 11.1223 12.0651 11.5444 11.8047 11.8047C11.5444 12.0651 11.1223 12.0651 10.8619 11.8047L6 6.94281L1.13807 11.8047C0.877722 12.0651 0.455612 12.0651 0.195262 11.8047C-0.0650873 11.5444 -0.0650873 11.1223 0.195262 10.8619L5.05719 6L0.195262 1.13807C-0.0650874 0.877722 -0.0650874 0.455612 0.195262 0.195262Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ArrowLeftIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12.5 15L7.5 10L12.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRightIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.5 15L12.5 10L7.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImageCarouselControl({ items, activeIndex, onSelect, onPrevious, onNext }) {
  if (items.length <= 1) {
    return null;
  }

  return (
    <div className="absolute bottom-[16px] left-1/2 flex -translate-x-1/2 items-center gap-[12px]">
      <Tooltip asChild portal showTip text="Imagen anterior" tipPosition="Top center">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full text-[var(--color-neutral-100-uniform)] transition-colors hover:bg-[rgba(42,41,41,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]"
          onClick={onPrevious}
          aria-label="Imagen anterior"
        >
          <ArrowLeftIcon className="size-5" />
        </button>
      </Tooltip>

      <div className="flex max-w-[340px] items-center gap-[6px] rounded-full bg-[rgba(42,41,41,0.82)] px-[10px] py-[7px]">
        {items.map((item, index) => (
          <Tooltip
            key={item.id ?? item.image}
            asChild
            portal
            showTip
            text={`Ver imagen ${index + 1}`}
            tipPosition="Top center"
          >
            <button
              type="button"
              className={clsx(
                "h-[8px] rounded-full transition-[width,background-color] duration-200",
                index === activeIndex
                  ? "w-[28px] bg-[var(--color-neutral-100-uniform)]"
                  : "w-[8px] bg-[var(--color-text-100)] hover:bg-[var(--color-neutral-300)]",
              )}
              onClick={() => onSelect(index)}
              aria-label={`Ver imagen ${index + 1}`}
              aria-current={index === activeIndex ? "true" : undefined}
            />
          </Tooltip>
        ))}
      </div>

      <Tooltip asChild portal showTip text="Imagen siguiente" tipPosition="Top center">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full text-[var(--color-neutral-100-uniform)] transition-colors hover:bg-[rgba(42,41,41,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]"
          onClick={onNext}
          aria-label="Imagen siguiente"
        >
          <ArrowRightIcon className="size-5" />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Escenario del visor de imágenes compartido por Proyectos (ImageViewerModal) y Gestión de
 * archivos: imagen, degradados, logo, «Cerrar» y carrusel (solo con varias imágenes).
 *
 * - `fit="cover"` (Proyectos): `ImageHighlighter` llena el escenario y admite seleccionar zonas
 *   para observaciones.
 * - `fit="contain"` (Gestión de archivos, solo consulta): la imagen conserva su proporción sin
 *   recortes, también vertical, con su texto alternativo y eventos de carga y error.
 *
 * @param {Object} props - Imagen, ajuste, cierre, carrusel y contenido superpuesto.
 * @param {string} props.imageSrc - URL de la imagen.
 * @param {"cover"|"contain"} [props.fit="cover"] - Ajuste de la imagen.
 * @param {string} [props.imageAlt] - Texto alternativo (modo contain).
 * @param {() => void} [props.onImageLoad] - Imagen cargada (modo contain).
 * @param {() => void} [props.onImageError] - Error de carga (modo contain).
 * @param {Array<Object>} [props.annotations] - Zonas observadas (modo cover).
 * @param {string|number|null} [props.focusedAnnotationId] - Zona resaltada (modo cover).
 * @param {(selection: Object) => void} [props.onSelectionChange] - Selección nueva (modo cover).
 * @param {boolean} [props.isImageVisible=true] - Transición entre imágenes del carrusel.
 * @param {() => void} props.onClose - Cierra el visor.
 * @param {string} [props.closeLabel="Cerrar imagen"] - Nombre accesible del cierre.
 * @param {{ items: Array<Object>, activeIndex: number, onSelect: Function, onPrevious: Function, onNext: Function }} [props.carousel] - Navegación.
 * @param {import("react").ReactNode} [props.children] - Capa superpuesta (carga o error).
 * @param {string} [props.className] - Tamaño y forma del escenario.
 * @returns {import("react").ReactElement} Escenario.
 */
export default function ImageViewerStage({
  annotations = [],
  carousel = null,
  children = null,
  className,
  closeLabel = "Cerrar imagen",
  fit = "cover",
  focusedAnnotationId = null,
  imageAlt,
  imageSrc,
  isImageVisible = true,
  onClose,
  onImageError,
  onImageLoad,
  onSelectionChange,
}) {
  return (
    <div
      className={clsx(
        "relative min-w-0 flex-1 overflow-hidden",
        "rounded-[var(--radius-3)] bg-[var(--color-neutral-200)]",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={clsx(
          "absolute inset-0 transition-[opacity,transform] duration-200 ease-out",
          isImageVisible
            ? "scale-100 opacity-100"
            : "scale-[1.01] opacity-0",
        )}
      >
        {fit === "contain" ? (
          <img
            src={imageSrc}
            alt={imageAlt}
            className="size-full object-contain"
            draggable={false}
            onLoad={onImageLoad}
            onError={onImageError}
          />
        ) : (
          <ImageHighlighter
            annotations={annotations}
            focusedAnnotationId={focusedAnnotationId}
            imageSrc={imageSrc}
            onSelectionChange={onSelectionChange}
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[rgba(42,41,41,0.18)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-[linear-gradient(180deg,rgba(0,0,0,0.26)_0%,rgba(0,0,0,0)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[170px] bg-[linear-gradient(0deg,rgba(0,0,0,0.40)_0%,rgba(0,0,0,0)_100%)]" />

      {children}

      <div className="absolute left-[12px] top-[12px]">
        <MainLogo size="32px" appearance="dark" alt="ARCA Studio" />
      </div>

      <Button
        theme="Primary"
        type="Solid"
        size="S"
        showText={false}
        showLeftIcon
        showRightIcon={false}
        iconLeft={<CloseIcon className="size-3" />}
        aria-label={closeLabel}
        tooltip={false}
        onClick={onClose}
        className="absolute right-[8px] top-[8px] size-9 text-[var(--color-text-200)]"
      />

      {carousel ? (
        <ImageCarouselControl
          items={carousel.items}
          activeIndex={carousel.activeIndex}
          onSelect={carousel.onSelect}
          onPrevious={carousel.onPrevious}
          onNext={carousel.onNext}
        />
      ) : null}
    </div>
  );
}
