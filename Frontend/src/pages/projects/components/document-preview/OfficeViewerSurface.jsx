import { lazy, Suspense } from "react";

import Loader from "../../../../components/ui/Loader/Loader.jsx";

// docx-preview y xlsx pesan cientos de KB: se descargan solo al abrir un documento de ese formato,
// no al entrar en el detalle del proyecto. React memoriza cada import, así que se pide una vez.
const DocxViewerSurface = lazy(() => import("./DocxViewerSurface.jsx"));
const XlsxViewerSurface = lazy(() => import("./XlsxViewerSurface.jsx"));

/**
 * Renderiza la superficie DOCX o XLSX cargando su librería bajo demanda.
 * Mientras se descarga el chunk muestra el mismo esqueleto que la carga del archivo, de modo que
 * el usuario ve un único estado de carga continuo.
 *
 * @param {object} props
 * @param {"docx" | "xlsx"} props.kind Formato del documento ya descargado.
 * @returns {JSX.Element}
 */
function OfficeViewerSurface({ kind, ...surfaceProps }) {
  const Surface = kind === "docx" ? DocxViewerSurface : XlsxViewerSurface;

  return (
    <Suspense fallback={<Loader preset="documentPreview" label="Cargando documento" />}>
      <Surface {...surfaceProps} />
    </Suspense>
  );
}

export default OfficeViewerSurface;
