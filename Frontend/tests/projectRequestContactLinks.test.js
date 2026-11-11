import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectRequestContactMessage,
  buildProjectRequestEmailHref,
  buildProjectRequestWhatsAppHref,
  getProjectRequestWhatsAppNumber,
} from "../src/utils/projectRequestContactLinks.js";

test("los enlaces de correo utilizan datos del usuario y preparan un borrador, sin enviarlo", () => {
  const href = buildProjectRequestEmailHref({
    email: " contacto@ejemplo.com ",
    projectName: "Casa Centro",
    note: "Adjunta los planos estructurales.",
  });
  assert.ok(href.startsWith("mailto:contacto@ejemplo.com?"));
  const [address, params] = href.slice("mailto:".length).split("?");
  assert.equal(address, "contacto@ejemplo.com");
  const fields = new URLSearchParams(params);
  assert.match(fields.get("subject"), /Información adicional/);
  assert.match(fields.get("body"), /Casa Centro/);
  assert.match(fields.get("body"), /planos estructurales/);
  for (const email of [undefined, "", "sin-arroba", "nombre@dominio"]) {
    assert.equal(buildProjectRequestEmailHref({ email }), null);
  }
});

test("WhatsApp solo abre números con prefijo internacional explícito", () => {
  assert.equal(getProjectRequestWhatsAppNumber("+58 414 1234567"), "584141234567");
  assert.equal(getProjectRequestWhatsAppNumber("+1 (312) 555-0123"), "13125550123");
  for (const number of ["0414 1234567", "4141234567", "++58 414 1234567", "abc", null]) {
    assert.equal(getProjectRequestWhatsAppNumber(number), null);
    assert.equal(buildProjectRequestWhatsAppHref({ phone: number }), null);
  }
  const href = buildProjectRequestWhatsAppHref({
    phone: "+58 414 1234567",
    projectName: "Casa Centro",
    note: "Falta un documento legal.",
  });
  const url = new URL(href);
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/584141234567");
  assert.match(url.searchParams.get("text"), /Falta un documento legal/);
});

test("el texto de contacto no inventa información faltante cuando el motivo está vacío", () => {
  assert.equal(
    buildProjectRequestContactMessage({ projectName: "Casa Centro" }),
    "Hola, necesitamos información adicional para continuar con la solicitud de tu proyecto Casa Centro.",
  );
  assert.match(
    buildProjectRequestContactMessage({ note: "Adjunta la documentación." }),
    /Información requerida: Adjunta la documentación/,
  );
});
