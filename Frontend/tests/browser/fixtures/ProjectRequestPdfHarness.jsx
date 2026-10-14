import { createRoot } from "react-dom/client";
import { AuthProvider } from "../../../src/auth/AuthContext.jsx";
import ProjectRequestWorkflowModal from "../../../src/components/project-requests/ProjectRequestWorkflowModal.jsx";
import "../../../src/index.css";

// Solicitud en revisión con un PDF y una imagen adjuntos, con la forma que devuelve la cola de revisión.
const REQUEST = {
  assignees: [{ id: 9, name: "Ana" }],
  description: "Detalle técnico de la solicitud",
  files: [
    { fileType: "application/pdf", id: 31, name: "Memoria descriptiva.pdf" },
    { fileType: "image/png", id: 32, name: "Fachada.png" },
  ],
  id: 7,
  projectName: "Casa Norte",
  status: "pending_review",
};

/** Monta el modal real de revisión de solicitudes con adjuntos. */
export default function RequestPdfHarness() {
  return (
    <AuthProvider>
      <ProjectRequestWorkflowModal mode="review" open projectRequest={REQUEST} onClose={() => {}} onSubmit={() => {}} />
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")).render(<RequestPdfHarness />);
