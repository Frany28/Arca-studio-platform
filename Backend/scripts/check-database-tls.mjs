// Comprueba la TLS de PostgreSQL con la misma configuración que usa el backend.
// Informa el estado TLS del socket del cliente (con el pooler de Supabase,
// pg_stat_ssl describe el tramo pooler → PostgreSQL, no el del backend).
// Ejecuta solo `select 1` en una transacción READ ONLY; no muestra la cadena de
// conexión ni el certificado. Uso: pnpm check:db-tls
import "dotenv/config";

const { pool } = await import("../src/config/db.js");
const { resolveDatabaseConnection } = await import("../src/config/databaseTls.js");
const { isLocalRuntime } = await import("../src/config/environment.js");

const { ssl } = resolveDatabaseConnection(process.env, { local: isLocalRuntime(process.env) });
const verification = ssl === false
  ? "sin TLS"
  : ssl.rejectUnauthorized
    ? (ssl.ca ? "verificada con DATABASE_SSL_CA_CERT" : "verificada con el almacén del sistema")
    : "SIN VERIFICAR (solo desarrollo local)";

const client = await pool.connect().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || "CONNECTION_ERROR", message: error.message, verification }));
  process.exit(1);
});
try {
  await client.query("BEGIN READ ONLY");
  await client.query("select 1");
  const socket = client.connection?.stream;
  console.log(JSON.stringify({
    ok: true,
    tls: Boolean(socket?.encrypted),
    protocol: socket?.getProtocol?.() ?? null,
    cipher: socket?.getCipher?.()?.name ?? null,
    certificateTrusted: socket?.encrypted ? socket.authorized : null,
    verification,
  }));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}
