import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const migrationsDirectory = new URL("../../prisma/migrations/", import.meta.url);

/**
 * Crea una base PostgreSQL desechable en un servidor local y aplica todo el historial de migraciones.
 * Rechaza hosts remotos y nunca lee DATABASE_URL ni .env, para no tocar bases compartidas.
 * Con `createApiRoles` crea anon/authenticated/service_role con los privilegios por defecto de
 * Supabase, de modo que se ejerciten los REVOKE (usar solo en un clúster desechable).
 *
 * @param {object} options - Configuración de la base aislada.
 * @param {string} options.baseUrl - URL de un servidor local con permiso para crear bases.
 * @param {string} options.prefix - Prefijo del nombre de la base temporal.
 * @param {boolean} [options.createApiRoles] - Crea los roles de la API de Supabase.
 * @returns {Promise<{ client: import("pg").Client, databaseUrl: string, drop: Function }>} Cliente
 *   conectado a la base migrada, su URL y la función que la elimina.
 */
export async function createIsolatedMigrationDatabase({ baseUrl, prefix, createApiRoles = false }) {
  const base = new URL(baseUrl);
  assert.ok(LOCAL_HOSTS.includes(base.hostname), "La prueba rechaza hosts remotos.");
  const { default: pg } = await import("pg");
  const admin = new pg.Client({ connectionString: base.toString(), ssl: false });
  await admin.connect();
  const databaseName = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  // Nombre generado internamente, sin entradas externas.
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  base.pathname = `/${databaseName}`;
  const databaseUrl = base.toString();
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });

  const drop = async () => {
    await client.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => {});
    await admin.end();
  };

  try {
    await client.connect();
    if (createApiRoles) await createSupabaseApiRoles(client);
    await applyMigrationHistory(client);
  } catch (error) {
    await drop();
    throw error;
  }
  return { client, databaseUrl, drop };
}

/**
 * Crea los roles de la API de Supabase con sus privilegios por defecto sobre tablas nuevas.
 *
 * @param {import("pg").Client} client - Cliente de la base aislada.
 * @returns {Promise<void>}
 */
async function createSupabaseApiRoles(client) {
  for (const role of ["anon", "authenticated", "service_role"]) {
    await client.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  }
  await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role");
}

/**
 * Aplica en orden todas las migraciones de prisma/migrations sin usar la CLI de Prisma.
 * Un valor de enum nuevo no puede usarse en la transacción que lo crea, así que el SQL se
 * ejecuta por tramos tras cada ADD VALUE.
 *
 * @param {import("pg").Client} client - Cliente de la base aislada.
 * @returns {Promise<void>}
 */
async function applyMigrationHistory(client) {
  // Tabla de control que Prisma crea antes de migrar; la migración D-2 revoca privilegios sobre ella.
  await client.query(`
    create table public._prisma_migrations (
      id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz,
      migration_name varchar(255) not null, logs text, rolled_back_at timestamptz,
      started_at timestamptz not null default now(), applied_steps_count integer not null default 0
    )
  `);
  const migrations = (await readdir(migrationsDirectory)).filter((name) => /^\d{14}_/.test(name)).sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`${migration}/migration.sql`, migrationsDirectory), "utf8");
    for (const chunk of sql.split(/(?<=ADD VALUE[^;]*;)/i)) {
      if (chunk.trim()) await client.query(chunk);
    }
  }
}
