-- Unidades de medida: unidades base y denominaciones personalizadas (arquitectura B2).
--
-- * measurement_units sigue siendo el catálogo de unidades base (código estable,
--   nombre completo, abreviatura, decimales). Solo se añaden restricciones de
--   consistencia: abreviatura sin espacios sobrantes y de hasta 10 caracteres, y
--   unicidad de abreviaturas y nombres equivalentes (mayúsculas, NFKC: m2 = m²).
-- * measurement_unit_denominations: denominaciones personalizadas que comparten una
--   unidad base (m² + "de construcción"). No tienen reglas propias: decimales y
--   compatibilidad se leen de la base. No se eliminan (is_active) y su base no puede
--   cambiar (trigger), para que la clave foránea compuesta de services sea estable.
-- * services.unit_denomination_id: denominación opcional. La clave foránea compuesta
--   (unit_denomination_id, measurement_unit_id) garantiza que pertenezca a la misma
--   unidad base del servicio; con NULL el servicio usa solo la base.
-- * service_versions conserva el id y el texto de la denominación de cada versión; el
--   trigger de inmutabilidad existente compara la fila completa y cubre estas columnas.
--
-- Aditiva: no modifica columnas ni restricciones existentes ni datos (las tablas del
-- catálogo estaban vacías al prepararla). No carga unidades: la carga inicial está en
-- prisma/seeds/measurement_units.sql y requiere autorización independiente.
BEGIN;

-- 1. Consistencia del catálogo de unidades base.
ALTER TABLE public.measurement_units
  ADD CONSTRAINT chk_measurement_units_symbol_format CHECK (symbol = btrim(symbol) AND char_length(symbol) <= 10);
CREATE UNIQUE INDEX uq_measurement_units_symbol_key ON public.measurement_units (lower(normalize(symbol, NFKC)));
CREATE UNIQUE INDEX uq_measurement_units_name_key ON public.measurement_units (lower(btrim(name)));

-- 2. Denominaciones personalizadas.
CREATE TABLE public.measurement_unit_denominations (
  id BIGSERIAL NOT NULL,
  measurement_unit_id BIGINT NOT NULL,
  denomination VARCHAR(80) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT,
  updated_by BIGINT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT measurement_unit_denominations_pkey PRIMARY KEY (id),
  -- Destino de la clave foránea compuesta de services.
  CONSTRAINT uq_measurement_unit_denominations_id_unit UNIQUE (id, measurement_unit_id),
  CONSTRAINT fk_measurement_unit_denominations_unit
    FOREIGN KEY (measurement_unit_id) REFERENCES public.measurement_units(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_measurement_unit_denominations_created_by
    FOREIGN KEY (created_by) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_measurement_unit_denominations_updated_by
    FOREIGN KEY (updated_by) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT chk_measurement_unit_denominations_text
    CHECK (denomination = btrim(denomination) AND denomination <> '' AND denomination !~ '\s{2,}')
);

-- Sin duplicados equivalentes dentro de una misma unidad base. Cubre también el
-- índice de la clave foránea hacia measurement_units (columna inicial).
CREATE UNIQUE INDEX uq_measurement_unit_denominations_key
  ON public.measurement_unit_denominations (measurement_unit_id, lower(normalize(denomination, NFKC)));

-- La unidad base de una denominación no cambia nunca.
-- search_path vacío: la función no depende de objetos resolubles por nombre.
CREATE FUNCTION public.prevent_denomination_unit_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.measurement_unit_id IS DISTINCT FROM OLD.measurement_unit_id THEN
    RAISE EXCEPTION 'La unidad base de una denominación no se puede modificar.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_denomination_unit_change() FROM PUBLIC;

CREATE TRIGGER measurement_unit_denominations_unit_immutable
  BEFORE UPDATE OF measurement_unit_id ON public.measurement_unit_denominations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_denomination_unit_change();

-- 3. Denominación opcional del servicio, de su misma unidad base.
ALTER TABLE public.services ADD COLUMN unit_denomination_id BIGINT;
ALTER TABLE public.services
  ADD CONSTRAINT fk_services_unit_denomination
    FOREIGN KEY (unit_denomination_id, measurement_unit_id)
    REFERENCES public.measurement_unit_denominations (id, measurement_unit_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX idx_services_unit_denomination_id ON public.services (unit_denomination_id)
  WHERE unit_denomination_id IS NOT NULL;

-- 4. Copia histórica de la denominación en cada versión.
ALTER TABLE public.service_versions ADD COLUMN unit_denomination_id BIGINT;
ALTER TABLE public.service_versions ADD COLUMN unit_denomination VARCHAR(80);
ALTER TABLE public.service_versions
  ADD CONSTRAINT fk_service_versions_unit_denomination
    FOREIGN KEY (unit_denomination_id) REFERENCES public.measurement_unit_denominations(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE public.service_versions
  ADD CONSTRAINT chk_service_versions_unit_denomination
    CHECK ((unit_denomination_id IS NULL) = (unit_denomination IS NULL));
CREATE INDEX idx_service_versions_unit_denomination_id ON public.service_versions (unit_denomination_id)
  WHERE unit_denomination_id IS NOT NULL;

-- Mismo criterio que el resto de tablas: RLS activo y sin políticas.
ALTER TABLE public.measurement_unit_denominations ENABLE ROW LEVEL SECURITY;

-- Regla de D-2 para tablas nuevas, solo si existen los roles de Supabase.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.measurement_unit_denominations FROM anon, authenticated, service_role';
  END IF;
END
$$;

COMMIT;
