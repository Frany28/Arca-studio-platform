import Button from "../../../../components/ui/Button/Button.jsx";
function ProcessesVideoGrid({ active, inert, onVideoOpen, videos }) {
  return (
    <div
      className="mx-auto grid w-full max-w-[1152px] grid-cols-1 gap-[8px] px-[16px] min-[600px]:grid-cols-2 min-[768px]:gap-[24px] min-[768px]:px-[48px] min-[1024px]:grid-cols-3 min-[1248px]:px-0"
      aria-label="Galería de videos de nuestros procesos"
      inert={inert ? "" : undefined}
      data-node-id="4845:5294"
    >
      {videos.map((video) => (
        <Button layout="content"
          key={video.id}
          htmlType="button"
          className="group relative aspect-[23/27] min-w-0 cursor-pointer overflow-hidden rounded-[var(--radius-2)] border-0 bg-[var(--color-neutral-200)] p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-950-uniform)]"
          aria-label={`Abrir video: ${video.title}`}
          onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();

            onVideoOpen(video, {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            });
          }}
        >
          {active ? (
            <video
              className="pointer-events-none absolute inset-0 size-full object-cover"
              poster={video.poster}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              tabIndex={-1}
              aria-hidden="true"
            >
              <source src={video.webm} type="video/webm" />
              <source src={video.mp4} type="video/mp4" />
            </video>
          ) : (
            <img
              src={video.poster}
              alt=""
              className="pointer-events-none absolute inset-0 size-full object-cover"
            />
          )}
          <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/10 group-focus-visible:bg-black/10 motion-reduce:transition-none" />
        </Button>
      ))}
    </div>
  );
}

export default ProcessesVideoGrid;
