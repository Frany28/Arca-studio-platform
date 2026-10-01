/* Permite alternar manualmente entre tema claro y oscuro y persiste la preferencia elegida. */
import { useEffect, useState } from "react";
import clsx from "clsx";

const STORAGE_KEY = "arca-theme";

// Obtiene el tema preferido por el sistema operativo.
function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Resuelve el tema inicial usando primero la preferencia guardada.
function getInitialTheme() {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(STORAGE_KEY);

  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return getSystemTheme();
}

// Icono mostrado cuando el tema activo es claro.
function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      aria-hidden="true"
    >
      <path
        d="M12 16.5C14.4853 16.5 16.5 14.4853 16.5 12C16.5 9.51472 14.4853 7.5 12 7.5C9.51472 7.5 7.5 9.51472 7.5 12C7.5 14.4853 9.51472 16.5 12 16.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 2V4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12 19.5V22"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M4.93 4.93L6.69 6.69"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M17.31 17.31L19.07 19.07"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M2 12H4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M19.5 12H22"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M4.93 19.07L6.69 17.31"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M17.31 6.69L19.07 4.93"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Icono mostrado cuando el tema activo es oscuro.
function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      aria-hidden="true"
    >
      <path
        d="M21 12.79C20.8427 14.4922 20.2039 16.1144 19.1584 17.4678C18.1129 18.8212 16.7049 19.8498 15.0982 20.4338C13.4915 21.0178 11.7522 21.1334 10.0829 20.7672C8.41361 20.401 6.88299 19.5677 5.67423 18.359C4.46546 17.1502 3.63217 15.6196 3.26597 13.9503C2.89977 12.281 3.01534 10.5417 3.59935 8.93502C4.18336 7.3283 5.21195 5.92028 6.56537 4.87479C7.9188 3.82931 9.54099 3.19047 11.2432 3.0332C10.246 4.38116 9.76555 6.04244 9.8879 7.71455C10.0103 9.38666 10.7273 10.9599 11.9092 12.1418C13.0911 13.3237 14.6643 14.0407 16.3365 14.1631C18.0086 14.2854 19.6698 13.805 21.0178 12.8078L21 12.79Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Coordina estado local, persistencia y sincronización visual del selector de tema.
function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [hasManualPreference, setHasManualPreference] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    return storedTheme === "dark" || storedTheme === "light";
  });

  useEffect(() => {
    const root = document.documentElement;

    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;

    if (hasManualPreference) {
      window.localStorage.setItem(STORAGE_KEY, theme);
      return;
    }

    window.localStorage.removeItem(STORAGE_KEY);
  }, [hasManualPreference, theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (event) => {
      const storedTheme = window.localStorage.getItem(STORAGE_KEY);

      if (storedTheme === "dark" || storedTheme === "light") {
        return;
      }

      setTheme(event.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => {
        setHasManualPreference(true);
        setTheme(isDark ? "light" : "dark");
      }}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-2 transition-colors duration-200",
        "cursor-pointer bg-[var(--color-neutral-100)] text-[var(--color-text-300)] border-[var(--color-neutral-300)] shadow-[var(--shadow-e1)]",
      )}
      aria-label={`Activar modo ${isDark ? "claro" : "oscuro"}`}
      title={`Modo actual: ${isDark ? "oscuro" : "claro"}`}
    >
      <span
        className={clsx(
          "inline-flex size-8 items-center justify-center rounded-full transition-colors",
          "bg-[var(--color-neutral-200)] text-[var(--color-text-300)]",
        )}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
      <span className="text-sm font-medium">
        {isDark ? "Modo oscuro" : "Modo claro"}
      </span>
    </button>
  );
}

export default ThemeToggle;
