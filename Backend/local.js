import "dotenv/config";
import "./src/config/environmentGuard.js";
import app from "./src/app.js";
import { pool } from "./src/config/db.js";
import { closeAllProjectEventConnections } from "./src/services/projectEvents.js";
import { beginShutdown } from "./src/services/lifecycle.js";

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  beginShutdown();
  console.log(JSON.stringify({ type: "shutdown_started", signal }));
  closeAllProjectEventConnections();
  const forceTimer = setTimeout(() => process.exit(1), Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000));
  forceTimer.unref();
  server.close(async () => {
    await pool.end();
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
