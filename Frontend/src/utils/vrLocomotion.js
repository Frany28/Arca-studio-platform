const DEFAULT_DEADZONE = 0.18;

/**
 * Normaliza un eje convertible a número dentro de [-1, 1].
 * Valores no finitos producen cero para evitar movimiento por datos inválidos.
 *
 * @param {number|string|null} value - Valor del eje.
 * @returns {number} Eje limitado.
 */
function normalizeAxis(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-1, Math.min(1, number)) : 0;
}

/**
 * Elimina deriva del control y reescala el tramo restante manteniendo el signo.
 * Normaliza el eje a [-1, 1], aplica zona muerta inclusiva y limita la magnitud a uno.
 *
 * @param {number|string} value - Eje recibido del gamepad.
 * @param {number} [deadzone=0.18] - Magnitud mínima para considerar intención de movimiento.
 * @returns {number} Eje reescalado o cero.
 */
export function applyGamepadDeadzone(value, deadzone = DEFAULT_DEADZONE) {
  const axis = normalizeAxis(value);
  const magnitude = Math.abs(axis);

  if (magnitude <= deadzone) {
    return 0;
  }

  return (
    Math.sign(axis) *
    Math.min(1, (magnitude - deadzone) / Math.max(1 - deadzone, 0.01))
  );
}

/**
 * Elige el par de ejes de mayor magnitud entre [2,3] y [0,1].
 * Normaliza componentes y prioriza [2,3] si empatan con magnitud positiva; sin señal devuelve ceros.
 *
 * @param {Array} [axes=[]] - Ejes del control.
 * @returns {Object} x, y y magnitude del par elegido.
 */
function getStrongestAxisPair(axes = []) {
  const pairs = [
    [axes[2], axes[3]],
    [axes[0], axes[1]],
  ].map(([x, y]) => ({
    magnitude: Math.hypot(normalizeAxis(x), normalizeAxis(y)),
    x: normalizeAxis(x),
    y: normalizeAxis(y),
  }));

  return pairs.reduce(
    (strongest, pair) =>
      pair.magnitude > strongest.magnitude ? pair : strongest,
    { magnitude: 0, x: 0, y: 0 },
  );
}

/**
 * Resuelve movimiento desde fuentes WebXR con gamepad, priorizando la mano izquierda.
 * Aplica zona muerta al par más fuerte y usa la primera fuente con movimiento
 * restante; no combina simultáneamente distintos controles.
 *
 * @param {Array|Object} [inputSources=[]] - Colección compatible con Array.from de fuentes XR.
 * @returns {Object} Ejes x e y, o ambos cero.
 */
export function getXRMovementAxes(inputSources = []) {
  const sources = Array.from(inputSources).filter(
    (source) => source?.gamepad?.axes,
  );
  const orderedSources = [
    ...sources.filter((source) => source.handedness === "left"),
    ...sources.filter((source) => source.handedness !== "left"),
  ];

  for (const source of orderedSources) {
    const pair = getStrongestAxisPair(source.gamepad.axes);
    const x = applyGamepadDeadzone(pair.x);
    const y = applyGamepadDeadzone(pair.y);

    if (x || y) {
      return { x, y };
    }
  }

  return { x: 0, y: 0 };
}

/**
 * Lee únicamente la primera fuente con gamepad de la mano solicitada.
 * Elige su par más fuerte y aplica zona muerta; si no existe fuente devuelve ceros.
 *
 * @param {Array|Object} [inputSources=[]] - Colección de fuentes XR.
 * @param {string} handedness - Mano solicitada.
 * @returns {Object} Ejes x e y normalizados.
 */
export function getXRHandedAxes(inputSources = [], handedness) {
  const source = Array.from(inputSources).find(
    (item) => item?.handedness === handedness && item?.gamepad?.axes,
  );
  const pair = getStrongestAxisPair(source?.gamepad?.axes);

  return {
    x: applyGamepadDeadzone(pair.x),
    y: applyGamepadDeadzone(pair.y),
  };
}

/**
 * Calcula un giro discreto y el bloqueo que evita repetirlo sin recentrar el control.
 * Con bloqueo solo libera al alcanzar releaseThreshold; sin bloqueo gira desde
 * turnThreshold, con dirección -1 para eje positivo y 1 para negativo.
 *
 * @param {number|string} axis - Eje horizontal.
 * @param {boolean} [latched=false] - Bloqueo del cálculo anterior.
 * @param {Object} [options={}] - Umbrales de histéresis.
 * @param {number} [options.releaseThreshold=0.3] - Magnitud que libera el bloqueo.
 * @param {number} [options.turnThreshold=0.72] - Magnitud que dispara un giro.
 * @returns {Object} direction y latched para la próxima lectura.
 */
export function getSnapTurnState(
  axis,
  latched = false,
  { releaseThreshold = 0.3, turnThreshold = 0.72 } = {},
) {
  const normalizedAxis = normalizeAxis(axis);

  if (latched) {
    return {
      direction: 0,
      latched: Math.abs(normalizedAxis) > releaseThreshold,
    };
  }

  if (Math.abs(normalizedAxis) < turnThreshold) {
    return { direction: 0, latched: false };
  }

  return {
    direction: normalizedAxis > 0 ? -1 : 1,
    latched: true,
  };
}

/**
 * Proyecta un punto sobre un rayo de dirección normalizada para seleccionar marcadores.
 * Exige proyección positiva dentro de maxDistance y distancia perpendicular no mayor
 * que radius; devuelve la distancia proyectada, no la intersección con una esfera.
 *
 * @param {Object} params - Geometría en un mismo sistema de coordenadas y unidades.
 * @param {Object} params.direction - Vector de dirección; se normaliza internamente.
 * @param {Object} params.origin - Origen { x, y, z }.
 * @param {Object} params.point - Punto del marcador.
 * @param {number} [params.maxDistance=500] - Alcance máximo del rayo.
 * @param {number} [params.radius=18] - Tolerancia perpendicular.
 * @returns {number|null} Distancia sobre el rayo o null sin coincidencia.
 */
export function getXRRayPointHitDistance({
  direction,
  maxDistance = 500,
  origin,
  point,
  radius = 18,
}) {
  if (!direction || !origin || !point) return null;
  const dx = Number(point.x) - Number(origin.x);
  const dy = Number(point.y) - Number(origin.y);
  const dz = Number(point.z) - Number(origin.z);
  const directionLength = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(directionLength) || directionLength === 0) return null;
  const nx = direction.x / directionLength;
  const ny = direction.y / directionLength;
  const nz = direction.z / directionLength;
  const distanceAlongRay = dx * nx + dy * ny + dz * nz;
  if (distanceAlongRay <= 0 || distanceAlongRay > maxDistance) return null;
  const perpendicularDistanceSq = Math.max(
    0,
    dx * dx + dy * dy + dz * dz - distanceAlongRay * distanceAlongRay,
  );
  return perpendicularDistanceSq <= radius * radius ? distanceAlongRay : null;
}
