/* Limita la desactivación de protección de rutas únicamente a entornos de desarrollo. */
// Habilita el bypass de autenticación solo cuando desarrollo y solicitud explícita coinciden.
export function resolveRouteAuthDisabledForTests({
  dev = false,
  requested = false,
} = {}) {
  return Boolean(dev && requested);
}
