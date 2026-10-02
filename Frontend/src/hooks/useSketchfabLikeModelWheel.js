import { useEffect } from "react";
import {
  getFiniteVector,
  getFiniteCameraOrbit,
  getModelViewerDimensions,
} from "../utils/modelViewerCamera.js";

/**
 * Convierte los ángulos de órbita en una dirección unitaria hacia el objetivo.
 * El sentido negativo de los ejes permite avanzar el objetivo al acercarse al modelo.
 *
 * @param {Object|null} orbit - Órbita con theta, phi y radio previamente validados.
 * @returns {Object|null} Vector { x, y, z } o null sin radio positivo o dirección.
 */
function getOrbitForwardVector(orbit) {
  if (!orbit || !Number.isFinite(orbit.radius) || orbit.radius <= 0) {
    return null;
  }

  const sinPhiRadius = Math.sin(orbit.phi);
  const x = -(sinPhiRadius * Math.sin(orbit.theta));
  const y = -Math.cos(orbit.phi);
  const z = -(sinPhiRadius * Math.cos(orbit.theta));
  const length = Math.hypot(x, y, z);

  return length > 0
    ? {
        x: x / length,
        y: y / length,
        z: z / length,
      }
    : null;
}

/**
 * Permite avanzar hacia el modelo cuando el zoom de aproximación ya está cerca.
 * Registra wheel en captura con passive:false solo si está habilitado y existe
 * el model-viewer. Consume deltaY negativo con cámara y dimensiones válidas
 * únicamente dentro del radio cercano, calculado según el tamaño y un mínimo.
 * Desplaza cameraTarget hacia delante, conserva la órbita y limita la intensidad
 * del paso; fuera de esas condiciones deja actuar al visor. El cleanup retira el listener.
 *
 * @param {Object} modelViewerRef - Ref al model-viewer con APIs de cámara y dimensiones.
 * @param {boolean} enabled - Habilita esta interacción adicional.
 * @returns {void}
 */
export function useSketchfabLikeModelWheel(modelViewerRef, enabled) {
  useEffect(() => {
    const modelViewer = modelViewerRef.current;

    if (!enabled || !modelViewer) {
      return undefined;
    }

    const handleWheel = (event) => {
      const orbit = getFiniteCameraOrbit(modelViewer.getCameraOrbit?.());
      const target = getFiniteVector(modelViewer.getCameraTarget?.());
      const dimensions = getModelViewerDimensions(modelViewer);
      const forward = getOrbitForwardVector(orbit);
      const isZoomingIn = event.deltaY < 0;

      if (!isZoomingIn || !orbit || !target || !dimensions || !forward) {
        return;
      }

      const closeRadius = Math.max(dimensions.max * 0.18, dimensions.min * 0.9, 0.35);

      if (orbit.radius > closeRadius) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const wheelStrength = Math.min(Math.abs(event.deltaY) / 90, 2.25);
      const step = Math.max(dimensions.max * 0.018, orbit.radius * 0.1, 0.08);
      const distance = step * wheelStrength;
      const nextTarget = {
        x: target.x + forward.x * distance,
        y: target.y + forward.y * distance,
        z: target.z + forward.z * distance,
      };

      modelViewer.cameraTarget = `${nextTarget.x}m ${nextTarget.y}m ${nextTarget.z}m`;
      modelViewer.cameraOrbit = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;
    };

    modelViewer.addEventListener("wheel", handleWheel, { capture: true, passive: false });

    return () => {
      modelViewer.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [enabled, modelViewerRef]);
}
