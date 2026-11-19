-- Fase 1.2 (B6): numeración de los puntos de panorámica por versión comentada.
--
-- Desde B6, un comentario de imagen de un archivo con la política 1.2 guarda la versión que comenta
-- (file_version_id) y sus puntos se numeran por versión: así el cliente no deduce cuántos comentarios
-- hay en versiones que no puede ver. El índice único anterior numeraba por destino sin versión.
--
-- Solo sustituye un índice. No escribe ni modifica filas. Con file_version_id NULL (comentarios
-- anteriores, archivos heredados y activación apagada) la unicidad es idéntica a la anterior: el índice
-- nuevo añade coalesce(file_version_id, 0), que vale 0 en todas las filas existentes, así que las filas
-- que cumplían el índice anterior cumplen el nuevo. Se crea el nuevo antes de retirar el anterior: en
-- ningún momento falta la garantía de unicidad.
--
-- Bloqueos: SHARE sobre project_comments mientras se construye el índice (bloquea escrituras de
-- comentarios, no lecturas) y ACCESS EXCLUSIVE breve al retirar el anterior. Si no obtiene un bloqueo
-- en 3 s o una sentencia supera 60 s, la transacción completa se revierte sin cambios.
--
-- Comprobaciones de solo lectura: prisma/checks/20261119120000_project_comment_version_points.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE UNIQUE INDEX project_comments_panorama_version_point_unique_idx
  ON public.project_comments (
    project_id,
    comment_type,
    coalesce(target_id, ''),
    coalesce(file_version_id, 0),
    ((target_metadata->>'pointNumber')::integer)
  )
  WHERE deleted_at IS NULL
    AND parent_comment_id IS NULL
    AND comment_type = 'panorama'::public.comment_type
    AND target_metadata ? 'pointNumber';

DROP INDEX public.project_comments_panorama_point_unique_idx;

COMMIT;
