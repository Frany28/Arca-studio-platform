-- Carga inicial del catálogo de unidades base de ARCA Studio.
--
-- NO es una migración: Prisma no la ejecuta. Requiere autorización expresa antes de
-- aplicarla en Supabase; la forma recomendada es copiarla en una migración de datos
-- propia (posterior a 20261020090000_measurement_unit_denominations) para que quede
-- registrada en _prisma_migrations.
--
-- * Los códigos son identificadores estables; las reglas de negocio usan el código
--   (por ejemplo, square_meter para las modalidades llave en mano), nunca el símbolo.
-- * m² usa el carácter ² (U+00B2).
-- * Idempotente por código: una unidad ya existente no se modifica. Un símbolo o un
--   nombre equivalente con otro código hace fallar la carga (índices únicos), lo que
--   señala una inconsistencia que debe revisarse.
BEGIN;

INSERT INTO public.measurement_units (code, name, symbol, allows_decimals, is_active, sort_order) VALUES
  ('square_meter', 'Metro cuadrado', 'm²',    true,  true, 1),
  ('linear_meter', 'Metro lineal',   'm.l.',  true,  true, 2),
  ('point',        'Punto',          'pt.',   false, true, 3),
  ('unit',         'Unidad',         'und.',  false, true, 4),
  ('project',      'Proyecto',       'proy.', false, true, 5),
  ('space',        'Espacio',        'esp.',  false, true, 6),
  ('hour',         'Hora',           'hrs',   true,  true, 7),
  ('minute',       'Minuto',         'min',   false, true, 8),
  ('week',         'Semana',         'sem.',  true,  true, 9),
  ('month',        'Mes',            'mes',   true,  true, 10),
  ('global',       'Global',         'glb.',  false, true, 11)
ON CONFLICT (code) DO NOTHING;

COMMIT;
