/* Centraliza la decisión de acceso a rutas protegidas sin acoplarla a React Router. */
// Devuelve la acción de navegación correspondiente al estado actual de autenticación.
export function getProtectedRouteDecision({
  allowedRoles,
  isAuthenticated,
  isLoading,
  isSessionUnavailable,
  role,
}) {
  if (isLoading) return "loading";
  if (isSessionUnavailable) return "unavailable";
  if (!isAuthenticated) return "login";
  if (allowedRoles?.length && !allowedRoles.includes(role)) return "role-home";
  return "content";
}
