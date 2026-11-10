import assert from "node:assert/strict";
import test from "node:test";

import {
  publishProjectEvent,
  subscribeToProjectEvents,
} from "../src/services/projectEvents.js";

test("project SSE events sanitize private resource links", () => {
  const chunks = [];
  const response = {
    destroyed: false,
    end() {},
    on() {},
    writableEnded: false,
    write(chunk) {
      chunks.push(chunk);
    },
  };
  const unsubscribe = subscribeToProjectEvents({
    projectId: 987654,
    response,
    userId: 987654,
  });

  try {
    publishProjectEvent({
      eventName: "project.comment.created",
      payload: {
        comment: {
          content: "Revisar plano",
          file_url: "s3://private-bucket/projects/1/file.png",
          selection: {
            src: "/api/projects/1/files/4/content",
            x: 0.5,
          },
        },
      },
      projectId: 987654,
    });
  } finally {
    unsubscribe();
  }

  const stream = chunks.join("");
  assert.match(stream, /"content":"Revisar plano"/);
  assert.match(stream, /"x":0.5/);
  assert.doesNotMatch(stream, /file_url|s3:\/\/|\/files\/4\/content|src/);
});

/**
 * Respuesta SSE simulada que registra escrituras y cierre.
 *
 * @returns {object} Respuesta con `chunks` y estado `writableEnded`.
 */
function fakeStream() {
  const response = {
    chunks: [],
    destroyed: false,
    end() { this.writableEnded = true; },
    on() {},
    writableEnded: false,
    write(chunk) { this.chunks.push(chunk); },
  };
  return response;
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

for (const [label, reauthorize, expectOpen] of [
  ["acceso vigente: el stream sigue abierto", async () => true, true],
  ["acceso revocado: el stream se cierra y deja de recibir eventos", async () => false, false],
  ["fallo al revalidar (p. ej. base caída): se cierra por seguridad", async () => { throw new Error("db down"); }, false],
]) {
  test(`SSE revalida la suscripción periódicamente — ${label}`, async (context) => {
    // Regresión (auditoría #9): la autorización solo se comprobaba al conectar; en un servidor de
    // larga duración un usuario desasignado o con sesión revocada seguía recibiendo comentarios.
    context.mock.timers.enable({ apis: ["setInterval"] });
    const response = fakeStream();
    let checks = 0;
    const unsubscribe = subscribeToProjectEvents({
      projectId: 4242,
      reauthorize: async () => { checks += 1; return reauthorize(); },
      response,
      userId: 4242,
    });
    context.after(unsubscribe);

    context.mock.timers.tick(30000);
    await flushAsync();
    assert.equal(checks, 1, "revalida al cumplirse el intervalo");
    assert.equal(response.writableEnded, !expectOpen);

    const before = response.chunks.length;
    publishProjectEvent({ eventName: "project.comment.created", payload: { comment: { content: "nuevo" } }, projectId: 4242 });
    assert.equal(response.chunks.length > before, expectOpen, expectOpen ? "recibe eventos" : "no recibe eventos tras el cierre");
  });
}
