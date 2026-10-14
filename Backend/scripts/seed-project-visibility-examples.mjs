import "dotenv/config";

import { pool, query } from "../src/config/db.js";
import { PROJECT_STATUS } from "../src/domain/projectStatus.js";
import { slugifyProjectName } from "../src/utils/projectSlug.js";

const examples = [
  {
    assignedArchitectId: null,
    budget: 22000,
    clientId: null,
    constructionArea: 95,
    description: "Proyecto publico de ejemplo para validar visibilidad general.",
    generalArea: 120,
    isPublic: true,
    location: "Caracas, Distrito Capital",
    name: "Casa Publica Arca",
  },
  {
    assignedArchitectId: null,
    budget: 47500,
    clientId: null,
    constructionArea: 168,
    description:
      "Pabellon contemporaneo para eventos y exhibiciones, con espacios modulares y jardines integrados.",
    generalArea: 240,
    isPublic: true,
    location: "Valencia, Carabobo",
    name: "Pabellon Aurora",
  },
  {
    assignedArchitectId: null,
    budget: 32800,
    clientId: null,
    constructionArea: 126,
    description:
      "Remodelacion de una terraza gastronomica con cubierta ligera, vegetacion tropical y areas sociales.",
    generalArea: 185,
    isPublic: true,
    location: "Lecheria, Anzoategui",
    name: "Terraza Origen",
  },
  {
    assignedArchitectId: 2,
    budget: 18500,
    clientId: 1,
    constructionArea: 82,
    description: "Proyecto privado de ejemplo visible solo por admin, cliente y arquitecto encargado.",
    generalArea: 110,
    isPublic: false,
    location: "San Cristobal, Tachira",
    name: "Loft Privado Arca",
  },
  {
    assignedArchitectId: 2,
    budget: 36500,
    clientId: 1,
    constructionArea: 138,
    description:
      "Proyecto finalizado de demostracion para validar el cierre operativo, la consulta historica y la publicacion.",
    endDate: "2026-07-31",
    generalArea: 190,
    isPublic: false,
    location: "Caracas, Distrito Capital",
    name: "Residencia Horizonte Finalizada",
    progress: 100,
    startDate: "2026-02-03",
    status: PROJECT_STATUS.FINISHED,
  },
];

async function ensureShowcaseClient() {
  const email = "showcase@arcastudio.com";
  const existing = await query(
    `
      select id
      from public.clients
      where lower(email) = lower($1)
        and deleted_at is null
      limit 1
    `,
    [email],
  );

  if (existing.rows[0]) {
    return Number(existing.rows[0].id);
  }

  const result = await query(
    `
      insert into public.clients (
        name,
        company_name,
        document_number,
        email,
        phone,
        address,
        city,
        country,
        status,
        notes
      )
      values (
        'Cliente Showcase',
        'ARCA Showcase',
        'SHOWCASE-001',
        $1,
        '+584120000099',
        'Direccion demo',
        'Caracas',
        'Venezuela',
        'active',
        'Cliente usado para proyectos publicos de demostracion'
      )
      returning id
    `,
    [email],
  );

  return Number(result.rows[0].id);
}

async function getAvailablePublicSlug(name, currentProjectId = null) {
  const baseSlug = slugifyProjectName(name);
  const result = await query(
    `
      select public_slug
      from public.projects
      where public_slug is not null
        and ($1::bigint is null or id <> $1)
        and (public_slug = $2 or public_slug like $3)
    `,
    [currentProjectId, baseSlug, `${baseSlug}-%`],
  );
  const usedSlugs = new Set(
    result.rows.map((row) => String(row.public_slug || "")),
  );
  let publicSlug = baseSlug;
  let suffix = 2;

  while (usedSlugs.has(publicSlug)) {
    publicSlug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return publicSlug;
}

async function upsertProject(example) {
  const existing = await query(
    `
      select id
      from public.projects
      where lower(name) = lower($1)
        and deleted_at is null
      limit 1
    `,
    [example.name],
  );

  const params = [
    example.clientId,
    1,
    example.assignedArchitectId,
    example.name,
    example.description,
    example.status || "in_process",
    example.startDate || "2026-06-13",
    example.endDate || "2026-09-30",
    example.budget,
    example.progress ?? 25,
    "residential",
    example.location,
    "Venezuela",
    true,
    example.generalArea,
    example.constructionArea,
    "mts",
    example.isPublic,
  ];

  if (existing.rows[0]) {
    const publicSlug = await getAvailablePublicSlug(
      example.name,
      existing.rows[0].id,
    );
    const result = await query(
      `
        update public.projects
        set
          client_id = $1,
          created_by = $2,
          assigned_architect_id = $3,
          name = $4,
          description = $5,
          status = $6,
          start_date = $7,
          end_date = $8,
          budget = $9,
          progress = $10,
          project_type = $11,
          location = $12,
          country = $13,
          has_plans = $14,
          general_area = $15,
          construction_area = $16,
          area_unit = $17,
          is_public = $18,
          public_slug = coalesce(public_slug, $19),
          updated_at = now()
        where id = $20
        returning id, name, status, progress, is_public, assigned_architect_id
      `,
      [...params, publicSlug, existing.rows[0].id],
    );

    return {
      action: "updated",
      project: result.rows[0],
    };
  }

  const publicSlug = await getAvailablePublicSlug(example.name);
  const result = await query(
    `
      insert into public.projects (
        client_id,
        created_by,
        assigned_architect_id,
        name,
        description,
        status,
        start_date,
        end_date,
        budget,
        progress,
        project_type,
        location,
        country,
        has_plans,
        general_area,
        construction_area,
        area_unit,
        is_public,
        public_slug
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      )
      returning id, name, status, progress, is_public, assigned_architect_id
    `,
    [...params, publicSlug],
  );

  return {
    action: "inserted",
    project: result.rows[0],
  };
}

try {
  const results = [];
  const showcaseClientId = await ensureShowcaseClient();

  examples.forEach((example) => {
    if (example.clientId === null) {
      example.clientId = showcaseClientId;
    }
  });

  for (const example of examples) {
    results.push(await upsertProject(example));
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await pool.end();
}
