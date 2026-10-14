import { createRoot } from "react-dom/client";
import { AuthProvider } from "../../../src/auth/AuthContext.jsx";
import { ProjectDocumentViewerModal } from "../../../src/pages/projects/components/ProjectDocumentPreview.jsx";
import "../../../src/index.css";

// Documento con la forma que produce projectDetailsPresentation para un PDF del proyecto.
const PDF_DOCUMENT = {
  currentVersionId: 9,
  extension: "pdf",
  fileType: "pdf",
  fileUrl: "/api/projects/15/files/5/content?versionId=9",
  id: 5,
  name: "Plano general.pdf",
};

/** Monta el visor real de documentos del proyecto, abierto sobre un PDF de varias páginas. */
export default function PdfViewerHarness() {
  return (
    <AuthProvider>
      <ProjectDocumentViewerModal document={PDF_DOCUMENT} open projectId={15} onClose={() => {}} />
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")).render(<PdfViewerHarness />);
