import { useCallback, useEffect, useRef, useState } from "react";

const CLOSED_VIEWER = {
  initialSession: null,
  mode: "fallback",
  notice: "",
  visible: false,
};

const MOBILE_DEVICE_PATTERN = /Android|iPhone|iPad|iPod|Mobile/i;
const HEADSET_BROWSER_PATTERN = /OculusBrowser|Meta Quest|Quest|Pico|Vive Focus|Firefox Reality/i;

/**
 * Distingue teléfonos y tablets de navegadores de visores mediante pistas del navegador.
 * Excluye primero los headsets; contempla userAgentData, userAgent e iPadOS
 * con identidad MacIntel y múltiples puntos táctiles. La detección es heurística.
 *
 * @param {Object|null} navigatorLike - Datos equivalentes a navigator.
 * @returns {boolean} Si corresponde a un móvil de mano.
 */
export function isHandheldMobileNavigator(navigatorLike) {
  if (!navigatorLike) return false;

  const userAgent = navigatorLike.userAgent || "";
  if (HEADSET_BROWSER_PATTERN.test(userAgent)) return false;

  if (navigatorLike.userAgentData?.mobile === true) return true;
  if (MOBILE_DEVICE_PATTERN.test(userAgent)) return true;

  // iPadOS can identify itself as macOS when desktop sites are enabled.
  return navigatorLike.platform === "MacIntel" && navigatorLike.maxTouchPoints > 1;
}

/**
 * Consulta soporte immersive-vr en WebXR excluyendo móviles de mano.
 * La exclusión evita sesiones tipo Cardboard con pantalla dividida en teléfonos;
 * la ausencia de API o los errores de detección producen unsupported.
 *
 * @param {Object|null} xr - API equivalente a navigator.xr.
 * @param {Object|null} navigatorLike - Datos para distinguir móviles y headsets.
 * @returns {Promise<string>} supported o unsupported.
 */
export async function getVrSupportStatus(xr, navigatorLike) {
  // Some Android browsers expose immersive-vr as a Cardboard-style session.
  // Opening it on a phone forces the duplicated, split-screen presentation.
  if (isHandheldMobileNavigator(navigatorLike)) return "unsupported";
  if (!xr?.isSessionSupported) return "unsupported";
  try {
    return await xr.isSessionSupported("immersive-vr") ? "supported" : "unsupported";
  } catch {
    return "unsupported";
  }
}

/**
 * Solicita una sesión immersive-vr con local-floor y bounded-floor opcionales.
 * Debe llamarse desde la interacción de apertura para cumplir la activación
 * requerida por el navegador; no transforma errores en un fallback.
 *
 * @param {Object|null} xr - API WebXR con requestSession.
 * @returns {Promise<Object>} Sesión WebXR creada.
 * @throws {Error} Rechaza con VR_UNAVAILABLE si falta la API o con el error de requestSession.
 */
export function requestVrSession(xr) {
  if (!xr?.requestSession) return Promise.reject(new Error("VR_UNAVAILABLE"));
  return xr.requestSession("immersive-vr", {
    optionalFeatures: ["local-floor", "bounded-floor"],
  });
}

/**
 * Coordina apertura del visor convencional o de una sesión WebXR inmersiva.
 * Comprueba navigator.xr al montar; el cleanup ignora el resultado de detección
 * sin cancelar la consulta. open usa fallback mientras comprueba o no hay soporte;
 * si requestSession falla abre el fallback con un aviso en viewer.notice.
 * close intenta terminar la sesión, ignora errores de end y oculta el visor.
 * handleImmersiveEnd muestra el fallback tras un fin externo, pero no tras cierre
 * explícito. El consumidor conecta este callback al fin de sesión; el hook no
 * registra ese listener ni termina sesiones automáticamente al desmontarse.
 *
 * @returns {Object} close, handleImmersiveEnd, isChecking, open, supportStatus y viewer.
 * viewer contiene initialSession (Object|null), mode, notice y visible; open devuelve Promise<void>.
 */
export default function useVrViewerLaunch() {
  const [supportStatus, setSupportStatus] = useState("checking");
  const [viewer, setViewer] = useState(CLOSED_VIEWER);
  const closingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getVrSupportStatus(navigator.xr, navigator).then((status) => {
      if (!cancelled) setSupportStatus(status);
    });
    return () => { cancelled = true; };
  }, []);

  const open = useCallback(async () => {
    closingRef.current = false;
    if (supportStatus !== "supported" || !navigator.xr?.requestSession) {
      setViewer({ ...CLOSED_VIEWER, visible: true });
      return;
    }
    try {
      const session = await requestVrSession(navigator.xr);
      setViewer({ initialSession: session, mode: "immersive", notice: "", visible: true });
    } catch {
      setViewer({
        initialSession: null,
        mode: "fallback",
        notice: "No se pudo iniciar el modo VR. Puedes continuar con el visor disponible.",
        visible: true,
      });
    }
  }, [supportStatus]);

  const close = useCallback(() => {
    closingRef.current = true;
    viewer.initialSession?.end?.().catch(() => {});
    setViewer(CLOSED_VIEWER);
  }, [viewer.initialSession]);

  const handleImmersiveEnd = useCallback(() => {
    if (closingRef.current) return;
    setViewer({ ...CLOSED_VIEWER, visible: true });
  }, []);

  return {
    close,
    handleImmersiveEnd,
    isChecking: supportStatus === "checking",
    open,
    supportStatus,
    viewer,
  };
}
