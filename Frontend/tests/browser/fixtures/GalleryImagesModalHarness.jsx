import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "../../../src/auth/AuthContext.jsx";
import GalleryImagesModal from "../../../src/components/ui/Gallery/GalleryImagesModal.jsx";
import "../../../src/index.css";

const params = new URLSearchParams(window.location.search);
const itemCount = Number(params.get("count") || 12);

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

// Imágenes locales en SVG para no depender de red ni de almacenamiento.
const ITEMS = Array.from({ length: itemCount }, (_, index) => ({
  id: `render-${index + 1}`,
  title: `Render ${index + 1}.png`,
  image: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${index * 37} 40% 60%)"/></svg>`,
  )}`,
}));

/** Monta la galería real con un botón que la abre y la cierra, sin proyecto (sin comentarios). */
export default function GalleryImagesModalHarness() {
  const [visible, setVisible] = useState(params.get("open") !== "false");
  return (
    <AuthProvider>
      <button type="button" onClick={() => setVisible(true)}>Abrir galería</button>
      <GalleryImagesModal visible={visible} items={ITEMS} onClose={() => setVisible(false)} />
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")).render(<GalleryImagesModalHarness />);
