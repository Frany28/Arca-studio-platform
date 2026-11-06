import { getCompatibilityPresentation } from "../../../utils/projectRequestCompatibility.js";
import {
  getCompletenessPresentation,
  getFinancialViabilityPresentation,
} from "../../../utils/projectRequestMetrics.js";
import { getProjectRequestStatus } from "../../../utils/projectRequestStatus.js";
import { getProjectTypeLabel } from "../../../utils/projectTypeDisplay.js";

/**
 * Presentación de la consulta administrativa de una solicitud (Figma «solicitudes vista de
 * ADMIN», 3727:687188). Todo procede del detalle administrativo de la API; ningún valor del
 * prototipo (porcentajes, nombres o fechas) se usa como contenido.
 */

export const DEFAULT_REQUEST_RETURN_TARGET = Object.freeze({ label: "Dashboard", to: "/dashboard-arquitecto" });

// Etapas del proceso en el orden del diseño. Primer contacto y Propuesta inicial ocurren
// después de la decisión y no se registran en la solicitud, por lo que nunca se marcan completas.
const REQUEST_STAGES = Object.freeze([
  { id: "submitted", title: "Solicitud enviada" },
  { id: "preliminary", title: "Evaluación preliminar" },
  { id: "review", title: "Revisión" },
  { id: "first-contact", title: "Primer contacto" },
  { id: "initial-proposal", title: "Propuesta inicial" },
]);

const COMPLETED = (status = "Completado") => ({ status, tone: "completed" });
const CURRENT = (status = "Pendiente") => ({ status, tone: "current" });
const UPCOMING = (status = "Pendiente") => ({ status, tone: "upcoming" });

// Estado de cada etapa por estado de la solicitud (pending_verification: verificación y
// asignación; pending_review: revisión técnica; el resto, decisiones administrativas).
const STAGE_STATES_BY_STATUS = Object.freeze({
  approved: [COMPLETED(), COMPLETED(), COMPLETED("Aprobada"), UPCOMING(), UPCOMING()],
  changes_requested: [COMPLETED(), COMPLETED(), CURRENT("Correcciones solicitadas"), UPCOMING(), UPCOMING()],
  converted: [COMPLETED(), COMPLETED(), COMPLETED("Aprobada"), UPCOMING(), UPCOMING()],
  pending_review: [COMPLETED(), COMPLETED(), CURRENT(), UPCOMING(), UPCOMING()],
  pending_verification: [COMPLETED(), CURRENT(), UPCOMING(), UPCOMING(), UPCOMING()],
  rejected: [COMPLETED(), COMPLETED(), COMPLETED("Rechazada"), UPCOMING("No aplica"), UPCOMING("No aplica")],
});

/**
 * Etapas del proceso de una solicitud a partir de su estado real.
 * Un estado desconocido solo marca como completada la solicitud enviada.
 *
 * @param {string|null|undefined} status - Estado de la solicitud.
 * @returns {Array<{id: string, title: string, status: string, tone: "completed"|"current"|"upcoming"}>} Etapas.
 */
export function buildProjectRequestStages(status) {
  const states = STAGE_STATES_BY_STATUS[status] || [COMPLETED(), UPCOMING(), UPCOMING(), UPCOMING(), UPCOMING()];
  return REQUEST_STAGES.map((stage, index) => ({ ...stage, ...states[index] }));
}

/**
 * Modelo de la cabecera: nombre, tipo, etapas y compatibilidad (0–100, entera) como indicador
 * circular. Sin evaluación de compatibilidad el indicador se omite en lugar de mostrar 0 %.
 *
 * @param {Object} projectRequest - Detalle administrativo de la API.
 * @returns {{project: Object, indicator: Object|null}} Props de `ProjectOverviewHeader`.
 */
export function buildAdminProjectRequestHeader(projectRequest) {
  const compatibility = getCompatibilityPresentation(projectRequest?.compatibility);
  const typeLabel = projectRequest?.projectType ? getProjectTypeLabel(projectRequest.projectType, "") : "";

  return {
    indicator: compatibility
      ? {
          ariaLabel: `Compatibilidad: ${compatibility.score} de 100, ${compatibility.label}`,
          theme: compatibility.theme,
          value: compatibility.score,
        }
      : null,
    project: {
      category: typeLabel ? `Proyecto ${typeLabel}` : "Tipo de proyecto no registrado",
      id: projectRequest?.id,
      stages: buildProjectRequestStages(projectRequest?.status),
      title: projectRequest?.projectName || "Solicitud de proyecto",
    },
  };
}

/**
 * Indicadores de la fila de progreso: coherencia financiera cualitativa (sin porcentaje,
 * algoritmo 3.3) en la posición del diseño y porcentaje entero de información completada.
 *
 * @param {Object} projectRequest - Detalle administrativo de la API.
 * @returns {{completeness: Object|null, financialViability: Object|null}} Métricas normalizadas.
 */
export function buildAdminProjectRequestMetrics(projectRequest) {
  return {
    completeness: getCompletenessPresentation(projectRequest?.completeness),
    financialViability: getFinancialViabilityPresentation(projectRequest?.financialViability),
  };
}

const ROLE_LABELS = Object.freeze({ admin: "Administrador", architect: "Arquitecto" });
const REVIEW_RECOMMENDATION_LABELS = Object.freeze({
  approve: "Recomienda aprobar",
  changes_requested: "Recomienda solicitar correcciones",
  reject: "Recomienda rechazar",
});

/**
 * Estado, responsables y revisiones técnicas para la sección de gestión de la consulta. Las
 * revisiones se ordenan de la más reciente a la más antigua sin depender del orden de la API;
 * una fecha inválida va al final. Sin estado en la respuesta, `status` es null.
 *
 * @param {Object} projectRequest - Detalle administrativo de la API.
 * @returns {{assignees: Array<Object>, reviews: Array<Object>, status: {label: string, badgeTheme: string}|null}}
 *   Estado, personas y revisiones presentables.
 */
export function buildAdminRequestTeam(projectRequest) {
  const assignees = (Array.isArray(projectRequest?.assignees) ? projectRequest.assignees : [])
    .filter((assignee) => assignee?.id != null)
    .map((assignee) => ({
      id: assignee.id,
      name: assignee.name || "Usuario",
      profilePhotoUrl: assignee.profilePhotoUrl || "",
      roleLabel: ROLE_LABELS[assignee.roleCode] || "Equipo",
    }));
  const toTime = (review) => {
    const time = new Date(review?.updatedAt).getTime();
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  const reviews = (Array.isArray(projectRequest?.reviews) ? projectRequest.reviews : [])
    .slice()
    .sort((first, second) => toTime(second) - toTime(first))
    .map((review, index) => ({
      key: `${review?.reviewer?.id ?? "reviewer"}-${index}`,
      note: review?.note?.trim() || "",
      recommendationLabel: REVIEW_RECOMMENDATION_LABELS[review?.recommendation] || "Revisión registrada",
      reviewerName: review?.reviewer?.name || "Usuario",
      updatedAt: review?.updatedAt || null,
    }));

  const statusPresentation = projectRequest?.status ? getProjectRequestStatus(projectRequest.status) : null;
  const status = statusPresentation
    ? { badgeTheme: statusPresentation.badgeTheme, label: statusPresentation.label }
    : null;

  return { assignees, reviews, status };
}

/**
 * Traduce el fallo de la lectura a un estado de la interfaz. Un 400/404 indica una solicitud
 * inexistente (o un borrador del cliente); 401/403, falta de permisos; sin estado HTTP, un
 * fallo de conexión. Solo los fallos transitorios ofrecen reintentar.
 *
 * @param {{error?: string, errorStatus?: number|null}} failure - Mensaje y estado HTTP de la lectura.
 * @returns {{kind: string, title: string, description: string, canRetry: boolean}} Estado presentable.
 */
export function getAdminProjectRequestFailure({ error = "", errorStatus = null } = {}) {
  if (errorStatus === 400 || errorStatus === 404) {
    return {
      canRetry: false,
      description: "Es posible que se haya eliminado o que el enlace no sea correcto.",
      kind: "not_found",
      title: "La solicitud no existe",
    };
  }
  if (errorStatus === 401 || errorStatus === 403) {
    return {
      canRetry: false,
      description: "Solo los administradores pueden consultar esta solicitud.",
      kind: "forbidden",
      title: "No tienes permisos para ver esta solicitud",
    };
  }
  if (errorStatus == null) {
    return {
      canRetry: true,
      description: "Comprueba tu conexión e inténtalo de nuevo.",
      kind: "connection",
      title: "No se pudo conectar con el servidor",
    };
  }
  return {
    canRetry: true,
    description: error || "Inténtalo de nuevo en unos minutos.",
    kind: "error",
    title: "No se pudo cargar la solicitud",
  };
}

/**
 * Destino de «volver»: el contexto de origen recibido en el estado de navegación o, en un
 * enlace directo, el dashboard. Solo acepta rutas internas para no navegar fuera de la app.
 *
 * @param {unknown} navigationState - `location.state` de React Router.
 * @returns {{label: string, to: string}} Etiqueta y ruta de regreso.
 */
export function getRequestReturnTarget(navigationState) {
  const from = navigationState?.from;
  const to = typeof from?.to === "string" ? from.to : "";
  if (!to.startsWith("/") || to.startsWith("//")) return DEFAULT_REQUEST_RETURN_TARGET;
  return { label: typeof from.label === "string" && from.label.trim() ? from.label.trim() : DEFAULT_REQUEST_RETURN_TARGET.label, to };
}
