-- Catálogo de servicios (módulo Servicios y Cotizaciones, fase 1).
--
-- * measurement_units: unidades configurables (m², metro lineal, punto, proyecto,
--   espacio, mes...). Se desactivan con is_active; nunca se eliminan mientras un
--   servicio o una versión las referencien (FK RESTRICT).
-- * services: estado actual de cada servicio del tabulador. Las 3 modalidades
--   llave en mano usan el mismo modelo (kind = 'turnkey', tarifa por m²). Sin
--   eliminación física: la baja es is_active = false.
-- * service_versions: historial inmutable. Cada cambio registra una copia completa
--   del servicio y de su unidad, para que una cotización futura conserve la tarifa,
--   la unidad y la descripción vigentes al cotizar aunque el servicio cambie.
--   Un índice único parcial impide dos versiones vigentes del mismo servicio y un
--   trigger impide modificar o borrar versiones (solo is_current pasa a false).
--
-- Escalas alineadas con QUOTE_DECIMAL_FORMATS (src/domain/quoteTotals.js): tarifa
-- NUMERIC(14,2). Tarifas en USD (currency_code fijo, copiado en cada versión).
-- created_by, updated_by y changed_by admiten NULL para cargas del sistema (la
-- migración de datos de los 19 servicios no tiene un usuario responsable).
--
-- Solo crea objetos nuevos y vacíos: no modifica tablas ni datos existentes y no
-- carga servicios; la carga inicial será una migración de datos independiente.
BEGIN;

CREATE TYPE public.service_kind AS ENUM ('individual', 'turnkey');

CREATE TABLE public.measurement_units (
  id BIGSERIAL NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(80) NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  allows_decimals BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT measurement_units_pkey PRIMARY KEY (id),
  CONSTRAINT uq_measurement_units_code UNIQUE (code),
  CONSTRAINT chk_measurement_units_code CHECK (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  CONSTRAINT chk_measurement_units_name CHECK (btrim(name) <> ''),
  CONSTRAINT chk_measurement_units_symbol CHECK (btrim(symbol) <> ''),
  CONSTRAINT chk_measurement_units_sort_order CHECK (sort_order >= 0)
);

CREATE TABLE public.services (
  id BIGSERIAL NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  kind public.service_kind NOT NULL DEFAULT 'individual',
  measurement_unit_id BIGINT NOT NULL,
  reference_rate NUMERIC(14,2) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT,
  updated_by BIGINT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT services_pkey PRIMARY KEY (id),
  CONSTRAINT uq_services_code UNIQUE (code),
  CONSTRAINT fk_services_measurement_unit
    FOREIGN KEY (measurement_unit_id) REFERENCES public.measurement_units(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_services_created_by
    FOREIGN KEY (created_by) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_services_updated_by
    FOREIGN KEY (updated_by) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT chk_services_code CHECK (code ~ '^[A-Z0-9]+([_-][A-Z0-9]+)*$'),
  CONSTRAINT chk_services_name CHECK (btrim(name) <> ''),
  CONSTRAINT chk_services_reference_rate CHECK (reference_rate >= 0),
  CONSTRAINT chk_services_currency_code CHECK (currency_code = 'USD'),
  CONSTRAINT chk_services_sort_order CHECK (sort_order >= 0)
);

-- Listado del catálogo en orden de visualización (cursor sort_order + id).
CREATE INDEX services_catalog_order_idx ON public.services (sort_order, id);
CREATE INDEX idx_services_measurement_unit_id ON public.services (measurement_unit_id);

CREATE TABLE public.service_versions (
  id BIGSERIAL NOT NULL,
  service_id BIGINT NOT NULL,
  version_number INTEGER NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  kind public.service_kind NOT NULL,
  measurement_unit_id BIGINT NOT NULL,
  unit_code VARCHAR(30) NOT NULL,
  unit_name VARCHAR(80) NOT NULL,
  unit_symbol VARCHAR(20) NOT NULL,
  unit_allows_decimals BOOLEAN NOT NULL,
  reference_rate NUMERIC(14,2) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  is_active BOOLEAN NOT NULL,
  sort_order INTEGER NOT NULL,
  change_note VARCHAR(255),
  changed_by BIGINT,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_versions_pkey PRIMARY KEY (id),
  CONSTRAINT uq_service_versions_service_version UNIQUE (service_id, version_number),
  CONSTRAINT fk_service_versions_service
    FOREIGN KEY (service_id) REFERENCES public.services(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_service_versions_measurement_unit
    FOREIGN KEY (measurement_unit_id) REFERENCES public.measurement_units(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_service_versions_changed_by
    FOREIGN KEY (changed_by) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT chk_service_versions_version_number CHECK (version_number >= 1),
  CONSTRAINT chk_service_versions_code CHECK (code ~ '^[A-Z0-9]+([_-][A-Z0-9]+)*$'),
  CONSTRAINT chk_service_versions_name CHECK (btrim(name) <> ''),
  CONSTRAINT chk_service_versions_reference_rate CHECK (reference_rate >= 0),
  CONSTRAINT chk_service_versions_currency_code CHECK (currency_code = 'USD'),
  CONSTRAINT chk_service_versions_sort_order CHECK (sort_order >= 0)
);

-- Una sola versión vigente por servicio (mismo patrón que file_versions).
CREATE UNIQUE INDEX uq_service_versions_current ON public.service_versions (service_id) WHERE is_current;
CREATE INDEX idx_service_versions_measurement_unit_id ON public.service_versions (measurement_unit_id);

-- Historial inmutable: solo se permite retirar la marca de vigencia (true → false).
-- search_path vacío: la función no depende de objetos resolubles por nombre.
CREATE FUNCTION public.prevent_service_version_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'service_versions es un historial inmutable; no se pueden eliminar versiones.'
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current')
     OR (NOT OLD.is_current AND NEW.is_current) THEN
    RAISE EXCEPTION 'service_versions es un historial inmutable; solo puede retirarse la vigencia de una versión.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

-- Una función de trigger no puede invocarse directamente; se retira igualmente el
-- EXECUTE predeterminado de PUBLIC para no ampliar la superficie expuesta.
REVOKE EXECUTE ON FUNCTION public.prevent_service_version_mutation() FROM PUBLIC;

CREATE TRIGGER service_versions_immutable
  BEFORE UPDATE OR DELETE ON public.service_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_version_mutation();

-- Mismo criterio que el resto de tablas: RLS activo y sin políticas.
ALTER TABLE public.measurement_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_versions ENABLE ROW LEVEL SECURITY;

-- Regla de D-2 para tablas nuevas, solo si existen los roles de Supabase.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.measurement_units FROM anon, authenticated, service_role';
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.services FROM anon, authenticated, service_role';
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.service_versions FROM anon, authenticated, service_role';
  END IF;
END
$$;

COMMIT;
