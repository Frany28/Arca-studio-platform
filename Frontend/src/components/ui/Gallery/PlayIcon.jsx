/**
 * Icono de reproducción (iconoir:play de Figma, 20 × 20) sobre miniaturas de vídeo.
 *
 * @param {Object} props - Clases del icono.
 * @param {string} [props.className] - Tamaño y color (usa `currentColor`).
 * @returns {import("react").ReactElement} SVG decorativo.
 */
export default function PlayIcon({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        d="M6 3.9V16.1C6 16.6 6.54 16.92 6.98 16.67L17.18 10.57C17.6 10.32 17.6 9.68 17.18 9.43L6.98 3.33C6.54 3.08 6 3.4 6 3.9Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
