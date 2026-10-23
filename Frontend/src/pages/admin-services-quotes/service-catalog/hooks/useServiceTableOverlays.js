import { useState } from "react";

/**
 * Coordina los tooltips del tabulador y su menú contextual. Solo una ayuda puede estar abierta;
 * seleccionar, pedir una acción o abrir un menú descarta la ayuda anterior. La coordinación es
 * local al catálogo: no modifica las interacciones de otros módulos.
 *
 * @param {boolean} blocked - Un diálogo o una operación impide abrir ayudas de la tabla.
 * @param {number} pageKey - Página recibida; invalida las capas de filas que se desmontaron.
 * @returns {Object} Propiedades controladas para ayudas, menús y cierre de la capa activa.
 */
export function useServiceTableOverlays(blocked, pageKey) {
  const [state, setState] = useState({ key: pageKey, tooltip: null, menu: null });
  // Como la selección, las capas pertenecen a una página recibida; no se restauran al volver.
  const activeTooltip = state.key === pageKey ? state.tooltip : null;
  const activeMenu = state.key === pageKey ? state.menu : null;

  /** Cierra la ayuda actual sin mover el foco ni impedir un hover o foco posterior. */
  function dismiss() {
    setState((current) => ({ key: pageKey, tooltip: null, menu: current.key === pageKey ? current.menu : null }));
  }

  /**
   * Devuelve el contrato controlado de Tooltip para un disparador estable de la tabla.
   * Un cierre tardío de otra ayuda no puede cerrar la que acaba de abrirse.
   * @param {string} id - Identificador de fila y tipo de ayuda.
   * @returns {{open: boolean, onOpenChange: (open: boolean) => void}} Estado y cambio de apertura.
   */
  function tooltipProps(id) {
    return {
      open: !blocked && activeMenu === null && activeTooltip === id,
      onOpenChange: (open) => {
        if (open && (blocked || activeMenu !== null)) return;
        setState((current) => ({
          key: pageKey,
          menu: current.key === pageKey ? current.menu : null,
          tooltip: open ? id : current.key === pageKey && current.tooltip !== id ? current.tooltip : null,
        }));
      },
    };
  }

  /**
   * Descarta las ayudas al cambiar de capa; al cerrar no restaura una apertura antigua.
   * @param {number|string} id - Servicio del menú.
   * @param {boolean} open - Estado del menú contextual.
   * @returns {void}
   */
  function menuChanged(id, open) {
    setState((current) => ({
      key: pageKey,
      tooltip: null,
      menu: open ? id : current.key === pageKey && current.menu !== id ? current.menu : null,
    }));
  }

  return { dismiss, menuChanged, tooltipProps };
}
