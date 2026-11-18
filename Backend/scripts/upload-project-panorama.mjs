import "dotenv/config";

import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildStorageFileUrl,
  buildStorageObjectKey,
  getFileExtension,
  getSupabaseStorageConfig,
  sanitizeStorageFileName,
} from "../src/config/storage.js";
import { pool } from "../src/config/db.js";
import { objectStorage } from "../src/services/objectStorage.js";
import { discardUnrecordedScriptObjects } from "./lib/discardUnrecordedScriptObjects.mjs";

const CONTENT_TYPES = new Map([
  [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"],
  [".png", "image/png"], [".webp", "image/webp"],
]);

function parseArguments() {
  const args = process.argv.slice(2);
  const options = { projectName: "Quinta Vella Vista", sourcePath: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--project-name") options.projectName = args[++index];
    else if (!options.sourcePath) options.sourcePath = path.resolve(args[index]);
    else throw new Error("Se admite una sola panorámica por ejecución.");
  }
  if (!options.sourcePath) {
    throw new Error('Uso: node scripts/upload-project-panorama.mjs [--project-name "Quinta Vella Vista"] <imagen>');
  }
  return options;
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (length < 2) break;
    offset += length + 2;
  }
  return null;
}

async function imageDimensions(sourcePath, extension) {
  const handle = await open(sourcePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (extension === ".png" && header.length >= 24) {
      return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
    }
    if ([".jpg", ".jpeg"].includes(extension)) return jpegDimensions(header);
    if (extension === ".webp" && header.toString("ascii", 12, 16) === "VP8X") {
      return {
        width: 1 + header.readUIntLE(24, 3),
        height: 1 + header.readUIntLE(27, 3),
      };
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function main() {
  const { projectName, sourcePath } = parseArguments();
  const extension = path.extname(sourcePath).toLowerCase();
  const contentType = CONTENT_TYPES.get(extension);
  const sourceStats = await stat(sourcePath);
  if (!contentType || !sourceStats.isFile() || sourceStats.size <= 0) {
    throw new Error("La panorámica debe ser un archivo JPEG, PNG o WEBP válido.");
  }
  const dimensions = await imageDimensions(sourcePath, extension);
  if (!dimensions || Math.abs(dimensions.width / dimensions.height - 2) > 0.05) {
    throw new Error("La panorámica debe ser equirectangular y tener una proporción cercana a 2:1.");
  }

  const storageConfig = getSupabaseStorageConfig();
  if (!storageConfig.bucket) throw new Error("SUPABASE_STORAGE_BUCKET is required");
  const client = await pool.connect();
  let storageKey = null;
  try {
    await client.query("begin");
    const projectResult = await client.query(
      `select id, created_by from public.projects where deleted_at is null and lower(name) = lower($1) limit 2`,
      [projectName],
    );
    if (projectResult.rowCount !== 1) {
      if (projectResult.rowCount) throw new Error("El nombre del proyecto no es único.");
      const candidates = await client.query(
        `select id, name from public.projects
         where deleted_at is null
           and (lower(name) like '%quinta%' or lower(name) like '%vella%' or lower(name) like '%villa%')
         order by name limit 10`,
      );
      const detail = candidates.rows.length
        ? ` Coincidencias: ${candidates.rows.map((row) => `${row.id}: ${row.name}`).join(", ")}.`
        : "";
      throw new Error(`No se encontró el proyecto.${detail}`);
    }
    const project = projectResult.rows[0];
    const originalName = path.basename(sourcePath);
    const existing = await client.query(
      `select id from public.files where project_id = $1 and file_category = 'panorama' and lower(title) = lower($2) and deleted_at is null limit 1`,
      [project.id, originalName],
    );
    if (existing.rowCount) {
      await client.query("rollback");
      console.log(`Panorámica ya registrada (fileId=${existing.rows[0].id}).`);
      return;
    }
    const fileResult = await client.query(
      `insert into public.files (project_id, uploaded_by, title, description, file_type, file_category, current_version, status)
       values ($1, $2, $3, 'Panorámica equirectangular 360.', $4, 'panorama', 1, 'active') returning id`,
      [project.id, project.created_by, originalName, contentType],
    );
    const fileId = fileResult.rows[0].id;
    storageKey = buildStorageObjectKey({ belongsTo: "projects", fileId, originalName, ownerId: project.created_by, parentId: project.id, uploadedAt: new Date(), versionNumber: 1 });
    await objectStorage.put({ body: createReadStream(sourcePath), contentLength: sourceStats.size, contentType, key: storageKey, metadata: { belongs_to: "project", file_id: String(fileId), file_category: "panorama", project_id: String(project.id), uploaded_by: String(project.created_by) } });
    await client.query(
      `insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, change_note, is_current)
       values ($1, $2, 1, $3, $4, $5, $6, $7, 'Carga inicial de panorámica 360.', true)`,
      [fileId, project.created_by, storageKey, sanitizeStorageFileName(originalName), buildStorageFileUrl(storageKey), getFileExtension(originalName), sourceStats.size],
    );
    await client.query("commit");
    console.log(`Panorámica cargada (projectId=${project.id}, fileId=${fileId}, ${dimensions.width}x${dimensions.height}).`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    // Solo se borra si ninguna versión quedó registrada con esa clave (COMMIT de resultado incierto).
    if (storageKey) await discardUnrecordedScriptObjects([storageKey], "maintenance_project_panorama");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
