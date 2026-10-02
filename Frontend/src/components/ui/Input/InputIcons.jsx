// Icono predeterminado usado en variantes relacionadas con usuarios o tags.
function UserIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 10C11.933 10 13.5 8.433 13.5 6.5C13.5 4.567 11.933 3 10 3C8.067 3 6.5 4.567 6.5 6.5C6.5 8.433 8.067 10 10 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4.16669 16.1667C4.16669 13.8667 6.78335 12 10 12C13.2167 12 15.8334 13.8667 15.8334 16.1667"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Icono predeterminado para entradas de texto generales.
function SmsIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M14.1667 17.0833H5.83341C3.33341 17.0833 1.66675 15.8333 1.66675 12.9166V7.08329C1.66675 4.16663 3.33341 2.91663 5.83341 2.91663H14.1667C16.6667 2.91663 18.3334 4.16663 18.3334 7.08329V12.9166C18.3334 15.8333 16.6667 17.0833 14.1667 17.0833Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.1666 7.5L11.5582 9.58333C10.6999 10.2667 9.29158 10.2667 8.43325 9.58333L5.83325 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Icono predeterminado para la variante de búsqueda.
function SearchIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M9.58335 15.8333C13.0351 15.8333 15.8334 13.0351 15.8334 9.58333C15.8334 6.13155 13.0351 3.33333 9.58335 3.33333C6.13157 3.33333 3.33335 6.13155 3.33335 9.58333C3.33335 13.0351 6.13157 15.8333 9.58335 15.8333Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.6667 16.6667L15 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Icono predeterminado para campos de contraseña.
function LockIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 8.33329V6.66663C5 3.90829 5.83333 1.66663 10 1.66663C14.1667 1.66663 15 3.90829 15 6.66663V8.33329"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.0001 15.4167C11.1507 15.4167 12.0834 14.4839 12.0834 13.3333C12.0834 12.1827 11.1507 11.25 10.0001 11.25C8.84949 11.25 7.91675 12.1827 7.91675 13.3333C7.91675 14.4839 8.84949 15.4167 10.0001 15.4167Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.1667 18.3334H5.83341C2.50008 18.3334 1.66675 17.5 1.66675 14.1667V12.5C1.66675 9.16671 2.50008 8.33337 5.83341 8.33337H14.1667C17.5001 8.33337 18.3334 9.16671 18.3334 12.5V14.1667C18.3334 17.5 17.5001 18.3334 14.1667 18.3334Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Icono usado para mostrar u ocultar el contenido de una contraseña.
function EyeIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12.1083 10C12.1083 11.1646 11.1646 12.1083 10 12.1083C8.83538 12.1083 7.89166 11.1646 7.89166 10C7.89166 8.83537 8.83538 7.89166 10 7.89166C11.1646 7.89166 12.1083 8.83537 12.1083 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M17.2417 9.99999C16.275 12.9167 13.4167 15 10 15C6.58337 15 3.72504 12.9167 2.75837 9.99999C3.72504 7.08332 6.58337 5 10 5C13.4167 5 16.275 7.08332 17.2417 9.99999Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Icono auxiliar mostrado al lado derecho en entradas informativas.
function HelpIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 18.3333C14.6024 18.3333 18.3333 14.6024 18.3333 10C18.3333 5.39762 14.6024 1.66666 10 1.66666C5.39763 1.66666 1.66667 5.39762 1.66667 10C1.66667 14.6024 5.39763 18.3333 10 18.3333Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M7.57501 7.50001C7.77085 6.94384 8.15715 6.4749 8.66546 6.17783C9.17377 5.88076 9.77094 5.77475 10.3499 5.87864C10.9289 5.98253 11.4525 6.28952 11.8282 6.74544C12.2038 7.20137 12.4074 7.77594 12.4025 8.36816C12.4025 10.0417 9.89168 10.8333 9.89168 10.8333"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 14.1667H10.0083"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Icono usado por selectores desplegables, como el prefijo telefónico.
export function ChevronDownIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Resuelve el adorno izquierdo del catálogo sin modificar el tipo público del campo.
 * Conserva el fallback de texto general y las dimensiones de los SVG existentes.
 *
 * @param {string} type Tipo resuelto del Input.
 * @returns {import("react").ReactElement} Icono decorativo predeterminado.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Resolver JSX sin estado utilizado antes de componer el campo.
export function getDefaultLeftIcon(type) {
  if (type === "Search bar") {
    return <SearchIcon className="size-5" />;
  }

  if (type === "Password") {
    return <LockIcon className="size-5" />;
  }

  if (type === "Tags") {
    return <UserIcon className="size-5" />;
  }

  return <SmsIcon className="size-5" />;
}

/**
 * Resuelve el adorno derecho y devuelve null cuando el tipo no tiene acción lateral.
 * El padre usa ese resultado para evitar botones vacíos en búsqueda y tags.
 *
 * @param {string} type Tipo resuelto del Input.
 * @param {boolean} passwordVisible Visibilidad interna de la contraseña.
 * @returns {import("react").ReactElement|null} Icono o ausencia de adorno.
 */
// eslint-disable-next-line react-refresh/only-export-components -- El resultado null también determina si se renderiza la acción.
export function getDefaultRightIcon(type, passwordVisible) {
  if (type === "Password") {
    return <EyeIcon className="size-5" data-visible={passwordVisible} />;
  }

  if (type === "Search bar" || type === "Tags") {
    return null;
  }

  return <HelpIcon className="size-5" />;
}
