import { Readable } from "node:stream";

/** Simula solo SQL de documentos; null significa que la sentencia pertenece a otro repositorio. */
export function createQuotePdfDatabaseMock() {
  const rows = new Map();
  let isPrivate = true;
  let failComplete = false;
  function respond(sql, params) {
    const text = sql.replace(/\s+/g, " ").trim();
    const result = (row) => ({ rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 });
    if (text.startsWith("select public from storage.buckets")) return result({ public: !isPrivate });
    if (!text.includes("public.quote_pdf_documents")) return null;
    const id = Number(params[0]);
    if (text.startsWith("insert into")) {
      if (!rows.has(id)) rows.set(id, {
        quote_version_id: id, object_key: params[1], file_name: params[2], document_model: JSON.parse(params[3]), source_hash: params[4],
        time_zone: params[5], layout_revision: params[6], status: "pending", attempts: 0, lease_token: null, lease_until: null,
        bucket: null, content_hash: null, size_bytes: null, generated_at: null, stored_at: null, error_code: null,
      });
      return result(null);
    }
    const row = rows.get(id);
    if (text.startsWith("select *")) return result(row);
    if (!row) return result(null);
    if (text.includes("attempts = attempts + 1")) {
      if (row.status === "available" || row.lease_until > Date.now()) return result(null);
      Object.assign(row, { status: "pending", lease_token: params[1], lease_until: Date.now() + 600000, attempts: row.attempts + 1, error_code: null });
    } else if (text.includes("set bucket = $3")) {
      if (row.lease_token !== params[1] || row.lease_until <= Date.now()) return result(null);
      if ((row.content_hash && row.content_hash !== params[3]) || (row.size_bytes && row.size_bytes !== params[4])) return result(null);
      Object.assign(row, { bucket: params[2], content_hash: params[3], size_bytes: params[4], generated_at: row.generated_at || new Date().toISOString() });
    } else if (text.includes("set status = 'available'")) {
      if (failComplete) throw new Error("metadata unavailable");
      if (row.lease_token !== params[1] || row.lease_until <= Date.now()) return result(null);
      Object.assign(row, { status: "available", stored_at: new Date().toISOString(), lease_token: null, lease_until: null, error_code: null });
    } else if (text.includes("set status = 'error'")) {
      if (params[1] ? row.lease_token !== params[1] : row.status !== "available") return result(null);
      Object.assign(row, { status: "error", error_code: params[2], lease_token: null, lease_until: null });
    } else throw new Error(`SQL de PDF no simulado: ${text}`);
    return result(row);
  }
  return { rows, respond, setPrivate: (value) => { isPrivate = value; }, setFailComplete: (value) => { failComplete = value; } };
}

/** Adaptador S3 en memoria con las mismas precondiciones de no sobrescritura que el proveedor. */
export function mockQuotePdfStorage(context, storage) {
  const objects = new Map();
  const calls = { put: 0, head: 0, get: 0 };
  let failPut = false;
  context.mock.method(storage, "head", async (key) => { calls.head++; return objects.get(key)?.metadata ?? null; });
  context.mock.method(storage, "get", async (key) => {
    calls.get++;
    const stored = objects.get(key);
    if (!stored) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
    return { ...stored.metadata, Body: Readable.from([stored.bytes]) };
  });
  context.mock.method(storage, "put", async (options) => {
    calls.put++;
    if (failPut) throw new Error("S3 unavailable");
    assertPrivateUpload(options);
    if (objects.has(options.key)) throw Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } });
    objects.set(options.key, { bytes: options.body, metadata: { ContentType: options.contentType, ContentLength: options.contentLength, Metadata: options.metadata } });
  });
  return { objects, calls, setFailPut: (value) => { failPut = value; } };
}

function assertPrivateUpload(options) {
  if (options.ifNoneMatch !== "*" || !options.bucket || options.bucket === process.env.SUPABASE_STORAGE_BUCKET) {
    throw new Error("La prueba exige bucket separado y escritura condicional.");
  }
}
