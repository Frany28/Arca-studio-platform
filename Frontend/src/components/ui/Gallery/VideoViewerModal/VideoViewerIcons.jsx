/**
 * Iconografía local del visor de video.
 * Mantiene los SVG originales fuera del componente orquestador.
 */

export function CloseIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.195262 0.195262C0.455612 -0.0650874 0.877722 -0.0650874 1.13807 0.195262L6 5.05719L10.8619 0.195263C11.1223 -0.0650867 11.5444 -0.0650866 11.8047 0.195263C12.0651 0.455612 12.0651 0.877722 11.8047 1.13807L6.94281 6L11.8047 10.8619C12.0651 11.1223 12.0651 11.5444 11.8047 11.8047C11.5444 12.0651 11.1223 12.0651 10.8619 11.8047L6 6.94281L1.13807 11.8047C0.877722 12.0651 0.455612 12.0651 0.195262 11.8047C-0.0650873 11.5444 -0.0650873 11.1223 0.195262 10.8619L5.05719 6L0.195262 1.13807C-0.0650874 0.877722 -0.0650874 0.455612 0.195262 0.195262Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function VolumeIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2.5 7.358V12.642C2.5 13.45 3.158 14.108 3.967 14.108H6.342L10.292 17.217C10.95 17.733 11.917 17.267 11.917 16.425V3.575C11.917 2.733 10.95 2.267 10.292 2.783L6.342 5.892H3.967C3.158 5.892 2.5 6.55 2.5 7.358Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.417 6.875C15.458 8.75 15.458 11.25 14.417 13.125"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.792 5.208C18.458 8.125 18.458 11.875 16.792 14.792"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VolumeMutedIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2.5 7.358V12.642C2.5 13.45 3.158 14.108 3.967 14.108H6.342L10.292 17.217C10.95 17.733 11.917 17.267 11.917 16.425V3.575C11.917 2.733 10.95 2.267 10.292 2.783L6.342 5.892H3.967C3.158 5.892 2.5 6.55 2.5 7.358Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.167 8.333L17.5 11.667M17.5 8.333L14.167 11.667"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CommentIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5.417 13.333H5C3.619 13.333 2.5 12.214 2.5 10.833V5.833C2.5 4.452 3.619 3.333 5 3.333H15C16.381 3.333 17.5 4.452 17.5 5.833V10.833C17.5 12.214 16.381 13.333 15 13.333H10.833L6.667 16.667V14.583C6.667 13.893 6.107 13.333 5.417 13.333Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.667 7.5H13.333M6.667 10H10.833"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlayIcon({ className }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M13.812 9.07404C13.6298 8.96602 13.4223 8.90815 13.2105 8.9063C12.9987 8.90445 12.7902 8.95869 12.6061 9.06351C12.4221 9.16833 12.269 9.32 12.1626 9.50311C12.0561 9.68621 12 9.89424 12 10.106V37.894C12 38.1058 12.0561 38.3139 12.1626 38.497C12.269 38.6801 12.4221 38.8317 12.6061 38.9366C12.7902 39.0414 12.9987 39.0956 13.2105 39.0938C13.4223 39.0919 13.6298 39.0341 13.812 38.926L37.258 25.032C37.4371 24.9258 37.5854 24.7748 37.6884 24.5938C37.7915 24.4129 37.8456 24.2083 37.8456 24C37.8456 23.7918 37.7915 23.5872 37.6884 23.4062C37.5854 23.2253 37.4371 23.0743 37.258 22.968L13.812 9.07404Z"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PauseIcon({ className }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M17 10V38M31 10V38"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SettingsIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 12.5C11.381 12.5 12.5 11.381 12.5 10C12.5 8.619 11.381 7.5 10 7.5C8.619 7.5 7.5 8.619 7.5 10C7.5 11.381 8.619 12.5 10 12.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.667 10.733V9.267C1.667 8.4 2.375 7.683 3.25 7.683C4.758 7.683 5.375 6.617 4.617 5.308C4.183 4.558 4.442 3.583 5.2 3.15L6.642 2.325C7.3 1.933 8.15 2.167 8.542 2.825L8.633 2.983C9.383 4.292 10.617 4.292 11.375 2.983L11.467 2.825C11.858 2.167 12.708 1.933 13.367 2.325L14.808 3.15C15.567 3.583 15.825 4.558 15.392 5.308C14.633 6.617 15.25 7.683 16.758 7.683C17.625 7.683 18.342 8.392 18.342 9.267V10.733C18.342 11.6 17.633 12.317 16.758 12.317C15.25 12.317 14.633 13.383 15.392 14.692C15.825 15.45 15.567 16.417 14.808 16.85L13.367 17.675C12.708 18.067 11.858 17.833 11.467 17.175L11.375 17.017C10.625 15.708 9.392 15.708 8.633 17.017L8.542 17.175C8.15 17.833 7.3 18.067 6.642 17.675L5.2 16.85C4.442 16.417 4.183 15.442 4.617 14.692C5.375 13.383 4.758 12.317 3.25 12.317C2.375 12.317 1.667 11.6 1.667 10.733Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
