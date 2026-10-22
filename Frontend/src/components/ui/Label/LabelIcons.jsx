/**
 * Icono informativo de Figma (vuesax/info-circle relleno): círculo en `currentColor` con el signo
 * en blanco. Lo usan Label y los indicadores de descripción de las tablas; es decorativo y el
 * nombre accesible lo aporta el control que lo contiene.
 *
 * @param {Object} props - Presentación.
 * @param {string} [props.className] - Tamaño y color.
 * @returns {import("react").ReactElement} SVG decorativo.
 */
export function InfoCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path
        d="M9 5.8V9.55"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="9" cy="11.85" r="1" fill="white" />
    </svg>
  );
}
