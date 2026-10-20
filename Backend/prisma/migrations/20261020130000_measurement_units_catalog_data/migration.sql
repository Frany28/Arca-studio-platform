-- Migración de DATOS (sin cambios estructurales): carga inicial del catálogo de 48
-- unidades base de ARCA Studio, aprobado el 20/10/2026.
--
-- El bloque BEGIN…COMMIT es idéntico byte a byte al catálogo fuente
-- prisma/seeds/measurement_units.sql; tests/measurementUnitSeed.test.js lo exige para
-- que nunca existan dos listas divergentes. Para ampliar el catálogo se crea una
-- migración de datos nueva: esta, una vez aplicada, no se modifica.
--
-- Idempotente por código (ON CONFLICT (code) DO NOTHING): no modifica unidades
-- existentes, denominaciones, servicios, tarifas, permisos ni RLS. Un símbolo o nombre
-- equivalente con otro código hace fallar la migración completa (índices únicos).
BEGIN;

INSERT INTO public.measurement_units (code, name, symbol, allows_decimals, is_active, sort_order) VALUES
  -- Superficie
  ('square_meter',       'Metro cuadrado',            'm²',     true,  true, 101),
  ('square_centimeter',  'Centímetro cuadrado',       'cm²',    true,  true, 102),
  ('square_foot',        'Pie cuadrado',              'pie²',   true,  true, 103),
  ('hectare',            'Hectárea',                  'ha',     true,  true, 104),
  ('square_kilometer',   'Kilómetro cuadrado',        'km²',    true,  true, 105),
  -- Longitud
  ('linear_meter',       'Metro lineal',              'm.l.',   true,  true, 201),
  ('meter',              'Metro',                     'm',      true,  true, 202),
  ('millimeter',         'Milímetro',                 'mm',     true,  true, 203),
  ('centimeter',         'Centímetro',                'cm',     true,  true, 204),
  ('kilometer',          'Kilómetro',                 'km',     true,  true, 205),
  ('inch',               'Pulgada',                   'pulg.',  true,  true, 206),
  ('foot',               'Pie',                       'pie',    true,  true, 207),
  -- Volumen
  ('cubic_meter',        'Metro cúbico',              'm³',     true,  true, 301),
  ('cubic_centimeter',   'Centímetro cúbico',         'cm³',    true,  true, 302),
  ('liter',              'Litro',                     'L',      true,  true, 303),
  ('us_gallon',          'Galón estadounidense',      'gal',    true,  true, 304),
  -- Masa y peso comercial
  ('kilogram',           'Kilogramo',                 'kg',     true,  true, 401),
  ('gram',               'Gramo',                     'g',      true,  true, 402),
  ('metric_ton',         'Tonelada métrica',          't',      true,  true, 403),
  -- Cantidades, materiales y empaques
  ('unit',               'Unidad',                    'und.',   false, true, 501),
  ('piece',              'Pieza',                     'pza.',   false, true, 502),
  ('point',              'Punto',                     'pt.',    false, true, 503),
  ('set',                'Juego',                     'jgo.',   false, true, 504),
  ('pair',               'Par',                       'par',    false, true, 505),
  ('package',            'Paquete',                   'paq.',   false, true, 506),
  ('box',                'Caja',                      'caja',   false, true, 507),
  ('bag',                'Saco',                      'saco',   false, true, 508),
  ('roll',               'Rollo',                     'rollo',  false, true, 509),
  ('lot',                'Lote',                      'lote',   false, true, 510),
  -- Tiempo
  ('hour',               'Hora',                      'hrs',    true,  true, 601),
  ('minute',             'Minuto',                    'min',    false, true, 602),
  ('day',                'Día',                       'día',    true,  true, 603),
  ('week',               'Semana',                    'sem.',   true,  true, 604),
  ('month',              'Mes',                       'mes',    true,  true, 605),
  ('year',               'Año',                       'año',    true,  true, 606),
  -- Personal y mano de obra
  ('man_hour',           'Hora-hombre',               'h-h',    true,  true, 701),
  ('man_day',            'Día-hombre',                'd-h',    true,  true, 702),
  -- Servicios profesionales
  ('project',            'Proyecto',                  'proy.',  false, true, 801),
  ('space',              'Espacio',                   'esp.',   false, true, 802),
  ('visit',              'Visita',                    'vis.',   false, true, 803),
  ('report',             'Informe',                   'inf.',   false, true, 804),
  ('drawing',            'Plano',                     'plano',  false, true, 805),
  ('render',             'Render',                    'render', false, true, 806),
  ('global',             'Global',                    'glb.',   false, true, 807),
  -- Energía, potencia y climatización
  ('kilowatt_hour',      'Kilovatio-hora',            'kWh',    true,  true, 901),
  ('kilowatt',           'Kilovatio',                 'kW',     true,  true, 902),
  ('kilovolt_ampere',    'Kilovoltiamperio',          'kVA',    true,  true, 903),
  ('refrigeration_ton',  'Tonelada de refrigeración', 'TR',     true,  true, 904)
ON CONFLICT (code) DO NOTHING;

COMMIT;
