-- Carga inicial del catálogo de unidades base de ARCA Studio (48 unidades).
--
-- Catálogo fuente. Prisma no ejecuta este archivo: lo aplica la migración de datos
-- 20261020130000_measurement_units_catalog_data, cuyo bloque BEGIN…COMMIT debe ser
-- idéntico a este (lo exige tests/measurementUnitSeed.test.js). Para ampliar el catálogo
-- después de aplicada, se crea otra migración de datos con las unidades nuevas.
--
-- Convenciones:
-- * code: identificador estable en inglés y snake_case. Las reglas de negocio usan el
--   código (square_meter para las modalidades llave en mano), nunca el símbolo.
-- * symbol: abreviatura visible en el Dropdown, formularios, tablas, cotizaciones y PDF
--   (≤10 caracteres). Es una convención de interfaz, no una regla de negocio.
-- * sort_order: bloques de 100 por categoría (101 superficie, 201 longitud...), con
--   huecos para añadir unidades sin renumerar.
-- * allows_decimals: las magnitudes físicas, el tiempo, la mano de obra y la energía
--   admiten fracciones; las unidades contables y de empaque, no.
--
-- Unidades base frente a denominaciones: una unidad base es una magnitud o forma de
-- contar distinta. Las variantes comerciales ("m² de construcción", "pt. de salida
-- eléctrica", "vis. de inspección") son denominaciones personalizadas de una base.
-- Por eso no se incluyen como bases: salida (= punto), jornada (= día-hombre),
-- ambiente (= espacio) e inspección (= visita). Metro (m) y metro lineal (m.l.), así
-- como pieza (pza.) y unidad (und.), se mantienen separados por decisión de ARCA para
-- clasificar y presupuestar.
--
-- Idempotente por código (ON CONFLICT DO NOTHING): una unidad existente no se modifica,
-- de modo que no se sobrescriben cambios administrativos (estado, orden). Un símbolo o un
-- nombre equivalente con otro código hace fallar la carga (índices únicos con NFKC y
-- pg_c_utf8), lo que señala una inconsistencia que debe revisarse. Los superíndices son
-- caracteres Unicode (² U+00B2, ³ U+00B3).
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
