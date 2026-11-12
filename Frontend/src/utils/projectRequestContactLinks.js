/**
 * Motivo que se guarda al «Solicitar más información» desde el modal de contacto (Figma
 * 3727:677375, sin campo de texto). Cumple el mínimo del backend y el cliente lo verá en su
 * solicitud; el detalle de lo que falta se lo comunica el administrador por correo o WhatsApp.
 */
export const PROJECT_REQUEST_CHANGES_REQUESTED_REASON =
  "El equipo de ARCA Studio se pondrá en contacto contigo por correo o WhatsApp para indicarte la información que falta.";

// Textos de cada propósito de contacto: más información (por defecto) o solicitud aprobada.
const CONTACT_COPY = Object.freeze({
  approve: Object.freeze({
    subject: "Tu solicitud de proyecto fue aprobada",
    withName: (name) => "Hola, tu solicitud del proyecto " + name + " fue aprobada. Queremos coordinar contigo la reunión inicial.",
    withoutName: "Hola, tu solicitud de proyecto fue aprobada. Queremos coordinar contigo la reunión inicial.",
  }),
  changes_requested: Object.freeze({
    subject: "Información adicional para tu solicitud de proyecto",
    withName: (name) => "Hola, necesitamos información adicional para continuar con la solicitud de tu proyecto " + name + ".",
    withoutName: "Hola, necesitamos información adicional para continuar con tu solicitud de proyecto.",
  }),
});

/**
 * Resuelve los textos del propósito; cualquier valor desconocido usa «más información».
 *
 * @param {unknown} purpose - approve o changes_requested.
 * @returns {{subject: string, withName: (name: string) => string, withoutName: string}} Textos.
 */
function getContactCopy(purpose) {
  return purpose === "approve" ? CONTACT_COPY.approve : CONTACT_COPY.changes_requested;
}

/**
 * Construye un mensaje de contacto manual para el cliente de la solicitud.
 * El texto se utiliza solo en enlaces externos; no cambia el estado de la solicitud.
 *
 * @param {{projectName?: string, note?: string, purpose?: "approve"|"changes_requested"}} params - Proyecto,
 * nota opcional y propósito del contacto.
 * @returns {string} Mensaje que el administrador podrá revisar antes de enviarlo.
 */
export function buildProjectRequestContactMessage({ projectName = "", note = "", purpose } = {}) {
  const copy = getContactCopy(purpose);
  const name = String(projectName).trim();
  const reason = String(note).trim();
  const introduction = name ? copy.withName(name) : copy.withoutName;
  return reason ? introduction + "\n\nInformación requerida: " + reason : introduction;
}

/**
 * Prepara un enlace de correo para abrir el cliente de correo del administrador.
 * Nunca envía mensajes de manera automática; el destinatario debe existir y ser válido.
 *
 * @param {{email?: string|null, projectName?: string, note?: string, purpose?: string}} params - Datos reales del solicitante.
 * @returns {string|null} URL mailto o null cuando no existe un correo válido.
 */
export function buildProjectRequestEmailHref({ email, projectName, note, purpose }) {
  const address = typeof email === "string" ? email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  const subject = getContactCopy(purpose).subject;
  const body = buildProjectRequestContactMessage({ projectName, note, purpose });
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
 * @param {{phone?: string|null, projectName?: string, note?: string, purpose?: string}} params - Teléfono y contexto.
 * @returns {string|null} URL segura de wa.me o null sin prefijo internacional.
 */
export function buildProjectRequestWhatsAppHref({ phone, projectName, note, purpose }) {
  const number = getProjectRequestWhatsAppNumber(phone);
  if (!number) return null;
  return "https://wa.me/" + number + "?text=" +
    encodeURIComponent(buildProjectRequestContactMessage({ projectName, note, purpose }));
}
