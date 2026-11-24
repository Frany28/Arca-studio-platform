import { z } from "zod";

// Notificaciones del usuario autenticado: solo cursor y límite; el usuario sale de la sesión.
export const notificationListSchema = z.object({
  query: z.object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }).strict(),
});

export const notificationReadSchema = z.object({
  params: z.object({ notificationId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
});
