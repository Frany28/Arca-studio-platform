import "dotenv/config";

import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
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

const VIDEO_CONTENT_TYPES = new Map([
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
]);
const SINGLE_UPLOAD_LIMIT_BYTES = 1024 * 1024 * 1024;
const MULTIPART_CHUNK_SIZE_BYTES = 16 * 1024 * 1024;

function printUsage() {
  console.log(`
Uso:
  node scripts/upload-project-videos.mjs --project-id <id> <video...>
  node scripts/upload-project-videos.mjs --project-name "<nombre>" <video...>

Ejemplo:
  node scripts/upload-project-videos.mjs --project-name "quinta bella vista" ./video.mov
`);
}

function getArguments() {
  const args = process.argv.slice(2);
  const videoPaths = [];
  const options = {
    projectId: null,
    projectName: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
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

    videoPaths.push(path.resolve(arg));
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

  if (!videoPaths.length) {
    throw new Error("Indica al menos un video.");
  }

  return {
    ...options,
    videoPaths,
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

async function prepareVideo(sourcePath) {
  const sourceStats = await stat(sourcePath);
  const extension = path.extname(sourcePath).toLowerCase();
  const contentType = VIDEO_CONTENT_TYPES.get(extension);

  if (!sourceStats.isFile() || sourceStats.size <= 0) {
    throw new Error(`La ruta no contiene un archivo valido: ${sourcePath}`);
  }

  if (!contentType) {
    throw new Error(
      `Formato no soportado para ${sourcePath}. Usa MOV, MP4 o WEBM.`,
    );
  }

  return {
    contentType,
    originalName: path.basename(sourcePath),
    size: sourceStats.size,
    sourcePath,
  };
}

async function uploadProjectVideo({
  client,
  project,
  s3Client,
  storageConfig,
  uploadedStorageKeys,
  video,
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
      video.originalName,
      "Video renderizado del proyecto.",
      video.contentType,
      versionNumber,
    ],
  );

  const fileId = fileResult.rows[0].id;
  const storageKey = buildStorageObjectKey({
    belongsTo: "projects",
    fileId,
    originalName: video.originalName,
    ownerId: project.created_by,
    parentId: project.id,
    uploadedAt,
    versionNumber,
  });
  const fileUrl = buildStorageFileUrl(storageKey);

  const uploadMetadata = {
    belongs_to: "project",
    file_id: String(fileId),
    project_id: String(project.id),
    uploaded_by: String(project.created_by),
    uploaded_year: String(uploadedAt.getUTCFullYear()),
  };

  if (video.size > SINGLE_UPLOAD_LIMIT_BYTES) {
    await uploadMultipartObject({
      bucket: storageConfig.bucket,
      contentType: video.contentType,
      key: storageKey,
      metadata: uploadMetadata,
      s3Client,
      sourcePath: video.sourcePath,
      size: video.size,
    });
  } else {
    await s3Client.send(
      new PutObjectCommand({
        Body: createReadStream(video.sourcePath),
        Bucket: storageConfig.bucket,
        ContentLength: video.size,
        ContentType: video.contentType,
        Key: storageKey,
        Metadata: uploadMetadata,
      }),
    );
  }
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
      sanitizeStorageFileName(video.originalName),
      fileUrl,
      getFileExtension(video.originalName),
      video.size,
      "Carga inicial de video del proyecto.",
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
    originalName: video.originalName,
    storageKey,
    versionId: Number(versionResult.rows[0].id),
  };
}

async function uploadMultipartObject({
  bucket,
  contentType,
  key,
  metadata,
  s3Client,
  sourcePath,
  size,
}) {
  const createResult = await s3Client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      ContentType: contentType,
      Key: key,
      Metadata: metadata,
    }),
  );
  const uploadId = createResult.UploadId;
  const parts = [];
  let fileHandle = null;

  try {
    fileHandle = await open(sourcePath, "r");

    for (
      let partNumber = 1, offset = 0;
      offset < size;
      partNumber += 1, offset += MULTIPART_CHUNK_SIZE_BYTES
    ) {
      const length = Math.min(MULTIPART_CHUNK_SIZE_BYTES, size - offset);
      const buffer = Buffer.allocUnsafe(length);
      await fileHandle.read(buffer, 0, length, offset);

      const uploadPartResult = await s3Client.send(
        new UploadPartCommand({
          Body: buffer,
          Bucket: bucket,
          ContentLength: length,
          Key: key,
          PartNumber: partNumber,
          UploadId: uploadId,
        }),
      );

      parts.push({
        ETag: uploadPartResult.ETag,
        PartNumber: partNumber,
      });
    }

    await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        MultipartUpload: {
          Parts: parts,
        },
        UploadId: uploadId,
      }),
    );
  } catch (error) {
    if (uploadId) {
      await s3Client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          }),
        )
        .catch(() => {});
    }

    throw error;
  } finally {
    await fileHandle?.close();
  }
}

async function run() {
  const options = getArguments();
  const storageConfig = getSupabaseStorageConfig();

  if (!storageConfig.bucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET is required");
  }

  const videos = [];
  for (const sourcePath of options.videoPaths) {
    videos.push(await prepareVideo(sourcePath));
  }

  const client = await pool.connect();
  const s3Client = getSupabaseS3Client();
  const uploadedStorageKeys = [];

  try {
    await client.query("begin");

    const project = await findProject(client, options);
    const uploadedVideos = [];

    for (const video of videos) {
      uploadedVideos.push(
        await uploadProjectVideo({
          client,
          project,
          s3Client,
          storageConfig,
          uploadedStorageKeys,
          video,
        }),
      );
    }

    await client.query("commit");

    return {
      projectId: Number(project.id),
      projectName: project.name,
      uploadedVideos,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});

    // Solo se borran los objetos sin versión registrada (COMMIT de resultado incierto).
    await discardUnrecordedScriptObjects(uploadedStorageKeys, "maintenance_project_video");

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
