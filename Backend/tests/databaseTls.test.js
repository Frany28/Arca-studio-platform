import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import tls from "node:tls";

import pg from "pg";

import { collectDatabaseTlsViolations, resolveDatabaseConnection } from "../src/config/databaseTls.js";
import { collectEnvironmentViolations } from "../src/config/environment.js";

const PASSWORD = "contrasena-que-no-debe-aparecer";
const SUPABASE_URL = `postgresql://postgres.ref:${PASSWORD}@aws-0-region.pooler.supabase.com:5432/postgres`;
const REMOTE_URL = `postgresql://app:${PASSWORD}@db.example.test:5432/arca`;
const LOOPBACK_URL = `postgresql://app:${PASSWORD}@localhost:5432/arca`;
// Certificado público incluido en Node: solo se usa como PEM válido, nunca para conectar.
const VALID_PEM = tls.rootCertificates[0];
const TLS_VERIFICATION_ERRORS = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/**
 * Devuelve los códigos de infracción TLS de un entorno desplegado.
 *
 * @param {Record<string, string>} environment - Variables del escenario.
 * @returns {Array<string>} Códigos ordenados.
 */
function codes(environment) {
  return collectDatabaseTlsViolations(environment).map(({ code }) => code).sort();
}

const DEPLOYED_MATRIX = [
  { label: "Supabase con CA", env: { DATABASE_URL: SUPABASE_URL, DATABASE_SSL_CA_CERT: VALID_PEM }, expected: [] },
  { label: "Supabase con CA y saltos de línea escapados", env: { DATABASE_URL: SUPABASE_URL, DATABASE_SSL_CA_CERT: VALID_PEM.replace(/\n/g, "\\n") }, expected: [] },
  { label: "Supabase sin CA", env: { DATABASE_URL: SUPABASE_URL }, expected: ["DATABASE_SSL_CA_REQUIRED"] },
  { label: "Supabase directo (.supabase.co) sin CA", env: { DATABASE_URL: `postgresql://postgres:${PASSWORD}@db.ref.supabase.co:5432/postgres` }, expected: ["DATABASE_SSL_CA_REQUIRED"] },
  { label: "CA que no es PEM", env: { DATABASE_URL: SUPABASE_URL, DATABASE_SSL_CA_CERT: "no-es-un-certificado" }, expected: ["DATABASE_SSL_CA_INVALID"] },
  { label: "CA PEM corrupto", env: { DATABASE_URL: SUPABASE_URL, DATABASE_SSL_CA_CERT: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----" }, expected: ["DATABASE_SSL_CA_INVALID"] },
  { label: "remota con CA pública del sistema", env: { DATABASE_URL: REMOTE_URL }, expected: [] },
  { label: "verificación desactivada", env: { DATABASE_URL: SUPABASE_URL, DATABASE_SSL_CA_CERT: VALID_PEM, DATABASE_SSL_REJECT_UNAUTHORIZED: "false" }, expected: ["DATABASE_TLS_VERIFICATION_DISABLED"] },
  { label: "verificación desactivada con mayúsculas", env: { DATABASE_URL: REMOTE_URL, DATABASE_SSL_REJECT_UNAUTHORIZED: " FALSE " }, expected: ["DATABASE_TLS_VERIFICATION_DISABLED"] },
  { label: "TLS desactivada en base remota", env: { DATABASE_URL: REMOTE_URL, DATABASE_SSL: "false" }, expected: ["DATABASE_TLS_DISABLED"] },
  { label: "TLS desactivada en loopback", env: { DATABASE_URL: LOOPBACK_URL, DATABASE_SSL: "false" }, expected: [] },
  { label: "URL sslmode=disable", env: { DATABASE_URL: `${REMOTE_URL}?sslmode=disable` }, expected: ["DATABASE_URL_TLS_INSECURE"] },
  { label: "URL sslmode=no-verify", env: { DATABASE_URL: `${REMOTE_URL}?sslmode=no-verify` }, expected: ["DATABASE_URL_TLS_INSECURE"] },
  { label: "URL sslmode=prefer", env: { DATABASE_URL: `${REMOTE_URL}?sslmode=prefer` }, expected: ["DATABASE_URL_TLS_INSECURE"] },
  { label: "URL sslmode=allow", env: { DATABASE_URL: `${REMOTE_URL}?sslmode=allow` }, expected: ["DATABASE_URL_TLS_INSECURE"] },
  { label: "URL ssl=0", env: { DATABASE_URL: `${REMOTE_URL}?ssl=0` }, expected: ["DATABASE_URL_TLS_INSECURE"] },
  { label: "URL ssl=no-verify", env: { DATABASE_URL: `${REMOTE_URL}?ssl=no-verify` }, expected: ["DATABASE_URL_TLS_INSECURE"] },
  { label: "URL uselibpqcompat con require", env: { DATABASE_URL: `${REMOTE_URL}?uselibpqcompat=true&sslmode=require` }, expected: ["DATABASE_URL_TLS_INSECURE"] },
  { label: "URL sslrootcert", env: { DATABASE_URL: `${REMOTE_URL}?sslrootcert=/tmp/ca.pem` }, expected: ["DATABASE_URL_TLS_INSECURE"] },
  { label: "URL sslmode=require (redundante)", env: { DATABASE_URL: `${SUPABASE_URL}?sslmode=require`, DATABASE_SSL_CA_CERT: VALID_PEM }, expected: [] },
  { label: "URL sslmode=verify-full (redundante)", env: { DATABASE_URL: `${REMOTE_URL}?sslmode=verify-full` }, expected: [] },
  { label: "URL inválida", env: { DATABASE_URL: "no es una url" }, expected: ["DATABASE_URL_INVALID"] },
  { label: "sin DATABASE_URL", env: {}, expected: [] },
];

for (const { label, env, expected } of DEPLOYED_MATRIX) {
  test(`TLS desplegado: ${label}`, () => {
    assert.deepEqual(codes(env), expected);
  });
}

test("los mensajes de infracción y avisos no revelan la cadena de conexión ni el certificado", () => {
  const environment = { DATABASE_URL: `${SUPABASE_URL}?sslmode=no-verify`, DATABASE_SSL_REJECT_UNAUTHORIZED: "false" };
  const text = JSON.stringify(collectDatabaseTlsViolations(environment));
  assert.doesNotMatch(text, new RegExp(PASSWORD));
  assert.doesNotMatch(text, /pooler\.supabase\.com/);
  assert.throws(() => resolveDatabaseConnection(environment, { local: false }), (error) => {
    assert.equal(error.code, "DATABASE_TLS_INSECURE");
    assert.doesNotMatch(error.message, new RegExp(PASSWORD));
    return true;
  });
  const { warnings } = resolveDatabaseConnection({ DATABASE_URL: `${REMOTE_URL}?sslmode=disable` }, { local: true });
  assert.doesNotMatch(JSON.stringify(warnings), new RegExp(PASSWORD));
});

test("desplegado: siempre verifica y la URL no puede sustituir la configuración", () => {
  assert.deepEqual(
    resolveDatabaseConnection({ DATABASE_URL: SUPABASE_URL, DATABASE_SSL_CA_CERT: VALID_PEM.replace(/\n/g, "\\n") }, { local: false }).ssl,
    { ca: VALID_PEM.trim(), rejectUnauthorized: true },
  );
  assert.deepEqual(resolveDatabaseConnection({ DATABASE_URL: REMOTE_URL }, { local: false }).ssl, { rejectUnauthorized: true });
  assert.equal(resolveDatabaseConnection({ DATABASE_URL: LOOPBACK_URL }, { local: false }).ssl, false);

  const resolved = resolveDatabaseConnection(
    { DATABASE_URL: `${SUPABASE_URL}?sslmode=require&application_name=arca`, DATABASE_SSL_CA_CERT: VALID_PEM },
    { local: false },
  );
  const url = new URL(resolved.connectionString);
  assert.equal(url.searchParams.has("sslmode"), false);
  assert.equal(url.searchParams.get("application_name"), "arca");
  assert.equal(decodeURIComponent(url.password), PASSWORD);
  assert.equal(resolved.ssl.rejectUnauthorized, true);
  assert.ok(resolved.ssl.ca);

  for (const DATABASE_URL of [`${SUPABASE_URL}?sslmode=no-verify`, `${REMOTE_URL}?ssl=0`]) {
    assert.throws(() => resolveDatabaseConnection({ DATABASE_URL, DATABASE_SSL_CA_CERT: VALID_PEM }, { local: false }), { code: "DATABASE_TLS_INSECURE" });
  }
});

test("con una IP, la identidad del certificado se comprueba contra esa IP", () => {
  const ipUrl = `postgresql://app:${PASSWORD}@10.0.0.5:5432/arca`;
  assert.deepEqual(resolveDatabaseConnection({ DATABASE_URL: ipUrl }, { local: false }).ssl, { host: "10.0.0.5", rejectUnauthorized: true });
  assert.deepEqual(
    resolveDatabaseConnection({ DATABASE_URL: `postgresql://app:${PASSWORD}@[2001:db8::5]:5432/arca`, DATABASE_SSL_CA_CERT: VALID_PEM }, { local: false }).ssl,
    { ca: VALID_PEM.trim(), host: "2001:db8::5", rejectUnauthorized: true },
  );
  assert.equal("host" in resolveDatabaseConnection({ DATABASE_URL: REMOTE_URL }, { local: false }).ssl, false);
});

test("una URL sin parámetros TLS se entrega a pg sin reconstruirla", () => {
  const raw = `${REMOTE_URL}?application_name=arca`;
  assert.equal(resolveDatabaseConnection({ DATABASE_URL: raw }, { local: false }).connectionString, raw);
});

test("local: mantiene la compatibilidad y avisa cuando no verifica", () => {
  assert.equal(resolveDatabaseConnection({ DATABASE_URL: LOOPBACK_URL }, { local: true }).ssl, false);
  assert.equal(resolveDatabaseConnection({ DATABASE_URL: REMOTE_URL, DATABASE_SSL: "false" }, { local: true }).ssl, false);

  const unverified = resolveDatabaseConnection({ DATABASE_URL: SUPABASE_URL }, { local: true });
  assert.deepEqual(unverified.ssl, { rejectUnauthorized: false });
  assert.match(unverified.warnings.join(" "), /sin verificar/);

  assert.deepEqual(
    resolveDatabaseConnection({ DATABASE_URL: SUPABASE_URL, DATABASE_SSL_CA_CERT: VALID_PEM }, { local: true }).ssl,
    { ca: VALID_PEM.trim(), rejectUnauthorized: true },
  );
  assert.deepEqual(
    resolveDatabaseConnection({ DATABASE_URL: REMOTE_URL, DATABASE_SSL_REJECT_UNAUTHORIZED: "true" }, { local: true }).ssl,
    { rejectUnauthorized: true },
  );

  // En local, la URL tampoco decide: no-verify se ignora y se avisa.
  const fromUrl = resolveDatabaseConnection(
    { DATABASE_URL: `${REMOTE_URL}?sslmode=no-verify`, DATABASE_SSL_REJECT_UNAUTHORIZED: "true" },
    { local: true },
  );
  assert.deepEqual(fromUrl.ssl, { rejectUnauthorized: true });
  assert.match(fromUrl.warnings.join(" "), /Se ignoraron parámetros TLS de DATABASE_URL \(sslmode\)/);
});

test("la guardia de arranque incluye la TLS de PostgreSQL en producción", () => {
  const production = {
    AUTH_TOKEN_SECRET: "x".repeat(48),
    CORS_ORIGINS: "https://arca-studio-platform.netlify.app",
    NODE_ENV: "production",
  };
  const violationCodes = (env) => collectEnvironmentViolations(env).map(({ code }) => code);
  assert.deepEqual(violationCodes({ ...production, DATABASE_URL: SUPABASE_URL }), ["DATABASE_SSL_CA_REQUIRED"]);
  assert.deepEqual(violationCodes({ ...production, DATABASE_URL: SUPABASE_URL, DATABASE_SSL_CA_CERT: VALID_PEM }), []);
  assert.deepEqual(violationCodes({ DATABASE_URL: SUPABASE_URL, NODE_ENV: "development" }), []);
});

// --- Handshakes reales con pg contra un servidor PostgreSQL simulado ---------------------------

/**
 * Genera una CA de prueba, un certificado de servidor para `localhost` y una segunda CA ajena.
 * Son efímeros: se crean en un directorio temporal que se elimina al terminar.
 *
 * @returns {{ trustedCa: string, otherCa: string, serverKey: string, serverCert: string }|null} PEMs, o null sin openssl.
 */
function createEphemeralCertificates() {
  const directory = mkdtempSync(path.join(tmpdir(), "arca-db-tls-"));
  const openssl = (...args) => execFileSync("openssl", args, { cwd: directory, stdio: "pipe" });
  try {
    for (const [name, cn] of [["trusted", "ARCA Test Root CA"], ["other", "Untrusted Test Root CA"]]) {
      openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${cn}`,
        "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
        "-keyout", `${name}-ca.key`, "-out", `${name}-ca.crt`);
    }
    writeFileSync(path.join(directory, "server.ext"), "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n");
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", "server.key", "-out", "server.csr");
    openssl("x509", "-req", "-in", "server.csr", "-CA", "trusted-ca.crt", "-CAkey", "trusted-ca.key", "-CAcreateserial",
      "-days", "2", "-extfile", "server.ext", "-out", "server.crt");
    const read = (name) => readFileSync(path.join(directory, name), "utf8");
    return { otherCa: read("other-ca.crt"), serverCert: read("server.crt"), serverKey: read("server.key"), trustedCa: read("trusted-ca.crt") };
  } catch {
    return null;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

const certificates = createEphemeralCertificates();
const handshakeSkip = !certificates && "Requiere openssl para generar certificados de prueba efímeros.";

/**
 * Inicia un servidor que acepta el SSLRequest de PostgreSQL y negocia TLS con el certificado de prueba.
 * Tras el handshake cierra la conexión: solo interesa saber si el cliente aceptó el certificado.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @returns {Promise<{ port: number, handshakes: () => number }>} Puerto y contador de handshakes completados.
 */
async function startFakePostgres(context) {
  let completed = 0;
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", (chunk) => {
      // SSLRequest: longitud 8 y código 80877103.
      if (chunk.length < 8 || chunk.readInt32BE(4) !== 80877103) {
        socket.destroy();
        return;
      }
      socket.write("S");
      const secure = new tls.TLSSocket(socket, { cert: certificates.serverCert, isServer: true, key: certificates.serverKey });
      secure.on("error", () => {});
      secure.on("secure", () => {
        completed += 1;
        secure.destroy();
      });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return { handshakes: () => completed, port: server.address().port };
}

/**
 * Conecta con pg usando exactamente la configuración que resolvería el backend.
 *
 * @param {object} connection - Resultado de `resolveDatabaseConnection` (o equivalente).
 * @returns {Promise<string|null>} Código del error del cliente, o null si no hubo error TLS.
 */
async function connectWith({ connectionString, ssl }) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, ssl });
  client.on("error", () => {});
  try {
    await client.connect();
    return null;
  } catch (error) {
    return error.code || error.message;
  } finally {
    await client.end().catch(() => {});
  }
}

test("handshake: una CA de confianza configurada permite la conexión", { skip: handshakeSkip }, async (context) => {
  const server = await startFakePostgres(context);
  const code = await connectWith(resolveDatabaseConnection({
    DATABASE_SSL: "true",
    DATABASE_SSL_CA_CERT: certificates.trustedCa.replace(/\n/g, "\\n"),
    DATABASE_URL: `postgresql://app:${PASSWORD}@localhost:${server.port}/arca`,
  }, { local: false }));
  assert.equal(server.handshakes(), 1);
  assert.equal(TLS_VERIFICATION_ERRORS.has(code), false, String(code));
});

for (const { label, env } of [
  { label: "sin CA (almacén del sistema)", env: {} },
  { label: "con una CA ajena", env: { DATABASE_SSL_CA_CERT: "OTHER_CA" } },
]) {
  test(`handshake: certificado no confiable rechazado ${label}`, { skip: handshakeSkip }, async (context) => {
    const server = await startFakePostgres(context);
    const environment = {
      DATABASE_SSL: "true",
      DATABASE_URL: `postgresql://app:${PASSWORD}@localhost:${server.port}/arca`,
      ...env,
    };
    if (environment.DATABASE_SSL_CA_CERT === "OTHER_CA") environment.DATABASE_SSL_CA_CERT = certificates.otherCa;
    const code = await connectWith(resolveDatabaseConnection(environment, { local: false }));
    assert.ok(TLS_VERIFICATION_ERRORS.has(code), String(code));
    assert.equal(server.handshakes(), 0);
  });
}

test("handshake: un host que no coincide con el certificado se rechaza", { skip: handshakeSkip }, async (context) => {
  const server = await startFakePostgres(context);
  const code = await connectWith(resolveDatabaseConnection({
    DATABASE_SSL: "true",
    DATABASE_SSL_CA_CERT: certificates.trustedCa,
    DATABASE_URL: `postgresql://app:${PASSWORD}@127.0.0.1:${server.port}/arca`,
  }, { local: false }));
  assert.equal(code, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(server.handshakes(), 0);
});

test("handshake: sslmode en la URL ya no descarta la CA configurada", { skip: handshakeSkip }, async (context) => {
  const server = await startFakePostgres(context);
  const environment = {
    DATABASE_SSL: "true",
    DATABASE_SSL_CA_CERT: certificates.trustedCa,
    DATABASE_URL: `postgresql://app:${PASSWORD}@localhost:${server.port}/arca?sslmode=require`,
  };
  // Comportamiento anterior: pg sustituía `ssl` por el de la URL y perdía la CA.
  const legacy = await connectWith({ connectionString: environment.DATABASE_URL, ssl: { ca: certificates.trustedCa, rejectUnauthorized: true } });
  assert.ok(TLS_VERIFICATION_ERRORS.has(legacy), String(legacy));

  const code = await connectWith(resolveDatabaseConnection(environment, { local: false }));
  assert.equal(TLS_VERIFICATION_ERRORS.has(code), false, String(code));
  assert.equal(server.handshakes(), 1);
});

test("handshake: sslmode=no-verify en la URL no desactiva la verificación local pedida", { skip: handshakeSkip }, async (context) => {
  const server = await startFakePostgres(context);
  const code = await connectWith(resolveDatabaseConnection({
    DATABASE_SSL: "true",
    DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
    DATABASE_URL: `postgresql://app:${PASSWORD}@localhost:${server.port}/arca?sslmode=no-verify`,
  }, { local: true }));
  assert.ok(TLS_VERIFICATION_ERRORS.has(code), String(code));
  assert.equal(server.handshakes(), 0);
});
