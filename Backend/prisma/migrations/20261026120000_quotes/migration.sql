-- Cotizaciones (módulo Servicios y Cotizaciones, fase 2).
--
-- * quotes: identidad estable de cada cotización (código visible COT-001 generado a
--   partir del id, autor y fechas). Su contenido vive en las versiones.
-- * quote_versions: historial inmutable. Cada guardado registra una versión completa
--   (cliente, proyecto, observaciones y total) y retira la vigencia de la anterior. Un
--   índice único parcial impide dos versiones vigentes y un trigger impide modificar o
--   borrar versiones (solo is_current pasa de true a false), igual que service_versions.
--   Se copian el nombre del cliente y del proyecto: el documento conserva lo cotizado
--   aunque esos registros cambien después.
-- * quote_items: conceptos de cada versión, también inmutables (sin UPDATE ni DELETE).
--   Referencian la versión del servicio cotizada (service_version_id), que conserva
--   nombre, unidad, modalidad y tarifa de referencia, y el servicio (service_id) para la
--   regla «modalidad bloqueada por cotizaciones» (SERVICE_MODALITY_IN_USE). La clave
--   foránea compuesta impide combinar la versión de un servicio con otro servicio.
--
-- Escalas alineadas con QUOTE_DECIMAL_FORMATS (src/domain/quoteTotals.js): cantidad
-- NUMERIC(12,3), tarifa e importes NUMERIC(14,2). El CHECK del subtotal replica el motor
-- de cálculo (round() de PostgreSQL redondea la mitad hacia arriba en positivos).
--
-- Solo crea objetos nuevos y vacíos. El único cambio sobre una tabla existente es la
-- restricción UNIQUE (id, service_id) de service_versions, siempre cierta porque id es la
-- clave primaria; la necesita la clave foránea compuesta de quote_items. No modifica datos.
BEGIN;

ALTER TABLE public.service_versions
  ADD CONSTRAINT uq_service_versions_id_service UNIQUE (id, service_id);

CREATE TABLE public.quotes (
  id BIGSERIAL NOT NULL,
  code VARCHAR(30) NOT NULL,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT quotes_pkey PRIMARY KEY (id),
  CONSTRAINT uq_quotes_code UNIQUE (code),
  CONSTRAINT fk_quotes_created_by
    FOREIGN KEY (created_by) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_quotes_updated_by
    FOREIGN KEY (updated_by) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT chk_quotes_code CHECK (code ~ '^COT-[0-9]{3,}$')
);

-- Listado por fecha (filtro por rango) con el id como desempate del cursor.
CREATE INDEX quotes_created_cursor_idx ON public.quotes (created_at, id);

CREATE TABLE public.quote_versions (
  id BIGSERIAL NOT NULL,
  quote_id BIGINT NOT NULL,
  version_number INTEGER NOT NULL,
  client_id BIGINT NOT NULL,
  client_name VARCHAR(150) NOT NULL,
  project_id BIGINT NOT NULL,
  project_name VARCHAR(150) NOT NULL,
  notes TEXT,
  services_total NUMERIC(14,2) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT quote_versions_pkey PRIMARY KEY (id),
  CONSTRAINT uq_quote_versions_quote_version UNIQUE (quote_id, version_number),
  CONSTRAINT fk_quote_versions_quote
    FOREIGN KEY (quote_id) REFERENCES public.quotes(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_quote_versions_client
    FOREIGN KEY (client_id) REFERENCES public.clients(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_quote_versions_project
    FOREIGN KEY (project_id) REFERENCES public.projects(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_quote_versions_created_by
    FOREIGN KEY (created_by) REFERENCES public.users(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT chk_quote_versions_version_number CHECK (version_number >= 1),
  CONSTRAINT chk_quote_versions_client_name CHECK (btrim(client_name) <> ''),
  CONSTRAINT chk_quote_versions_project_name CHECK (btrim(project_name) <> ''),
  CONSTRAINT chk_quote_versions_notes CHECK (notes IS NULL OR (btrim(notes) <> '' AND char_length(notes) <= 2000)),
  CONSTRAINT chk_quote_versions_services_total CHECK (services_total >= 0),
  CONSTRAINT chk_quote_versions_currency_code CHECK (currency_code = 'USD')
);

-- Una sola versión vigente por cotización; el listado lee siempre la vigente.
CREATE UNIQUE INDEX uq_quote_versions_current ON public.quote_versions (quote_id) WHERE is_current;
-- Orden por total (cursor services_total + quote_id) sobre las versiones vigentes.
CREATE INDEX quote_versions_current_total_idx ON public.quote_versions (services_total, quote_id) WHERE is_current;
CREATE INDEX idx_quote_versions_client_id ON public.quote_versions (client_id);
CREATE INDEX idx_quote_versions_project_id ON public.quote_versions (project_id);

CREATE TABLE public.quote_items (
  id BIGSERIAL NOT NULL,
  quote_version_id BIGINT NOT NULL,
  line_number INTEGER NOT NULL,
  service_id BIGINT NOT NULL,
  service_version_id BIGINT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  unit_rate NUMERIC(14,2) NOT NULL,
  reference_rate NUMERIC(14,2) NOT NULL,
  subtotal NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT quote_items_pkey PRIMARY KEY (id),
  CONSTRAINT uq_quote_items_version_line UNIQUE (quote_version_id, line_number),
  CONSTRAINT uq_quote_items_version_service UNIQUE (quote_version_id, service_id),
  CONSTRAINT fk_quote_items_quote_version
    FOREIGN KEY (quote_version_id) REFERENCES public.quote_versions(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_quote_items_service
    FOREIGN KEY (service_id) REFERENCES public.services(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_quote_items_service_version
    FOREIGN KEY (service_version_id, service_id) REFERENCES public.service_versions(id, service_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT chk_quote_items_line_number CHECK (line_number >= 1),
  CONSTRAINT chk_quote_items_quantity CHECK (quantity > 0),
  CONSTRAINT chk_quote_items_unit_rate CHECK (unit_rate >= 0),
  CONSTRAINT chk_quote_items_reference_rate CHECK (reference_rate >= 0),
  CONSTRAINT chk_quote_items_subtotal CHECK (subtotal = round(quantity * unit_rate, 2))
);

-- Uso de un servicio en cotizaciones (SERVICE_MODALITY_IN_USE) sin recorrer las versiones.
CREATE INDEX idx_quote_items_service_id ON public.quote_items (service_id);
CREATE INDEX idx_quote_items_service_version_id ON public.quote_items (service_version_id);

-- Historial inmutable de versiones: solo se permite retirar la vigencia (true → false).
-- search_path vacío: la función no depende de objetos resolubles por nombre.
CREATE FUNCTION public.prevent_quote_version_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quote_versions es un historial inmutable; no se pueden eliminar versiones.'
      USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current')
     OR (NOT OLD.is_current AND NEW.is_current) THEN
    RAISE EXCEPTION 'quote_versions es un historial inmutable; solo puede retirarse la vigencia de una versión.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_quote_version_mutation() FROM PUBLIC;

CREATE TRIGGER quote_versions_immutable
  BEFORE UPDATE OR DELETE ON public.quote_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_quote_version_mutation();

-- Los conceptos pertenecen a una versión inmutable: no se modifican ni se eliminan.
CREATE FUNCTION public.prevent_quote_item_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'quote_items pertenece a una versión inmutable; no se pueden modificar ni eliminar conceptos.'
    USING ERRCODE = '55000';
END
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_quote_item_mutation() FROM PUBLIC;

CREATE TRIGGER quote_items_immutable
  BEFORE UPDATE OR DELETE ON public.quote_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_quote_item_mutation();

-- Mismo criterio que el resto de tablas: RLS activo y sin políticas.
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

-- Regla de D-2 para tablas nuevas, solo si existen los roles de Supabase.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 THEN
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.quotes FROM anon, authenticated, service_role';
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.quote_versions FROM anon, authenticated, service_role';
    EXECUTE 'REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.quote_items FROM anon, authenticated, service_role';
  END IF;
END
$$;

COMMIT;
