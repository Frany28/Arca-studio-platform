import { useRouteError } from "react-router-dom";

import EmptyState from "./ui/EmptyState/EmptyState.jsx";
import { isChunkLoadError } from "../utils/lazyWithRetry.js";

/**
 * Pantalla de error de las rutas (errorElement del data router). Sustituye el mensaje técnico
 * «Unexpected Application Error» de React Router por una explicación clara con opción de
 * reintentar. Si el error es un módulo no disponible (nueva versión publicada tras una recarga
 * automática fallida), lo indica; reintentar recarga la página para obtener la versión vigente.
 *
 * @returns {import("react").ReactElement} Pantalla de error a pantalla completa.
 */
export default function RouteErrorPage() {
  const error = useRouteError();
  const isNewVersion = isChunkLoadError(error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-neutral-bg)] p-[24px]">
      <EmptyState
        title={isNewVersion ? "No se pudo cargar esta sección" : "Ocurrió un error inesperado"}
        description={isNewVersion
          ? "Es posible que se haya publicado una nueva versión de ARCA Studio. Vuelve a intentarlo para cargarla."
          : "No pudimos mostrar esta página. Vuelve a intentarlo o regresa al inicio."}
        size="M"
        showFeaturedIcon
        showActions
        showSecondaryAction
        primaryActionLabel="Reintentar"
        secondaryActionLabel="Ir al inicio"
        onPrimaryAction={() => window.location.reload()}
        onSecondaryAction={() => window.location.assign(import.meta.env.BASE_URL || "/")}
      />
    </main>
  );
}
