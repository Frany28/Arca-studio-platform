import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { classifyStatus, sessionCookieFrom, sessionHeaders } from "../load-tests/session.js";

// P0-4: el arnés de carga usa la cookie de sesión real. Los scripts de k6 importan módulos de k6 y no
// se pueden ejecutar con Node; se comprueban su configuración y el módulo común de sesión.
const loadTestsDirectory = new URL("../load-tests/", import.meta.url);

test("extrae la cookie de sesión de desarrollo y de producción, sola o junto a otras", () => {
  assert.equal(sessionCookieFrom(["arca_session=abc.def.ghi; Max-Age=43200; Path=/; HttpOnly; SameSite=Lax"]), "arca_session=abc.def.ghi");
  assert.equal(sessionCookieFrom("__Host-arca_session=tok; Path=/; HttpOnly; Secure; SameSite=Lax"), "__Host-arca_session=tok");
  // k6 une varias Set-Cookie en una cadena; las fechas Expires contienen comas.
  assert.equal(sessionCookieFrom("other=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/, arca_session=xyz; Path=/; HttpOnly"), "arca_session=xyz");
  assert.equal(sessionCookieFrom(["arca_session=; Max-Age=0; Path=/"]), null, "una cookie vacía (logout) no es una sesión");
  assert.equal(sessionCookieFrom(undefined), null);
  assert.deepEqual(sessionHeaders("arca_session=x", "https://app.test", { Range: "bytes=0-1" }), { Cookie: "arca_session=x", Origin: "https://app.test", Range: "bytes=0-1" });
});

test("separa límites legítimos, saturación y fallos de autenticación de los errores del sistema", () => {
  assert.equal(classifyStatus(200), "ok");
  assert.equal(classifyStatus(206), "ok");
  assert.equal(classifyStatus(429), "rate_limited");
  assert.equal(classifyStatus(503), "saturated");
  assert.equal(classifyStatus(401), "auth_failure");
  assert.equal(classifyStatus(403), "auth_failure");
  assert.equal(classifyStatus(500), "server_error");
  assert.equal(classifyStatus(409), "client_error");
  assert.equal(classifyStatus(0), "network_error");
});

test("ningún script lee un token del cuerpo ni usa Authorization Bearer", async () => {
  const files = (await readdir(loadTestsDirectory)).filter((name) => /\.(m?js)$/.test(name));
  assert.ok(files.length >= 5);
  for (const file of files) {
    const source = await readFile(new URL(file, loadTestsDirectory), "utf8");
    assert.doesNotMatch(source, /json\(["']token["']\)|\)\.token\b|Bearer \$\{/, file);
  }
});

test("perfiles de 10, 25, 50 y 100 usuarios, carga sostenida de 60 minutos y métricas separadas", async () => {
  const config = await readFile(new URL("config.js", loadTestsDirectory), "utf8");
  for (const profile of ["c10: constant(10)", "c25: constant(25)", "c50: constant(50)", "c100: constant(100)"]) {
    assert.ok(config.includes(profile), profile);
  }
  assert.match(config, /soak: \{ main: \{ duration: __ENV\.DURATION \|\| "60m"/);
  assert.match(config, /auth_failures: \["count==0"\]/);
  assert.match(config, /expectedStatuses\(\{ min: 200, max: 399 \}, 429\)/);
  assert.match(config, /"p\(95\)", "p\(99\)"/);
  for (const workload of ["mixed-workload.js", "file-workload.js"]) {
    const source = await readFile(new URL(workload, loadTestsDirectory), "utf8");
    assert.match(source, /login\(baseUrl, accounts\)/, workload);
    assert.match(source, /scenarios: scenarios\(\)/, workload);
  }
});
