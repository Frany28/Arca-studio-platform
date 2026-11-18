// Ejecución bloqueada (Fase 1.2, B1: conservación de archivos guardados).
//
// Este script eliminaba del almacenamiento los objetos de archivos 3D (GLB/GLTF) registrados en
// public.file_versions y en public.model_processing_jobs. Borrar el objeto de un archivo registrado
// está prohibido: los archivos guardados, sus versiones y sus objetos se conservan.
//
// El guardián termina antes de cargar .env, conectar con PostgreSQL o crear el cliente del
// almacenamiento, de modo que ninguna invocación puede borrar nada. Su historial queda en Git. Una
// limpieza futura de objetos sin registro (A7) necesita un plan propio, revisado y autorizado.

console.error(
  "cleanup-legacy-models.mjs está bloqueado: los archivos guardados y sus objetos se conservan (Fase 1.2, B1).",
);
process.exitCode = 1;
