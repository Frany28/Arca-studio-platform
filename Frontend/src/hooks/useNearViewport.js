import { useEffect, useState } from "react";

/**
 * Indica si un elemento ya se acercó al viewport, para diferir trabajo costoso (como leer un
 * fotograma de vídeo) hasta que el usuario pueda verlo. Una vez visible permanece en `true` y
 * deja de observar; sin IntersectionObserver (entornos antiguos) se considera visible.
 *
 * @param {import("react").RefObject<Element>} ref - Elemento observado.
 * @param {Object} [options] - Configuración de la observación.
 * @param {string} [options.rootMargin="200px"] - Margen anticipado respecto del viewport.
 * @returns {boolean} true cuando el elemento estuvo cerca del viewport al menos una vez.
 */
export default function useNearViewport(ref, { rootMargin = "200px" } = {}) {
  const [isNear, setIsNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const element = ref.current;
    if (isNear || !element) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsNear(true);
        observer.disconnect();
      }
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isNear, ref, rootMargin]);

  return isNear;
}
