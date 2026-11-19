import { z } from "zod";

import { decodeCursor } from "../utils/pagination.js";

// Entradas de las rutas de versiones y revisión de archivos de proyecto (Fase 1.2, B4). Los textos
// (motivo del cambio y del rechazo) solo se comprueban aquí como texto; su obligatoriedad y longitud
// las decide el dominio (domain/projectFileReview.js) para responder con el campo exacto.

const positiveId = z.coerce.number().int().positive();
const cursor = z.string().optional().refine((value) => !value || Boolean(decodeCursor(value)), "Cursor inválido.");
const fileParams = z.object({ projectId: positiveId, fileId: positiveId });
const versionParams = fileParams.extend({ versionId: positiveId });

export const projectFileVersionListSchema = z.object({
  params: fileParams,
  query: z.object({ cursor, limit: z.coerce.number().int().min(1).max(100).optional() }),
});

// Reemplazo: cuerpo binario (como la subida); el motivo llega en la cabecera X-Change-Note.
export const projectFileVersionUploadSchema = z.object({ params: fileParams });

export const projectFileVersionRestoreSchema = z.object({
  params: versionParams,
  body: z.object({ changeNote: z.string() }).strict(),
});

export const projectFileVersionApproveSchema = z.object({
  params: versionParams,
  body: z.object({}).strict().optional(),
});

export const projectFileVersionRejectSchema = z.object({
  params: versionParams,
  body: z.object({ reason: z.string() }).strict(),
});

// Audiencias (Fase 1.2, B5): `client` (cliente propietario) o `showcase` (escaparate).
const audienceParams = fileParams.extend({ audience: z.enum(["client", "showcase"]) });

export const projectFileAudienceListSchema = z.object({ params: fileParams });

export const projectFileAudienceGrantSchema = z.object({
  params: audienceParams,
  body: z.object({ versionId: positiveId }).strict(),
});

export const projectFileAudienceRevokeSchema = z.object({ params: audienceParams });
