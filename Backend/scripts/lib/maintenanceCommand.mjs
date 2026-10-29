import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/*
 * Utilidades compartidas de los comandos de mantenimiento del catálogo
 * (load-official-service-catalog.mjs, split-service-units.mjs): contraseña sin eco, destino sin
 * credenciales e informe JSON fuera del repositorio.
 */

/**
 * Pide la contraseña sin mostrarla en la terminal o la toma de ARCA_MAINTENANCE_ADMIN_PASSWORD
 * cuando no hay terminal interactiva.
 *
 * @param {string} email - Cuenta para la que se pide.
 * @returns {Promise<string>} Contraseña.
 */
export async function readPassword(email) {
  if (process.env.ARCA_MAINTENANCE_ADMIN_PASSWORD) return process.env.ARCA_MAINTENANCE_ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error("Sin terminal interactiva: define ARCA_MAINTENANCE_ADMIN_PASSWORD.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return await new Promise((resolve) => {
      prompt.question(`Contraseña de ${email}: `, resolve);
      // Tras escribir la pregunta, nada de lo tecleado se repite en pantalla.
      prompt._writeToOutput = () => {};
    });
  } finally {
    prompt.close();
    process.stdout.write("\n");
  }
}

/**
 * Describe el servidor de DATABASE_URL sin usuario ni contraseña.
 *
 * @returns {string} Host (y puerto si se indica).
 */
export function databaseHost() {
  const url = new URL(process.env.DATABASE_URL);
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

/**
 * Guarda el informe JSON de una ejecución fuera del repositorio y devuelve su ruta: la indicada o,
 * por defecto, `~/ARCA_PRIVATE_BACKUPS/<carpeta>/<inicio>-<modo>-<ejecución>.json`.
 *
 * @param {string|undefined} requestedPath - Ruta indicada con --report.
 * @param {string} folder - Carpeta por defecto dentro de ARCA_PRIVATE_BACKUPS.
 * @param {{ startedAt: string, mode: string, runId: string }} report - Contenido del informe.
 * @returns {Promise<string>} Ruta del informe.
 */
export async function writeReport(requestedPath, folder, report) {
  const file = requestedPath
    ? path.resolve(requestedPath)
    : path.join(homedir(), "ARCA_PRIVATE_BACKUPS", folder, `${report.startedAt.replace(/[:.]/g, "-")}-${report.mode}-${report.runId}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}
