export const FILE_UPLOAD_SECTION_DEFAULT_FILES = [
  {
    id: "completed-file",
    name: "Nombre del archivo",
    type: "PDF",
    status: "completed",
    currentSizeLabel: "200KB",
    totalSizeLabel: "200KB",
    progress: 40,
  },
  {
    id: "uploading-file",
    name: "Nombre del archivo",
    type: "JPG",
    status: "uploading",
    currentSizeLabel: "80KB",
    totalSizeLabel: "200KB",
    progress: 40,
  },
  {
    id: "failed-file",
    name: "Nombre del archivo",
    type: "OBJ",
    status: "failed",
    errorMessage: "Error al subir, por favor intenta de nuevo",
  },
];

export const FILE_UPLOAD_SECTION_DEFAULT_PROPS = {
  title: "File upload section",
  chooseFileLabel: "Elige un archivo",
  separatorLabel: "O",
  dropLabel: "Arrastra y suelta",
  formatsLabel: "Formatos JPEG, PNG, PDF y MP4, hasta 50 MB.",
  files: FILE_UPLOAD_SECTION_DEFAULT_FILES,
  showUploadedFiles: true,
  viewportHeight: 456,
  "aria-label": "File upload section",
};

/**
 * Ids estables de una tarjeta de FileUploadSection y de sus partes, derivados del prefijo de la
 * sección y del `id` del archivo (no de su posición): las asociaciones (aria-describedby, destinos
 * de la navegación a errores) se conservan al quitar o reordenar archivos.
 *
 * @param {string} idPrefix - Prefijo de la sección (prop `idPrefix`).
 * @param {string|number} fileId - `id` de la tarjeta.
 * @returns {{card: string, remove: string, message: string}} Ids de la tarjeta, de su botón para
 * quitarla y de su mensaje de validación.
 */
export function getFileUploadCardIds(idPrefix, fileId) {
  const card = `${idPrefix}-file-${String(fileId).replace(/[^\w-]/g, "_")}`;
  return { card, message: `${card}-message`, remove: `${card}-remove` };
}

export function createFileUploadSectionProps(overrides = {}) {
  return {
    ...FILE_UPLOAD_SECTION_DEFAULT_PROPS,
    ...overrides,
  };
}
