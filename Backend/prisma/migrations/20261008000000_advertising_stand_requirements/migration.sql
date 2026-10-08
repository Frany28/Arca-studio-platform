-- La categoría histórica no se renombra ni se convierte en stand publicitario.
ALTER TYPE public.project_type ADD VALUE IF NOT EXISTS 'advertising_stand';

-- Sin default ni backfill: las solicitudes anteriores y los demás tipos conservan NULL.
ALTER TABLE public.project_requests ADD COLUMN stand_requirements jsonb;

-- El cast a text evita usar el nuevo valor del enum antes del commit de la migración.
ALTER TABLE public.project_requests ADD CONSTRAINT project_requests_stand_requirements_type_check
  CHECK (stand_requirements IS NULL OR (
    project_type::text = 'advertising_stand'
    AND jsonb_typeof(stand_requirements) = 'object'
  ));
