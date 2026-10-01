import { useEffect } from "react";
import {
  getFiniteVector,
  getFiniteCameraOrbit,
  getModelViewerDimensions,
} from "../utils/modelViewerCamera.js";

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
