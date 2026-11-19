import { z } from "zod";

// Entradas del administrador de archivos (Fase 1.2, B7). Los cursores son opacos; el servicio comprueba
// que correspondan a la consulta (pestaña, orden y sentido) y responde 400 si no.

const positiveId = z.coerce.number().int().positive();
const limit = z.coerce.number().int().min(1).max(100).default(25);
const cursor = z.string().max(512).optional();
const search = z.string().trim().min(1).max(100).optional();
const folderName = z.string().trim().min(1, "Escribe el nombre de la carpeta.").max(120);
const booleanFlag = z.enum(["true", "false"]).default("false").transform((value) => value === "true");
// Lista de extensiones separada por comas (`pdf,png`), en minúsculas y sin punto.
const extensions = z.string().max(120).optional()
  .transform((value) => (value ? [...new Set(value.split(",").map((item) => item.trim().toLowerCase().replace(/^\./, "")).filter(Boolean))] : []))
  .refine((items) => items.length <= 10 && items.every((item) => /^[a-z0-9]{1,10}$/.test(item)), "Extensiones no válidas.");

/**
 * Exige el proyecto cuando se pide una carpeta como ámbito.
 * El servicio comprueba después que la carpeta pertenezca a ese proyecto.
 *
 * @param {{ projectId?: number, folderId?: number }} value - Consulta.
 * @returns {boolean} true si es coherente.
 */
function folderNeedsProject(value) {
  return !value.folderId || Boolean(value.projectId);
}

const scope = z.object({ folderId: positiveId.optional(), projectId: positiveId.optional() });
const scopeMessage = { message: "La carpeta exige su proyecto.", path: ["folderId"] };

export const fileManagerMetricsSchema = z.object({
  query: scope.strict().refine(folderNeedsProject, scopeMessage),
});

export const fileManagerTreeSchema = z.object({
  query: z.object({ cursor, limit, search }).strict(),
});

export const fileManagerFolderSearchSchema = z.object({
  query: z.object({ cursor, limit, projectId: positiveId.optional(), search: z.string().trim().min(1).max(100) }).strict(),
});

export const fileManagerItemsSchema = z.object({
  query: scope.extend({
    cursor,
    extensions,
    includeSubfolders: booleanFlag,
    limit,
    order: z.enum(["asc", "desc"]).default("desc"),
    search,
    sort: z.enum(["date", "name", "size"]).default("date"),
    tab: z.enum(["approved", "pending", "rejected"]).default("approved"),
  }).strict().refine(folderNeedsProject, scopeMessage),
});

const folderParams = z.object({ projectId: positiveId, folderId: positiveId });

export const fileManagerFolderCreateSchema = z.object({
  params: z.object({ projectId: positiveId }),
  body: z.object({ name: folderName, parentId: positiveId.nullable().optional().transform((value) => value ?? null) }).strict(),
});

export const fileManagerFolderRenameSchema = z.object({
  params: folderParams,
  body: z.object({ name: folderName }).strict(),
});

export const fileManagerFolderDeleteSchema = z.object({ params: folderParams });

// Fase 1.2 (B8): vínculos entre garantías y documentos, y lectura de garantías de un proyecto.
export const warrantyDocumentLinkSchema = z.object({
  params: z.object({ fileId: positiveId, projectId: positiveId, warrantyId: positiveId }),
});

export const projectWarrantiesReadSchema = z.object({ params: z.object({ projectId: positiveId }) });
