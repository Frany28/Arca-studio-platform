/**
 * Construye un mensaje de contacto manual para solicitar información adicional.
 * El texto se utiliza solo en enlaces externos; no cambia el estado de la solicitud.
 *
 * @param {{projectName?: string, note?: string}} params - Proyecto y motivo del administrador.
 * @returns {string} Mensaje que el administrador podrá revisar antes de enviarlo.
 */
export function buildProjectRequestContactMessage({ projectName = "", note = "" } = {}) {
  const name = String(projectName).trim();
  const reason = String(note).trim();
  const introduction = name
    ? "Hola, necesitamos información adicional para continuar con la solicitud de tu proyecto " + name + "."
    : "Hola, necesitamos información adicional para continuar con tu solicitud de proyecto.";
  return reason ? introduction + "\n\nInformación requerida: " + reason : introduction;
}

/**
 * Prepara un enlace de correo para abrir el cliente de correo del administrador.
 * Nunca envía mensajes de manera automática; el destinatario debe existir y ser válido.
 *
 * @param {{email?: string|null, projectName?: string, note?: string}} params - Datos reales del solicitante.
 * @returns {string|null} URL mailto o null cuando no existe un correo válido.
 */
export function buildProjectRequestEmailHref({ email, projectName, note }) {
  const address = typeof email === "string" ? email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  const subject = "Información adicional para tu solicitud de proyecto";
  const body = buildProjectRequestContactMessage({ projectName, note });
  return "mailto:" + address + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}

/**
 * Acepta únicamente teléfonos con prefijo internacional explícito para evitar
 * abrir WhatsApp con un país incorrecto. El número sigue disponible para copiar.
 *
 * @param {unknown} phone - Teléfono registrado del cliente.
 * @returns {string|null} Número internacional sin +, o null si no es E.164.
 */
export function getProjectRequestWhatsAppNumber(phone) {
  if (typeof phone !== "string") return null;
  const compact = phone.trim().replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact.slice(1) : null;
}

/**
 * Genera el enlace oficial de WhatsApp con mensaje editable, sin emitir mensajes.
 *
 * @param {{phone?: string|null, projectName?: string, note?: string}} params - Teléfono y contexto.
 * @returns {string|null} URL segura de wa.me o null sin prefijo internacional.
 */
export function buildProjectRequestWhatsAppHref({ phone, projectName, note }) {
  const number = getProjectRequestWhatsAppNumber(phone);
  if (!number) return null;
  return "https://wa.me/" + number + "?text=" +
    encodeURIComponent(buildProjectRequestContactMessage({ projectName, note }));
}
