/* Define destinos autenticados comunes según el rol del usuario. */
// Resuelve la pantalla inicial que corresponde a cada tipo de usuario.
export function getDefaultAuthenticatedPath(user) {
  if (user?.role === "architect" || user?.role === "admin") {
    return "/dashboard-arquitecto";
  }

  return "/dashboard-clientes";
}
