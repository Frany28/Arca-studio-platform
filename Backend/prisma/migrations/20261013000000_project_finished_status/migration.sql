BEGIN;

-- Renombra la etiqueta sin recrear el tipo ni reescribir las filas que lo usan.
-- Afecta projects.status, projects.archived_from_status, project_stages.status
-- y project_milestones.status; conserva OID, índices, relaciones y fechas.
ALTER TYPE public.project_status RENAME VALUE 'completed' TO 'finished';

-- El historial usa VARCHAR, no el enum. Solo se normalizan los códigos;
-- se conservan IDs, responsables, notas, relaciones y changed_at.
UPDATE public.project_status_history
SET previous_status = CASE WHEN previous_status = 'completed' THEN 'finished' ELSE previous_status END,
    new_status = CASE WHEN new_status = 'completed' THEN 'finished' ELSE new_status END
WHERE previous_status = 'completed' OR new_status = 'completed';

-- audit_logs conserva sus snapshots originales como evidencia histórica.
COMMIT;
