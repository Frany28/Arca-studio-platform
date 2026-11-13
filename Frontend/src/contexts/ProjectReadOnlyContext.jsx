/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from "react";

const ProjectReadOnlyContext = createContext({
  message: "",
  readOnly: false,
  uploadsLocked: false,
});

// `uploadsLocked` separa la subida de archivos del resto de operaciones: un draft es de solo
// lectura para comentarios, pero el administrador puede subirle archivos. Por defecto sigue a readOnly.
export function ProjectReadOnlyProvider({ children, message = "", readOnly = false, uploadsLocked = readOnly }) {
  const value = readOnly || uploadsLocked
    ? {
        message: message || "El proyecto es de solo lectura.",
        readOnly,
        uploadsLocked,
      }
    : { message: "", readOnly: false, uploadsLocked: false };

  return (
    <ProjectReadOnlyContext.Provider value={value}>
      {children}
    </ProjectReadOnlyContext.Provider>
  );
}

export function useProjectReadOnly() {
  return useContext(ProjectReadOnlyContext);
}
