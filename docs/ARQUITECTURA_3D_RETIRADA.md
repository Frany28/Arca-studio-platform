# Arquitectura 3D retirada y recuperación

## Motivo y reemplazo

El flujo GLB fue retirado en agosto de 2026 porque el peso de algunos modelos y
texturas afectaba la carga web. La experiencia activa usa imágenes
equirectangulares 2:1, clasificadas como `panorama`, servidas por el endpoint
autenticado de archivos y mostradas con Three.js.

Los renders planos, videos, documentos y sus observaciones no forman parte de
esta retirada. Las observaciones `viewer3d` se eliminaron porque sus referencias
espaciales no se pueden convertir de forma fiable a `yaw`/`pitch`.

## Piezas retiradas

- Dependencias `@google/model-viewer` y `@google/model-viewer-effects`, visor
  local, miniaturas GLB, efectos/materiales y configuración de iluminación.
- Tablas `model_processing_jobs` y `model_render_settings`.
- Servicios y repositorios de optimización, cola de procesamiento y ajustes de
  render; endpoints `GET/PUT /projects/:projectId/files/:fileId/render-settings`.
- Formatos de carga GLB/GLBF y scripts administrativos de modelos.
- Evento SSE `model.render-settings.updated`.

La migración `20260803000000_panorama_files` contiene el cambio de esquema. El
historial Git anterior a esa migración es la fuente de verdad del código
retirado; no se copiaron credenciales, URLs privadas ni claves de almacenamiento
en este documento.

## Contrato panorámico vigente

- `files.file_category = panorama` diferencia una imagen 360 de un render plano
  sin alterar su MIME `image/*`.
- Los comentarios usan `comment_type = panorama`, `target_id = files.id` y
  `target_metadata.selection = { kind: "panorama-point", yaw, pitch }`.
- El backend asigna `pointNumber` de manera transaccional por archivo.
- Los archivos siguen saliendo exclusivamente por
  `/projects/:projectId/files/:fileId/content`; las respuestas JSON no exponen
  rutas ni claves del almacenamiento.

## Recuperación futura de modelos 3D

1. Crear una migración nueva; no revertir ni editar migraciones ya desplegadas.
2. Restaurar desde Git los módulos de procesamiento, ajustes de render y visor,
   actualizándolos a las versiones de dependencias vigentes.
3. Añadir una categoría nueva como `model3d`; no reutilizar `panorama`, MIME ni
   sus comentarios.
4. Recrear tablas, restricciones, índices, RLS y permisos de los endpoints. La
   cola debe conservar claves de almacenamiento solo en datos internos.
5. Restaurar carga por streaming, validación de tamaño/formato, compensación S3
   y optimización asíncrona antes de publicar el archivo.
6. Introducir un tipo de comentario 3D nuevo y mantenerlo separado de `panorama`;
   no transformar automáticamente `yaw`/`pitch` en coordenadas de escena.
7. Restaurar eventos SSE únicamente después de aplicar el saneador público y
   añadir pruebas de no exposición de URLs o claves.
8. Ejecutar `pnpm db:migrate:dev --name restore_model3d` en desarrollo, revisar
   manualmente el SQL y usar `pnpm db:migrate:deploy` en despliegue. Nunca usar
   `prisma db push` ni `prisma migrate reset` sobre una base con datos.

Antes de desplegar la retirada actual se ejecuta
`node scripts/cleanup-legacy-models.mjs`; después se aplica la migración. Para la
imagen inicial se usa `node scripts/upload-project-panorama.mjs <ruta>`, que por
defecto exige un único proyecto llamado “Quinta Vella Vista”.
