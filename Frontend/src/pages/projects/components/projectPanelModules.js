import { lazyWithRetry as lazy } from "../../../utils/lazyWithRetry.js";

// Paneles del detalle que se descargan al abrir su pestaña. Información es la pestaña inicial y se
// carga con la página. Renders arrastra three.js y los visores, y retenerlos retrasaba las lecturas
// del detalle. lazyWithRetry recupera los chunks ausentes tras una publicación nueva.
export const ProjectDocumentsPanel = lazy(() => import("../panels/ProjectDocumentsPanel.jsx"));
export const ProjectRendersPanel = lazy(() => import("../panels/ProjectRendersPanel.jsx"));
export const ProjectTrackingPanel = lazy(() => import("../panels/ProjectTrackingPanel.jsx"));
export const ProjectUploadFilesPanel = lazy(() => import("../panels/ProjectUploadFilesPanel.jsx"));
export const ProjectWarrantiesPanel = lazy(() => import("../panels/ProjectWarrantiesPanel.jsx"));

// Índice de pestaña (orden de PROJECT_DETAIL_TABS) → panel diferido. `heavy` marca el que incluye
// three.js (~165 kB comprimidos): solo se precarga con una intención sostenida y nunca por un toque.
export const PROJECT_PANEL_MODULES = {
  1: { component: ProjectRendersPanel, heavy: true },
  2: { component: ProjectDocumentsPanel, heavy: false },
  3: { component: ProjectTrackingPanel, heavy: false },
  4: { component: ProjectWarrantiesPanel, heavy: false },
  5: { component: ProjectUploadFilesPanel, heavy: false },
};
