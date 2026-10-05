import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import NotificationsDrawer from "../../../src/components/ui/NotificationsDrawer.jsx";
import { api } from "../../../src/api/http.js";
import NotificationsDrawerConsumers from "./NotificationsDrawerConsumers.jsx";
import "../../../src/index.css";

const root = createRoot(document.getElementById("root"));
const events = [];
const pendingSubmissions = [];
const parameters = new URLSearchParams(window.location.search);
let mounted = true;
let submissionMode = "immediate";
let readFailure = false;

/** Proporciona lecturas controladas sin red, conservando los hooks y consumidores reales. */
function mockComments(scope) {
  record(`read-${scope}`, null);
  if (readFailure) return Promise.reject(new Error("Fallo de lectura"));
  return Promise.resolve({ comments: drawerProps.comments.filter((comment) =>
    scope === "environment" ? comment.scope === "environment" : comment.scope !== "environment",
  ).map((comment) => ({
    ...comment, content: comment.message, scope,
  })) });
}

api.auth.me = async () => ({ user: { id: 1, role: "architect", name: "Ana Pérez" } });
api.projects.listAllComments = () => mockComments("project");
api.projects.subscribeToEvents = () => () => {};
api.projects.createComment = (payload) => submit("api-project", payload);
api.environmentComments.listAll = () => mockComments("environment");
api.environmentComments.create = (payload) => submit("api-environment", payload);

/** Registra argumentos públicos y conserva su identidad para las pruebas de selección. */
function record(type, value, sameReference) {
  events.push({ type, value, sameReference });
}

/**
 * Simula únicamente el callback externo, sin modificar carga ni estado del drawer.
 * Las promesas diferidas permiten observar fallos y respuestas fuera de orden.
 * @param {string} type Callback invocado.
 * @param {Object} value Payload público recibido.
 * @returns {Object|undefined|Promise<Object>} Resultado síncrono o finalización controlada.
 */
function submit(type, value) {
  record(type, value);
  if (submissionMode === "sync") return { saved: true };
  if (submissionMode === "void") return undefined;
  if (submissionMode === "throw") throw new Error("Fallo síncrono");
  if (submissionMode === "immediate") return Promise.resolve({});
  return new Promise((resolve, reject) => pendingSubmissions.push({ resolve, reject }));
}

/** Cierra el componente controlado como lo hacen sus consumidores y registra el callback. */
function close() {
  record("close", null);
  setProps({ open: false });
}

let drawerProps = {
  open: false,
  comments: [],
  recentActivity: [],
  onClose: close,
  onRefreshComments: () => record("refresh-comments", null),
  onRefreshActivity: () => record("refresh-activity", null),
  onCommentSelect: (item) => record("select-comment", item, drawerProps.comments.includes(item)),
  onActivitySelect: (item) => record("select-activity", item, drawerProps.recentActivity.includes(item)),
  onSubmitComment: (payload) => submit("submit-project", payload),
  onSubmitEnvironmentComment: (payload) => submit("submit-environment", payload),
  ...JSON.parse(parameters.get("props") || "{}"),
};

/**
 * Actualiza props sin remontar el componente real ni acceder a su estado interno.
 * El trigger permanece disponible durante cierre y desmontaje para verificar foco.
 * @param {Object} [nextProps={}] Cambios del consumidor.
 * @returns {void} Renderiza el contrato actualizado.
 */
function setProps(nextProps = {}) {
  drawerProps = { ...drawerProps, ...nextProps };
  flushSync(() => root.render(
    <>
      <button type="button" onClick={() => setProps({ open: true })}>Abrir notificaciones</button>
      {mounted ? (parameters.get("consumer")
        ? <NotificationsDrawerConsumers consumer={parameters.get("consumer")} {...drawerProps} />
        : <NotificationsDrawer {...drawerProps} />) : null}
    </>,
  ));
}

/** Desmonta el drawer manteniendo el trigger para observar la restauración de foco. */
function unmount() {
  mounted = false;
  setProps();
}

/** Cambia el comportamiento del callback externo para las siguientes solicitudes. */
function setSubmissionMode(mode) {
  submissionMode = mode;
}

/**
 * Completa una solicitud externa; el rechazo conserva el mensaje del consumidor.
 * @param {number} index Índice de la solicitud pendiente.
 * @param {boolean} [fail=false] Si debe rechazar la solicitud.
 * @returns {void} Resuelve o rechaza la promesa observada por el drawer.
 */
function settle(index, fail = false) {
  if (fail) {
    pendingSubmissions[index].reject(new Error("Fallo simulado"));
  } else {
    pendingSubmissions[index].resolve({});
  }
}

document.documentElement.classList.toggle("dark", parameters.get("theme") === "dark");
window.drawerHarness = { events, setProps, unmount, setSubmissionMode, settle,
  setReadFailure: (fail) => { readFailure = fail; },
};
setProps();
