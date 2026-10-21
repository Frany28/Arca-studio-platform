-- Cambio controlado de la unidad base de una denominación personalizada.
--
-- * Sustituye el cuerpo de public.prevent_denomination_unit_change(): el trigger
--   measurement_unit_denominations_unit_immutable sigue siendo la barrera de PostgreSQL, pero
--   ahora solo rechaza (55000) el cambio de measurement_unit_id cuando la denominación tiene
--   referencias en public.services (activas o inactivas) o en public.service_versions. Sin
--   referencias, el cambio se permite; así ninguna versión histórica ni servicio queda con una
--   denominación de otra base.
-- * Concurrencia: measurement_unit_id forma parte de uq_measurement_unit_denominations_id_unit,
--   por lo que cambiarlo exige un bloqueo FOR UPDATE de la fila, incompatible con el FOR KEY
--   SHARE que toman las FK de services y service_versions al insertar o reasignar una
--   referencia. El trigger se ejecuta después de obtener ese bloqueo y, al ser VOLATILE, cada
--   consulta usa una instantánea nueva (READ COMMITTED): ve cualquier referencia confirmada
--   por la transacción que retenía el bloqueo.
-- * Seguridad: SECURITY INVOKER con search_path vacío. Solo pueden actualizar denominaciones
--   roles que ya leen services y service_versions (RLS sin políticas para anon/authenticated).
--   CREATE OR REPLACE conserva el trigger, el propietario y el REVOKE EXECUTE; se repite el
--   REVOKE por claridad.
-- * public_code no cambia: es una columna generada desde el id.
--
-- No modifica tablas, datos, índices, restricciones ni privilegios de tablas.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_denomination_unit_change() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Asignar la misma base (UPDATE OF measurement_unit_id sin cambio real) no consulta referencias.
  IF NEW.measurement_unit_id IS NOT DISTINCT FROM OLD.measurement_unit_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.services WHERE unit_denomination_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.service_versions WHERE unit_denomination_id = OLD.id) THEN
    RAISE EXCEPTION 'La unidad base de una denominación con servicios o versiones históricas no se puede modificar.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.prevent_denomination_unit_change() FROM PUBLIC;

COMMIT;
