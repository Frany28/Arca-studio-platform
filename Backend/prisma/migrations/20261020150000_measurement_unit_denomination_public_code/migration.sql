-- Identificador público de las denominaciones de unidades de medida (UNID-001, UNID-002…).
--
-- * public_code es una columna generada (GENERATED ALWAYS … STORED) derivada del id interno:
--   'UNID-' + id con al menos tres dígitos ('UNID-001', 'UNID-999', 'UNID-1000'). Se usa
--   greatest(3, length) porque lpad trunca los números más largos que el ancho indicado.
-- * Unicidad y permanencia se heredan del id (BIGSERIAL): nunca se repite ni se reutiliza,
--   no depende de filtros, orden ni paginación y es segura ante inserciones concurrentes.
--   Puede haber saltos si una inserción se revierte; es aceptable.
-- * PostgreSQL no permite escribir una columna generada (INSERT/UPDATE explícitos fallan con
--   428C9), así que el código no puede introducirse ni editarse, ni siquiera por SQL directo.
-- * VARCHAR(24): 'UNID-' más los 19 dígitos del mayor BIGINT.
-- * Solo presentación: las relaciones (services.unit_denomination_id) y las reglas siguen
--   usando el id interno.
--
-- Aditiva: añadir la columna calcula el código de las filas existentes a partir de su id.
-- No modifica otras columnas, restricciones de B2, datos ni privilegios.
BEGIN;

ALTER TABLE public.measurement_unit_denominations ADD COLUMN public_code VARCHAR(24) GENERATED ALWAYS AS ('UNID-' || lpad(id::text, greatest(3, length(id::text)), '0')) STORED NOT NULL;

ALTER TABLE public.measurement_unit_denominations
  ADD CONSTRAINT uq_measurement_unit_denominations_public_code UNIQUE (public_code);

COMMIT;
