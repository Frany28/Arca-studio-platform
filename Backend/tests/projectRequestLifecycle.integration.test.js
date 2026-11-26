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
  database = await createIsolatedMigrationDatabase({ recordMigrations: true,
    baseUrl: process.env.ARCA_REQUEST_LIFECYCLE_TEST_DATABASE_URL,
    prefix: "arca_request_lifecycle",
  });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "lifecycle-test-secret-0123456789abcdef0123456789abcdef",
    DATABASE_URL: database.databaseUrl,
    DATABASE_POOL_MAX: "6",
    FILE_UPLOAD_MAX_BYTES: String(MAX_FILE_BYTES),
    MAIL_FROM: "ARCA <no-reply@example.test>",
    NODE_ENV: "test",
    // Las pruebas del ciclo usan el código real; la validación temporal se prueba aparte.
    PROJECT_REQUEST_EMAIL_VERIFICATION: "enabled",
    PROJECT_REQUEST_RATE_LIMIT_MAX: "1000",
    // Cada prueba envía solicitudes con su código: el límite real (10/h) se probaría en su propia suite.
    PROJECT_REQUEST_CODE_RATE_LIMIT_MAX: "1000",
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
    ownerClientId,
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

/**
 * Captura la fila de un archivo, todas sus versiones y la presencia de sus objetos, para comprobar
 * que un intento de eliminación no cambia nada (Fase 1.2, B1).
 *
 * @param {number} fileId - Archivo.
 * @returns {Promise<Object>} Estado conservable del archivo.
 */
async function retainedFileSnapshot(fileId) {
  const file = (await database.client.query(
    "select id, status::text as status, deleted_at, updated_at, project_id, project_request_id, current_version from public.files where id = $1",
    [fileId],
  )).rows[0];
  const versions = (await database.client.query(
    "select id, version_number, file_name, is_current, deleted_at from public.file_versions where file_id = $1 order by id",
    [fileId],
  )).rows;
  return { file, objects: versions.map((version) => storage.has(version.file_name)), versions };
}

/**
 * Comprueba que el archivo sigue activo y exactamente igual que antes del intento de eliminación.
 *
 * @param {number} fileId - Archivo.
 * @param {Object} before - Resultado previo de retainedFileSnapshot.
 * @returns {Promise<void>} Finaliza si el archivo se conservó.
 */
async function assertFileRetained(fileId, before) {
  const after = await retainedFileSnapshot(fileId);
  assert.deepEqual(after, before, "el registro, sus versiones y sus objetos no cambian");
  assert.equal(after.file.status, "active");
  assert.equal(after.file.deleted_at, null);
  assert.ok(after.versions.length > 0 && after.versions.every((version) => version.deleted_at === null));
  assert.ok(after.objects.every(Boolean), "cada versión conserva su objeto");
}

/**
 * Comprueba que el almacenamiento solo borró objetos sin versión registrada (compensaciones de
 * cargas rechazadas), nunca el objeto de un archivo guardado.
 *
 * @returns {Promise<void>} Finaliza si ninguna clave borrada está registrada.
 */
async function assertNoRecordedObjectDeleted() {
  if (!deletedKeys.length) return;
  const recorded = (await database.client.query(
    "select file_name from public.file_versions where file_name = any($1::text[])",
    [deletedKeys],
  )).rows;
  assert.deepEqual(recorded, [], "ningún objeto registrado se borró del almacenamiento");
}

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

  // 6. Un adjunto guardado se conserva (Fase 1.2, B1): sin sesión 401, un tercero 404 y el propietario
  // 409, sin tocar la fila, sus versiones ni el objeto almacenado.
  const photoBefore = await retainedFileSnapshot(photo.body.file.id);
  assert.equal((await api(`/project-requests/${id}/files/${photo.body.file.id}`, { method: "DELETE" })).status, 401);
  assert.equal((await api(`/project-requests/${id}/files/${photo.body.file.id}`, { headers: stranger, method: "DELETE" })).status, 404);
  const refusedRemoval = await api(`/project-requests/${id}/files/${photo.body.file.id}`, { headers: owner, method: "DELETE" });
  assert.equal(refusedRemoval.status, 409, JSON.stringify(refusedRemoval.body));
  assert.deepEqual(refusedRemoval.body, { code: "FILE_DELETION_NOT_ALLOWED", message: "Los archivos guardados se conservan y no se pueden eliminar." });
  assert.equal((await api(`/project-requests/${id}/files/${photo.body.file.id}`, { headers: admin, method: "DELETE" })).status, 409);
  await assertFileRetained(photo.body.file.id, photoBefore);
  assert.deepEqual((await api(`/project-requests/${id}`, { headers: owner })).body.projectRequest.files.map((file) => file.name), ["plano-principal.pdf", "fachada.png"]);

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
  const persisted = sent.body.projectRequest.files.find((file) => file.name === "plano-principal.pdf");
  assert.equal(sent.body.projectRequest.files.length, 2, "el adjunto que se intentó eliminar sigue en la solicitud");
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
  assert.deepEqual(adminDetail.body.projectRequest.files.map((file) => file.id), [persisted.id, photo.body.file.id]);
  assert.equal((await api(`/admin/project-requests/${id}`, { headers: owner })).status, 403);
  const adminContent = await fetch(`${base}/project-requests/${id}/files/${persisted.id}/content`, { headers: admin });
  assert.equal(adminContent.status, 200);
  const assigned = await api(`/admin/project-requests/${id}/assignees`, { body: { assigneeIds: [seed.architect] }, headers: admin, method: "PUT" });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const architectQueue = await api("/project-requests/review-queue?limit=100", { headers: architect });
  assert.equal(architectQueue.status, 200);
  assert.equal(architectQueue.body.projectRequests.find((item) => item.id === id).clientName, null, "el arquitecto no recibe el cliente en su cola");
  const review = await api(`/project-requests/${id}/review`, {
    body: { meetingRecommendation: "SCHEDULE_MEETING", note: "Faltan fotografías actuales del terreno.", recommendation: "changes_requested" },
    headers: architect,
    method: "PUT",
  });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  // La recomendación del arquitecto solo se registra: la solicitud sigue en revisión y él no decide.
  const [stored] = (await database.client.query(`select request.status::text as status, review.recommendation::text as recommendation,
      review.meeting_recommendation::text as meeting from public.project_requests request
      join public.project_request_reviews review on review.project_request_id = request.id where request.id = $1`, [id])).rows;
  assert.deepEqual(stored, { meeting: "SCHEDULE_MEETING", recommendation: "changes_requested", status: "pending_review" });
  const architectDecision = await api(`/admin/project-requests/${id}/decision`, {
    body: { action: "request_changes", reason: "El arquitecto no puede decidir." },
    headers: architect,
    method: "PATCH",
  });
  assert.equal(architectDecision.status, 403);
  const decision = await api(`/admin/project-requests/${id}/decision`, {
    body: { action: "request_changes", reason: "Adjunta fotografías actuales del terreno." },
    headers: admin,
    method: "PATCH",
  });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));

  // 11. Corrección: el cliente ve el motivo, conserva los adjuntos previos, añade y reenvía. Intentar
  // eliminar un adjunto también en corrección responde 409 y lo conserva.
  const returned = await api(`/project-requests/${id}`, { headers: owner });
  assert.equal(returned.body.projectRequest.status, "changes_requested");
  assert.equal(returned.body.projectRequest.correctionReason, "Adjunta fotografías actuales del terreno.");
  assert.equal(returned.body.projectRequest.files.length, 2);
  const terrain = await upload(id, png("terreno.png"), owner);
  assert.equal(terrain.status, 201, JSON.stringify(terrain.body));
  assert.equal((await upload(id, png("terreno.png"), owner)).body.file.id, terrain.body.file.id, "reintento sin duplicar");
  const planBefore = await retainedFileSnapshot(first.body.file.id);
  const refusedCorrection = await api(`/project-requests/${id}/files/${first.body.file.id}`, { headers: owner, method: "DELETE" });
  assert.equal(refusedCorrection.status, 409);
  assert.equal(refusedCorrection.body.code, "FILE_DELETION_NOT_ALLOWED");
  await assertFileRetained(first.body.file.id, planBefore);
  assert.equal((await api(`/project-requests/${id}`, { body: { ...payload, projectName: `${payload.projectName} v2` }, headers: owner, method: "PATCH" })).status, 200);
  await database.client.query("update public.project_requests set verification_sent_at = now() - interval '2 minutes' where id = $1", [id]);
  const resubmitted = await verifyAndSubmit(id, owner);
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(resubmitted.body.projectRequest.id, id, "la corrección reenvía la misma solicitud");

  // 12. El administrador ve la información nueva y el historial de revisiones se conserva.
  const afterCorrection = await api(`/admin/project-requests/${id}`, { headers: admin });
  assert.equal(afterCorrection.body.projectRequest.projectName, `${payload.projectName} v2`);
  assert.deepEqual(afterCorrection.body.projectRequest.files.map((file) => file.name), ["plano-principal.pdf", "fachada.png", "terreno.png"]);
  const reviews = (await database.client.query("select count(*)::int as total from public.project_request_reviews where project_request_id = $1", [id])).rows[0].total;
  assert.equal(reviews, 1, "la revisión técnica previa no se pierde");
  const activeFiles = (await fileRows(id)).filter((file) => !file.deleted_at && file.status !== "deleted");
  assert.deepEqual(activeFiles.map((file) => file.title), ["Plano principal.pdf", "fachada.png", "terreno.png"]);
  for (const file of activeFiles) assert.ok(storage.has(file.file_name), "cada adjunto activo existe en el almacenamiento");
  await assertNoRecordedObjectDeleted();
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

/**
 * Configura un borrador con los datos obligatorios por la API administrativa y confirma
 * «Finalizar configuración» (draft → pending).
 *
 * @param {number} projectId - Proyecto draft.
 * @param {Object} adminHeaders - Autenticación del administrador.
 * @param {number[]} assigneeIds - Responsables operativos.
 * @param {boolean} [finalize=true] - Confirma al terminar o conserva el borrador para pruebas de edición.
 * @returns {Promise<{status: number, body: Object|null}>} Respuesta de la finalización.
 */
async function configureAndFinalize(projectId, adminHeaders, assigneeIds, finalize = true) {
  const general = await api(`/admin/projects/${projectId}/configuration/general`, {
    body: {
      assigneeIds, constructionArea: 80, generalArea: 120, location: "Maracaibo, Estado Zulia",
      name: `Proyecto ${projectId}`, projectType: "residential", zoning: "Sala, cocina y dos habitaciones.",
    },
    headers: adminHeaders, method: "PUT",
  });
  assert.equal(general.status, 200, JSON.stringify(general.body));
  const tracking = await api(`/admin/projects/${projectId}/configuration/tracking`, {
    body: { estimatedDeliveryDate: "2026-12-20", milestones: [], stages: [{ endDate: "2026-12-10", name: "Propuesta inicial", startDate: "2026-12-01", status: "pending" }] },
    headers: adminHeaders, method: "PUT",
  });
  assert.equal(tracking.status, 200, JSON.stringify(tracking.body));
  if (!finalize) return tracking;
  return api(`/admin/projects/${projectId}/configuration/finalize`, { headers: adminHeaders, method: "POST" });
}

/**
 * Crea por HTTP un borrador completo sin coordenadas y con planos todavía desconocidos.
 * Conserva draft para comprobar fechas, rollback y carreras con la finalización.
 *
 * @returns {Promise<{headers: object, projectId: number, path: string}>} Borrador editable.
 */
async function configuredDraft() {
  const headers = await authAs(seed.admin);
  const created = await api("/admin/projects/drafts", {
    body: { clientId: seed.ownerClientId, name: `Prueba Fase 1.1 ${randomUUID()}` }, headers, method: "POST",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const projectId = created.body.projectId;
  await configureAndFinalize(projectId, headers, [seed.architect], false);
  return { headers, path: `/admin/projects/${projectId}/configuration`, projectId };
}

test("Fase 1.1: seguimiento rechaza fechas inválidas sin modificar datos y finalizar revalida borradores anteriores", { skip }, async () => {
  const { headers, path, projectId } = await configuredDraft();
  const initial = (await api(path, { headers })).body.configuration;
  const tracking = {
    estimatedDeliveryDate: "2026-12-20", milestones: [],
    stages: [{ name: "Fase", status: "pending", startDate: "2026-12-01", endDate: "2026-12-10" }],
  };
  const { saveProjectTrackingConfiguration } = await import("../src/services/projectConfigurationService.js");
  for (const body of [
    { ...tracking, estimatedDeliveryDate: "2026-11-30" },
    { ...tracking, estimatedDeliveryDate: "2026-02-31" },
    { ...tracking, stages: [{ ...tracking.stages[0], startDate: "2026-12-11" }] },
    { ...tracking, milestones: [{ title: "Hito", dueDate: "2026-04-31" }] },
  ]) {
    const result = await api(`${path}/tracking`, { body, headers, method: "PUT" });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.code, "VALIDATION_ERROR");
    await assert.rejects(saveProjectTrackingConfiguration({ payload: body, projectId }), {
      code: "VALIDATION_ERROR", status: 400,
    }, "el servicio también valida cuando se invoca sin middleware HTTP");
    const after = (await api(path, { headers })).body.configuration;
    assert.deepEqual(after, initial, "el guardado fallido es atómico");
  }
  // Datos válidos para PostgreSQL que el servicio anterior permitía guardar en draft.
  await database.client.query("update public.projects set end_date = '2026-11-30' where id = $1", [projectId]);
  let finalized = await api(`${path}/finalize`, { headers, method: "POST" });
  assert.equal(finalized.status, 400, JSON.stringify(finalized.body));
  assert.ok(finalized.body.fields["estimatedDeliveryDate.beforeStart"]);
  assert.equal(await requestRowStatus(projectId), "draft");
  assert.equal(Number((await database.client.query("select count(*) from public.project_status_history where project_id = $1", [projectId])).rows[0].count), 0);
  await database.client.query("update public.projects set end_date = null where id = $1", [projectId]);
  await database.client.query("update public.project_stages set end_date = '2026-11-30' where project_id = $1 and deleted_at is null", [projectId]);
  finalized = await api(`${path}/finalize`, { headers, method: "POST" });
  assert.equal(finalized.status, 400);
  assert.ok(finalized.body.fields["stages.0.endDate"]);
  const repaired = await api(`${path}/tracking`, { body: { ...tracking, estimatedDeliveryDate: "2026-12-01" }, headers, method: "PUT" });
  assert.equal(repaired.status, 200);
  finalized = await api(`${path}/finalize`, { headers, method: "POST" });
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  assert.equal(finalized.body.configuration.latitude, null);
  assert.equal(finalized.body.configuration.longitude, null);
  assert.equal(finalized.body.configuration.hasPlans, false, "se conserva la convención de planos desconocidos");
});

test("Fase 1.1: DATE vuelve idéntica con UTC+14, Caracas y DateStyle alternativo", { skip }, async () => {
  const { headers, path } = await configuredDraft();
  const previousZone = process.env.TZ;
  try {
    const { findProjectConfiguration } = await import("../src/repositories/projectConfigurationRepository.js");
    await database.client.query("set datestyle = 'SQL, DMY'; set time zone 'Pacific/Kiritimati'");
    for (const zone of ["Pacific/Kiritimati", "America/Caracas"]) {
      process.env.TZ = zone;
      const tracking = await api(`${path}/tracking`, { body: {
        estimatedDeliveryDate: "2026-12-20", milestones: [{ title: "Hito", dueDate: "2026-12-05" }],
        stages: [{ name: "Fase", status: "pending", startDate: "2026-12-01", endDate: "2026-12-10" }],
      }, headers, method: "PUT" });
      assert.equal(tracking.status, 200, JSON.stringify(tracking.body));
      const warranty = { product: "P", model: "M", code: "C", startDate: "2027-01-01", serviceDate: "2027-06-01", endDate: "2027-12-01" };
      assert.equal((await api(`${path}/warranties`, { body: { warranties: [warranty] }, headers, method: "PUT" })).status, 200);
      const config = (await api(path, { headers })).body.configuration;
      assert.equal(config.estimatedDeliveryDate, "2026-12-20", zone);
      assert.equal(config.stages[0].startDate, "2026-12-01", zone);
      assert.equal(config.stages[0].endDate, "2026-12-10", zone);
      assert.equal(config.milestones[0].dueDate, "2026-12-05", zone);
      for (const field of ["startDate", "serviceDate", "endDate"]) assert.equal(config.warranties[0][field], warranty[field], zone);
      const raw = await findProjectConfiguration(config.id, database.client);
      assert.equal(raw.project.end_date, config.estimatedDeliveryDate);
      assert.equal(raw.stages[0].startDate, config.stages[0].startDate);
      assert.equal(raw.milestones[0].dueDate, config.milestones[0].dueDate);
      assert.equal(raw.warranties[0].serviceDate, warranty.serviceDate);
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
    await database.client.query("reset datestyle; reset time zone");
  }
});

test("Fase 1.1: seguimiento y finalizar concurrentes conservan una configuración e historial coherentes", { skip }, async () => {
  const tracking = {
    estimatedDeliveryDate: "2027-02-20", milestones: [],
    stages: [{ name: "Fase nueva", status: "pending", startDate: "2027-02-01", endDate: "2027-02-10" }],
  };
  for (const saveFirst of [true, false]) {
    const { headers, path, projectId } = await configuredDraft();
    await database.client.query("begin");
    await database.client.query("select id from public.projects where id = $1 for update", [projectId]);
    const save = () => api(`${path}/tracking`, { body: tracking, headers, method: "PUT" });
    const finalize = () => api(`${path}/finalize`, { headers, method: "POST" });
    const requests = [];
    try {
      requests.push(saveFirst ? save() : finalize());
      await waitForConfigurationLocks(1);
      requests.push(saveFirst ? finalize() : save());
      await waitForConfigurationLocks(2);
    } finally {
      await database.client.query("rollback");
    }
    const results = await Promise.all(requests);
    const [saved, finalized] = saveFirst ? results : results.toReversed();
    assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
    assert.equal(saved.status, saveFirst ? 200 : 409, JSON.stringify(saved.body));
    if (!saveFirst) assert.equal(saved.body.code, "PROJECT_NOT_DRAFT");
    const final = (await api(path, { headers })).body.configuration;
    assert.equal(final.status, "pending");
    assert.equal(final.stages[0].startDate, saveFirst ? "2027-02-01" : "2026-12-01");
    const row = (await database.client.query("select to_char(start_date, 'YYYY-MM-DD') as start_date from public.projects where id = $1", [projectId])).rows[0];
    assert.equal(row.start_date, final.stages[0].startDate);
    assert.equal(Number((await database.client.query("select count(*) from public.project_status_history where project_id = $1", [projectId])).rows[0].count), 1);
  }
});

/**
 * Espera a que las peticiones estén bloqueadas en el FOR UPDATE antes de liberar el proyecto.
 * Fija el orden de ambas carreras y falla si se elimina la serialización del servicio.
 *
 * @param {number} expected - Peticiones concurrentes esperadas en espera de bloqueo.
 * @returns {Promise<void>} Finaliza al observar todas las esperas.
 */
async function waitForConfigurationLocks(expected) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    // Otra conexión evita el snapshot de pg_stat_activity de la transacción bloqueante.
    const result = await modules.query(`select count(*)::int as total from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and query like '%for update%'
        and query like '%public.projects%'`);
    if (result.rows[0].total === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`No se observaron ${expected} escrituras de configuración serializadas.`);
}

test("Fase 1.1: fallos PostgreSQL diferidos en COMMIT se traducen y revierten sin filtrar el mensaje", { skip }, async () => {
  const { headers, path, projectId } = await configuredDraft();
  const initial = (await api(path, { headers })).body.configuration;
  // Trigger exclusivo de la base creada por createIsolatedMigrationDatabase.
  const statuses = { "23503": 409, "40001": 409, "40P01": 409, "22008": 400, "23514": 400, XX000: 500 };
  for (const [code, status] of Object.entries(statuses)) {
    await database.client.query(`create function public.phase11_fail_commit() returns trigger language plpgsql as $$
      begin raise exception using errcode = '${code}', message = 'detalle_privado_postgresql', constraint = 'chk_projects_dates'; end $$;
      create constraint trigger phase11_fail_commit after update on public.projects deferrable initially deferred
      for each row execute function public.phase11_fail_commit();`);
    try {
      const result = await api(`${path}/finalize`, { headers, method: "POST" });
      assert.equal(result.status, status, JSON.stringify(result.body));
      assert.doesNotMatch(JSON.stringify(result.body), /detalle_privado_postgresql|chk_projects_dates|stack|\bSELECT\b/i);
      assert.equal(await requestRowStatus(projectId), "draft");
      assert.deepEqual((await api(path, { headers })).body.configuration, initial);
      assert.equal(Number((await database.client.query("select count(*) from public.audit_logs where entity_id = $1 and action = 'project.configuration_finalized'", [projectId])).rows[0].count), 0);
    } finally {
      await database.client.query("drop trigger phase11_fail_commit on public.projects; drop function public.phase11_fail_commit()");
    }
  }
});

/**
 * Proyecto creado al aprobar una solicitud.
 *
 * @param {number} id - Solicitud.
 * @returns {Promise<number>} Id del proyecto convertido.
 */
async function convertedProjectId(id) {
  return Number((await database.client.query("select converted_project_id from public.project_requests where id = $1", [id])).rows[0].converted_project_id);
}

/**
 * Concede projects.read a clientes y arquitectos (en staging lo concede un script de permisos).
 *
 * @returns {Promise<void>}
 */
async function grantProjectRead() {
  await database.client.query(`
    with permission as (
      insert into public.permissions (code, name, description, module) values ('projects.read', 'Leer proyectos', null, 'projects')
      on conflict (code) do update set name = excluded.name returning id
    )
    insert into public.role_permissions (role_id, permission_id, is_active)
    select r.id, permission.id, true from public.roles r, permission where r.code in ('client', 'architect')
    on conflict do nothing`);
}

test("PostgreSQL y HTTP: aprobar crea un único borrador draft con los datos equivalentes, sin responsables ni acceso del cliente", { skip }, async () => {
  await grantProjectRead();
  const { fileIds, headers, id } = await reviewedRequest([png("planta.png"), pdf("escritura.pdf")]);
  const versionsBefore = (await database.client.query("select file_id, file_name, file_size from public.file_versions where file_id = any($1) order by file_id", [fileIds])).rows;
  const objectsBefore = storage.size;

  const approved = await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.project.status, "draft");
  // Reintento: no crea otro proyecto.
  assert.equal((await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" })).status, 409);
  const projectId = await convertedProjectId(id);
  const [project] = (await database.client.query("select status, start_date, project_type, location, has_plans, client_id, assigned_architect_id from public.projects where id = $1", [projectId])).rows;
  assert.equal(project.status, "draft");
  assert.equal(project.start_date, null, "la fecha esperada del cliente no confirma el inicio");
  assert.equal(project.project_type, "residential");
  assert.equal(project.assigned_architect_id, null);
  assert.equal(Number((await database.client.query("select count(*) from public.project_assignees where project_id = $1", [projectId])).rows[0].count), 0, "quien revisó no pasa a responsable");
  assert.equal(Number((await database.client.query("select count(*) from public.projects where public_slug = $1", [`solicitud-${id}`])).rows[0].count), 1);

  const moved = (await database.client.query("select id, project_id, project_request_id, origin_project_request_id from public.files where id = any($1) order by id", [fileIds])).rows;
  assert.deepEqual(moved.map((row) => [Number(row.project_id), row.project_request_id, Number(row.origin_project_request_id)]), fileIds.map(() => [projectId, null, id]));
  assert.deepEqual((await database.client.query("select file_id, file_name, file_size from public.file_versions where file_id = any($1) order by file_id", [fileIds])).rows, versionsBefore, "versiones y claves intactas");
  assert.equal(storage.size, objectsBefore, "no se duplican objetos en el almacenamiento");

  // Draft: el cliente sigue su solicitud pero no ve el proyecto (listado, detalle ni archivos).
  assert.equal((await api(`/projects/${projectId}`, { headers: headers.owner })).status, 404);
  assert.equal((await api("/projects?scope=owned", { headers: headers.owner })).body.projects.some((row) => row.id === projectId), false);
  const detail = await api(`/project-requests/${id}`, { headers: headers.owner });
  assert.equal(detail.body.projectRequest.convertedProjectAvailable, false);
  assert.equal(detail.body.projectRequest.firstContactAt, null);
  for (const fileId of fileIds) {
    assert.equal((await fetch(`${base}/projects/${projectId}/files/${fileId}/content`, { headers: headers.owner })).status, 404, "draft: sin acceso por el proyecto");
    assert.equal((await fetch(`${base}/project-requests/${id}/files/${fileId}/content`, { headers: headers.owner })).status, 200, "el detalle de la solicitud conserva su enlace");
    assert.equal((await fetch(`${base}/project-requests/${id}/files/${fileId}/content`, { headers: headers.architect })).status, 404, "el arquitecto ya no usa la ruta de la solicitud");
  }
  const notification = (await database.client.query("select project_id, message from public.notifications where entity_type = 'project_request' and entity_id = $1 order by id desc limit 1", [id])).rows[0];
  assert.equal(notification.project_id, null, "la notificación no enlaza un proyecto inaccesible");
  assert.equal(notification.message, "Tu solicitud ha sido aprobada. Nuestro equipo se pondrá en contacto contigo para continuar con los siguientes pasos.", "no anuncia un proyecto disponible ni un contacto realizado");
});

test("PostgreSQL y HTTP: configurar el borrador precarga la solicitud, guarda por secciones y solo finalizar lo pasa a pending", { skip }, async () => {
  await grantProjectRead();
  const { fileIds: [photoId], headers, id } = await reviewedRequest([png("fachada.png")]);
  assert.equal((await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" })).status, 200);
  const projectId = await convertedProjectId(id);
  const path = `/admin/projects/${projectId}/configuration`;

  // Solo administradores.
  assert.equal((await api(path, { headers: headers.owner })).status, 403);
  assert.equal((await api(path, { headers: headers.architect })).status, 403);

  const initial = await api(path, { headers: headers.admin });
  assert.equal(initial.status, 200, JSON.stringify(initial.body));
  const config = initial.body.configuration;
  assert.equal(config.status, "draft");
  assert.equal(config.editable, true);
  assert.equal(config.projectType, "residential");
  assert.equal(config.location, draftPayload().projectLocation);
  assert.deepEqual(config.request.suggestedAssigneeIds, [seed.architect], "los revisores se sugieren, no se asignan");
  assert.deepEqual(config.assigneeIds, []);
  assert.ok(config.request.investmentRange, "el rango de inversión es referencia, no presupuesto");
  assert.deepEqual(config.missingRequirements, ["assigneeIds", "generalArea", "constructionArea", "zoning", "stages"]);

  // Finalizar con requisitos pendientes no cambia el estado.
  const early = await api(`${path}/finalize`, { headers: headers.admin, method: "POST" });
  assert.equal(early.status, 400);
  assert.ok(early.body.fields.zoning && early.body.fields.stages);

  // Responsables: solo administradores o arquitectos activos.
  const invalid = await api(`${path}/general`, { body: { assigneeIds: [seed.owner], name: "Casa Lago" }, headers: headers.admin, method: "PUT" });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.fields["body.assigneeIds"]);

  // Seguimiento: el progreso se calcula de las fases reales.
  const tracking = await api(`${path}/tracking`, {
    body: {
      estimatedDeliveryDate: "2027-01-31",
      milestones: [{ dueDate: "2026-12-15", title: "Reunión de equipo" }],
      stages: [
        { endDate: "2026-12-10", name: "Propuesta inicial", startDate: "2026-12-01", status: "finished" },
        { endDate: "2027-01-20", name: "Ejecución", startDate: "2026-12-11", status: "pending" },
      ],
    },
    headers: headers.admin, method: "PUT",
  });
  assert.equal(tracking.status, 200, JSON.stringify(tracking.body));
  assert.equal(tracking.body.configuration.progress, 50);
  assert.equal((await requestRowStatus(projectId)), "draft", "guardar una sección no habilita el proyecto");

  const badWarranty = await api(`${path}/warranties`, {
    body: { warranties: [{ code: "LGX-1", endDate: "2026-01-01", model: "AC-001", product: "Aire", serviceDate: "2026-06-01", startDate: "2026-03-01" }] },
    headers: headers.admin, method: "PUT",
  });
  assert.equal(badWarranty.status, 400);
  const warranties = await api(`${path}/warranties`, {
    body: { warranties: [{ code: "LGX-1", endDate: "2027-12-01", model: "AC-001", product: "Aire acondicionado", serviceDate: "2027-06-01", startDate: "2027-01-01" }] },
    headers: headers.admin, method: "PUT",
  });
  assert.equal(warranties.status, 200);
  assert.equal(warranties.body.configuration.warranties.length, 1);

  // Carpetas y archivos del borrador. La aprobación ya creó las 18 carpetas predeterminadas.
  const initialFolders = await api(`${path}/files`, { headers: headers.admin });
  // Respuesta HTTP real: las 18 carpetas en el orden del catálogo (preorden confirmado).
  assert.deepEqual(initialFolders.body.folders.map((candidate) => candidate.systemKey), [
    "cover", "renders", "renders.models", "renders.models.initial_proposal", "renders.models.final_proposal",
    "renders.images", "renders.images.initial_proposal", "renders.images.initial_proposal.before",
    "renders.images.execution", "renders.images.final_result", "renders.videos", "renders.videos.initial_proposal",
    "renders.videos.execution", "renders.videos.final_result", "documents", "documents.initial_proposal",
    "documents.warranties", "client_files",
  ]);
  const byKey = new Map(initialFolders.body.folders.map((candidate) => [candidate.systemKey, candidate]));
  assert.deepEqual([byKey.get("renders.models").name, byKey.get("documents.warranties").name], ["Panorámicas", "Garantías"]);
  const coverFolder = initialFolders.body.folders.find((candidate) => candidate.systemKey === "cover");
  const coverChild = await api(`${path}/folders`, { body: { name: "Variantes", parentId: coverFolder.id }, headers: headers.admin, method: "POST" });
  assert.deepEqual([coverChild.status, coverChild.body.code], [409, "PROJECT_FOLDER_SUBFOLDERS_NOT_ALLOWED"], "la portada no admite subcarpetas");
  const renamedCover = await api(`${path}/folders/${coverFolder.id}`, { body: { name: "Otra" }, headers: headers.admin, method: "PATCH" });
  assert.deepEqual([renamedCover.status, renamedCover.body.code], [409, "PROJECT_FOLDER_PROTECTED"]);
  const deletedCover = await api(`${path}/folders/${coverFolder.id}`, { headers: headers.admin, method: "DELETE" });
  assert.deepEqual([deletedCover.status, deletedCover.body.code], [409, "PROJECT_FOLDER_PROTECTED"]);
  assert.equal((await api(`${path}/folders`, { body: { name: "renders e imágenes " }, headers: headers.admin, method: "POST" })).status, 400, "nombre de una carpeta predeterminada hermana");
  const folder = await api(`${path}/folders`, { body: { name: "Planos del cliente" }, headers: headers.admin, method: "POST" });
  assert.equal(folder.status, 201, JSON.stringify(folder.body));
  const child = await api(`${path}/folders`, { body: { name: "Propuesta inicial", parentId: folder.body.folder.id }, headers: headers.admin, method: "POST" });
  assert.equal(child.status, 201);
  assert.equal((await api(`${path}/folders`, { body: { name: "planos del cliente " }, headers: headers.admin, method: "POST" })).status, 400, "nombre repetido entre hermanas");
  const uploaded = await fetch(`${base}${path}/files?folderId=${child.body.folder.id}`, {
    body: png("render-1.png").bytes,
    headers: { ...headers.admin, "Content-Type": "image/png", "X-File-Name": "render-1.png" },
    method: "POST",
  });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const files = await api(`${path}/files`, { headers: headers.admin });
  assert.equal(files.body.files.find((file) => file.name === "render-1.png").folderId, child.body.folder.id);
  assert.equal(files.body.files.find((file) => file.id === photoId).fromClientRequest, true, "adjuntos de la solicitud = archivos del cliente");
  assert.equal((await api(`${path}/folders/${folder.body.folder.id}`, { headers: headers.admin, method: "DELETE" })).status, 409, "una carpeta con contenido no se elimina");
  assert.equal((await api(`${path}/files/${photoId}`, { body: { folderId: folder.body.folder.id }, headers: headers.admin, method: "PATCH" })).status, 200);

  // Finalizar: draft → pending una sola vez, con historial, auditoría y aviso al cliente.
  const finalized = await configureAndFinalize(projectId, headers.admin, [seed.architect]);
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  assert.equal(finalized.body.configuration.status, "pending");
  assert.equal(finalized.body.configuration.editable, false);
  const [project] = (await database.client.query("select status, start_date::text as start_date, has_plans from public.projects where id = $1", [projectId])).rows;
  assert.deepEqual(project, { has_plans: true, start_date: "2026-12-01", status: "pending" }, "inicio = primera fase; nunca in_process");
  assert.equal((await api(`${path}/finalize`, { headers: headers.admin, method: "POST" })).status, 409, "ya no es un borrador");
  assert.equal((await api(`${path}/general`, { body: { assigneeIds: [], name: "Otro" }, headers: headers.admin, method: "PUT" })).status, 409);
  const history = (await database.client.query("select previous_status, new_status from public.project_status_history where project_id = $1", [projectId])).rows;
  assert.deepEqual(history, [{ new_status: "pending", previous_status: "draft" }]);
  assert.equal(Number((await database.client.query("select count(*) from public.audit_logs where action = 'project.configuration_finalized' and entity_id = $1", [projectId])).rows[0].count), 1);

  // Pending: el cliente ya accede; el arquitecto asignado en la configuración también.
  assert.equal((await api(`/projects/${projectId}`, { headers: headers.owner })).status, 200);
  assert.equal((await fetch(`${base}/projects/${projectId}/files/${photoId}/content`, { headers: headers.architect })).status, 200);
  assert.equal((await api(`/project-requests/${id}`, { headers: headers.owner })).body.projectRequest.convertedProjectAvailable, true);
});

/**
 * Estado vigente de un proyecto.
 *
 * @param {number} projectId - Proyecto.
 * @returns {Promise<string>} Estado.
 */
async function requestRowStatus(projectId) {
  return (await database.client.query("select status from public.projects where id = $1", [projectId])).rows[0].status;
}

test("PostgreSQL y HTTP: dos finalizaciones simultáneas producen una sola transición", { skip }, async () => {
  const { headers, id } = await reviewedRequest([]);
  assert.equal((await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" })).status, 200);
  const projectId = await convertedProjectId(id);
  await configureAndFinalize(projectId, headers.admin, [seed.architect]).catch(() => null);
  // La primera llamada ya finalizó; repetir en paralelo nunca duplica historial.
  const results = await Promise.all([1, 2].map(() => api(`/admin/projects/${projectId}/configuration/finalize`, { headers: headers.admin, method: "POST" })));
  assert.deepEqual(results.map((result) => result.status), [409, 409]);
  assert.equal(Number((await database.client.query("select count(*) from public.project_status_history where project_id = $1", [projectId])).rows[0].count), 1);
});

test("PostgreSQL y HTTP: el primer contacto se registra una vez y solo en solicitudes aprobadas", { skip }, async () => {
  const { headers, id } = await reviewedRequest([]);
  assert.equal((await api(`/admin/project-requests/${id}/first-contact`, { headers: headers.admin, method: "POST" })).status, 409, "sin aprobar no hay primer contacto");
  assert.equal((await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" })).status, 200);
  assert.equal((await api(`/admin/project-requests/${id}/first-contact`, { headers: headers.owner, method: "POST" })).status, 403);
  const first = await api(`/admin/project-requests/${id}/first-contact`, { headers: headers.admin, method: "POST" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.alreadyRecorded, false);
  const again = await api(`/admin/project-requests/${id}/first-contact`, { headers: headers.admin, method: "POST" });
  assert.equal(again.body.alreadyRecorded, true);
  assert.equal(again.body.firstContactAt, first.body.firstContactAt, "conserva la fecha original");
  assert.ok((await api(`/project-requests/${id}`, { headers: headers.owner })).body.projectRequest.firstContactAt);
  assert.ok((await api(`/admin/project-requests/${id}`, { headers: headers.admin })).body.projectRequest.firstContactAt);
});

test("PostgreSQL y HTTP: la miniatura usa la solicitud mientras el proyecto es draft y la del proyecto después", { skip }, async () => {
  const listedRow = async (headers, id) => (await api("/project-requests", { headers })).body.projectRequests.find((row) => row.id === id);
  const { fileIds: [planId, photoId], headers, id } = await reviewedRequest([pdf("plano.pdf"), png("fachada.png")]);
  const pending = await listedRow(headers.owner, id);
  assert.equal(pending.imageFileId, photoId);
  assert.notEqual(pending.imageFileId, planId);

  assert.equal((await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" })).status, 200);
  const projectId = await convertedProjectId(id);
  const draft = await listedRow(headers.owner, id);
  assert.equal(draft.imageFileId, photoId);
  assert.equal(draft.convertedProjectAvailable, false, "draft: la imagen se sirve por la ruta de la solicitud");
  assert.equal((await fetch(`${base}/project-requests/${id}/files/${photoId}/content`, { headers: headers.owner })).status, 200);

  // Una imagen nueva del proyecto draft no se expone al cliente.
  const insertImage = async (title) => {
    const file = await database.client.query(`
      insert into public.files (project_id, uploaded_by, title, file_type, file_category, current_version, created_at)
      values ($1, $2, $3, 'image/png', 'image', 1, now() + interval '1 minute') returning id`, [projectId, seed.admin, title]);
    const fileId = Number(file.rows[0].id);
    const version = await database.client.query(`
      insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size)
      values ($1, $2, 1, $3::text, $3::text, 'projects/' || $3::text, 'png', 10) returning id`, [fileId, seed.admin, title]);
    return { fileId, versionId: Number(version.rows[0].id) };
  };
  await insertImage("render-draft.png");
  assert.equal((await listedRow(headers.owner, id)).imageFileId, photoId);

  assert.equal((await configureAndFinalize(projectId, headers.admin, [seed.architect])).status, 200);
  const render = await insertImage("render.png");
  const available = await listedRow(headers.owner, id);
  assert.equal(available.convertedProjectAvailable, true);
  assert.equal(available.imageFileId, render.fileId);
  assert.equal(available.imageFileVersionId, render.versionId);
});

test("Fase 1.2 (B5): el cliente conserva sus adjuntos en draft y después; una versión interna posterior solo sigue la política del proyecto", { skip }, async () => {
  process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  try {
    await grantProjectRead();
    const photo = png("fachada-cliente.png");
    const { fileIds: [photoId, planId], headers, id } = await reviewedRequest([photo, pdf("plano-cliente.pdf")]);
    const bytesOf = async (response) => Buffer.from(await response.arrayBuffer());
    const viaRequest = (fileId, auth = headers.owner) => fetch(`${base}/project-requests/${id}/files/${fileId}/content`, { headers: auth });
    const viaProject = (projectId, fileId, auth, versionId) => fetch(`${base}/projects/${projectId}/files/${fileId}/content${versionId ? `?versionId=${versionId}` : ""}`, { headers: auth });
    const listedRequest = async () => (await api("/project-requests", { headers: headers.owner })).body.projectRequests.find((row) => row.id === id);
    const [origin] = (await database.client.query("select id::int, file_name from public.file_versions where file_id = $1", [photoId])).rows;
    assert.deepEqual((await database.client.query("select access_policy from public.files where id = any($1)", [[photoId, planId]])).rows, [{ access_policy: null }, { access_policy: null }],
      "los adjuntos de solicitud se crean con la regla heredada");

    assert.equal((await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" })).status, 200);
    const projectId = await convertedProjectId(id);

    // Draft: el cliente consulta sus adjuntos por la solicitud; el proyecto todavía no existe para él.
    for (const fileId of [photoId, planId]) {
      assert.equal((await viaRequest(fileId)).status, 200);
      assert.equal((await viaProject(projectId, fileId, headers.owner)).status, 404);
    }
    assert.deepEqual(await bytesOf(await viaRequest(photoId)), photo.bytes);
    let listed = await listedRequest();
    assert.deepEqual([listed.convertedProjectAvailable, listed.imageFileId, listed.imageFileVersionId], [false, photoId, origin.id]);

    // Hoy un archivo heredado no admite versiones; se simula la compatibilidad posterior (B9): la
    // foto pasa a la política 1.2 y el equipo incorpora una versión interna aprobada, sin compartir.
    await database.client.query(`
      with permission as (
        insert into public.permissions (code, name, description, module) values ('projects.files.upload', 'Subir archivos', null, 'projects')
        on conflict (code) do update set name = excluded.name returning id
      )
      insert into public.role_permissions (role_id, permission_id, is_active)
      select r.id, permission.id, true from public.roles r, permission where r.code = 'admin'
      on conflict do nothing`);
    const replace = await fetch(`${base}/projects/${projectId}/files/${photoId}/versions`, {
      body: Buffer.from("interna"), headers: { ...headers.admin, "Content-Type": "image/png", "X-Change-Note": "render", "X-File-Name": "render.png" }, method: "POST",
    });
    assert.deepEqual([replace.status, (await replace.json()).code], [409, "FILE_VERSIONING_UNAVAILABLE"]);
    const internalKey = `projects/${projectId}/files/${photoId}/v2-interna/render-interno.png`;
    storage.set(internalKey, { body: Buffer.from("render interno"), contentType: "image/png" });
    await database.client.query("update public.files set access_policy = 1 where id = $1", [photoId]);
    await database.client.query("update public.file_versions set is_current = false where file_id = $1", [photoId]);
    const [internal] = (await database.client.query(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url,
        file_extension, file_size, is_current, content_type, review_status, reviewed_by, reviewed_at)
      values ($1, $2, 2, $3, 'render-interno.png', 's3://ficticio', 'png', 14, true, 'image/png', 'approved', $2, now()) returning id::int`, [photoId, seed.admin, internalKey])).rows;
    await database.client.query("update public.files set current_version = 2 where id = $1", [photoId]);

    // Draft con la versión interna: la solicitud sigue sirviendo y nombrando lo que aportó el cliente.
    for (const auth of [headers.owner, headers.admin]) assert.deepEqual(await bytesOf(await viaRequest(photoId, auth)), photo.bytes);
    const attachments = (await api(`/project-requests/${id}`, { headers: headers.owner })).body.projectRequest.files;
    assert.deepEqual(attachments.find((file) => file.id === photoId).name, "fachada-cliente.png");
    assert.equal(attachments.find((file) => file.id === photoId).size, photo.bytes.length);
    const workflow = await api(`/admin/project-requests/${id}`, { headers: headers.admin });
    assert.equal(JSON.stringify(workflow.body).includes("render-interno"), false, "el flujo de la solicitud tampoco nombra la versión interna");
    assert.equal((await listedRequest()).imageFileVersionId, origin.id);

    // draft → pending: la portada pasa a leerse por el proyecto con la versión del cliente.
    assert.equal((await configureAndFinalize(projectId, headers.admin, [seed.architect])).status, 200);
    listed = await listedRequest();
    assert.deepEqual([listed.convertedProjectAvailable, listed.imageFileId, listed.imageFileVersionId], [true, photoId, origin.id]);
    assert.deepEqual(await bytesOf(await viaProject(projectId, photoId, headers.owner, listed.imageFileVersionId)), photo.bytes, "el enlace de la portada");
    assert.deepEqual(await bytesOf(await viaProject(projectId, photoId, headers.owner)), photo.bytes, "sin versionId, su propia versión");
    assert.equal((await viaProject(projectId, photoId, headers.owner, internal.id)).status, 404, "la versión interna no compartida");
    assert.deepEqual(await bytesOf(await viaRequest(photoId)), photo.bytes, "el detalle de la solicitud conserva su enlace");
    const detail = (await api(`/projects/${projectId}`, { headers: headers.owner })).body.project;
    assert.equal(detail.files.find((file) => file.id === photoId).currentVersionId, origin.id);
    assert.deepEqual([detail.imageFileId, detail.imageFileVersionId], [photoId, origin.id], "miniatura del detalle");
    const projectRow = (await api("/projects?scope=owned", { headers: headers.owner })).body.projects.find((row) => row.id === projectId);
    assert.deepEqual([projectRow.imageFileId, projectRow.imageFileVersionId], [photoId, origin.id], "miniatura del listado");
    assert.deepEqual(await bytesOf(await viaProject(projectId, photoId, headers.architect)), Buffer.from("render interno"), "el equipo ve la vigente");

    // Compartir la interna la entrega por el proyecto; la ruta de la solicitud sigue con la aportada.
    assert.equal((await api(`/projects/${projectId}/files/${photoId}/audiences/client`, { body: { versionId: internal.id }, headers: headers.admin, method: "PUT" })).status, 200);
    assert.deepEqual(await bytesOf(await viaProject(projectId, photoId, headers.owner)), Buffer.from("render interno"));
    assert.deepEqual(await bytesOf(await viaRequest(photoId)), photo.bytes);
    assert.equal(deletedKeys.includes(origin.file_name), false, "conservación del objeto aportado");
  } finally {
    process.env.PROJECT_FILE_REVIEW_ENABLED = "false";
  }
});

test("PostgreSQL y HTTP: al aprobar, los adjuntos homónimos entran todos en «Archivos del cliente» con nombre lógico único", { skip }, async () => {
  // La solicitud solo exige nombres únicos por autor (uq_files_project_request_user_title): tres autores
  // pueden adjuntar «planta.png». Se simula reescribiendo título, autor y nombre original de dos adjuntos.
  const { fileIds, headers, id } = await reviewedRequest([png("planta.png"), pdf("escritura.pdf"), pdf("memoria.pdf"), pdf("otro.pdf")]);
  const authors = [seed.admin, seed.architect];
  for (const [index, title] of ["PLANTA.png", "Planta.png"].entries()) {
    await database.client.query("update public.files set title = $2, uploaded_by = $3 where id = $1", [fileIds[index + 1], title, authors[index]]);
    await database.client.query("update public.file_versions set original_name = $2 where file_id = $1", [fileIds[index + 1], title]);
  }
  // Un cuarto adjunto ya se llama como el sufijo que tocaría: no se pisa.
  await database.client.query("update public.files set title = 'planta (2).png' where id = $1", [fileIds[3]]);
  const versionsBefore = (await database.client.query("select id, file_id, version_number, original_name, file_name from public.file_versions where file_id = any($1) order by id", [fileIds])).rows;
  const objectsBefore = storage.size;

  const approve = () => api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" });
  assert.equal((await approve()).status, 200);
  const projectId = await convertedProjectId(id);
  const placed = async () => (await database.client.query(`select file.id::int, file.title, folder.system_key from public.files file
    left join public.project_folders folder on folder.id = file.folder_id where file.id = any($1) order by file.id`, [fileIds])).rows;
  const after = await placed();
  assert.deepEqual(after.map((row) => [row.title, row.system_key]), [
    ["planta.png", "client_files"], ["PLANTA (3).png", "client_files"], ["Planta (4).png", "client_files"], ["planta (2).png", "client_files"],
  ], "todos en «Archivos del cliente», el de menor id conserva el nombre y los sufijos no pisan uno real");
  assert.deepEqual((await database.client.query("select file_id, version_number, original_name, file_name from public.file_versions where file_id = any($1) order by id", [fileIds])).rows,
    versionsBefore.map(({ file_id: fileId, file_name: fileName, original_name: originalName, version_number: versionNumber }) => ({ file_id: fileId, file_name: fileName, original_name: originalName, version_number: versionNumber })),
    "nombres originales, versiones y claves de almacenamiento intactos");
  assert.equal(storage.size, objectsBefore, "sin objetos nuevos");

  const audit = (await database.client.query("select new_values from public.audit_logs where entity_type = 'project_request' and entity_id = $1 and action = 'project_request.approve'", [id])).rows[0];
  assert.deepEqual(audit.new_values.renamedAttachments, [
    { fileId: fileIds[1], originalTitle: "PLANTA.png", title: "PLANTA (3).png" },
    { fileId: fileIds[2], originalTitle: "Planta.png", title: "Planta (4).png" },
  ]);

  // El detalle de la solicitud conserva el nombre original; la configuración del proyecto muestra el lógico.
  const detail = await api(`/project-requests/${id}`, { headers: headers.owner });
  assert.deepEqual(detail.body.projectRequest.files.map((file) => file.name).slice(0, 3), ["planta.png", "PLANTA.png", "Planta.png"]);
  const configuration = await api(`/admin/projects/${projectId}/configuration/files`, { headers: headers.admin });
  assert.equal(configuration.status, 200, JSON.stringify(configuration.body));
  assert.deepEqual(configuration.body.files.filter((file) => fileIds.includes(file.id)).map((file) => file.name).sort(), ["PLANTA (3).png", "Planta (4).png", "planta (2).png", "planta.png"]);
  for (const fileId of fileIds.slice(0, 3)) {
    assert.equal((await fetch(`${base}/project-requests/${id}/files/${fileId}/content`, { headers: headers.owner })).status, 200, "las descargas por la solicitud siguen funcionando");
  }

  // Conversión repetida: 409, sin otro proyecto ni nombres nuevos.
  assert.equal((await approve()).status, 409);
  assert.deepEqual(await placed(), after);
  assert.equal(Number((await database.client.query("select count(*) from public.projects where public_slug = $1", [`solicitud-${id}`])).rows[0].count), 1);
});

test("PostgreSQL y HTTP: aprobar una solicitud sin adjuntos crea el borrador", { skip }, async () => {
  const { headers, id } = await reviewedRequest([]);
  const approved = await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal((await requestRow(id)).status, "converted");
  assert.equal(await requestRowStatus(await convertedProjectId(id)), "draft");
});

test("PostgreSQL y HTTP: «Nuevo proyecto» crea un borrador manual que se configura con el mismo flujo", { skip }, async () => {
  const admin = await authAs(seed.admin);
  const created = await api("/admin/projects/drafts", { body: { clientId: seed.ownerClientId, name: "Oficina Norte" }, headers: admin, method: "POST" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const projectId = created.body.projectId;
  assert.equal(await requestRowStatus(projectId), "draft");
  assert.equal((await api("/admin/projects/drafts", { body: { clientId: seed.ownerClientId, name: "oficina  norte" }, headers: admin, method: "POST" })).status, 409, "nombre repetido para el cliente");
  assert.equal((await api("/admin/projects/drafts", { body: { clientId: 999999, name: "Otro" }, headers: admin, method: "POST" })).status, 400);
  assert.equal((await api("/admin/projects/drafts", { body: { clientId: seed.ownerClientId, name: "Otro" }, headers: await authAs(seed.owner), method: "POST" })).status, 403);
  const config = await api(`/admin/projects/${projectId}/configuration`, { headers: admin });
  assert.equal(config.body.configuration.request, null, "sin solicitud de origen");
  assert.equal(config.body.configuration.client.id, seed.ownerClientId);
  assert.equal((await configureAndFinalize(projectId, admin, [seed.architect])).status, 200);
  assert.equal(await requestRowStatus(projectId), "pending");
  assert.equal(Number((await database.client.query("select count(*) from public.audit_logs where action = $2 and entity_id = $1", [projectId, "project.create_draft"])).rows[0].count), 1);
});

test("PostgreSQL y HTTP: el administrador sube archivos y asigna encargados a un draft; los demás siguen sin verlo", { skip }, async () => {
  await grantProjectRead();
  await database.client.query(`
    with permission as (
      insert into public.permissions (code, name, description, module) values ('projects.files.upload', 'Subir archivos', null, 'projects')
      on conflict (code) do update set name = excluded.name returning id
    )
    insert into public.role_permissions (role_id, permission_id, is_active)
    select r.id, permission.id, true from public.roles r, permission where r.code in ('admin', 'architect')
    on conflict do nothing`);
  const { headers, id } = await reviewedRequest([]);
  assert.equal((await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" })).status, 200);
  const projectId = await convertedProjectId(id);
  const admin = await authAs(seed.admin);

  const uploaded = await fetch(`${base}/projects/${projectId}/files`, {
    body: pdf("plano-draft.pdf").bytes,
    headers: { ...admin, "Content-Type": "application/pdf", "X-File-Name": "plano-draft.pdf" },
    method: "POST",
  });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const assigned = await api(`/admin/projects/${projectId}/assignees`, { body: { assigneeIds: [seed.architect] }, headers: admin, method: "PUT" });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(await requestRowStatus(projectId), "draft", "subir y asignar no cambian el estado");

  // El draft sigue siendo inexistente para el arquitecto asignado y el cliente; los comentarios siguen bloqueados.
  const architect = await authAs(seed.architect);
  assert.equal((await api(`/projects/${projectId}`, { headers: architect })).status, 404);
  assert.equal((await api(`/projects/${projectId}`, { headers: await authAs(seed.owner) })).status, 404);
  const architectUpload = await fetch(`${base}/projects/${projectId}/files`, {
    body: pdf("otro.pdf").bytes, headers: { ...architect, "Content-Type": "application/pdf", "X-File-Name": "otro.pdf" }, method: "POST",
  });
  assert.equal(architectUpload.status, 404);
  assert.equal((await api(`/projects/${projectId}/comments`, { body: { content: "Hola" }, headers: admin, method: "POST" })).status, 409);
});

/**
 * Convierte la representación editable de la API en el cuerpo del formulario
 * (buildProjectRequestPayload), con la versión leída para el control de concurrencia.
 *
 * @param {Object} projectRequest - Respuesta de GET /admin/project-requests/:id/form.
 * @param {Object} [overrides] - Campos a sustituir.
 * @returns {Object} Cuerpo de PUT /admin/project-requests/:id/form.
 */
function adminEditPayload(projectRequest, overrides = {}) {
  return {
    capitalAvailability: projectRequest.capitalAvailability,
    decisionMaker: projectRequest.decisionMaker,
    description: projectRequest.description,
    developmentMode: projectRequest.developmentMode,
    expectedUpdatedAt: projectRequest.updatedAt,
    experience: projectRequest.experience,
    hasBlueprints: projectRequest.hasPlans,
    hasMultipleOwners: projectRequest.hasMultipleOwners,
    investmentRange: projectRequest.investmentRange,
    landStatus: projectRequest.landStatus,
    legalDocumentTypes: projectRequest.legalDocumentTypes,
    legalDocumentationStatus: projectRequest.legalDocumentationStatus,
    projectLocation: projectRequest.location,
    projectLocationFormattedAddress: projectRequest.formattedAddress,
    projectLocationLatitude: projectRequest.locationCoordinates?.latitude ?? null,
    projectLocationLongitude: projectRequest.locationCoordinates?.longitude ?? null,
    projectLocationProviderPlaceId: projectRequest.providerPlaceId,
    projectName: projectRequest.projectName,
    projectSize: projectRequest.projectSize,
    projectType: projectRequest.projectType,
    quality: projectRequest.quality,
    referenceLink: projectRequest.referenceLink,
    standRequirements: projectRequest.standRequirements,
    startTime: projectRequest.startTime,
    ...overrides,
  };
}

const workflowSnapshot = async (id) => (await database.client.query(`
  select r.status, r.client_id, r.requested_by, r.reviewed_by, r.converted_project_id, r.verified_at,
    (select count(*)::int from public.project_request_assignees a where a.project_request_id = r.id) as assignees,
    (select count(*)::int from public.project_request_reviews v where v.project_request_id = r.id) as reviews,
    (select count(*)::int from public.project_requests same where same.client_id = r.client_id and same.deleted_at is null) as client_requests,
    (select count(*)::int from public.projects p where p.client_id = r.client_id) as client_projects
  from public.project_requests r where r.id = $1`, [id])).rows[0];

const adminEditAudits = async (id) => (await database.client.query(
  "select user_id, new_values, old_values from public.audit_logs where action = 'project_request.admin_update' and entity_id = $1 order by id",
  [id],
)).rows;

test("PostgreSQL y HTTP: el administrador edita una solicitud en evaluación sin cambiar su estado, workflow ni adjuntos", { skip }, async () => {
  const { fileIds, headers, id } = await reviewedRequest([png("referencia.png"), pdf("escritura.pdf")]);
  const anonymous = await api(`/admin/project-requests/${id}/form`);
  assert.equal(anonymous.status, 401);
  assert.equal((await api(`/admin/project-requests/${id}/form`, { headers: headers.owner })).status, 403);
  assert.equal((await api(`/admin/project-requests/${id}/form`, { headers: headers.architect })).status, 403);
  assert.equal((await api("/admin/project-requests/999999999/form", { headers: headers.admin })).status, 404);

  // Precarga: respuestas reales con sus false/null, adjuntos y versión.
  const loaded = await api(`/admin/project-requests/${id}/form`, { headers: headers.admin });
  assert.equal(loaded.status, 200, JSON.stringify(loaded.body));
  const original = loaded.body.projectRequest;
  assert.equal(original.id, id);
  assert.equal(original.editable, true);
  assert.equal(original.hasMultipleOwners, false);
  assert.equal(original.hasPlans, true);
  assert.deepEqual(original.locationCoordinates, { latitude: 10.6545, longitude: -71.6406 });
  assert.deepEqual(original.files.map((file) => file.id), fileIds);
  assert.equal("submissionId" in original, false);
  const before = await workflowSnapshot(id);
  const versionsBefore = (await database.client.query("select file_id, file_name, file_size, version_number from public.file_versions where file_id = any($1) order by file_id", [fileIds])).rows;
  const objectsBefore = storage.size;

  // Cuerpos inválidos o con campos de workflow no se aceptan ni modifican nada.
  const workflowField = await api(`/admin/project-requests/${id}/form`, { body: adminEditPayload(original, { status: "converted" }), headers: headers.admin, method: "PUT" });
  assert.equal(workflowField.status, 400);
  const invalid = await api(`/admin/project-requests/${id}/form`, { body: adminEditPayload(original, { description: "corta" }), headers: headers.admin, method: "PUT" });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.fields["body.description"]);
  assert.equal((await api(`/admin/project-requests/${id}/form`, { body: adminEditPayload(original), headers: headers.architect, method: "PUT" })).status, 403);
  assert.equal((await adminEditAudits(id)).length, 0);

  // Guardar sin cambios no mueve la versión ni audita.
  const noop = await api(`/admin/project-requests/${id}/form`, { body: adminEditPayload(original), headers: headers.admin, method: "PUT" });
  assert.equal(noop.status, 200, JSON.stringify(noop.body));
  assert.deepEqual(noop.body.changedFields, []);
  assert.equal(noop.body.projectRequest.updatedAt, original.updatedAt);
  assert.equal((await adminEditAudits(id)).length, 0);

  // Edición real: texto, booleano a true, opcionales a null y sin coordenadas.
  const saved = await api(`/admin/project-requests/${id}/form`, {
    body: adminEditPayload(original, {
      decisionMaker: null,
      description: "Vivienda unifamiliar de tres plantas frente al lago, con terraza y piscina.",
      hasMultipleOwners: true,
      projectLocationFormattedAddress: null,
      projectLocationLatitude: null,
      projectLocationLongitude: null,
      projectLocationProviderPlaceId: null,
    }),
    headers: headers.admin,
    method: "PUT",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.changedFields, ["formattedAddress", "locationCoordinates", "providerPlaceId", "description", "hasMultipleOwners", "decisionMaker"]);
  const edited = saved.body.projectRequest;
  assert.equal(edited.id, id, "se conserva el identificador");
  assert.equal(edited.status, original.status, "guardar no decide ni reenvía");
  assert.equal(edited.hasMultipleOwners, true);
  assert.equal(edited.decisionMaker, null);
  assert.equal(edited.locationCoordinates, null);
  assert.notEqual(edited.updatedAt, original.updatedAt);
  assert.deepEqual(edited.files.map((file) => file.id), fileIds, "los adjuntos siguen en la solicitud");

  // Persistencia: la recarga devuelve lo guardado; el workflow, el cliente y los adjuntos no cambian.
  const reloaded = (await api(`/admin/project-requests/${id}/form`, { headers: headers.admin })).body.projectRequest;
  assert.equal(reloaded.description, edited.description);
  assert.equal(reloaded.hasMultipleOwners, true);
  assert.equal(reloaded.updatedAt, edited.updatedAt);
  assert.deepEqual(await workflowSnapshot(id), before);
  assert.deepEqual((await database.client.query("select file_id, file_name, file_size, version_number from public.file_versions where file_id = any($1) order by file_id", [fileIds])).rows, versionsBefore);
  assert.equal(storage.size, objectsBefore, "sin objetos duplicados");
  const compatibility = (await database.client.query("select compatibility_score, compatibility_level from public.project_requests where id = $1", [id])).rows[0];
  assert.equal(Number(compatibility.compatibility_score), edited.compatibility.score, "compatibilidad recalculada y persistida");
  assert.equal((await api(`/admin/project-requests/${id}`, { headers: headers.admin })).body.projectRequest.description, edited.description, "la consulta administrativa ve el cambio");
  assert.equal((await api(`/project-requests/${id}`, { headers: headers.owner })).body.projectRequest.description, edited.description, "el cliente ve su solicitud actualizada");

  // Auditoría: quién, qué solicitud y qué campos, sin copiar las respuestas.
  const audits = await adminEditAudits(id);
  assert.equal(audits.length, 1);
  assert.equal(Number(audits[0].user_id), seed.admin);
  assert.deepEqual(audits[0].new_values.changedFields, saved.body.changedFields);
  assert.equal(JSON.stringify(audits[0]).includes("piscina"), false, "la auditoría no guarda el texto del cliente");

  // Concurrencia: guardar con la versión anterior no sobrescribe.
  const stale = await api(`/admin/project-requests/${id}/form`, { body: adminEditPayload(original, { description: "Otra descripción suficientemente larga para pasar la validación." }), headers: headers.admin, method: "PUT" });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "PROJECT_REQUEST_EDIT_CONFLICT");
  assert.equal((await api(`/admin/project-requests/${id}/form`, { headers: headers.admin })).body.projectRequest.description, edited.description);
  const [first, second] = await Promise.all([1, 2].map((index) => api(`/admin/project-requests/${id}/form`, {
    body: adminEditPayload(reloaded, { description: `Edición simultánea número ${index} con texto suficientemente largo.` }),
    headers: headers.admin,
    method: "PUT",
  })));
  assert.deepEqual([first.status, second.status].sort(), [200, 409], "solo una edición simultánea gana");

  // Unicidad del nombre dentro del mismo cliente.
  const other = await reviewedRequest([]);
  const otherName = (await api(`/admin/project-requests/${other.id}/form`, { headers: headers.admin })).body.projectRequest.projectName;
  const current = (await api(`/admin/project-requests/${id}/form`, { headers: headers.admin })).body.projectRequest;
  const duplicated = await api(`/admin/project-requests/${id}/form`, { body: adminEditPayload(current, { projectName: otherName }), headers: headers.admin, method: "PUT" });
  assert.equal(duplicated.status, 409);
  assert.equal(duplicated.body.code, "PROJECT_NAME_ALREADY_EXISTS");

  // Tras una decisión deja de ser editable: se consulta, pero no se guarda.
  assert.equal((await api(`/admin/project-requests/${id}/decision`, { body: { action: "reject", reason: "Fuera del alcance del estudio." }, headers: headers.admin, method: "PATCH" })).status, 200);
  const closed = (await api(`/admin/project-requests/${id}/form`, { headers: headers.admin })).body.projectRequest;
  assert.equal(closed.editable, false);
  const rejectedEdit = await api(`/admin/project-requests/${id}/form`, { body: adminEditPayload(closed), headers: headers.admin, method: "PUT" });
  assert.equal(rejectedEdit.status, 409);
  assert.equal(rejectedEdit.body.code, "PROJECT_REQUEST_NOT_EDITABLE");
  assert.equal((await workflowSnapshot(id)).status, "rejected");
});

test("PostgreSQL y HTTP: la edición administrativa no alcanza borradores del cliente", { skip }, async () => {
  const owner = await authAs(seed.owner);
  const admin = await authAs(seed.admin);
  const created = await api("/project-requests", { body: { ...draftPayload(), submissionId: randomUUID() }, headers: owner, method: "POST" });
  const id = created.body.projectRequest.id;
  assert.equal((await api(`/admin/project-requests/${id}/form`, { headers: admin })).status, 404);
  const attempt = await api(`/admin/project-requests/${id}/form`, {
    body: adminEditPayload(created.body.projectRequest),
    headers: admin,
    method: "PUT",
  });
  assert.equal(attempt.status, 404);
  assert.equal((await requestRow(id)).status, "draft");
});

test("PostgreSQL y HTTP: las revisiones anteriores a cambios relevantes se marcan y protegen la aprobación", { skip }, async () => {
  const { headers, id } = await reviewedRequest([]);
  const detail = async () => (await api(`/admin/project-requests/${id}`, { headers: headers.admin })).body.projectRequest;
  const form = async () => (await api(`/admin/project-requests/${id}/form`, { headers: headers.admin })).body.projectRequest;
  const edit = async (overrides) => {
    const saved = await api(`/admin/project-requests/${id}/form`, { body: adminEditPayload(await form(), overrides), headers: headers.admin, method: "PUT" });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    return saved.body;
  };
  const initial = await detail();
  assert.equal(initial.hasOutdatedReviews, false);
  assert.equal(initial.answersRevisedAt, null);
  assert.deepEqual(initial.reviews.map((review) => review.outdated), [false]);

  // Sin avisos falsos: cambiar responsables o datos que no afectan a la revisión no marca nada.
  assert.equal((await api(`/admin/project-requests/${id}/assignees`, { body: { assigneeIds: [seed.architect, seed.admin] }, headers: headers.admin, method: "PUT" })).status, 200);
  const renamed = await edit({ projectName: `Casa renombrada ${randomUUID().slice(0, 8)}`, referenceLink: null });
  assert.deepEqual(renamed.changedFields, ["projectName", "referenceLink"]);
  assert.equal((await detail()).hasOutdatedReviews, false, "nombre y enlace no desactualizan la revisión");

  // Un cambio relevante marca la revisión previa, sin modificarla ni cambiar el estado.
  const reviewBefore = (await database.client.query("select reviewer_id, recommendation, note, updated_at from public.project_request_reviews where project_request_id = $1", [id])).rows;
  await edit({ investmentRange: "50k_150k" });
  const revised = await detail();
  assert.equal(revised.hasOutdatedReviews, true);
  assert.ok(revised.answersRevisedAt);
  assert.deepEqual(revised.reviews.map((review) => review.outdated), [true]);
  assert.equal(revised.status, "pending_review");
  assert.deepEqual((await database.client.query("select reviewer_id, recommendation, note, updated_at from public.project_request_reviews where project_request_id = $1", [id])).rows, reviewBefore, "la revisión original se conserva");
  const queue = await api("/project-requests/review-queue?limit=100", { headers: headers.admin });
  assert.equal(queue.body.projectRequests.find((request) => request.id === id).hasOutdatedReviews, true, "la cola (resumen) también lo indica");
  const audit = (await database.client.query("select new_values from public.audit_logs where action = 'project_request.admin_update' and entity_id = $1 order by id desc limit 1", [id])).rows[0];
  assert.deepEqual(audit.new_values.reviewRelevantFields, ["investmentRange"]);

  // Aprobar sin excepción se rechaza y no crea nada; la excepción exige confirmación y justificación.
  const blocked = await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "PROJECT_REQUEST_REVIEWS_OUTDATED");
  assert.equal((await workflowSnapshot(id)).status, "pending_review");
  assert.equal((await database.client.query("select converted_project_id from public.project_requests where id = $1", [id])).rows[0].converted_project_id, null);
  for (const body of [
    { acknowledgeOutdatedReviews: true, action: "approve" },
    { action: "approve", outdatedReviewsJustification: "El cliente confirmó el presupuesto por teléfono." },
    { acknowledgeOutdatedReviews: true, action: "approve", outdatedReviewsJustification: "corta" },
  ]) {
    assert.equal((await api(`/admin/project-requests/${id}/decision`, { body, headers: headers.admin, method: "PATCH" })).status, 400, JSON.stringify(body));
  }

  // Una revisión nueva sobre los datos actuales retira el aviso; otra edición relevante lo repone.
  const rereview = await api(`/project-requests/${id}/review`, { body: { note: "Revisado con el presupuesto actualizado.", recommendation: "approve" }, headers: headers.architect, method: "PUT" });
  assert.equal(rereview.status, 200, JSON.stringify(rereview.body));
  assert.equal((await detail()).hasOutdatedReviews, false);
  await edit({ startTime: "3_6_months" });
  assert.equal((await detail()).hasOutdatedReviews, true);

  // Excepción explícita: aprueba y queda auditada con su justificación.
  const approved = await api(`/admin/project-requests/${id}/decision`, {
    body: { acknowledgeOutdatedReviews: true, action: "approve", outdatedReviewsJustification: "El cliente confirmó el nuevo plazo en la reunión." },
    headers: headers.admin,
    method: "PATCH",
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const decisionAudit = (await database.client.query("select new_values from public.audit_logs where action = 'project_request.approve' and entity_id = $1", [id])).rows[0];
  assert.deepEqual(decisionAudit.new_values.outdatedReviewsOverride, { justification: "El cliente confirmó el nuevo plazo en la reunión.", outdatedReviews: 1 });
  assert.equal(Number((await database.client.query("select count(*) from public.project_request_reviews where project_request_id = $1", [id])).rows[0].count), 1);
});

test("PostgreSQL y HTTP: sin revisiones desactualizadas la aprobación y el rechazo no cambian", { skip }, async () => {
  const { headers, id } = await reviewedRequest([]);
  const other = await reviewedRequest([]);
  const current = (await api(`/admin/project-requests/${other.id}/form`, { headers: headers.admin })).body.projectRequest;
  assert.equal((await api(`/admin/project-requests/${other.id}/form`, { body: adminEditPayload(current, { quality: "luxury" }), headers: headers.admin, method: "PUT" })).status, 200);
  // Rechazar o pedir correcciones con revisiones desactualizadas no exige la excepción.
  assert.equal((await api(`/admin/project-requests/${other.id}/decision`, { body: { action: "reject", reason: "Fuera del alcance del estudio." }, headers: headers.admin, method: "PATCH" })).status, 200);
  // Sin ediciones, aprobar sigue funcionando como antes y no audita ninguna excepción.
  const approved = await api(`/admin/project-requests/${id}/decision`, { body: { action: "approve" }, headers: headers.admin, method: "PATCH" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const decisionAudit = (await database.client.query("select new_values from public.audit_logs where action = 'project_request.approve' and entity_id = $1", [id])).rows[0];
  assert.equal("outdatedReviewsOverride" in decisionAudit.new_values, false);
});

/**
 * Concede (o reactiva) permisos a los roles indicados, como el script de permisos de staging.
 *
 * @param {string[]} codes - Permisos.
 * @param {string[]} roleCodes - Roles.
 * @returns {Promise<void>}
 */
async function grantPermissions(codes, roleCodes) {
  for (const code of codes) {
    await database.client.query(`
      with permission as (
        insert into public.permissions (code, name, description, module) values ($1, $1, null, 'projects')
        on conflict (code) do update set name = excluded.name returning id
      )
      insert into public.role_permissions (role_id, permission_id, is_active)
      select r.id, permission.id, true from public.roles r, permission where r.code = any($2::text[])
      on conflict (role_id, permission_id) do update set is_active = true`, [code, roleCodes]);
  }
}

/**
 * Sube un archivo a un proyecto como lo hace uploadRawFile.
 *
 * @param {number} projectId - Proyecto destino.
 * @param {Object} file - Nombre, tipo y bytes.
 * @param {Object} headers - Autenticación.
 * @returns {Promise<{status: number, body: Object|null}>} Respuesta.
 */
async function uploadToProject(projectId, { bytes, name, type }, headers) {
  const response = await fetch(`${base}/projects/${projectId}/files`, {
    body: bytes,
    headers: { ...headers, "Content-Type": type, "X-File-Name": encodeURIComponent(name) },
    method: "POST",
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, status: response.status };
}

test("Fase 1.2 (B1): eliminar un archivo de proyecto guardado se rechaza y conserva registro, versiones y objeto", { skip }, async () => {
  await grantProjectRead();
  await grantPermissions(["projects.files.upload", "projects.files.delete"], ["admin", "architect", "client"]);
  const admin = await authAs(seed.admin);
  const created = await api("/admin/projects/drafts", { body: { clientId: seed.ownerClientId, name: `Conservación ${randomUUID()}` }, headers: admin, method: "POST" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const projectId = created.body.projectId;
  const finalized = await configureAndFinalize(projectId, admin, [seed.architect]);
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));

  const architect = await authAs(seed.architect);
  const owner = await authAs(seed.owner);
  const stranger = await authAs(seed.stranger);
  const report = pdf("memoria-descriptiva.pdf");
  const architectFile = await uploadToProject(projectId, report, architect);
  assert.equal(architectFile.status, 201, JSON.stringify(architectFile.body));
  const ownerFile = await uploadToProject(projectId, png("referencia-cliente.png"), owner);
  assert.equal(ownerFile.status, 201, JSON.stringify(ownerFile.body));
  const architectFileId = architectFile.body.file.id;
  const ownerFileId = ownerFile.body.file.id;
  const path = (fileId) => `/projects/${projectId}/files/${fileId}`;
  const architectBefore = await retainedFileSnapshot(architectFileId);
  const ownerBefore = await retainedFileSnapshot(ownerFileId);

  // Autenticación, permisos y acceso se comprueban antes que la regla de conservación.
  assert.equal((await api(path(architectFileId), { method: "DELETE" })).status, 401);
  await database.client.query(`update public.role_permissions rp set is_active = false from public.permissions p, public.roles r
    where rp.permission_id = p.id and rp.role_id = r.id and p.code = 'projects.files.delete' and r.code = 'client'`);
  const forbidden = await api(path(ownerFileId), { headers: owner, method: "DELETE" });
  assert.equal(forbidden.status, 403, JSON.stringify(forbidden.body));
  await grantPermissions(["projects.files.delete"], ["client"]);
  assert.equal((await api(path(architectFileId), { headers: stranger, method: "DELETE" })).status, 404, "proyecto ajeno");
  assert.equal((await api(path(architectFileId), { headers: owner, method: "DELETE" })).status, 404, "archivo de otro autor");
  assert.equal((await api(path(99_999_999), { headers: admin, method: "DELETE" })).status, 404, "archivo inexistente");
  assert.equal((await api(`/projects/${projectId}/files/abc`, { headers: admin, method: "DELETE" })).status, 400);

  // Quien podía eliminarlo recibe 409 y nada cambia: ni la fila, ni sus versiones, ni el objeto.
  for (const [fileId, headers] of [[architectFileId, architect], [architectFileId, admin], [ownerFileId, owner]]) {
    const refused = await api(path(fileId), { headers, method: "DELETE" });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.deepEqual(refused.body, { code: "FILE_DELETION_NOT_ALLOWED", message: "Los archivos guardados se conservan y no se pueden eliminar." });
  }
  await assertFileRetained(architectFileId, architectBefore);
  await assertFileRetained(ownerFileId, ownerBefore);

  // El archivo sigue disponible con sus mismos bytes.
  const content = await fetch(`${base}${path(architectFileId)}/content`, { headers: owner });
  assert.equal(content.status, 200);
  assert.ok(Buffer.from(await content.arrayBuffer()).equals(report.bytes));

  // Un proyecto de solo lectura conserva su respuesta previa (409 del estado) sin tocar el archivo.
  await database.client.query("update public.projects set status = 'archived', archived_from_status = 'pending' where id = $1", [projectId]);
  const archived = await api(path(architectFileId), { headers: admin, method: "DELETE" });
  assert.equal(archived.status, 409);
  assert.equal(archived.body.code, "PROJECT_ARCHIVED");
  await assertFileRetained(architectFileId, architectBefore);
  await assertNoRecordedObjectDeleted();
});
