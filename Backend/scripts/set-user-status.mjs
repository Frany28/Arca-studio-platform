import "dotenv/config";

import { pool, query } from "../src/config/db.js";
import { invalidatePasswordResetTokens } from "../src/repositories/passwordResetRepository.js";
import { SESSION_REVOCATION_REASONS, revokeUserSessions } from "../src/repositories/sessionRepository.js";

const [identifier, nextStatus = "inactive"] = process.argv.slice(2);
const allowedStatuses = new Set(["active", "inactive"]);

if (!identifier || !allowedStatuses.has(nextStatus)) {
  console.error(
    "Usage: node scripts/set-user-status.mjs <email-or-id> <active|inactive>",
  );
  process.exitCode = 1;
} else {
  try {
    const result = await query(
      `
        update public.users u
        set status = $2, updated_at = now()
        from public.roles r
        where r.id = u.role_id
          and r.code = 'client'
          and u.deleted_at is null
          and (
            lower(u.email) = lower($1)
            or u.id::text = $1
          )
        returning u.id, u.email, u.status
      `,
      [identifier, nextStatus],
    );

    if (!result.rowCount) {
      console.log(
        JSON.stringify(
          {
            updated: false,
            message: "No active client user found for that email or id.",
          },
          null,
          2,
        ),
      );
    } else {
      // Igual que la desactivación desde el panel: cierra sesiones e invalida enlaces de recuperación
      // pendientes, para que una reactivación posterior no los vuelva válidos.
      if (nextStatus !== "active") {
        const userId = result.rows[0].id;
        await revokeUserSessions({ reason: SESSION_REVOCATION_REASONS.userDisabled, userId });
        await invalidatePasswordResetTokens({ userId });
      }
      console.log(
        JSON.stringify(
          {
            updated: true,
            user: result.rows[0],
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await pool.end();
  }
}
