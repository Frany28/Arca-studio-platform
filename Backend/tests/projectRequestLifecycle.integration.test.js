import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Ciclo completo de una solicitud por HTTP contra PostgreSQL real: borrador, adjuntos, código,
// envío, consulta, descarga, cola y decisión del administrador, corrección y reenvío. Opcional y
// aislada: ARCA_REQUEST_LIFECYCLE_DB_TESTS=1 y ARCA_REQUEST_LIFECYCLE_TEST_DATABASE_URL (solo
// localhost). Crea una base propia con todas las migraciones y la elimina al terminar; nunca usa
// DATABASE_URL del proyecto. El almacenamiento es un mapa en memoria y el correo se simula.
const enabled = process.env.ARCA_REQUEST_LIFECYCLE_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_REQUEST_LIFECYCLE_DB_TESTS=1 y ARCA_REQUEST_LIFECYCLE_TEST_DATABASE_URL.";
// Límite por archivo reducido para comprobar el 413 sin transferir 50 MB.
const MAX_FILE_BYTES = 64 * 1024;

let database;
let server;
let base;
let modules;
let seed;
const storage = new Map();
const deletedKeys = [];
const sentCodes = [];
const realFetch = globalThis.fetch;

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_REQUEST_LIFECYCLE_TEST_DATABASE_URL,
    prefix: "arca_request_lifecycle",
  });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "lifecycle-test-secret-0123456789abcdef0123456789abcdef",
    DATABASE_URL: database.databaseUrl,
    FILE_UPLOAD_MAX_BYTES: String(MAX_FILE_BYTES),
    MAIL_FROM: "ARCA <no-reply@example.test>",
    NODE_ENV: "test",
    // Las pruebas del ciclo usan el código real; la validación temporal se prueba aparte.
    PROJECT_REQUEST_EMAIL_VERIFICATION: "enabled",
    PROJECT_REQUEST_RATE_LIMIT_MAX: "1000",
    RESEND_API_KEY: "test-key",
    SUPABASE_STORAGE_BUCKET: "test-bucket",
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: "test-access-key",
    SUPABASE_STORAGE_S3_ENDPOINT: "https://storage.test.local/s3",
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: "test-secret-key",
  });
  // Solo se simula el proveedor de correo: registra el código y deja pasar las peticiones locales.
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      sentCodes.push(JSON.parse(options.body).text.match(/\b(\d{6})\b/)[1]);
      return new Response(JSON.stringify({ id: randomUUID() }), { headers: { "content-type": "application/json" }, status: 200 });
    }
    return realFetch(url, options);
  };
  modules = {
    ...(await import("../src/config/db.js")),
    ...(await import("../src/services/objectStorage.js")),
    ...(await import("../src/services/sessionService.js")),
    app: (await import("../src/app.js")).default,
  };
  installMemoryStorage(modules.objectStorage);

  const { client } = database;
  const roleId = async (code) => Number((await client.query("insert into public.roles (code, name) values ($1, $1) returning id", [code])).rows[0].id);
  const roles = { admin: await roleId("admin"), architect: await roleId("architect"), client: await roleId("client") };
  const insertClient = async (email) => Number((await client.query(`insert into public.clients (name, email, phone, address, city, country)
    values ('Cliente prueba', $1, '+584120000002', 'Prueba', 'Caracas', 'VE') returning id`, [email])).rows[0].id);
  const insertUser = async ({ clientId = null, email, phone, role }) => Number((await client.query(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash, phone)
    values ($1, $2, $3, 'Prueba', 'Ciclo', '!login-disabled!', $4) returning id`, [roles[role], clientId, email, phone])).rows[0].id);
  const ownerClientId = await insertClient("cliente-ciclo@example.test");
  const strangerClientId = await insertClient("ajeno-ciclo@example.test");
  seed = {
    admin: await insertUser({ email: "admin-ciclo@example.test", phone: "+584120000011", role: "admin" }),
    architect: await insertUser({ email: "arquitecto-ciclo@example.test", phone: "+584120000012", role: "architect" }),
    owner: await insertUser({ clientId: ownerClientId, email: "cliente-ciclo@example.test", phone: "+584120000013", role: "client" }),
    stranger: await insertUser({ clientId: strangerClientId, email: "ajeno-ciclo@example.test", phone: "+584120000014", role: "client" }),
  };

  server = modules.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (!enabled) return;
  globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  await modules?.pool?.end().catch(() => {});
  await database?.drop();
});

/**
 * Sustituye el almacenamiento S3 por un mapa en memoria que conserva los bytes transferidos, para
 * comprobar que lo registrado en PostgreSQL se puede descargar íntegro.
 *
 * @param {object} objectStorage - Adaptador compartido de almacenamiento.
 * @returns {void}
 */
function installMemoryStorage(objectStorage) {
  objectStorage.put = async ({ body, contentType, key }) => {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    storage.set(key, { body: Buffer.concat(chunks), contentType });
    return {};
  };
  objectStorage.delete = async (key) => {
    deletedKeys.push(key);
    storage.delete(key);
    return {};
  };
  objectStorage.get = async (key) => {
    const stored = storage.get(key);
    if (!stored) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    const { Readable } = await import("node:stream");
    return { Body: Readable.from([stored.body]), ContentLength: stored.body.length, ContentType: stored.contentType };
  };
}

/**
 * Emite una sesión real (tabla user_sessions) y devuelve su cabecera Authorization.
 *
 * @param {number} userId - Usuario de la sesión.
 * @returns {Promise<Object>} Cabeceras de autenticación.
 */
async function authAs(userId) {
  const session = await modules.issueUserSession(userId);
  return { Authorization: `Bearer ${session.token}` };
}

/**
 * Llama a la API con JSON y devuelve estado y cuerpo decodificado.
 *
 * @param {string} path - Ruta relativa a /api.
 * @param {Object} [options] - Método, cabeceras y cuerpo JSON.
 * @returns {Promise<{status: number, body: Object|null}>} Respuesta.
 */
async function api(path, { body, headers = {}, method = "GET" } = {}) {
  const response = await fetch(`${base}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method,
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, status: response.status };
}

/**
 * Sube un archivo como lo hace uploadRawFile: cuerpo binario, Content-Type y X-File-Name.
 *
 * @param {number} projectRequestId - Solicitud destino.
 * @param {Object} file - Nombre, tipo y bytes.
 * @param {Object} headers - Autenticación.
 * @returns {Promise<{status: number, body: Object|null}>} Respuesta.
 */
async function upload(projectRequestId, { bytes, name, type }, headers) {
  const response = await fetch(`${base}/project-requests/${projectRequestId}/files`, {
    body: bytes,
    headers: { ...headers, "Content-Type": type, "X-File-Name": encodeURIComponent(name) },
    method: "POST",
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, status: response.status };
}

const pdf = (name, size = 2048) => ({ bytes: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(size, 0x20)]), name, type: "application/pdf" });
const png = (name) => ({ bytes: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(1024, 1)]), name, type: "image/png" });

/**
 * Payload completo como lo construye buildProjectRequestPayload en el frontend (Residencial con
 * inmueble disponible y documentación legal).
 *
 * @param {Object} [overrides] - Campos a sustituir.
 * @returns {Object} Cuerpo del borrador.
 */
function draftPayload(overrides = {}) {
  return {
    capitalAvailability: "available_now",
    decisionMaker: "self",
    description: "Vivienda unifamiliar de dos plantas frente al lago, con terraza.",
    developmentMode: "full",
    experience: "first_time",
    hasBlueprints: true,
    hasMultipleOwners: false,
    investmentRange: "10k_50k",
    landStatus: "available",
    legalDocumentTypes: ["property_deed"],
    legalDocumentationStatus: "available",
    projectLocation: "Maracaibo, Estado Zulia",
    projectLocationFormattedAddress: "Maracaibo, Zulia, Venezuela",
    projectLocationLatitude: 10.6545,
    projectLocationLongitude: -71.6406,
    projectLocationProviderPlaceId: "place-123",
    projectName: `Casa Lago ${randomUUID().slice(0, 8)}`,
    projectSize: "medium_80_200",
    projectType: "residential",
    quality: "premium",
    referenceLink: "https://example.test/referencia",
    startTime: "immediate",
    ...overrides,
  };
}

/**
 * Pide un código para el borrador y lo envía; devuelve la respuesta del envío.
 *
 * @param {number} id - Solicitud.
 * @param {Object} headers - Autenticación del propietario.
 * @returns {Promise<{status: number, body: Object|null}>} Respuesta del envío.
 */
async function verifyAndSubmit(id, headers) {
  const issued = await api(`/project-requests/${id}/verification-code`, { body: {}, headers, method: "POST" });
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  return api(`/project-requests/${id}/submit`, { body: { verificationCode: sentCodes.at(-1) }, headers, method: "POST" });
}

const fileRows = async (id) => (await database.client.query(
  `select f.id, f.title, f.status, f.deleted_at, fv.file_size, fv.file_name
     from public.files f left join public.file_versions fv on fv.file_id = f.id and fv.is_current = true
    where f.project_request_id = $1 order by f.id`,
  [id],
)).rows;

test("PostgreSQL y HTTP: borrador, adjuntos, envío, consulta, descarga, permisos y corrección", { skip }, async () => {
  const owner = await authAs(seed.owner);
  const stranger = await authAs(seed.stranger);
  const admin = await authAs(seed.admin);
  const architect = await authAs(seed.architect);

  // 1. Borrador: todos los campos llegan a PostgreSQL tal como se enviaron.
  const payload = draftPayload();
  const created = await api("/project-requests", { body: { ...payload, submissionId: randomUUID() }, headers: owner, method: "POST" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.projectRequest.id;
  const row = (await database.client.query("select * from public.project_requests where id = $1", [id])).rows[0];
  assert.equal(row.status, "draft");
  assert.equal(row.project_name, payload.projectName);
  assert.equal(row.location, payload.projectLocation);
  assert.equal(row.formatted_address, payload.projectLocationFormattedAddress);
  assert.equal(Number(row.location_latitude), payload.projectLocationLatitude);
  assert.equal(Number(row.location_longitude), payload.projectLocationLongitude);
  assert.equal(row.provider_place_id, payload.projectLocationProviderPlaceId);
  assert.equal(row.has_plans, true);
  assert.equal(row.has_multiple_owners, false);
  assert.deepEqual(row.legal_document_types, ["property_deed"]);
  assert.equal(row.reference_link, payload.referenceLink);

  // 2. Permisos: sin sesión 401; otro cliente no ve ni adjunta en la solicitud (404).
  assert.equal((await upload(id, pdf("plano.pdf"), {})).status, 401);
  assert.equal((await api(`/project-requests/${id}`, { headers: stranger })).status, 404);
  assert.equal((await upload(id, pdf("plano.pdf"), stranger)).status, 404);

  // 3. Validación de archivos: tipo no admitido, contenido que no coincide y tamaño excedido.
  assert.equal((await upload(id, { bytes: Buffer.from("hola"), name: "notas.txt", type: "text/plain" }, owner)).status, 415);
  assert.equal((await upload(id, { bytes: Buffer.alloc(2048, 1), name: "falso.pdf", type: "application/pdf" }, owner)).status, 415);
  const tooLarge = await upload(id, pdf("grande.pdf", MAX_FILE_BYTES + 1), owner);
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.code, "FILE_TOO_LARGE");
  assert.equal((await fileRows(id)).length, 0, "los rechazos no registran archivos");

  // 4. Subida válida y reintento con el mismo nombre: reutiliza el adjunto (sin duplicado).
  const plan = pdf("Plano principal.pdf");
  const first = await upload(id, plan, owner);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const retried = await upload(id, plan, owner);
  assert.equal(retried.status, 201);
  assert.equal(retried.body.file.id, first.body.file.id);
  assert.equal(retried.body.file.reused, true);
  // Otro contenido con el mismo nombre no es un reintento: se rechaza en lugar de confirmarse
  // como subido conservando en silencio los bytes anteriores.
  const replacement = await upload(id, pdf("Plano principal.pdf", 4096), owner);
  assert.equal(replacement.status, 409, JSON.stringify(replacement.body));
  assert.equal(replacement.body.code, "DUPLICATE_PROJECT_REQUEST_FILE");
  const photo = await upload(id, png("fachada.png"), owner);
  assert.equal(photo.status, 201);
  assert.equal((await fileRows(id)).filter((file) => !file.deleted_at).length, 2);
  const [storedPlan] = await fileRows(id);
  assert.ok(storage.get(storedPlan.file_name).body.equals(plan.bytes), "el almacenamiento conserva el archivo confirmado");

  // 5. Actualizar el borrador conserva los adjuntos. La consulta expone el nombre normalizado
  // del almacenamiento (file_versions.original_name), no el título original.
  const updated = await api(`/project-requests/${id}`, { body: { ...payload, projectSize: "large_200_500" }, headers: owner, method: "PATCH" });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const draftDetail = await api(`/project-requests/${id}`, { headers: owner });
  assert.equal(draftDetail.body.projectRequest.projectSize, "large_200_500");
  assert.deepEqual(draftDetail.body.projectRequest.files.map((file) => file.name), ["plano-principal.pdf", "fachada.png"]);

  // 6. Eliminar un adjunto del borrador editable lo retira de la consulta y del almacenamiento.
  assert.equal((await api(`/project-requests/${id}/files/${photo.body.file.id}`, { headers: stranger, method: "DELETE" })).status, 404);
  assert.equal((await api(`/project-requests/${id}/files/${photo.body.file.id}`, { headers: owner, method: "DELETE" })).status, 200);
  assert.deepEqual((await api(`/project-requests/${id}`, { headers: owner })).body.projectRequest.files.map((file) => file.name), ["plano-principal.pdf"]);

  // 7. Código y envío: la solicitud deja de ser editable y conserva sus adjuntos.
  const submitted = await verifyAndSubmit(id, owner);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.projectRequest.status, "pending_verification");
  assert.equal((await upload(id, png("tarde.png"), owner)).status, 404, "una solicitud enviada no admite adjuntos");
  assert.equal((await api(`/project-requests/${id}/files/${first.body.file.id}`, { headers: owner, method: "DELETE" })).status, 404);

  // 8. Consulta tras el envío (equivale a recargar o a volver a iniciar sesión: otra sesión).
  const ownerAgain = await authAs(seed.owner);
  const sent = await api(`/project-requests/${id}`, { headers: ownerAgain });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.projectRequest.status, "pending_verification");
  assert.equal(sent.body.projectRequest.projectSize, "large_200_500");
  const [persisted] = sent.body.projectRequest.files;
  assert.equal(sent.body.projectRequest.files.length, 1);
  assert.equal(persisted.size, plan.bytes.length);

  // 9. Descarga autorizada: los bytes recuperados son los subidos; un tercero recibe 404.
  const content = await fetch(`${base}/project-requests/${id}/files/${persisted.id}/content`, { headers: ownerAgain });
  assert.equal(content.status, 200);
  assert.ok(Buffer.from(await content.arrayBuffer()).equals(plan.bytes));
  assert.equal((await fetch(`${base}/project-requests/${id}/files/${persisted.id}/content`, { headers: stranger })).status, 404);

  // 10. Administrador: cola, detalle con adjuntos, asignación, revisión técnica y corrección.
  const queue = await api("/project-requests/review-queue?limit=100", { headers: admin });
  assert.equal(queue.status, 200);
  assert.ok(queue.body.projectRequests.some((item) => item.id === id));
  // Gestión de proyectos muestra el cliente de cada solicitud abierta (solo en la cola del administrador).
  assert.equal(queue.body.projectRequests.find((item) => item.id === id).clientName, "Cliente prueba");
  const adminDetail = await api(`/admin/project-requests/${id}`, { headers: admin });
  assert.equal(adminDetail.status, 200, JSON.stringify(adminDetail.body));
  assert.deepEqual(adminDetail.body.projectRequest.files.map((file) => file.id), [persisted.id]);
  assert.equal((await api(`/admin/project-requests/${id}`, { headers: owner })).status, 403);
  const adminContent = await fetch(`${base}/project-requests/${id}/files/${persisted.id}/content`, { headers: admin });
  assert.equal(adminContent.status, 200);
  const assigned = await api(`/admin/project-requests/${id}/assignees`, { body: { assigneeIds: [seed.architect] }, headers: admin, method: "PUT" });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const architectQueue = await api("/project-requests/review-queue?limit=100", { headers: architect });
  assert.equal(architectQueue.status, 200);
  assert.equal(architectQueue.body.projectRequests.find((item) => item.id === id).clientName, null, "el arquitecto no recibe el cliente en su cola");
  const review = await api(`/project-requests/${id}/review`, {
    body: { note: "Faltan fotografías actuales del terreno.", recommendation: "changes_requested" },
    headers: architect,
    method: "PUT",
  });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const decision = await api(`/admin/project-requests/${id}/decision`, {
    body: { action: "request_changes", reason: "Adjunta fotografías actuales del terreno." },
    headers: admin,
    method: "PATCH",
  });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));

  // 11. Corrección: el cliente ve el motivo, conserva el adjunto previo, elimina, añade y reenvía.
  const returned = await api(`/project-requests/${id}`, { headers: owner });
  assert.equal(returned.body.projectRequest.status, "changes_requested");
  assert.equal(returned.body.projectRequest.correctionReason, "Adjunta fotografías actuales del terreno.");
  assert.equal(returned.body.projectRequest.files.length, 1);
  const terrain = await upload(id, png("terreno.png"), owner);
  assert.equal(terrain.status, 201, JSON.stringify(terrain.body));
  assert.equal((await upload(id, png("terreno.png"), owner)).body.file.id, terrain.body.file.id, "reintento sin duplicar");
  assert.equal((await api(`/project-requests/${id}/files/${first.body.file.id}`, { headers: owner, method: "DELETE" })).status, 200);
  assert.equal((await api(`/project-requests/${id}`, { body: { ...payload, projectName: `${payload.projectName} v2` }, headers: owner, method: "PATCH" })).status, 200);
  await database.client.query("update public.project_requests set verification_sent_at = now() - interval '2 minutes' where id = $1", [id]);
  const resubmitted = await verifyAndSubmit(id, owner);
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(resubmitted.body.projectRequest.id, id, "la corrección reenvía la misma solicitud");

  // 12. El administrador ve la información nueva y el historial de revisiones se conserva.
  const afterCorrection = await api(`/admin/project-requests/${id}`, { headers: admin });
  assert.equal(afterCorrection.body.projectRequest.projectName, `${payload.projectName} v2`);
  assert.deepEqual(afterCorrection.body.projectRequest.files.map((file) => file.name), ["terreno.png"]);
  const reviews = (await database.client.query("select count(*)::int as total from public.project_request_reviews where project_request_id = $1", [id])).rows[0].total;
  assert.equal(reviews, 1, "la revisión técnica previa no se pierde");
  const activeFiles = (await fileRows(id)).filter((file) => !file.deleted_at && file.status !== "deleted");
  assert.deepEqual(activeFiles.map((file) => file.title), ["terreno.png"]);
  for (const file of activeFiles) assert.ok(storage.has(file.file_name), "cada adjunto activo existe en el almacenamiento");
});

const requestRow = async (id) => (await database.client.query(
  "select status, project_name, verified_at, verification_code_hash from public.project_requests where id = $1",
  [id],
)).rows[0];
const activeFileCount = async (id) => (await fileRows(id)).filter((file) => !file.deleted_at && file.status !== "deleted").length;

test("PostgreSQL y HTTP: borrador vacío al adjuntar, idempotente, no se envía incompleto y conserva sus adjuntos", { skip }, async () => {
  const owner = await authAs(seed.owner);
  const admin = await authAs(seed.admin);
  const submissionId = randomUUID();

  // Varias selecciones rápidas: creaciones simultáneas con el mismo submissionId → un solo borrador.
  const creations = await Promise.all([1, 2, 3].map(() => api("/project-requests", { body: { submissionId }, headers: owner, method: "POST" })));
  assert.deepEqual(creations.map((created) => created.status), [201, 201, 201]);
  const id = creations[0].body.projectRequest.id;
  assert.ok(creations.every((created) => created.body.projectRequest.id === id));
  assert.deepEqual(await requestRow(id), { project_name: null, status: "draft", verification_code_hash: null, verified_at: null });
  // Un cuerpo con datos parciales no es un borrador vacío: exige la solicitud completa.
  assert.equal((await api("/project-requests", { body: { projectName: "Solo nombre", submissionId: randomUUID() }, headers: owner, method: "POST" })).status, 400);

  // Los adjuntos se asocian al borrador antes de completar el formulario.
  assert.equal((await upload(id, pdf("anexo.pdf"), owner)).status, 201);
  assert.equal(await activeFileCount(id), 1);

  // Sin el formulario guardado, el envío se rechaza antes de consumir el código y sigue como borrador.
  assert.equal((await api(`/project-requests/${id}/verification-code`, { body: {}, headers: owner, method: "POST" })).status, 201);
  const incomplete = await api(`/project-requests/${id}/submit`, { body: { verificationCode: sentCodes.at(-1) }, headers: owner, method: "POST" });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.code, "VALIDATION_ERROR");
  assert.ok(incomplete.body.fields["body.projectName"]);
  assert.equal((await requestRow(id)).status, "draft");
  assert.ok((await requestRow(id)).verification_code_hash, "el código no se consumió");

  // La base de datos tampoco admite una solicitud enviada sin identidad.
  await assert.rejects(
    database.client.query("update public.project_requests set status = 'pending_verification' where id = $1", [id]),
    { code: "23514" },
  );

  // Guardar el formulario completo en el mismo borrador; un código incorrecto conserva los adjuntos.
  const payload = draftPayload();
  assert.equal((await api(`/project-requests/${id}`, { body: payload, headers: owner, method: "PATCH" })).status, 200);
  const wrongCode = sentCodes.at(-1) === "000000" ? "111111" : "000000";
  const wrong = await api(`/project-requests/${id}/submit`, { body: { verificationCode: wrongCode }, headers: owner, method: "POST" });
  assert.equal(wrong.body.code, "VERIFICATION_CODE_INVALID");
  assert.equal((await requestRow(id)).status, "draft");
  assert.equal(await activeFileCount(id), 1, "los adjuntos siguen en el borrador");

  const submitted = await api(`/project-requests/${id}/submit`, { body: { verificationCode: sentCodes.at(-1) }, headers: owner, method: "POST" });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.projectRequest.status, "pending_verification");
  assert.equal(await activeFileCount(id), 1);
  // Una solicitud enviada ya no admite adjuntos ni cambios.
  assert.equal((await upload(id, png("tarde.png"), owner)).status, 404);
  const adminDetail = await api(`/admin/project-requests/${id}`, { headers: admin });
  assert.deepEqual(adminDetail.body.projectRequest.files.map((file) => file.name), ["anexo.pdf"]);
});

test("PostgreSQL y HTTP: validación temporal por defecto, sin correo, para cualquier cuenta y sin duplicar", { skip }, async (context) => {
  const previous = process.env.PROJECT_REQUEST_EMAIL_VERIFICATION;
  context.after(() => {
    if (previous === undefined) delete process.env.PROJECT_REQUEST_EMAIL_VERIFICATION;
    else process.env.PROJECT_REQUEST_EMAIL_VERIFICATION = previous;
  });
  // Sin variables: la validación temporal está activa.
  delete process.env.PROJECT_REQUEST_EMAIL_VERIFICATION;
  const owner = await authAs(seed.owner);
  const stranger = await authAs(seed.stranger);
  const admin = await authAs(seed.admin);
  const createComplete = async (headers) => {
    const created = await api("/project-requests", { body: { ...draftPayload(), submissionId: randomUUID() }, headers, method: "POST" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body.projectRequest.id;
  };

  // Cualquier cuenta: no se genera ni se envía correo y cualquier código de seis dígitos sirve.
  const emailsBefore = sentCodes.length;
  for (const headers of [owner, stranger]) {
    const id = await createComplete(headers);
    assert.equal((await upload(id, pdf("prueba.pdf"), headers)).status, 201);
    const issued = await api(`/project-requests/${id}/verification-code`, { body: {}, headers, method: "POST" });
    assert.equal(issued.status, 201);
    assert.deepEqual(issued.body.verification, { mode: "test" });
    assert.equal((await api(`/project-requests/${id}/submit`, { body: { verificationCode: "12345" }, headers, method: "POST" })).status, 400, "conserva el formato de seis dígitos");
    const submitted = await api(`/project-requests/${id}/submit`, { body: { verificationCode: "123456" }, headers, method: "POST" });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.projectRequest.status, "pending_verification");
    assert.ok((await requestRow(id)).verified_at, "la verificación queda registrada");
    assert.equal(await activeFileCount(id), 1, "los adjuntos siguen asociados");
    // Un reintento del envío devuelve la misma solicitud sin duplicarla.
    const retried = await api(`/project-requests/${id}/submit`, { body: { verificationCode: "654321" }, headers, method: "POST" });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.projectRequest.id, id);
    assert.equal((await api(`/admin/project-requests/${id}`, { headers: admin })).body.projectRequest.files.length, 1);
  }
  assert.equal(sentCodes.length, emailsBefore, "no se envía ningún correo");
  // Sin permiso sobre la solicitud ajena, la validación temporal no la envía.
  const foreignId = await createComplete(owner);
  assert.equal((await api(`/project-requests/${foreignId}/submit`, { body: { verificationCode: "123456" }, headers: stranger, method: "POST" })).status, 404);
  assert.equal((await requestRow(foreignId)).status, "draft");

  // PROJECT_REQUEST_EMAIL_VERIFICATION=enabled restaura la verificación real por correo.
  process.env.PROJECT_REQUEST_EMAIL_VERIFICATION = "enabled";
  const normalId = await createComplete(owner);
  const normalIssued = await api(`/project-requests/${normalId}/verification-code`, { body: {}, headers: owner, method: "POST" });
  assert.equal(normalIssued.body.verification.mode, "email");
  assert.equal(sentCodes.length, emailsBefore + 1, "se envía el correo real");
  const guess = sentCodes.at(-1) === "123456" ? "654321" : "123456";
  assert.equal((await api(`/project-requests/${normalId}/submit`, { body: { verificationCode: guess }, headers: owner, method: "POST" })).body.code, "VERIFICATION_CODE_INVALID");
  assert.equal((await requestRow(normalId)).status, "draft");
});

/**
 * Lleva una solicitud nueva del cliente hasta pending_review con una revisión favorable del arquitecto.
 *
 * @param {Array<Object>} attachments - Archivos a adjuntar antes de enviar.
 * @returns {Promise<{ id: number, fileIds: Array<number>, headers: Object }>} Solicitud lista para decidir.
 */
async function reviewedRequest(attachments) {
  const headers = { admin: await authAs(seed.admin), architect: await authAs(seed.architect), owner: await authAs(seed.owner) };
  const created = await api("/project-requests", { body: { ...draftPayload(), submissionId: randomUUID() }, headers: headers.owner, method: "POST" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.projectRequest.id;
  const fileIds = [];
  for (const file of attachments) {
    const uploaded = await upload(id, file, headers.owner);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    fileIds.push(uploaded.body.file.id);
  }
  assert.equal((await verifyAndSubmit(id, headers.owner)).status, 200);
  assert.equal((await api(`/admin/project-requests/${id}/assignees`, { body: { assigneeIds: [seed.architect] }, headers: headers.admin, method: "PUT" })).status, 200);
  const review = await api(`/project-requests/${id}/review`, { body: { note: "Proyecto viable para iniciar.", recommendation: "approve" }, headers: headers.architect, method: "PUT" });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  return { fileIds, headers, id };
}

test("PostgreSQL y HTTP: aprobar con varios adjuntos los pasa al proyecto con trazabilidad y revoca al arquitecto retirado", { skip }, async () => {
  // Regresión: chk_files_owner hacía fallar (500) la aprobación de solicitudes con adjuntos, y la
  // ruta de la solicitud daba acceso permanente al arquitecto aunque se le retirara del proyecto.
  // La ruta de archivos del proyecto exige projects.read (en staging lo concede un script de permisos).
  await database.client.query(`
    with permission as (
      insert into public.permissions (code, name, description, module) values ('projects.read', 'Leer proyectos', null, 'projects')
      on conflict (code) do update set name = excluded.name returning id
    )
    insert into public.role_permissions (role_id, permission_id, is_active)
    select r.id, permission.id, true from public.roles r, permission where r.code in ('client', 'architect')
    on conflict do nothing`);
  const { fileIds, headers, id } = await reviewedRequest([png("planta.png"), pdf("escritura.pdf")]);
  const versionsBefore = (await database.client.query("select file_id, file_name, file_size from public.file_versions where file_id = any($1) order by file_id", [fileIds])).rows;
  const objectsBefore = storage.size;

  const approved = await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const projectId = Number((await database.client.query("select converted_project_id from public.project_requests where id = $1", [id])).rows[0].converted_project_id);

  const moved = (await database.client.query("select id, project_id, project_request_id, origin_project_request_id from public.files where id = any($1) order by id", [fileIds])).rows;
  assert.deepEqual(moved.map((row) => [Number(row.project_id), row.project_request_id, Number(row.origin_project_request_id)]), fileIds.map(() => [projectId, null, id]));
  assert.deepEqual((await database.client.query("select file_id, file_name, file_size from public.file_versions where file_id = any($1) order by file_id", [fileIds])).rows, versionsBefore, "versiones y claves intactas");
  assert.equal(storage.size, objectsBefore, "no se duplican objetos en el almacenamiento");

  for (const fileId of fileIds) {
    const projectContent = `${base}/projects/${projectId}/files/${fileId}/content`;
    const requestContent = `${base}/project-requests/${id}/files/${fileId}/content`;
    assert.equal((await fetch(projectContent, { headers: headers.owner })).status, 200, "el cliente lo ve desde el proyecto");
    assert.equal((await fetch(projectContent, { headers: headers.architect })).status, 200, "el arquitecto asignado lo ve desde el proyecto");
    assert.equal((await fetch(requestContent, { headers: headers.owner })).status, 200, "el detalle de la solicitud conserva su enlace");
    assert.equal((await fetch(requestContent, { headers: headers.architect })).status, 404, "el arquitecto ya no usa la ruta de la solicitud");
  }
  const detail = await api(`/project-requests/${id}`, { headers: headers.owner });
  assert.deepEqual(detail.body.projectRequest.files.map((file) => file.id).sort(), [...fileIds].sort(), "la solicitud sigue listando sus adjuntos de origen");

  assert.equal((await api(`/admin/projects/${projectId}/assignees`, { body: { assigneeIds: [seed.admin] }, headers: headers.admin, method: "PUT" })).status, 200);
  for (const fileId of fileIds) {
    assert.equal((await fetch(`${base}/projects/${projectId}/files/${fileId}/content`, { headers: headers.architect })).status, 404, "retirado: sin acceso por el proyecto");
    assert.equal((await fetch(`${base}/project-requests/${id}/files/${fileId}/content`, { headers: headers.architect })).status, 404, "retirado: sin acceso por la solicitud");
    assert.equal((await fetch(`${base}/projects/${projectId}/files/${fileId}/content`, { headers: headers.owner })).status, 200);
  }
});

test("PostgreSQL y HTTP: aprobar una solicitud sin adjuntos crea el proyecto", { skip }, async () => {
  const { headers, id } = await reviewedRequest([]);
  const approved = await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal((await requestRow(id)).status, "converted");
});
