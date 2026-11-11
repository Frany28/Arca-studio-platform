import { z } from "zod";
import { decodeCursor } from "../utils/pagination.js";
import { isValidProjectSlug } from "../utils/projectSlug.js";

const positiveId = z.coerce.number().int().positive();
const cursor = z.string().optional().refine((value) => !value || Boolean(decodeCursor(value)), "Cursor inválido.");

export const loginSchema = z.object({
  body: z.object({ email: z.string().trim().pipe(z.email("Correo inválido.")).transform((value) => value.toLowerCase()), password: z.string().min(8).max(256) }),
});

// Recuperación de contraseña: estos esquemas solo fijan el TIPO (cadena acotada). El formato del
// correo, la firma del token y la fortaleza de la contraseña los sigue validando el controlador con
// sus códigos actuales (INVALID_EMAIL, INVALID_RESET_TOKEN, INVALID_PASSWORD). Deben ejecutarse antes
// de los límites por cuenta/destinatario: un valor no textual (p. ej. un arreglo) no produce clave de
// límite y el controlador lo convertiría en texto con String(), saltándose el límite.
const recoveryEmail = z.string().max(320);
const recoveryToken = z.string().max(4096);

export const forgotPasswordSchema = z.object({ body: z.object({ email: recoveryEmail }) });

export const verifyResetTokenSchema = z.object({ body: z.object({ token: recoveryToken }) });

export const resetPasswordSchema = z.object({
  body: z.object({ password: z.string().max(256), token: recoveryToken }),
});

// Activación de una cuenta pendiente: misma política que la recuperación (8+ caracteres, mayúscula,
// número y carácter especial) con el máximo de 72 que bcrypt procesa completo.
const activationPassword = z.string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(72, "La contraseña no puede superar 72 caracteres.")
  .regex(/[A-Z]/, "La contraseña debe incluir una mayúscula.")
  .regex(/\d/, "La contraseña debe incluir un número.")
  .regex(/[^A-Za-z0-9]/, "La contraseña debe incluir un carácter especial.");

export const verifyActivationTokenSchema = z.object({ body: z.object({ token: recoveryToken.min(1) }).strict() });

export const activateAccountSchema = z.object({
  body: z.object({ password: activationPassword, token: recoveryToken.min(1) }).strict(),
});

export const adminUserActivationLinkSchema = z.object({
  params: z.object({ userId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
});

export const paginationSchema = z.object({
  query: z.object({ cursor, limit: z.coerce.number().int().min(1).max(100).optional() }).passthrough(),
});

export const projectListSchema = z.object({
  query: z.object({
    cursor,
    limit: z.coerce.number().int().min(1).max(100).optional(),
    scope: z.enum(["accessible", "owned"]).optional(),
  }).passthrough(),
});

export const projectIdSchema = z.object({ params: z.object({ projectId: positiveId }) });

const projectIdentifier = z.string().trim().refine((value) => {
  const numericValue = Number(value);
  return (
    (Number.isInteger(numericValue) && numericValue > 0) ||
    isValidProjectSlug(value)
  );
}, "Proyecto inválido.");

export const projectDetailSchema = z.object({
  params: z.object({ projectId: projectIdentifier }),
  query: z.object({
    filesCursor: cursor,
    filesLimit: z.coerce.number().int().min(1).max(100).optional(),
  }).passthrough(),
});

export const projectCommentAuthorPhotoSchema = z.object({
  params: z.object({
    projectId: positiveId,
    userId: positiveId,
  }),
});

export const commentSchema = z.object({
  params: z.object({ projectId: positiveId }),
  body: z.object({
    commentType: z.enum(["general", "image", "video", "panorama", "document"]).default("general"),
    content: z.string().trim().min(1, "Escribe una observación.").max(2000),
    parentCommentId: positiveId.nullish(),
    targetId: z.union([z.string(), z.number()]).nullish(),
    image: z.record(z.string(), z.unknown()).nullish(),
    selection: z.record(z.string(), z.unknown()).nullish(),
    fileId: positiveId.nullish(),
    fileVersionId: positiveId.nullish(),
  }).passthrough(),
}).superRefine((value, context) => {
  const selection = value.body.selection;

  if (value.body.commentType === "document") {
    const hasNormalizedCoordinates =
      value.body.fileId &&
      value.body.fileVersionId &&
      !value.body.parentCommentId &&
      typeof selection.normalizedX === "number" &&
      selection.normalizedX >= 0 && selection.normalizedX <= 1 &&
      typeof selection.normalizedY === "number" &&
      selection.normalizedY >= 0 && selection.normalizedY <= 1;
    const validPdfPoint =
      selection?.kind === "document-point" &&
      Number.isInteger(selection.pageNumber) && selection.pageNumber > 0 &&
      Number.isInteger(selection.pageCount) && selection.pageCount > 0 &&
      selection.pageNumber <= selection.pageCount;
    const validWordPoint =
      selection?.kind === "document-section-point" &&
      Number.isInteger(selection.sectionIndex) && selection.sectionIndex >= 0 &&
      Number.isInteger(selection.sectionCount) && selection.sectionCount > 0 &&
      selection.sectionIndex < selection.sectionCount;
    const validExcelPoint =
      selection?.kind === "document-cell-point" &&
      typeof selection.sheetName === "string" && selection.sheetName.trim().length > 0 && selection.sheetName.length <= 31 &&
      typeof selection.cell === "string" && /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(selection.cell);
    const validPoint = hasNormalizedCoordinates && (validPdfPoint || validWordPoint || validExcelPoint);
    const validReply =
      value.body.fileId && value.body.fileVersionId && value.body.parentCommentId && !selection;
    if (!validPoint && !validReply) {
      context.addIssue({
        code: "custom",
        message: "El punto del documento no es válido.",
        path: ["body", "selection"],
      });
    }
    return;
  }

  if (value.body.commentType === "panorama" && !value.body.parentCommentId) {
    const yaw = Number(selection?.yaw);
    const pitch = Number(selection?.pitch);
    const validPoint =
      ["panorama-point", "viewer3d-point"].includes(selection?.kind) &&
      typeof selection?.yaw === "number" &&
      Number.isFinite(yaw) && yaw >= -180 && yaw <= 180 &&
      typeof selection?.pitch === "number" &&
      Number.isFinite(pitch) && pitch >= -90 && pitch <= 90;
    if (!validPoint) {
      context.addIssue({
        code: "custom",
        message: "El punto de la panorámica no es válido.",
        path: ["body", "selection"],
      });
    }
    return;
  }

  if (selection?.kind !== "video-time") return;

  const timeSeconds = Number(selection.timeSeconds);
  const durationSeconds = Number(selection.durationSeconds);
  const isValid =
    value.body.commentType === "video" &&
    typeof selection.timeSeconds === "number" &&
    typeof selection.durationSeconds === "number" &&
    Number.isFinite(timeSeconds) &&
    timeSeconds >= 0 &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0 &&
    timeSeconds <= durationSeconds;

  if (!isValid) {
    context.addIssue({
      code: "custom",
      message: "La referencia temporal del video no es válida.",
      path: ["body", "selection"],
    });
  }
});

export const documentCommentsSchema = z.object({
  params: z.object({ projectId: positiveId, fileId: positiveId }),
  query: z.object({
    cursor,
    limit: z.coerce.number().int().min(1).max(100).optional(),
    fileVersionId: positiveId,
  }),
});

export const projectFileContentSchema = z.object({
  params: z.object({ projectId: positiveId, fileId: positiveId }),
  query: z.object({ versionId: positiveId.optional() }).passthrough(),
});

export const environmentCommentSchema = z.object({
  body: z.object({
    content: z.string().trim().min(1, "Escribe una observación.").max(2000),
    parentCommentId: positiveId.nullish(),
  }),
});

export const environmentCommentAuthorPhotoSchema = z.object({
  params: z.object({ userId: positiveId }),
});

export const fileRouteSchema = z.object({
  params: z.object({ projectId: positiveId.optional(), projectRequestId: positiveId.optional(), supportRequestId: positiveId.optional() }).passthrough(),
});
