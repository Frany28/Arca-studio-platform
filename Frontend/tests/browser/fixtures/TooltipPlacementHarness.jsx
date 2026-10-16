import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import Tooltip from "../../../src/components/ui/Tooltip/Tooltip.jsx";
import "../../../src/index.css";

const root = createRoot(document.getElementById("root"));

/**
 * Monta un único ancla en coordenadas fijas con su Tooltip abierto o controlado por interacción.
 * La prueba lo invoca para cada posición, borde y longitud de texto, y mide la geometría resultante.
 *
 * @param {object} scenario Escenario de la prueba.
 * @param {string} scenario.position Posición preferida del Tooltip.
 * @param {number} scenario.x Borde izquierdo del ancla en píxeles.
 * @param {number} scenario.y Borde superior del ancla en píxeles.
 * @param {number} [scenario.width=44] Ancho del ancla.
 * @param {number} [scenario.height=44] Alto del ancla.
 * @param {string} [scenario.text] Texto del Tooltip.
 * @param {boolean} [scenario.interactive=false] Abre por hover o foco en lugar de forzarlo.
 * @param {boolean} [scenario.dark=false] Aplica el tema oscuro.
 */
window.renderTooltipScenario = ({
  dark = false,
  height = 44,
  interactive = false,
  position,
  text = "Pantalla completa",
  width = 44,
  x,
  y,
}) => {
  document.documentElement.classList.toggle("dark", dark);
  flushSync(() => {
    root.render(
      <Tooltip
        asChild
        portal
        showTip
        open={interactive ? undefined : true}
        text={text}
        tipPosition={position}
      >
        <button
          type="button"
          data-testid="anchor"
          aria-label={text}
          style={{ height, left: x, position: "fixed", top: y, width }}
        />
      </Tooltip>,
    );
  });
};
