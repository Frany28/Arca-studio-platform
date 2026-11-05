import { hasApplicableProperty, requiresPropertyAvailability } from "../../../utils/projectRequestApplicability.js";
import { getProjectRequestOptionLabel } from "../../../utils/projectRequestOptions.js";
import { getProjectRequestStatus } from "../../../utils/projectRequestStatus.js";
import { isAdvertisingStand } from "../../../utils/projectRequestStand.js";
import { getProjectTypeLabel } from "../../../utils/projectTypeDisplay.js";
import { formatCalendarDate } from "../../../utils/relativeTime.js";

/**
 * Traduce un booleano guardado a una respuesta legible; null/undefined no se muestra.
 *
 * @param {boolean|null|undefined} value - Respuesta booleana.
 * @param {[string, string]} labels - Textos para true y false.
 * @returns {string} Texto visible o cadena vacía.
 */
function booleanLabel(value, [whenTrue, whenFalse]) {
  if (value === true) return whenTrue;
  if (value === false) return whenFalse;
  return "";
}

/**
 * Crea un dato del resumen; `kind` indica al componente cómo presentarlo.
 *
 * @param {string} id - Identificador estable.
 * @param {string} label - Etiqueta visible.
 * @param {string} value - Valor ya formateado.
 * @param {"text"|"tag"|"status"|"link"} [kind="text"] - Presentación.
 * @returns {{id: string, kind: string, label: string, value: string}} Dato del resumen.
 */
function field(id, label, value, kind = "text") {
  return { id, kind, label, value: String(value ?? "").trim() };
}

/**
 * Elimina los datos sin respuesta y las filas que quedan vacías, para no mostrar
 * preguntas opcionales sin contestar ni secciones que no aplican al tipo de proyecto.
 *
 * @param {Array<Array<Object>>} rows - Filas de datos (una fila agrupa datos en línea).
 * @returns {Array<Array<Object>>} Filas con al menos un dato con valor.
 */
function compactRows(rows) {
  return rows
    .map((row) => row.filter((item) => item.value))
    .filter((row) => row.length > 0);
}

/**
 * Construye la información de solo lectura de una solicitud registrada, con la misma
 * aplicabilidad condicional que el formulario: requisitos del stand solo en Stand
 * publicitario y sección legal solo con inmueble aplicable y disponible.
 *
 * @param {Object|null} projectRequest - Solicitud pública devuelta por la API.
 * @returns {{details: Array<Array<Object>>, preferences: Array<Array<Object>>}} Filas de la
 *   columna principal (proyecto e inmueble) y de la secundaria (viabilidad y compatibilidad).
 */
export function buildProjectRequestSummary(projectRequest) {
  const request = projectRequest || {};
  const stand = request.standRequirements || {};
  const isStand = isAdvertisingStand(request.projectType);
  const propertyRows = isStand
    ? [
      [field("standRequirementsStatus", "Requisitos del evento", getProjectRequestOptionLabel("standRequirementsStatus", stand.requirementsStatus))],
      [field("standDocumentTypes", "Documentación del evento", (stand.documentTypes || [])
        .map((value) => getProjectRequestOptionLabel("standDocumentTypes", value, value))
        .join(", "))],
      [field("standSpaceStatus", "Espacio dentro del evento", getProjectRequestOptionLabel("standSpaceStatus", stand.spaceStatus))],
      [field("hasStandSpacePlans", "Medidas o plano del espacio", booleanLabel(stand.hasSpacePlans, ["Sí, disponible", "No disponible"]))],
    ]
    : [
      [field("landStatus", "Disponibilidad de terreno", requiresPropertyAvailability(request.projectType)
        ? getProjectRequestOptionLabel("landStatus", request.landStatus)
        : "")],
    ];
  const legalRows = hasApplicableProperty(request)
    ? [
      [field("legalDocumentationStatus", "Documentación legal", getProjectRequestOptionLabel("legalDocumentationStatus", request.legalDocumentationStatus))],
      [field("legalDocumentTypes", "Documentos disponibles", (request.legalDocumentTypes || [])
        .map((value) => getProjectRequestOptionLabel("legalDocumentTypes", value, value))
        .join(", "))],
      [field("hasMultipleOwners", "Más de un propietario", booleanLabel(request.hasMultipleOwners, ["Sí", "No"]))],
      [field("hasPlans", "Disponibilidad de planos", booleanLabel(request.hasPlans, ["Sí, disponible", "No disponible"]))],
    ]
    : [];

  return {
    details: compactRows([
      [field("createdAt", "Fecha de creación", formatCalendarDate(request.createdAt, ""))],
      [field("status", "Estado", request.status ? getProjectRequestStatus(request.status).label : "", "status")],
      [field("projectName", "Proyecto", request.projectName, "tag")],
      [
        field("projectType", "Tipo", request.projectType ? getProjectTypeLabel(request.projectType, "") : ""),
        field("location", "Ubicación", request.formattedAddress || request.location),
      ],
      [field("description", "Descripción del proyecto", request.description)],
      [field("projectSize", "Tamaño aproximado del proyecto", getProjectRequestOptionLabel("projectSize", request.projectSize))],
      [field("developmentMode", "Desarrollo del proyecto", getProjectRequestOptionLabel("developmentMode", request.developmentMode))],
      ...propertyRows,
      ...legalRows,
    ]),
    preferences: compactRows([
      [field("investmentRange", "Rango de inversión estimado", getProjectRequestOptionLabel("investmentRange", request.investmentRange))],
      [field("capitalAvailability", "Disponibilidad del capital", getProjectRequestOptionLabel("capitalAvailability", request.capitalAvailability))],
      [
        field("startTime", "Tiempo de espera", getProjectRequestOptionLabel("startTime", request.startTime)),
        field("decisionMaker", "Toma de decisiones", getProjectRequestOptionLabel("decisionMaker", request.decisionMaker)),
      ],
      [field("quality", "Expectativa de estilo / nivel de calidad", getProjectRequestOptionLabel("quality", request.quality))],
      [field("experience", "Experiencia previa", getProjectRequestOptionLabel("experience", request.experience))],
      [field("referenceLink", "Link de referencia", request.referenceLink, "link")],
    ]),
  };
}
