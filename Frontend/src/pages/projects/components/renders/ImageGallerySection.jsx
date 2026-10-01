import Button from "../../../../components/ui/Button/Button.jsx";
import SharedGalleryImageCard from "../../../../components/ui/Gallery/GalleryImageCard.jsx";
import MediaEmptyState from "./MediaEmptyState.jsx";

export default function ImageGallerySection({ items, onOpenGallery, onSelectImage = () => {} }) {
  if (!items.length) {
    return (
      <section className="flex w-full flex-col gap-[16px]">
        <div className="flex w-full items-center justify-between">
          <span className="text-heading-8 text-[var(--color-text-200)]">
            Galería de Imágenes
          </span>

          <Button
            theme="Primary"
            type="Outline"
            size="S"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            onClick={onOpenGallery}
          >
            Ver más
          </Button>
        </div>

        <MediaEmptyState
          title="Aún no hay imágenes"
          description="Esta sección muestra las imágenes creadas para el proyecto."
          className="min-h-[206px]"
        />
      </section>
    );
  }

  const previewItems = items.slice(0, 6);

  return (
    <div className="flex w-full flex-col gap-[16px]">
      <div className="flex w-full items-center justify-between">
        <span className="text-heading-8 text-[var(--color-text-200)]">
          Galería de Imágenes
        </span>

        <Button
          theme="Primary"
          type="Outline"
          size="S"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          onClick={onOpenGallery}
        >
          Ver más
        </Button>
      </div>

      <div className="grid w-full grid-cols-3 gap-[16px] max-[1024px]:grid-cols-2 max-[640px]:grid-cols-1">
        {previewItems.map((item, index) => (
          <SharedGalleryImageCard
            key={`gallery-preview-${item.id}-${index}`}
            item={item}
            onClick={() => onSelectImage(item)}
            className="w-full"
          />
        ))}
      </div>
    </div>
  );
}
