/**
 * Presenta un cambio confirmado por la API, separando el nombre real del servicio de su efecto
 * en nuevas cotizaciones. Una selección de un solo servicio conserva el mensaje individual; en
 * plural, `count` debe ser la cantidad que la API confirmó, nunca la seleccionada.
 * @param {{isActive: boolean, service?: Object, count?: number}} result - Operación confirmada.
 * @returns {{tone: string, title: string, message: string, content?: string}} Aviso de éxito.
 */
export function describeServiceStatusSuccess({ isActive, service, count = 1 }) {
  const plural = count > 1;
  const state = isActive ? "activado" : "desactivado";
  const availability = isActive ? "Ya" : "Ya no";
  return {
    tone: "success",
    title: plural ? `${count} servicios ${state}s correctamente` : `Servicio ${state} correctamente`,
    message: `${availability} ${plural ? "están disponibles" : "está disponible"} para nuevas cotizaciones`,
    ...(!plural && service?.name ? { content: service.name } : {}),
  };
}
