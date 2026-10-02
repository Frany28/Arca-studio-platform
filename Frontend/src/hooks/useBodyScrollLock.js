import { useEffect } from "react";

let activeLocks = 0;
let previousBodyOverflow = "";

/**
 * Adquiere un bloqueo de scroll compartido entre overlays.
 * El primer bloqueo guarda el overflow inline del body; los siguientes incrementan
 * el contador para impedir que un overlay desbloquee otro aún abierto.
 *
 * @returns {void}
 */
function acquireBodyScrollLock() {
  if (activeLocks === 0) {
    previousBodyOverflow = document.body.style.overflow;
  }

  activeLocks += 1;
  document.body.style.overflow = "hidden";
}

/**
 * Libera un bloqueo manteniendo el contador compartido no negativo.
 * Restaura el overflow inline previo solo cuando ya no quedan bloqueos activos.
 *
 * @returns {void}
 */
function releaseBodyScrollLock() {
  activeLocks = Math.max(activeLocks - 1, 0);

  if (activeLocks === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
}

/**
 * Bloquea el scroll del body mientras esta instancia esté activa.
 * Omite acceso al DOM si document no existe. El cleanup libera su bloqueo al
 * desactivarse o desmontarse; otros consumidores pueden mantener el body bloqueado.
 *
 * @param {boolean} locked - Indica si debe adquirir un bloqueo.
 * @returns {void}
 */
export default function useBodyScrollLock(locked) {
  useEffect(() => {
    if (!locked || typeof document === "undefined") {
      return undefined;
    }

    acquireBodyScrollLock();

    return () => {
      releaseBodyScrollLock();
    };
  }, [locked]);
}

export { acquireBodyScrollLock, releaseBodyScrollLock };
