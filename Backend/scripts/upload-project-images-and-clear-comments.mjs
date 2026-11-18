import "dotenv/config";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import {
  buildStorageFileUrl,
  buildStorageObjectKey,
  getFileExtension,
  getSupabaseS3Client,
  getSupabaseStorageConfig,
  sanitizeStorageFileName,
} from "../src/config/storage.js";
import { pool } from "../src/config/db.js";
import { discardUnrecordedScriptObjects } from "./lib/discardUnrecordedScriptObjects.mjs";

const IMAGE_CONTENT_TYPES = new Map([
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function printUsage() {
  console.log(`
Uso:
  node scripts/upload-project-images-and-clear-comments.mjs --project-id <id> [--delete-comments] <imagen...>
  node scripts/upload-project-images-and-clear-comments.mjs --project-name "<nombre>" [--delete-comments] <imagen...>

Ejemplo:
  node scripts/upload-project-images-and-clear-comments.mjs --project-id 1 --delete-comments ./renders/cocina.png ./renders/habitacion.jpg
`);
}

function getArguments() {
  const args = process.argv.slice(2);
  const imagePaths = [];
  const options = {
    deleteComments: false,
    projectId: null,
    projectName: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--delete-comments") {
      options.deleteComments = true;
      continue;
    }

    if (arg === "--project-id") {
      options.projectId = Number(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--project-name") {
      options.projectName = args[index + 1];
      index += 1;
      continue;
    }

    imagePaths.push(path.resolve(arg));
  }

  if (
    (!Number.isInteger(options.projectId) || options.projectId <= 0) &&
    !options.projectName
  ) {
    throw new Error("Indica --project-id o --project-name.");
  }

  if (options.projectId && options.projectName) {
    throw new Error("Usa solo --project-id o --project-name, no ambos.");
  }

  if (!imagePaths.length && !options.deleteComments) {
    throw new Error("Indica al menos una imagen o usa --delete-comments.");
  }

  return {
    ...options,
    imagePaths,
  };
}

async function findProject(client, { projectId, projectName }) {
  const result = projectId
    ? await client.query(
        `
          select id, name, created_by
          from public.projects
          where id = $1
            and deleted_at is null
          limit 1
        `,
        [projectId],
      )
    : await client.query(
        `
          select id, name, created_by
          from public.projects
          where deleted_at is null
            and lower(name) = lower($1)
          limit 2
        `,
        [projectName],
      );

  if (result.rowCount !== 1) {
    throw new Error(
      result.rowCount === 0
        ? "No se encontro el proyecto indicado."
        : `Hay mas de un proyecto llamado "${projectName}". Usa --project-id.`,
    );
  }

  return result.rows[0];
}

async function prepareImage(sourcePath) {
  const sourceStats = await stat(sourcePath);
  const extension = path.extname(sourcePath).toLowerCase();
  const contentType = IMAGE_CONTENT_TYPES.get(extension);

  if (!sourceStats.isFile() || sourceStats.size <= 0) {
    throw new Error(`La ruta no contiene un archivo valido: ${sourcePath}`);
  }

  if (!contentType) {
    throw new Error(
      `Formato no soportado para ${sourcePath}. Usa JPEG, PNG o WEBP.`,
    );
  }

  return {
    contentType,
    originalName: path.basename(sourcePath),
    size: sourceStats.size,
    sourcePath,
  };
}

async function uploadProjectImage({
  client,
  image,
  project,
  s3Client,
  storageConfig,
  uploadedStorageKeys,
}) {
  const uploadedAt = new Date();
  const versionNumber = 1;

  const fileResult = await client.query(
    `
      insert into public.files (
        project_id,
        uploaded_by,
        title,
        description,
        file_type,
        current_version,
        status
      )
      values ($1, $2, $3, $4, $5, $6, 'active'::file_status)
      returning id
    `,
    [
      project.id,
      project.created_by,
      image.originalName,
      "Imagen renderizada del proyecto.",
      image.contentType,
      versionNumber,
    ],
  );
  const fileId = fileResult.rows[0].id;
  const storageKey = buildStorageObjectKey({
    belongsTo: "projects",
    fileId,
    originalName: image.originalName,
    ownerId: project.created_by,
    parentId: project.id,
    uploadedAt,
    versionNumber,
  });
  const fileUrl = buildStorageFileUrl(storageKey);

  await s3Client.send(
    new PutObjectCommand({
      Body: createReadStream(image.sourcePath),
      Bucket: storageConfig.bucket,
      ContentLength: image.size,
      ContentType: image.contentType,
      Key: storageKey,
      Metadata: {
        belongs_to: "project",
        file_id: String(fileId),
        project_id: String(project.id),
        uploaded_by: String(project.created_by),
        uploaded_year: String(uploadedAt.getUTCFullYear()),
      },
    }),
  );
  uploadedStorageKeys.push(storageKey);

  const versionResult = await client.query(
    `
      insert into public.file_versions (
        file_id,
        uploaded_by,
        version_number,
        file_name,
        original_name,
        file_url,
        file_extension,
        file_size,
        change_note,
        is_current
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      returning id
    `,
    [
      fileId,
      project.created_by,
      versionNumber,
      storageKey,
      sanitizeStorageFileName(image.originalName),
      fileUrl,
      getFileExtension(image.originalName),
      image.size,
      "Carga inicial de render del proyecto.",
    ],
  );

  const storedObject = await s3Client.send(
    new HeadObjectCommand({
      Bucket: storageConfig.bucket,
      Key: storageKey,
    }),
  );

  return {
    contentLength: storedObject.ContentLength,
    contentType: storedObject.ContentType,
    fileId: Number(fileId),
    fileUrl,
    originalName: image.originalName,
    storageKey,
    versionId: Number(versionResult.rows[0].id),
  };
}

async function softDeleteProjectComments(client) {
  const result = await client.query(
    `
      update public.project_comments
      set deleted_at = now(),
          updated_at = now()
      where deleted_at is null
    `,
  );

  return result.rowCount;
}

async function run() {
  const options = getArguments();
  const storageConfig = getSupabaseStorageConfig();

  if (!storageConfig.bucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET is required");
  }

  const images = [];
  for (const sourcePath of options.imagePaths) {
    images.push(await prepareImage(sourcePath));
  }

  const client = await pool.connect();
  const s3Client = getSupabaseS3Client();
  const uploadedStorageKeys = [];

  try {
    await client.query("begin");

    const project = await findProject(client, options);
    const deletedComments = options.deleteComments
      ? await softDeleteProjectComments(client)
      : 0;
    const uploadedImages = [];

    for (const image of images) {
      uploadedImages.push(
        await uploadProjectImage({
          client,
          image,
          project,
          s3Client,
          storageConfig,
          uploadedStorageKeys,
        }),
      );
    }

    await client.query("commit");

    return {
      deletedComments,
      projectId: Number(project.id),
      projectName: project.name,
      uploadedImages,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});

    // Solo se borran los objetos sin versión registrada (COMMIT de resultado incierto).
    await discardUnrecordedScriptObjects(uploadedStorageKeys, "maintenance_project_image");

    throw error;
  } finally {
    client.release();
  }
}

try {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
