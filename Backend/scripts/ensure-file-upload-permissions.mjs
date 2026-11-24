import "dotenv/config";

import { parseArgs } from "node:util";

import { pool, query } from "../src/config/db.js";

// Crea los permisos de archivos y soporte y los asigna a admin, arquitecto y cliente.
//   node scripts/ensure-file-upload-permissions.mjs                       → todos (comportamiento anterior)
//   node scripts/ensure-file-upload-permissions.mjs --permission <código>  → solo los códigos indicados
//   --dry-run                                                             → plan exacto, sin escribir
// El acceso por proyecto no depende de estos permisos: lo aplica cada servicio (p. ej. la subida
// solo admite proyectos propios o asignados; findProjectForFileUpload).
const { values: options } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, permission: { multiple: true, type: "string" } },
  strict: true,
});

const PERMISSIONS = [
  {
    code: "projects.files.upload",
    description: "Permite subir archivos a proyectos accesibles",
    module: "projects",
    name: "Subir archivos de proyecto",
  },
  {
    code: "projects.files.delete",
    description: "Permite eliminar archivos propios en proyectos accesibles",
    module: "projects",
    name: "Eliminar archivos de proyecto",
  },
  {
    code: "support.requests.create",
    description: "Permite crear solicitudes de soporte",
    module: "support",
    name: "Crear solicitudes de soporte",
  },
  {
    code: "support.files.upload",
    description: "Permite adjuntar archivos a solicitudes de soporte",
    module: "support",
    name: "Subir archivos de soporte",
  },
];

const ROLE_CODES = ["admin", "architect", "client"];

async function upsertPermission(permission) {
  const result = await query(
    `
      insert into public.permissions (
        code,
        name,
        description,
        module,
        is_active
      )
      values ($1, $2, $3, $4, true)
      on conflict (code) do update
      set
        name = excluded.name,
        description = excluded.description,
        module = excluded.module,
        is_active = true,
        updated_at = now()
      returning id, code
    `,
    [
      permission.code,
      permission.name,
      permission.description,
      permission.module,
    ],
  );

  return result.rows[0];
}

async function assignPermissionToRoles(permissionId) {
  await query(
    `
      insert into public.role_permissions (role_id, permission_id, is_active)
      select r.id, $1, true
      from public.roles r
      where r.code = any($2::text[])
        and r.is_active = true
        and not exists (
          select 1
          from public.role_permissions rp
          where rp.role_id = r.id
            and rp.permission_id = $1
        )
    `,
    [permissionId, ROLE_CODES],
  );

  await query(
    `
      update public.role_permissions rp
      set is_active = true
      from public.roles r
      where r.id = rp.role_id
        and r.code = any($2::text[])
        and rp.permission_id = $1
    `,
    [permissionId, ROLE_CODES],
  );
}

/**
 * Describe sin escribir lo que haría el script con cada permiso elegido: si crea o actualiza el
 * permiso y qué asignaciones de rol inserta o reactiva.
 *
 * @param {Array<object>} selected - Permisos elegidos.
 * @returns {Promise<Array<object>>} Plan.
 */
async function describePlan(selected) {
  const plan = [];
  for (const permission of selected) {
    const existing = (await query("select id, is_active from public.permissions where code = $1", [permission.code])).rows[0] ?? null;
    const roles = (await query(
      `select r.code, rp.is_active as assignment_active
       from public.roles r
       left join public.role_permissions rp on rp.role_id = r.id and rp.permission_id = $1
       where r.code = any($2::text[]) and r.is_active = true
       order by r.id`,
      [existing?.id ?? null, ROLE_CODES],
    )).rows;
    plan.push({
      code: permission.code,
      permission: existing ? (existing.is_active ? "update_metadata" : "reactivate") : "insert",
      roleAssignments: roles.map((role) => ({
        action: role.assignment_active === null ? "insert" : role.assignment_active ? "none" : "reactivate",
        role: role.code,
      })),
    });
  }
  return plan;
}

async function main() {
  const permissions = [];
  const requested = options.permission ?? PERMISSIONS.map((permission) => permission.code);
  const unknown = requested.filter((code) => !PERMISSIONS.some((permission) => permission.code === code));
  if (unknown.length) throw new Error(`Permisos desconocidos: ${unknown.join(", ")}`);
  const selected = PERMISSIONS.filter((permission) => requested.includes(permission.code));

  if (options["dry-run"]) {
    console.log(JSON.stringify({ dryRun: true, plan: await describePlan(selected), roles: ROLE_CODES }, null, 2));
    return;
  }

  for (const permissionDefinition of selected) {
    const permission = await upsertPermission(permissionDefinition);
    await assignPermissionToRoles(permission.id);
    permissions.push(permission);
  }

  console.log(
    JSON.stringify(
      {
        permissions,
        roles: ROLE_CODES,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await pool.end();
}
