import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  REPOSITORY_ROOT,
  assertConfirmedTarget,
  assertReportOutsideRepository,
  describeInventoryTarget,
  isInsideDirectory,
  loadExplicitEnvironment,
  toStorageConnection,
} from "../scripts/lib/storageInventoryTarget.mjs";

// Valores ficticios: ninguna prueba conecta ni lee archivos reales de entorno.
const ENVIRONMENT = {
  DATABASE_URL: "postgresql://inventory_reader:secreto-db@db.example.internal:6543/arca",
  SUPABASE_QUOTE_PDF_BUCKET: "quote-pdfs",
  SUPABASE_STORAGE_BUCKET: "general-files",
  SUPABASE_STORAGE_S3_ACCESS_KEY_ID: "clave-acceso",
  SUPABASE_STORAGE_S3_ENDPOINT: "https://storage.example.internal/storage/v1/s3",
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: "secreto-s3",
  SUPABASE_URL: "https://example-project.supabase.co",
};

test("el destino exige un archivo explícito fuera del repositorio y no lee process.env", async () => {
  await assert.rejects(() => loadExplicitEnvironment(undefined), /--env-file/);
  let read = false;
  const reader = async () => {
    read = true;
    return "DATABASE_URL=postgresql://x@y/z";
  };
  await assert.rejects(() => loadExplicitEnvironment(path.join(REPOSITORY_ROOT, "Backend", ".env"), { read: reader }), /dentro del repositorio/);
  await assert.rejects(() => loadExplicitEnvironment(path.join(REPOSITORY_ROOT, "otro.env"), { read: reader }), /dentro del repositorio/);
  assert.equal(read, false, "No debe leerse un archivo del repositorio");

  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://no-usar@process-env/db";
  try {
    const environment = await loadExplicitEnvironment(path.join(tmpdir(), "arca-inventory.env"), {
      read: async () => "DATABASE_URL=postgresql://lector@db.local/arca\nSUPABASE_STORAGE_BUCKET=files\n",
    });
    assert.equal(environment.DATABASE_URL, "postgresql://lector@db.local/arca");
    assert.equal(process.env.DATABASE_URL, "postgresql://no-usar@process-env/db");
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("la descripción del destino no contiene credenciales ni URLs completas", () => {
  const target = describeInventoryTarget(ENVIRONMENT);
  assert.deepEqual(target, {
    buckets: { general: "general-files", quotes: "quote-pdfs" },
    database: "arca@db.example.internal:6543",
    storageHost: "storage.example.internal",
    supabaseUrlConfigured: true,
  });
  const serialized = JSON.stringify(target);
  for (const secret of ["secreto-db", "inventory_reader", "clave-acceso", "secreto-s3", "supabase.co", "postgresql://"]) {
    assert.ok(!serialized.includes(secret), secret);
  }
  assert.throws(() => describeInventoryTarget({ ...ENVIRONMENT, SUPABASE_STORAGE_BUCKET: "" }), /SUPABASE_STORAGE_BUCKET/);
  assert.throws(() => describeInventoryTarget({ ...ENVIRONMENT, DATABASE_URL: "no-es-url" }), /no son URLs válidas/);
});

test("las confirmaciones deben repetir base, host de almacenamiento y todos los buckets", () => {
  const target = describeInventoryTarget(ENVIRONMENT);
  assert.doesNotThrow(() => assertConfirmedTarget(target, {
    buckets: "quote-pdfs, general-files",
    database: "arca@db.example.internal:6543",
    storage: "storage.example.internal",
  }));
  assert.throws(() => assertConfirmedTarget(target, {}), /Destino no confirmado/);
  assert.throws(() => assertConfirmedTarget(target, {
    buckets: "general-files",
    database: "arca@db.example.internal:6543",
    storage: "storage.example.internal",
  }), /--confirm-buckets/);
  assert.throws(() => assertConfirmedTarget(target, {
    buckets: "general-files,quote-pdfs",
    database: "arca@otra-base:5432",
    storage: "storage.example.internal",
  }), /--confirm-database/);
});

test("el informe no puede guardarse dentro del repositorio", () => {
  assert.throws(() => assertReportOutsideRepository(path.join(REPOSITORY_ROOT, "Backend", "informe.json")), /dentro del repositorio/);
  assert.doesNotThrow(() => assertReportOutsideRepository(path.join(tmpdir(), "informe.json")));
  assert.doesNotThrow(() => assertReportOutsideRepository(undefined));
  assert.equal(isInsideDirectory(REPOSITORY_ROOT, REPOSITORY_ROOT), true);
  assert.equal(isInsideDirectory(path.join(REPOSITORY_ROOT, "..", "fuera"), REPOSITORY_ROOT), false);
});

test("la conexión de almacenamiento usa solo las variables del archivo explícito", () => {
  assert.deepEqual(toStorageConnection(ENVIRONMENT), {
    accessKeyId: "clave-acceso",
    endpoint: "https://storage.example.internal/storage/v1/s3",
    region: "us-east-1",
    secretAccessKey: "secreto-s3",
  });
});
