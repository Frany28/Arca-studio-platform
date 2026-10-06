import { useEffect, useRef, useState } from "react";

import "../../../config/modelViewer.js";
import { getModel3DSource } from "../../../utils/model3DThumbnail.js";
import Loader from "../Loader/Loader.jsx";

export default function Model3DThumbnail({ alt = "Modelo 3D", className, item }) {
  const modelSrc = getModel3DSource(item);
  const modelViewerRef = useRef(null);
  const [failedSource, setFailedSource] = useState("");
  const [loadedSource, setLoadedSource] = useState("");

  const previewSource = item?.image || modelSrc || "";
  const isLoading = Boolean(previewSource) && loadedSource !== previewSource && failedSource !== previewSource;

  useEffect(() => {
    const modelViewer = modelViewerRef.current;

    if (!modelViewer || !modelSrc) {
      return undefined;
    }

    function handleError() {
      setFailedSource(modelSrc);
    }

    function handleLoad() {
      setLoadedSource(modelSrc);
    }

    modelViewer.addEventListener("error", handleError);
    modelViewer.addEventListener("load", handleLoad);

    return () => {
      modelViewer.removeEventListener("error", handleError);
      modelViewer.removeEventListener("load", handleLoad);
    };
  }, [modelSrc]);

  if (item?.image) {
    return (
      <span className={`${className || ""} relative block`}>
        {isLoading ? (
          <Loader
            preset="modelThumbnail"
            label="Cargando miniatura panorámica"
            className="absolute inset-0 z-[1] size-full"
          />
        ) : null}
        {failedSource === item.image ? (
          <span className="flex size-full items-center justify-center bg-[var(--color-neutral-50)] text-heading-8 text-[var(--color-text-100)]">
            Panorámica 360
          </span>
        ) : (
          <img
            src={item.image}
            alt={alt}
            className="size-full object-cover"
            onLoad={() => setLoadedSource(item.image)}
            onError={() => setFailedSource(item.image)}
          />
        )}
      </span>
    );
  }

  if (!modelSrc || failedSource === modelSrc) {
    return (
      <span
        className={`${className || ""} flex items-center justify-center bg-[radial-gradient(circle_at_50%_38%,#3a3a3a_0%,#171717_68%)] text-heading-8 text-[var(--color-neutral-100-uniform)]`}
        aria-label={alt}
      >
        Modelo 3D
      </span>
    );
  }

  return (
    <span className={`${className || ""} relative block`}>
      {isLoading ? (
        <Loader
          preset="modelThumbnail"
          label="Cargando miniatura panorámica"
          className="absolute inset-0 z-[1] size-full"
        />
      ) : null}
      <model-viewer
        ref={modelViewerRef}
        src={modelSrc}
        alt={alt}
        with-credentials
        class="size-full"
        camera-orbit="35deg 72deg 105%"
        field-of-view="30deg"
        interaction-prompt="none"
        loading="lazy"
        reveal="auto"
        style={{ display: "block" }}
      />
    </span>
  );
}
