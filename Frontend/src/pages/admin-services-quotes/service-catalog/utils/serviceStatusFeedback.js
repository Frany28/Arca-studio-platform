/**
 * Presenta un cambio confirmado por la API, separando el nombre real del servicio de su efecto
 * en nuevas cotizaciones. Una selección de un solo servicio conserva el mensaje individual.
 * @param {{isActive: boolean, service?: Object, count?: number}} result - Operación confirmada.
 * @returns {{tone: string, title: string, message: string, content?: string}} Aviso de éxito.
 */
export function describeServiceStatusSuccess({ isActive, service, count = 1 }) {
  const plural = count > 1;
  const state = isActive ? "activado" : "desactivado";
  return {
    tone: "success",
    title: `${plural ? "Servicios" : "Servicio"} ${state}${plural ? "s" : ""} correctamente`,
    message: plural
      ? `Se ${isActive ? "activaron" : "desactivaron"} ${count} servicios`
      : `${isActive ? "Vuelve a estar disponible" : "Ya no está disponible"} para nuevas cotizaciones`,
    ...(!plural && service?.name ? { content: service.name } : {}),
  };
}
