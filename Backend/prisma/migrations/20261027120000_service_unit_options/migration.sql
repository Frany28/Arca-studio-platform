-- Unidades de medida alternativas por servicio (módulo Servicios y Cotizaciones).
--
-- Un servicio del tabulador puede medirse con varias unidades («Por Proyecto / Espacio»,
-- «Por Minuto / Proyecto»). Cada unidad puede tener una tarifa específica o quedar pendiente
-- de validación comercial; una unidad pendiente nunca se cotiza.
--
-- * service_unit_options: unidades vigentes de cada servicio, de 1 a 10, en posiciones 1..n.
--   La posición 1 es la unidad principal y coincide siempre con services.measurement_unit_id y
--   services.unit_denomination_id, que se conservan para los filtros, etiquetas y consultas
--   existentes. reference_rate NULL = tarifa pendiente de validación comercial. Con una sola
--   unidad su tarifa es la del servicio (services.reference_rate); con varias, la tarifa del
--   servicio es la de referencia del tabulador y cada unidad lleva la suya. presentation_label
--   sustituye a la etiqueta compuesta («Global por Proyecto» en lugar de «proy.»).
-- * service_version_unit_options: copia inmutable de esas unidades en cada versión del servicio
--   (unidad, denominación, etiqueta y tarifa), con el mismo criterio que service_versions.
-- * quote_items.service_version_unit_option_id: unidad cotizada, de la misma versión del
--   servicio (FK compuesta). La tarifa de referencia del concepto es la de esa unidad.
--
-- PostgreSQL mantiene la coherencia para cualquier escritor: un trigger sincroniza la posición 1
-- con la unidad del servicio (y la tarifa de una unidad única), otro copia las unidades vigentes
-- en cada versión nueva, y las reglas entre tablas (posiciones 1..n, unidad principal igual a la
-- del servicio y tarifa única igual a la del servicio) se comprueban con triggers de restricción
-- diferidos al COMMIT, porque el backend escribe en varias sentencias de una transacción.
--
-- Datos existentes: cada servicio y cada versión reciben su unidad actual en la posición 1, y
-- cada concepto de cotización apunta a la unidad principal de su versión. Para esto último se
-- desactiva quote_items_immutable solo dentro de esta transacción (el DDL es transaccional: un
-- fallo lo restaura) y se reactiva antes de terminar. No borra ni modifica otros datos.
BEGIN;

-- 1. Unidades vigentes de cada servicio.
CREATE TABLE public.service_unit_options (
  id BIGSERIAL NOT NULL,
  service_id BIGINT NOT NULL,
  position SMALLINT NOT NULL,
  measurement_unit_id BIGINT NOT NULL,
  unit_denomination_id BIGINT,
  presentation_label VARCHAR(80),
  reference_rate NUMERIC(14,2),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_unit_options_pkey PRIMARY KEY (id),
  CONSTRAINT uq_service_unit_options_position UNIQUE (service_id, position),
  CONSTRAINT uq_service_unit_options_unit UNIQUE NULLS NOT DISTINCT (service_id, measurement_unit_id, unit_denomination_id),
  CONSTRAINT fk_service_unit_options_service
    FOREIGN KEY (service_id) REFERENCES public.services(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_service_unit_options_measurement_unit
    FOREIGN KEY (measurement_unit_id) REFERENCES public.measurement_units(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_service_unit_options_unit_denomination
    FOREIGN KEY (unit_denomination_id, measurement_unit_id) REFERENCES public.measurement_unit_denominations(id, measurement_unit_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT chk_service_unit_options_position CHECK (position BETWEEN 1 AND 10),
  CONSTRAINT chk_service_unit_options_presentation_label CHECK (presentation_label IS NULL OR (presentation_label = btrim(presentation_label) AND presentation_label <> '' AND presentation_label !~ '\s{2,}')),
  CONSTRAINT chk_service_unit_options_reference_rate CHECK (reference_rate IS NULL OR reference_rate >= 0)
);

CREATE INDEX idx_service_unit_options_measurement_unit_id ON public.service_unit_options (measurement_unit_id);
CREATE INDEX idx_service_unit_options_unit_denomination_id ON public.service_unit_options (unit_denomination_id)
  WHERE unit_denomination_id IS NOT NULL;

-- 2. Copia inmutable de las unidades en cada versión del servicio.
CREATE TABLE public.service_version_unit_options (
  id BIGSERIAL NOT NULL,
  service_version_id BIGINT NOT NULL,
  position SMALLINT NOT NULL,
  measurement_unit_id BIGINT NOT NULL,
  unit_code VARCHAR(30) NOT NULL,
  unit_name VARCHAR(80) NOT NULL,
  unit_symbol VARCHAR(20) NOT NULL,
  unit_allows_decimals BOOLEAN NOT NULL,
  unit_denomination_id BIGINT,
  unit_denomination VARCHAR(80),
  presentation_label VARCHAR(80),
  reference_rate NUMERIC(14,2),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_version_unit_options_pkey PRIMARY KEY (id),
  CONSTRAINT uq_service_version_unit_options_position UNIQUE (service_version_id, position),
  CONSTRAINT uq_service_version_unit_options_id_version UNIQUE (id, service_version_id),
  CONSTRAINT fk_service_version_unit_options_version
    FOREIGN KEY (service_version_id) REFERENCES public.service_versions(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_service_version_unit_options_measurement_unit
    FOREIGN KEY (measurement_unit_id) REFERENCES public.measurement_units(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_service_version_unit_options_unit_denomination
    FOREIGN KEY (unit_denomination_id) REFERENCES public.measurement_unit_denominations(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT chk_service_version_unit_options_position CHECK (position BETWEEN 1 AND 10),
  CONSTRAINT chk_service_version_unit_options_denomination CHECK ((unit_denomination_id IS NULL) = (unit_denomination IS NULL)),
  CONSTRAINT chk_service_version_unit_options_reference_rate CHECK (reference_rate IS NULL OR reference_rate >= 0)
);

CREATE INDEX idx_service_version_unit_options_measurement_unit_id ON public.service_version_unit_options (measurement_unit_id);
CREATE INDEX idx_service_version_unit_options_unit_denomination_id ON public.service_version_unit_options (unit_denomination_id)
  WHERE unit_denomination_id IS NOT NULL;

-- 3. Datos existentes: la unidad actual de cada servicio y de cada versión pasa a la posición 1.
INSERT INTO public.service_unit_options (service_id, position, measurement_unit_id, unit_denomination_id, reference_rate, created_at, updated_at)
SELECT s.id, 1, s.measurement_unit_id, s.unit_denomination_id, s.reference_rate, s.created_at, s.updated_at
FROM public.services s;

INSERT INTO public.service_version_unit_options (
  service_version_id, position, measurement_unit_id, unit_code, unit_name, unit_symbol, unit_allows_decimals,
  unit_denomination_id, unit_denomination, reference_rate, created_at
)
SELECT v.id, 1, v.measurement_unit_id, v.unit_code, v.unit_name, v.unit_symbol, v.unit_allows_decimals,
  v.unit_denomination_id, v.unit_denomination, v.reference_rate, v.created_at
FROM public.service_versions v;

-- 4. Las copias por versión no se modifican ni se eliminan (sin excepción de vigencia: no la tienen).
CREATE FUNCTION public.prevent_service_version_unit_option_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'service_version_unit_options pertenece a una versión inmutable; no se pueden modificar ni eliminar sus unidades.'
    USING ERRCODE = '55000';
END
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_service_version_unit_option_mutation() FROM PUBLIC;

CREATE TRIGGER service_version_unit_options_immutable
  BEFORE UPDATE OR DELETE ON public.service_version_unit_options
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_version_unit_option_mutation();

-- 5. Sincronización: services sigue siendo la fuente de la unidad principal para cualquier
-- escritura (backend, fixtures o mantenimiento). Al crear un servicio se registra su unidad en la
-- posición 1; al cambiar su unidad o denominación se actualiza la posición 1 (el texto comercial
-- describía la unidad anterior y se retira), y con una sola unidad su tarifa sigue a la del
-- servicio. El backend sustituye las unidades antes de actualizar el servicio, así que en su caso
-- estas sentencias no cambian nada.
CREATE FUNCTION public.sync_service_primary_unit_option() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.service_unit_options (service_id, position, measurement_unit_id, unit_denomination_id, reference_rate)
    VALUES (NEW.id, 1, NEW.measurement_unit_id, NEW.unit_denomination_id, NEW.reference_rate)
    ON CONFLICT (service_id, position) DO NOTHING;
    RETURN NULL;
  END IF;
  UPDATE public.service_unit_options
  SET measurement_unit_id = NEW.measurement_unit_id, unit_denomination_id = NEW.unit_denomination_id,
      presentation_label = NULL, updated_at = now()
  WHERE service_id = NEW.id AND position = 1
    AND (measurement_unit_id IS DISTINCT FROM NEW.measurement_unit_id OR unit_denomination_id IS DISTINCT FROM NEW.unit_denomination_id);
  UPDATE public.service_unit_options
  SET reference_rate = NEW.reference_rate, updated_at = now()
  WHERE service_id = NEW.id AND position = 1 AND reference_rate IS DISTINCT FROM NEW.reference_rate
    AND NOT EXISTS (SELECT 1 FROM public.service_unit_options alternative WHERE alternative.service_id = NEW.id AND alternative.position > 1);
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION public.sync_service_primary_unit_option() FROM PUBLIC;

CREATE TRIGGER services_sync_primary_unit_option
  AFTER INSERT OR UPDATE OF measurement_unit_id, unit_denomination_id, reference_rate ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.sync_service_primary_unit_option();

-- Cada versión nueva copia las unidades vigentes de su servicio (unidad, denominación, texto
-- comercial y tarifa): la copia no depende de que quien inserta la versión la recuerde. La fila
-- de la versión es la autoridad sobre su unidad principal: si coincide con la principal vigente se
-- copian todas las unidades (con una sola, con la tarifa de la versión); si no (una escritura
-- directa que describe otra unidad), se copia solo la unidad de la versión con su tarifa.
CREATE FUNCTION public.snapshot_service_version_unit_options() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.service_unit_options WHERE service_id = NEW.service_id;
  IF EXISTS (
    SELECT 1 FROM public.service_unit_options
    WHERE service_id = NEW.service_id AND position = 1
      AND measurement_unit_id = NEW.measurement_unit_id AND unit_denomination_id IS NOT DISTINCT FROM NEW.unit_denomination_id
  ) THEN
    INSERT INTO public.service_version_unit_options (
      service_version_id, position, measurement_unit_id, unit_code, unit_name, unit_symbol, unit_allows_decimals,
      unit_denomination_id, unit_denomination, presentation_label, reference_rate
    )
    SELECT NEW.id, o.position, u.id, u.code, u.name, u.symbol, u.allows_decimals, d.id, d.denomination, o.presentation_label,
      CASE WHEN v_count = 1 THEN NEW.reference_rate ELSE o.reference_rate END
    FROM public.service_unit_options o
    INNER JOIN public.measurement_units u ON u.id = o.measurement_unit_id
    LEFT JOIN public.measurement_unit_denominations d ON d.id = o.unit_denomination_id
    WHERE o.service_id = NEW.service_id
    ORDER BY o.position;
  ELSE
    INSERT INTO public.service_version_unit_options (
      service_version_id, position, measurement_unit_id, unit_code, unit_name, unit_symbol, unit_allows_decimals,
      unit_denomination_id, unit_denomination, reference_rate
    )
    VALUES (NEW.id, 1, NEW.measurement_unit_id, NEW.unit_code, NEW.unit_name, NEW.unit_symbol, NEW.unit_allows_decimals,
      NEW.unit_denomination_id, NEW.unit_denomination, NEW.reference_rate);
  END IF;
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION public.snapshot_service_version_unit_options() FROM PUBLIC;

CREATE TRIGGER service_versions_snapshot_unit_options
  AFTER INSERT ON public.service_versions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_service_version_unit_options();

-- 6. Coherencia de las unidades vigentes con su servicio, comprobada al COMMIT.
CREATE FUNCTION public.assert_service_unit_options() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_service_id BIGINT;
  v_service record;
  v_count INTEGER;
  v_max_position INTEGER;
  v_primary record;
BEGIN
  -- IF y no CASE: PL/pgSQL prepara todas las ramas de un CASE y services no tiene service_id.
  IF TG_TABLE_NAME = 'services' THEN
    v_service_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_service_id := OLD.service_id;
  ELSE
    v_service_id := NEW.service_id;
  END IF;
  SELECT id, measurement_unit_id, unit_denomination_id, reference_rate INTO v_service
  FROM public.services WHERE id = v_service_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*), max(position) INTO v_count, v_max_position
  FROM public.service_unit_options WHERE service_id = v_service_id;
  IF v_count = 0 OR v_max_position <> v_count THEN
    RAISE EXCEPTION 'El servicio % debe tener unidades en posiciones consecutivas desde 1.', v_service_id
      USING ERRCODE = '23514', CONSTRAINT = 'chk_service_unit_options_sequence';
  END IF;
  SELECT measurement_unit_id, unit_denomination_id, reference_rate INTO v_primary
  FROM public.service_unit_options WHERE service_id = v_service_id AND position = 1;
  IF v_primary.measurement_unit_id IS DISTINCT FROM v_service.measurement_unit_id
     OR v_primary.unit_denomination_id IS DISTINCT FROM v_service.unit_denomination_id THEN
    RAISE EXCEPTION 'La unidad principal del servicio % no coincide con su unidad de medida.', v_service_id
      USING ERRCODE = '23514', CONSTRAINT = 'chk_service_unit_options_primary';
  END IF;
  IF v_count = 1 AND v_primary.reference_rate IS DISTINCT FROM v_service.reference_rate THEN
    RAISE EXCEPTION 'La tarifa de la única unidad del servicio % debe ser la del servicio.', v_service_id
      USING ERRCODE = '23514', CONSTRAINT = 'chk_service_unit_options_single_rate';
  END IF;
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION public.assert_service_unit_options() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER service_unit_options_consistent
  AFTER INSERT OR UPDATE OR DELETE ON public.service_unit_options
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_service_unit_options();

CREATE CONSTRAINT TRIGGER services_unit_options_consistent
  AFTER INSERT OR UPDATE OF measurement_unit_id, unit_denomination_id, reference_rate ON public.services
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_service_unit_options();

-- 7. Coherencia de las unidades copiadas con su versión, comprobada al COMMIT.
CREATE FUNCTION public.assert_service_version_unit_options() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_version_id BIGINT;
  v_version record;
  v_count INTEGER;
  v_max_position INTEGER;
  v_primary record;
BEGIN
  IF TG_TABLE_NAME = 'service_versions' THEN
    v_version_id := NEW.id;
  ELSE
    v_version_id := NEW.service_version_id;
  END IF;
  SELECT id, measurement_unit_id, unit_denomination_id, reference_rate INTO v_version
  FROM public.service_versions WHERE id = v_version_id;
  SELECT count(*), max(position) INTO v_count, v_max_position
  FROM public.service_version_unit_options WHERE service_version_id = v_version_id;
  IF v_count = 0 OR v_max_position <> v_count THEN
    RAISE EXCEPTION 'La versión de servicio % debe copiar sus unidades en posiciones consecutivas desde 1.', v_version_id
      USING ERRCODE = '23514', CONSTRAINT = 'chk_service_version_unit_options_sequence';
  END IF;
  SELECT measurement_unit_id, unit_denomination_id, reference_rate INTO v_primary
  FROM public.service_version_unit_options WHERE service_version_id = v_version_id AND position = 1;
  IF v_primary.measurement_unit_id IS DISTINCT FROM v_version.measurement_unit_id
     OR v_primary.unit_denomination_id IS DISTINCT FROM v_version.unit_denomination_id
     OR (v_count = 1 AND v_primary.reference_rate IS DISTINCT FROM v_version.reference_rate) THEN
    RAISE EXCEPTION 'Las unidades copiadas no coinciden con la versión de servicio %.', v_version_id
      USING ERRCODE = '23514', CONSTRAINT = 'chk_service_version_unit_options_primary';
  END IF;
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION public.assert_service_version_unit_options() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER service_versions_unit_options_consistent
  AFTER INSERT ON public.service_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_service_version_unit_options();

CREATE CONSTRAINT TRIGGER service_version_unit_options_consistent
  AFTER INSERT ON public.service_version_unit_options
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_service_version_unit_options();

-- 8. Unidad cotizada en cada concepto, de la misma versión del servicio.
ALTER TABLE public.quote_items ADD COLUMN service_version_unit_option_id BIGINT;

ALTER TABLE public.quote_items DISABLE TRIGGER quote_items_immutable;
UPDATE public.quote_items i
SET service_version_unit_option_id = o.id
FROM public.service_version_unit_options o
WHERE o.service_version_id = i.service_version_id AND o.position = 1;
ALTER TABLE public.quote_items ENABLE TRIGGER quote_items_immutable;

ALTER TABLE public.quote_items ALTER COLUMN service_version_unit_option_id SET NOT NULL;
ALTER TABLE public.quote_items
  ADD CONSTRAINT fk_quote_items_service_version_unit_option
    FOREIGN KEY (service_version_unit_option_id, service_version_id)
    REFERENCES public.service_version_unit_options(id, service_version_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX idx_quote_items_service_version_unit_option_id ON public.quote_items (service_version_unit_option_id);

-- 9. Cambio de base de una denominación: también la bloquean las unidades alternativas vigentes
-- y copiadas (mismo criterio que services y service_versions en 20261021120000).
CREATE OR REPLACE FUNCTION public.prevent_denomination_unit_change() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.measurement_unit_id IS NOT DISTINCT FROM OLD.measurement_unit_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.services WHERE unit_denomination_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.service_versions WHERE unit_denomination_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.service_unit_options WHERE unit_denomination_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.service_version_unit_options WHERE unit_denomination_id = OLD.id) THEN
    RAISE EXCEPTION 'La unidad base de una denominación con servicios o versiones históricas no se puede modificar.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.prevent_denomination_unit_change() FROM PUBLIC;

-- 10. Mismo criterio que el resto de tablas: RLS activo y sin políticas, y regla D-2.
ALTER TABLE public.service_unit_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_version_unit_options ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.service_unit_options FROM anon, authenticated, service_role';
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.service_version_unit_options FROM anon, authenticated, service_role';
  END IF;
END
$$;

COMMIT;
