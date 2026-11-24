import assert from "node:assert/strict";
import test from "node:test";

import { toNotificationActivity } from "../src/hooks/useUserNotifications.js";

const BASE = { createdAt: "2026-11-23T10:00:00.000Z", entity: { id: 302, type: "file_version" }, id: 11, readAt: null };

test("una notificación de rechazo se presenta como nueva, con su motivo, su estado y el proyecto accesible", () => {
  const item = toNotificationActivity({
    ...BASE, isRead: false, message: "La versión V2 de «Plano.pdf» fue rechazada. Motivo: Falta firma. Puedes subir una versión corregida.",
    project: { id: 21, name: "Casa Norte" }, title: "Archivo rechazado", type: "project_file.version_rejected",
  }, Date.parse("2026-11-23T10:05:00.000Z"));
  assert.deepEqual([item.id, item.name, item.status, item.type, item.unread, item.projectName], ["notification-11", "ARCA Studio", "Archivo rechazado", "status", true, "Casa Norte"]);
  assert.match(item.action, /Motivo: Falta firma/);
  assert.equal(item.notification.id, 11, "conserva la notificación para marcarla y navegar");
});

test("una leída no se marca como nueva y sin acceso al proyecto no se nombra", () => {
  const item = toNotificationActivity({ ...BASE, id: 12, isRead: true, message: "Aprobada.", project: null, title: "Archivo aprobado", type: "project_file.version_approved" });
  assert.deepEqual([item.unread, item.projectName, item.status], [false, undefined, "Archivo aprobado"]);
  const unknown = toNotificationActivity({ ...BASE, id: 13, isRead: false, message: "x", project: null, title: "Aviso", type: "otro.tipo" });
  assert.equal(unknown.status, "Aviso", "un tipo desconocido usa su título");
});
