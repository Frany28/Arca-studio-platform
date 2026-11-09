import { useEffect, useState } from "react";
import clsx from "clsx";

import logo20 from "./LOGO=20px (1).svg";
import logo24 from "./LOGO=24px (1).svg";
import logo32 from "./LOGO=32px (1).svg";
import logo48 from "./LOGO=48px (1).svg";
import logo64 from "./LOGO 64px.svg";
import logo200 from "./LOGO 200px.svg";
// Variantes oscuras como archivos estáticos: cada una es su variante clara con `#2A2929` sustituido
// por `#FFFFFF` (los 30 rellenos del texto) y ningún otro byte cambiado. Antes se generaban en
// tiempo de ejecución desde el SVG importado con `?raw`, lo que incluía los seis vectores (~238 KB)
// en el JavaScript de cada vista con logo. Como URL, el navegador solo descarga la variante que
// muestra. tests/mainLogoAssets.test.js comprueba que cada archivo sigue derivando de su variante clara.
import logo20Dark from "./dark/LOGO=20px (1).svg";
import logo24Dark from "./dark/LOGO=24px (1).svg";
import logo32Dark from "./dark/LOGO=32px (1).svg";
import logo48Dark from "./dark/LOGO=48px (1).svg";
import logo64Dark from "./dark/LOGO 64px.svg";
import logo200Dark from "./dark/LOGO 200px.svg";

const APPEARANCES = new Set(["auto", "light", "dark"]);

const LOGO_MAP = {
  light: {
    "20px": logo20,
    "24px": logo24,
    "32px": logo32,
    "48px": logo48,
    "64px": logo64,
    "200px": logo200,
  },
  dark: {
    "20px": logo20Dark,
    "24px": logo24Dark,
    "32px": logo32Dark,
    "48px": logo48Dark,
    "64px": logo64Dark,
    "200px": logo200Dark,
  },
};

function getDocumentDarkMode() {
  if (typeof document === "undefined") {
    return false;
  }

  return (
    document.documentElement.classList.contains("dark") ||
    document.body.classList.contains("dark")
  );
}

function MainLogo({
  size = "32px",
  appearance = "auto",
  alt = "Main logo",
  className,
  imgClassName,
  ...props
}) {
  const [isDarkMode, setIsDarkMode] = useState(getDocumentDarkMode);
  const resolvedSize = LOGO_MAP.light[size] ? size : "32px";
  const resolvedAppearance = APPEARANCES.has(appearance) ? appearance : "auto";
  const useDarkLogo =
    resolvedAppearance === "dark" ||
    (resolvedAppearance === "auto" && isDarkMode);
  const logoSrc = useDarkLogo
    ? LOGO_MAP.dark[resolvedSize]
    : LOGO_MAP.light[resolvedSize];

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const html = document.documentElement;
    const body = document.body;

    const observer = new MutationObserver(() => {
      setIsDarkMode(getDocumentDarkMode());
    });

    observer.observe(html, {
      attributes: true,
      attributeFilter: ["class"],
    });

    if (body) {
      observer.observe(body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={clsx("inline-flex items-center justify-center", className)}
      {...props}
    >
      <img
        src={logoSrc}
        alt={alt}
        className={clsx("block w-auto object-contain", imgClassName)}
        style={{ height: resolvedSize }}
      />
    </div>
  );
}

export default MainLogo;
