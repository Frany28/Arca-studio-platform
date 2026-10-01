/* Resuelve el texto de ayuda para botones que muestran únicamente un icono. */
// Solo devuelve tooltip cuando el botón no tiene texto visible y existe una etiqueta útil.
export function resolveIconButtonTooltip({ ariaLabel, showText, tooltip }) {
  if (showText !== false) return null;
  if (tooltip === false) return null;

  const resolvedText = tooltip || ariaLabel;
  return typeof resolvedText === "string" && resolvedText.trim()
    ? resolvedText.trim()
    : null;
}
