import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import AdminActiveProjects from "../../../src/pages/admin-dashboard/components/admin-active-projects/index.js";
import "../../../src/index.css";

const root = createRoot(document.getElementById("root"));
const parameters = new URLSearchParams(window.location.search);
const events = [];
const pending = [];
const trace = [];
let mounted = true;
let mode = "immediate";

// Instrumenta APIs del navegador sin alterar su planificación ni sus resultados.
const NativeResizeObserver = window.ResizeObserver;
if (parameters.get("resizeFallback") === "true") {
  window.ResizeObserver = undefined;
} else {
  window.ResizeObserver = class extends NativeResizeObserver {
    observe(element, options) {
      if (element.querySelector("table")) this.table = true;
      if (this.table) trace.push({ type: "observe" });
      return super.observe(element, options);
    }
    disconnect() {
      if (this.table) trace.push({ type: "disconnect" });
      return super.disconnect();
    }
  };
}
const nativeAdd = window.addEventListener.bind(window);
const nativeRemove = window.removeEventListener.bind(window);
window.addEventListener = (type, listener, options) => {
  if (type === "resize") trace.push({ type: "resize-add", listener });
  return nativeAdd(type, listener, options);
};
window.removeEventListener = (type, listener, options) => {
  if (type === "resize") trace.push({ type: "resize-remove", listener });
  return nativeRemove(type, listener, options);
};
const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
window.cancelAnimationFrame = (id) => {
  trace.push({ type: "cancel-frame", id });
  nativeCancelFrame(id);
};
const nativeScrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = function(options) {
  if (this.matches('[data-selection-footer="true"]')) trace.push({ type: "scroll-end", options });
  return nativeScrollIntoView.call(this, options);
};

/** Registra callbacks públicos y permite controlar éxito, rechazo y solicitudes lentas. */
function request(type, value) {
  events.push({ type, value, sameReference: type === "bulk"
    ? value.projects.every((project) => props.projects.includes(project))
    : props.projects.includes(value.project) });
  if (mode === "throw") throw new Error("Error de actualización");
  if (mode === "immediate") return Promise.resolve();
  return new Promise((resolve, reject) => pending.push({ resolve, reject }));
}

/** Simula la reconciliación del consumidor real después de confirmar una acción masiva. */
async function bulk(value) {
  await request("bulk", value);
  const ids = new Set(value.projects.map((project) => String(project.id)));
  const isPublic = !value.projects.every((project) => project.isPublic);
  setProps({ projects: props.projects.map((project) => !ids.has(String(project.id)) ? project : {
    ...project,
    ...(value.action === "change_visibility" ? { isPublic } : { status: value.action === "archive" ? "archived" : "in_process" }),
  }) });
}

/** Conserva los argumentos de responsables y aplica la respuesta solo tras confirmar el guardado. */
async function assign(project, assignees) {
  await request("assignees", { project, assignees });
  setProps({ projects: props.projects.map((current) => current.id === project.id
    ? { ...current, assignees, assignedArchitects: assignees, assignedArchitect: assignees[0] || null }
    : current) });
}

let props = {
  projects: [], assignees: [], loading: false, error: "",
  onOpenProject: (project) => events.push({ type: "open", value: project, sameReference: props.projects.includes(project) }),
  onBulkAction: bulk,
  onProjectAssigneesChange: assign,
  onRetry: () => events.push({ type: "retry" }),
  ...JSON.parse(parameters.get("props") || "{}"),
};

/** Actualiza props públicas sin remontar ni acceder al estado interno del componente. */
function setProps(next = {}) {
  props = { ...props, ...next };
  flushSync(() => root.render(mounted ? <AdminActiveProjects {...props} /> : null));
}

/** Completa una solicitud diferida con el mismo canal de errores del consumidor. */
function settle(index, fail = false) {
  if (fail) pending[index].reject(new Error("Error de actualización"));
  else pending[index].resolve();
}

document.documentElement.classList.toggle("dark", parameters.get("theme") === "dark");
window.adminProjectsHarness = {
  events, trace, setProps, settle,
  setMode: (next) => { mode = next; },
  unmount: () => { mounted = false; setProps(); },
  traceSummary: () => trace.map(({ type, options }) => ({ type, options })),
  resizeCleanupMatches: () => trace.filter((event) => event.type === "resize-add")
    .every((add) => trace.some((remove) => remove.type === "resize-remove" && add.listener === remove.listener)),
};
setProps();
