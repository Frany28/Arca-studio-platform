-- Una sola unidad de medida por servicio (módulo Servicios y Cotizaciones).
--
-- Retira las unidades alternativas de 20261027120000_service_unit_options sin tocar su historial.
-- Los servicios que se cobraban de dos formas se separan antes en servicios independientes con el
-- comando de mantenimiento scripts/split-service-units.mjs (versiones nuevas y altas hechas por el
-- backend, con auditoría), de modo que esta migración solo fija la regla para cualquier escritor:
--
-- * service_unit_options: exactamente una unidad vigente por servicio (posición 1) y con tarifa
--   confirmada. Validado: la comprobación previa aborta si queda algún servicio por separar.
-- * service_version_unit_options: las versiones nuevas copian una sola unidad con tarifa. NOT VALID
--   conserva sin revalidar las copias históricas (una versión anterior con dos unidades o con una
--   tarifa pendiente), que siguen siendo inmutables y pueden estar referenciadas por quote_items.
--
-- Se conservan las tablas, los triggers de sincronización, copia e inmutabilidad y la clave
-- foránea de quote_items: la unidad cotizada y su texto comercial («Global por Proyecto») se
-- siguen leyendo de la copia por versión. No modifica datos, no desactiva triggers ni toca
-- secuencias.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.service_unit_options WHERE position > 1 OR reference_rate IS NULL) THEN
    RAISE EXCEPTION 'Hay servicios con unidades alternativas o tarifa pendiente: sepáralos en servicios independientes (scripts/split-service-units.mjs) antes de aplicar esta migración.'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE public.service_unit_options
  ADD CONSTRAINT chk_service_unit_options_single CHECK (position = 1),
  ADD CONSTRAINT chk_service_unit_options_rate_confirmed CHECK (reference_rate IS NOT NULL);

ALTER TABLE public.service_version_unit_options
  ADD CONSTRAINT chk_service_version_unit_options_single CHECK (position = 1) NOT VALID,
  ADD CONSTRAINT chk_service_version_unit_options_rate_confirmed CHECK (reference_rate IS NOT NULL) NOT VALID;

COMMIT;
