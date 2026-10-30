-- IVA referencial de las cotizaciones (informativo, no es una liquidación fiscal).
--
-- Cada versión guarda la tasa y el importe con que se calculó, para que volver a editarla y su PDF
-- muestren los mismos valores aunque después cambie la tasa configurada (QUOTE_REFERENCE_VAT_RATE).
-- El total estimado con IVA no se guarda: es services_total + reference_vat_amount.
--
-- * reference_vat_enabled: la versión se calculó con IVA referencial. false cuando no había una tasa
--   configurada («pendiente de configuración»); las versiones anteriores quedan así, sin IVA.
-- * reference_vat_rate: porcentaje NUMERIC(5,2) entre 0 y 100 (QUOTE_DECIMAL_FORMATS.vatRate); 0 es
--   válido. Solo existe con el IVA habilitado.
-- * reference_vat_amount: services_total × tasa / 100 redondeado a 2 decimales, igual que el motor
--   (round() de PostgreSQL redondea la mitad hacia arriba en positivos); 0 sin IVA.
--
-- Solo añade columnas con valor por defecto y restricciones que esos valores cumplen: no modifica
-- filas (el trigger quote_versions_immutable no se dispara), no desactiva triggers ni toca secuencias.
BEGIN;

ALTER TABLE public.quote_versions ADD COLUMN reference_vat_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.quote_versions ADD COLUMN reference_vat_rate NUMERIC(5,2);
ALTER TABLE public.quote_versions ADD COLUMN reference_vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.quote_versions
  ADD CONSTRAINT chk_quote_versions_reference_vat_rate
    CHECK (reference_vat_rate IS NULL OR reference_vat_rate BETWEEN 0 AND 100),
  ADD CONSTRAINT chk_quote_versions_reference_vat CHECK (
    (reference_vat_enabled AND reference_vat_rate IS NOT NULL
      AND reference_vat_amount = round(services_total * reference_vat_rate / 100, 2))
    OR (NOT reference_vat_enabled AND reference_vat_rate IS NULL AND reference_vat_amount = 0)
  ),
  ADD CONSTRAINT chk_quote_versions_estimated_total_with_vat
    CHECK (services_total + reference_vat_amount <= 999999999999.99);

COMMIT;
