export default function Model3DLoadingState({
  image,
  onRetry,
  progress,
  state = "loading",
}) {
  const isError = state === "error";
  const isSlow = state === "slow";
  const title = isError
    ? "No se pudo cargar la panorámica"
    : isSlow
      ? "La panorámica sigue cargando"
      : "Cargando panorámica 360";
  const description = isError
    ? "Revisa la conexión o intenta cargar el visor nuevamente."
    : isSlow
      ? "La imagen panorámica puede ser pesada o la conexión puede estar lenta."
      : "";

  return (
    <div className="pointer-events-auto absolute inset-0 z-10 h-full w-full overflow-hidden">
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute inset-[-18px] h-[calc(100%+36px)] w-[calc(100%+36px)] object-cover blur-[14px] scale-105"
          aria-hidden="true"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_43%,#3a3a3a_0%,#262626_44%,#121212_100%)]" />
      )}
      <div className="absolute inset-0 bg-[rgba(0,0,0,0.58)] backdrop-blur-[12px]" />

      <div className="absolute left-1/2 top-1/2 flex w-[320px] max-w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[8px] text-center">
        <div className="flex w-full items-start justify-center">
          <p className="text-heading-8 text-[var(--color-neutral-100-uniform)]">
            {title}
          </p>
        </div>

        {description ? (
          <p className="text-body-3 text-[rgba(255,255,255,0.78)]">
            {description}
          </p>
        ) : null}

        {!isError ? (
          <div className="relative h-[8px] w-full overflow-hidden rounded-full bg-[var(--color-neutral-200)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent-300)] transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="mt-[4px] h-[36px] cursor-pointer rounded-[var(--radius-2)] bg-[var(--color-neutral-100)] px-[14px] text-heading-8 text-[var(--color-text-300)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)]"
            onClick={onRetry}
          >
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

