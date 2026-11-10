import "dotenv/config";

import bcrypt from "bcrypt";

import { pool, query } from "../src/config/db.js";
import { databaseHost } from "./lib/maintenanceCommand.mjs";

const DEMO_CLIENT_EMAIL = "showcase@arcastudio.com";
const DEMO_REQUESTER_EMAIL = "solicitudes.showcase@arcastudio.com";
// La contraseña ya no se versiona: se toma del entorno al ejecutar el seed.
const DEMO_REQUESTER_PASSWORD = process.env.DEMO_REQUESTER_PASSWORD || "";
const DEMO_SUBMISSION_ID = "00000000-0000-4000-8000-000000000028";
const DEMO_REQUEST_NAME = "Café Mirador Solicitud Demo";

async function findDemoRequester() {
  const existing = await query(
    `
      select user_account.id as user_id, client.id as client_id
      from public.clients client
      inner join public.users user_account on user_account.client_id = client.id
      inner join public.roles role on role.id = user_account.role_id
      where lower(user_account.email) = lower($1)
        and client.status = 'active'
        and client.deleted_at is null
        and user_account.status = 'active'
        and user_account.deleted_at is null
        and role.code = 'client'
      limit 1
    `,
    [DEMO_REQUESTER_EMAIL],
  );

  if (existing.rows[0]) return existing.rows[0];

  const clientResult = await query(
    `
      select id
      from public.clients
      where lower(email) = lower($1)
        and status = 'active'
        and deleted_at is null
      limit 1
    `,
    [DEMO_CLIENT_EMAIL],
  );
  if (!clientResult.rows[0]) {
    throw new Error("No se encontró el cliente demo Showcase.");
  }

  const roleResult = await query(
    `select id from public.roles where code = 'client' and is_active = true limit 1`,
  );
  if (!roleResult.rows[0]) throw new Error("No se encontró el rol client activo.");

  const passwordHash = await bcrypt.hash(DEMO_REQUESTER_PASSWORD, 10);
  const inserted = await query(
    `
      insert into public.users (
        client_id, role_id, email, first_name, last_name, password_hash,
        company_name, status
      ) values ($1, $2, $3, 'Cliente', 'Showcase', $4, 'ARCA Showcase', 'active')
      returning id as user_id, client_id
    `,
    [
      clientResult.rows[0].id,
      roleResult.rows[0].id,
      DEMO_REQUESTER_EMAIL,
      passwordHash,
    ],
  );

  return inserted.rows[0];
}

async function ensureDemoRequest({ client_id: clientId, user_id: userId }) {
  const existing = await query(
    `
      select id, project_name, status, requested_by, client_id
      from public.project_requests
      where submission_id = $1::uuid
        and deleted_at is null
      limit 1
    `,
    [DEMO_SUBMISSION_ID],
  );

  if (existing.rows[0]) {
    return { action: "existing", projectRequest: existing.rows[0] };
  }

  const inserted = await query(
    `
      insert into public.project_requests (
        client_id,
        requested_by,
        project_name,
        project_type,
        location,
        description,
        has_plans,
        legal_documentation_status,
        legal_document_types,
        has_multiple_owners,
        project_size,
        development_mode,
        land_status,
        investment_range,
        capital_availability,
        expected_start_time,
        decision_maker,
        quality_expectation,
        prior_design_experience,
        status,
        formatted_address,
        submission_id,
        compatibility_score,
        compatibility_level,
        compatibility_reason_codes,
        compatibility_scoring_version
      ) values (
        $1, $2, $3, 'commercial', 'El Hatillo, Caracas',
        'Diseño de una cafetería con terraza, vista panorámica y espacios flexibles.',
        false, 'in_process', ARRAY[]::text[], false,
        'medium_80_200', 'full', 'available', '50k_150k',
        'within_3_months', '3_6_months', 'self', 'premium', 'positive',
        'pending_verification', 'El Hatillo, Caracas, Venezuela', $4::uuid,
        78, 'high', '[]'::jsonb, '2.2'
      )
      returning id, project_name, status, requested_by, client_id
    `,
    [clientId, userId, DEMO_REQUEST_NAME, DEMO_SUBMISSION_ID],
  );

  return { action: "inserted", projectRequest: inserted.rows[0] };
}

// Protección del seed (auditoría): crea una cuenta de cliente activa, así que no debe ejecutarse por
// accidente contra la base que carga dotenv (en este proyecto, la de staging). Exige confirmar la base
// destino, igual que load-official-service-catalog.mjs, y no publica la contraseña en el repositorio.
const target = databaseTarget();
const confirmIndex = process.argv.indexOf("--confirm-target");
const confirmedTarget = confirmIndex >= 0 ? process.argv[confirmIndex + 1] : undefined;
if (confirmedTarget !== target) {
  console.error(`Este seed crea una cuenta de cliente activa. Para ejecutarlo contra ${target} usa:\n  DEMO_REQUESTER_PASSWORD=<contraseña> node scripts/seed-project-request-workflow-example.mjs --confirm-target ${target}`);
  await pool.end();
  process.exit(1);
}
if (!DEMO_REQUESTER_PASSWORD || DEMO_REQUESTER_PASSWORD.length < 12) {
  console.error("Define DEMO_REQUESTER_PASSWORD (12 caracteres o más) para la cuenta de demostración.");
  await pool.end();
  process.exit(1);
}

try {
  const requester = await findDemoRequester();
  const result = await ensureDemoRequest(requester);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}

/**
 * Identifica la base destino como `base@host[:puerto]`, sin credenciales, para confirmarla.
 *
 * @returns {string} Base y servidor de DATABASE_URL.
 */
function databaseTarget() {
  const url = new URL(process.env.DATABASE_URL);
  return `${url.pathname.replace(/^\//, "")}@${databaseHost()}`;
}
