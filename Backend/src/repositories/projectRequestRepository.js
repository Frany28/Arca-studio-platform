import { query } from "../config/db.js";
import { pageResult } from "../utils/pagination.js";

const SELECT_FIELDS = `
  id,
  client_id,
  requested_by,
  project_name,
  project_type,
  stand_requirements,
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
  reference_link,
  status,
  created_at,
  updated_at,
  location_latitude,
  location_longitude,
  provider_place_id,
  formatted_address,
  submission_id,
  compatibility_score,
  compatibility_level,
  compatibility_reason_codes,
  compatibility_scoring_version,
  reviewed_by,
  reviewed_at,
  rejection_reason,
  correction_reason,
  converted_project_id
`;

/**
 * Transforma el valor de proyecto solicitud registro a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} row - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function toProjectRequestRecord(row) {
  return {
    capitalAvailability: row.capital_availability,
    clientId: Number(row.client_id),
    compatibility:
      row.compatibility_score === null || row.compatibility_score === undefined
        ? null
        : {
            level: row.compatibility_level,
            reasonCodes: Array.isArray(row.compatibility_reason_codes)
              ? row.compatibility_reason_codes
              : [],
            score: Number(row.compatibility_score),
            version: row.compatibility_scoring_version,
          },
    createdAt: row.created_at,
    decisionMaker: row.decision_maker,
    description: row.description,
    developmentMode: row.development_mode,
    experience: row.prior_design_experience,
    formattedAddress: row.formatted_address,
    hasPlans: row.has_plans,
    legalDocumentationStatus: row.legal_documentation_status,
    legalDocumentTypes: Array.isArray(row.legal_document_types)
      ? row.legal_document_types
      : [],
    hasMultipleOwners: row.has_multiple_owners,
    id: Number(row.id),
    investmentRange: row.investment_range,
    landStatus: row.land_status,
    location: row.location,
    locationCoordinates:
      row.location_latitude !== null &&
      row.location_latitude !== undefined &&
      row.location_longitude !== null &&
      row.location_longitude !== undefined
        ? {
            latitude: Number(row.location_latitude),
            longitude: Number(row.location_longitude),
          }
        : null,
    projectName: row.project_name,
    projectSize: row.project_size,
    projectType: row.project_type,
    standRequirements: row.stand_requirements ?? null,
    providerPlaceId: row.provider_place_id,
    quality: row.quality_expectation,
    referenceLink: row.reference_link,
    correctionReason: row.correction_reason || null,
    convertedProjectId: row.converted_project_id == null
      ? null
      : Number(row.converted_project_id),
    rejectionReason: row.rejection_reason || null,
    reviewedAt: row.reviewed_at || null,
    requestedBy: Number(row.requested_by),
    startTime: row.expected_start_time,
    status: row.status,
    submissionId: row.submission_id,
    updatedAt: row.updated_at,
  };
}

/**
 * Lista el valor de proyecto solicitudes for usuario respetando el alcance y la paginación solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.cursor - Valor de `options.cursor` requerido por esta operación.
 * @param {number} options.limit - Valor de `options.limit` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function listProjectRequestsForUser(user, { cursor, limit }) {
  const params = [user.clientId, user.id];
  let cursorCondition = "";

  if (cursor) {
    params.push(cursor[0], cursor[1]);
    cursorCondition = "and (created_at, id) < ($3::timestamptz, $4::bigint)";
  }

  params.push(limit + 1);
  const result = await query(
    `
      select ${SELECT_FIELDS}
      from public.project_requests
      where client_id = $1
        and requested_by = $2
        and deleted_at is null
        and status <> 'draft'
        ${cursorCondition}
      order by created_at desc, id desc
      limit $${params.length}
    `,
    params,
  );

  return pageResult(
    result.rows,
    limit,
    toProjectRequestRecord,
    (row) => [row.created_at, Number(row.id)],
  );
}

/**
 * Busca un nombre de proyecto ya usado por el cliente y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} clientId - Valor de `clientId` requerido por esta operación.
 * @param {string} projectName - Valor de `projectName` requerido por esta operación.
 * @param {object} [options] - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} [options.excludeProjectRequestId] - Valor de `options.excludeProjectRequestId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findExistingProjectNameForClient(
  clientId,
  projectName,
  { excludeProjectRequestId = null } = {},
) {
  const result = await query(
    `
      select source, id, name, status
      from (
        select 'project' as source, p.id, p.name, p.status::text as status
        from public.projects p
        where p.client_id = $1
          and p.deleted_at is null
          and p.status <> 'cancelled'
          and lower(p.name) = lower($2)

        union all

        select 'project_request', pr.id, pr.project_name, pr.status::text
        from public.project_requests pr
        where pr.client_id = $1
          and pr.deleted_at is null
          and pr.status in ('pending_verification', 'pending_review', 'approved')
          and lower(pr.project_name) = lower($2)
          and ($3::bigint is null or pr.id <> $3::bigint)
      ) existing_names
      limit 1
    `,
    [clientId, String(projectName).trim(), excludeProjectRequestId],
  );

  return result.rows[0] || null;
}

/**
 * Busca el valor de proyecto solicitud by submission id y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} submissionId - Valor de `submissionId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findProjectRequestBySubmissionId(submissionId, user) {
  const result = await query(
    `
      select ${SELECT_FIELDS}
      from public.project_requests
      where client_id = $1
        and requested_by = $2
        and submission_id = $3::uuid
        and deleted_at is null
      limit 1
    `,
    [user.clientId, user.id, submissionId],
  );
  return result.rows[0] ? toProjectRequestRecord(result.rows[0]) : null;
}

/**
 * Busca el valor de proyecto solicitud owned by usuario y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectRequestId - Valor de `projectRequestId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findProjectRequestOwnedByUser(projectRequestId, user) {
  const result = await query(
    `
      select ${SELECT_FIELDS}
      from public.project_requests
      where id = $1
        and client_id = $2
        and requested_by = $3
        and deleted_at is null
      limit 1
    `,
    [projectRequestId, user.clientId, user.id],
  );
  return result.rows[0] ? toProjectRequestRecord(result.rows[0]) : null;
}

/**
 * Crea en PostgreSQL un borrador con las respuestas validadas del proyecto y del evento.
 * Guarda requisitos del stand como JSON opcional, sin completar solicitudes de otros tipos.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function createProjectRequestDraft(user, payload) {
  const result = await query(
    `
      insert into public.project_requests (
        client_id, requested_by, project_name, project_type, location,
        description, has_plans, project_size, development_mode, land_status,
        investment_range, capital_availability, expected_start_time,
        decision_maker, quality_expectation, prior_design_experience,
        reference_link, status, location_latitude, location_longitude,
        provider_place_id, formatted_address,
        legal_documentation_status, legal_document_types, has_multiple_owners,
        stand_requirements, submission_id
      )
      values (
        $1, $2, $3, $4::project_type, $5,
        $6, $7, $8::project_request_size, $9::project_development_mode,
        $10::project_land_status, $11::project_investment_range,
        $12::project_capital_availability, $13::project_start_time,
        $14::project_decision_maker, $15::project_quality_expectation,
        $16::project_design_experience, $17, 'draft', $18, $19, $20, $21,
        $22::project_legal_documentation_status, $23::text[], $24, $25::jsonb, $26::uuid
      )
      on conflict (client_id, requested_by, submission_id)
        where submission_id is not null and deleted_at is null
      do nothing
      returning ${SELECT_FIELDS}
    `,
    [...projectRequestParams(user, payload), payload.submissionId],
  );

  if (result.rows[0]) return toProjectRequestRecord(result.rows[0]);
  return findProjectRequestBySubmissionId(payload.submissionId, user);
}

/**
 * Actualiza en PostgreSQL un borrador o solicitud devuelta, conservando sus permisos.
 * Reemplaza los requisitos del evento; al cambiar de tipo, el contrato los limpia a null.
 *
 * @param {string} projectRequestId - Valor de `projectRequestId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function updateProjectRequestDraft(projectRequestId, user, payload) {
  const params = projectRequestParams(user, payload);
  const result = await query(
    `
      update public.project_requests
      set
        project_name = $3,
        project_type = $4::project_type,
        location = $5,
        description = $6,
        has_plans = $7,
        project_size = $8::project_request_size,
        development_mode = $9::project_development_mode,
        land_status = $10::project_land_status,
        investment_range = $11::project_investment_range,
        capital_availability = $12::project_capital_availability,
        expected_start_time = $13::project_start_time,
        decision_maker = $14::project_decision_maker,
        quality_expectation = $15::project_quality_expectation,
        prior_design_experience = $16::project_design_experience,
        reference_link = $17,
        location_latitude = $18,
        location_longitude = $19,
        provider_place_id = $20,
        formatted_address = $21,
        legal_documentation_status = $22::project_legal_documentation_status,
        legal_document_types = $23::text[],
        has_multiple_owners = $24,
        stand_requirements = $25::jsonb,
        updated_at = now()
      where id = $26
        and client_id = $1
        and requested_by = $2
        and deleted_at is null
        and status in ('draft', 'changes_requested')
      returning ${SELECT_FIELDS}
    `,
    [...params, projectRequestId],
  );
  return result.rows[0] ? toProjectRequestRecord(result.rows[0]) : null;
}

/**
 * Envía el valor de proyecto solicitud for usuario después de validar el estado y las reglas aplicables.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectRequestId - Valor de `projectRequestId` requerido por esta operación.
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} evaluation - Valor de `evaluation` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function submitProjectRequestForUser(projectRequestId, user, evaluation) {
  const result = await query(
    `
      with target as (
        select id as target_id, status as old_status
        from public.project_requests
        where id = $1
          and client_id = $2
          and requested_by = $3
          and deleted_at is null
          and status in ('draft', 'changes_requested')
        for update
      ),
      updated as (
        update public.project_requests request
        set
          status = 'pending_verification',
          compatibility_score = $4,
          compatibility_level = $5::project_compatibility_level,
          compatibility_reason_codes = $6::jsonb,
          compatibility_scoring_version = $7,
          updated_at = now()
        from target
        where request.id = target.target_id
        returning ${SELECT_FIELDS}
      ),
      audited as (
        insert into public.audit_logs (
          user_id, action, entity_type, entity_id, description, old_values, new_values
        )
        select
          $3,
          'project_request.submit',
          'project_request',
          target.target_id,
          'Solicitud enviada para verificacion',
          jsonb_build_object('status', target.old_status),
          jsonb_build_object('status', 'pending_verification')
        from target
        inner join updated on updated.id = target.target_id
        returning id
      )
      select * from updated
    `,
    [
      projectRequestId,
      user.clientId,
      user.id,
      evaluation.score,
      evaluation.level,
      JSON.stringify(evaluation.reasonCodes),
      evaluation.version,
    ],
  );
  if (result.rows[0]) return toProjectRequestRecord(result.rows[0]);
  return findProjectRequestOwnedByUser(projectRequestId, user);
}

/**
 * Ordena los parámetros compartidos por la creación y actualización de solicitudes.
 * Serializa el bloque informativo del stand; submissionId se añade solo al crear el borrador.
 *
 * @param {unknown} user - Usuario autenticado que ejecuta la operación.
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @returns {Array<unknown>} Resultado producido por la operación.
 */
function projectRequestParams(user, payload) {
  return [
    user.clientId,
    user.id,
    payload.projectName,
    payload.projectType,
    payload.projectLocation,
    payload.description,
    payload.hasBlueprints,
    payload.projectSize,
    payload.developmentMode,
    payload.landStatus,
    payload.investmentRange,
    payload.capitalAvailability,
    payload.startTime,
    payload.decisionMaker,
    payload.quality,
    payload.experience,
    payload.referenceLink,
    payload.projectLocationLatitude,
    payload.projectLocationLongitude,
    payload.projectLocationProviderPlaceId,
    payload.projectLocationFormattedAddress,
    payload.legalDocumentationStatus,
    payload.legalDocumentTypes,
    payload.hasMultipleOwners,
    payload.standRequirements == null ? null : JSON.stringify(payload.standRequirements),
  ];
}
