/**
 * Adapta el patrón de confirmación a Servicios: operación, cantidad completa y disponibilidad
 * para nuevas cotizaciones. La activación usa el tema primario con iconografía positiva;
 * la desactivación reutiliza la variante Danger del patrón de advertencia de Figma.
 *
 * @param {Object|null} change - Cambio individual o selección homogénea pendiente.
 * @returns {{title: string, description: string, actionLabel: string, actionTheme: string}} Presentación del diálogo.
 */
export function describeServiceStatusConfirmation(change) {
  const count = change?.services?.length ?? 1;
  const plural = count > 1;
  const activating = Boolean(change?.isActive);
  const actionLabel = activating ? "Activar" : "Desactivar";
  const subject = plural ? `Los ${count} servicios seleccionados` : "Este servicio";
  const effect = activating
    ? (plural ? "volverán a estar disponibles" : "volverá a estar disponible")
    : (plural ? "dejarán de estar disponibles" : "dejará de estar disponible");
  return {
    title: `¿${actionLabel} ${plural ? "servicios" : "servicio"}?`,
    description: `${subject} ${effect} para nuevas cotizaciones`,
    actionLabel,
    actionTheme: activating ? "Primary" : "Danger",
  };
}
