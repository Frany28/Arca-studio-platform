import { createRoot } from "react-dom/client";
import { AuthProvider } from "../../../src/auth/AuthContext.jsx";
import VideoViewerModal from "../../../src/components/ui/Gallery/VideoViewerModal.jsx";
import "../../../src/index.css";

// Video del proyecto con la forma que usa la galería; la prueba simula su duración.
const VIDEO_ITEM = {
  id: "video-1",
  title: "Recorrido de obra",
  video: "/media/recorrido.mp4",
};

if (new URLSearchParams(window.location.search).get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

/** Monta el reproductor real abierto, con los comentarios temporales que entrega la API simulada. */
export default function VideoViewerTooltipHarness() {
  return (
    <AuthProvider>
      <VideoViewerModal visible item={VIDEO_ITEM} projectId={15} onClose={() => {}} />
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")).render(<VideoViewerTooltipHarness />);
