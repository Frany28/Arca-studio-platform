import { z } from "zod";

import { ADMIN_USERS_PAGE_SIZE } from "../config/adminUsers.js";
import { decodeCursor } from "../utils/pagination.js";

const userCursor = z.string().optional().refine((value) => {
  if (!value) return true;
  const decoded = decodeCursor(value);
  return Boolean(decoded && !Number.isNaN(Date.parse(decoded[0])) && /^\d+$/.test(String(decoded[1])));
}, "Cursor inválido.");

/**
 * Normaliza el valor de optional phone para mantener un formato interno consistente.
 * Se utiliza para normalizar entradas y construir contratos Zod reutilizables.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @param {string} context - Contexto utilizado durante la validación.
 * @returns {object} Resultado producido por la operación.
 */
function normalizeOptionalPhone(value, context) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return null;

  let digits = rawValue.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!rawValue.startsWith("+") && digits.length === 10) digits = `1${digits}`;

  if (digits.length < 8 || digits.length > 15) {
    context.addIssue({ code: "custom", message: "Número de teléfono inválido." });
    return z.NEVER;
  }

  return `+${digits}`;
}

const fullName = z.string().trim().min(3, "Ingresa nombre y apellido.").max(300).transform((value, context) => {
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    context.addIssue({ code: "custom", message: "Ingresa nombre y apellido." });
    return z.NEVER;
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
});

const optionalPhone = z.string().max(40).optional().transform(normalizeOptionalPhone);

/**
 * Procesa el valor de optional csv lista para completar la responsabilidad asignada al módulo.
 * Se utiliza para normalizar entradas y construir contratos Zod reutilizables.
 *
 * @param {unknown} itemSchema - Valor de `itemSchema` requerido por esta operación.
 * @param {number} [maxItems] - Valor de `maxItems` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function optionalCsvList(itemSchema, maxItems = 50) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const values = (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
    return [...new Set(values)];
  }, z.array(itemSchema).min(1).max(maxItems).optional());
}

export const adminUserListSchema = z.object({
  query: z.object({
    cursor: userCursor,
    limit: z.coerce.number().int().min(1).max(ADMIN_USERS_PAGE_SIZE).optional(),
    role: optionalCsvList(z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i)),
    search: z.string().trim().max(100).optional(),
    status: optionalCsvList(z.enum(["active", "blocked", "inactive"]), 3),
  }).passthrough(),
});

const adminUserMutationFields = {
  fullName,
  companyName: z.string().trim().max(150).optional().transform((value) => value || null),
  email: z.string().trim().pipe(z.email("Correo inválido.")).transform((value) => value.toLowerCase()),
  roleCode: z.string().trim().min(1).max(50).regex(/^[a-z0-9_-]+$/i),
  phone: optionalPhone,
  secondaryPhone: optionalPhone,
  status: z.enum(["active", "blocked", "inactive"]),
};

const passwordsMatchPolicy = z.string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(72, "La contraseña no puede superar 72 caracteres.")
  .regex(/[A-Z]/, "La contraseña debe incluir una mayúscula.")
  .regex(/\d/, "La contraseña debe incluir un número.")
  .regex(/[^A-Za-z0-9]/, "La contraseña debe incluir un carácter especial.");

/**
 * Procesa el valor de different phones para completar la responsabilidad asignada al módulo.
 * Se utiliza para normalizar entradas y construir contratos Zod reutilizables.
 *
 * @param {unknown} body - Valor de `body` requerido por esta operación.
 * @returns {void} Finalización de la operación.
 */
const differentPhones = (body) => !body.phone || body.phone !== body.secondaryPhone;
const differentPhonesIssue = { message: "Los teléfonos deben ser diferentes.", path: ["secondaryPhone"] };

const adminUserMutationBody = z.object(adminUserMutationFields).refine(
  differentPhones,
  differentPhonesIssue,
);

const adminUserUpdateBody = z.object({
  ...adminUserMutationFields,
  password: passwordsMatchPolicy.optional(),
}).refine(
  differentPhones,
  differentPhonesIssue,
);

export const adminUserCreateSchema = z.object({
  body: adminUserMutationBody,
});

export const adminUserUpdateSchema = z.object({
  params: z.object({
    userId: z.coerce.number().int().positive(),
  }),
  body: adminUserUpdateBody,
});

export const adminUserStatusSchema = z.object({
  params: z.object({
    userId: z.coerce.number().int().positive(),
  }),
  body: z.object({
    status: z.enum(["active", "blocked", "inactive"]),
  }),
});

export const adminUserSessionRevokeSchema = z.object({
  params: z.object({
    userId: z.coerce.number().int().positive(),
  }),
});

export const adminUserPhotoSchema = z.object({
  params: z.object({
    userId: z.coerce.number().int().positive(),
  }),
});

export const adminUserDetailSchema = z.object({
  params: z.object({
    userId: z.coerce.number().int().positive(),
  }),
});

const adminUserNoteContent = z.string().trim().min(1, "Escribe una nota.").max(1000, "La nota no puede superar 1000 caracteres.");

export const adminUserNoteListSchema = z.object({
  params: z.object({ userId: z.coerce.number().int().positive() }),
  query: z.object({
    cursor: userCursor,
    limit: z.coerce.number().int().min(1).max(25).optional(),
  }).passthrough(),
});

export const adminUserNoteCreateSchema = z.object({
  params: z.object({ userId: z.coerce.number().int().positive() }),
  body: z.object({ content: adminUserNoteContent }),
});

export const adminUserNoteUpdateSchema = z.object({
  params: z.object({
    userId: z.coerce.number().int().positive(),
    noteId: z.coerce.number().int().positive(),
  }),
  body: z.object({ content: adminUserNoteContent }),
});

export const adminUserNoteArchiveSchema = z.object({
  params: z.object({
    userId: z.coerce.number().int().positive(),
    noteId: z.coerce.number().int().positive(),
  }),
});

export const adminUserNoteDeleteSchema = adminUserNoteArchiveSchema;
