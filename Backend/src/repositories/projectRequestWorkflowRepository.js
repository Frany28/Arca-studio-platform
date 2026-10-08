import { pool, query } from "../config/db.js";
import { pageResult } from "../utils/pagination.js";

/**
 * Transforma el valor de person a la representación pública esperada.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function toPerson(value) {
  return value && value.id
    ? {
        hasProfilePhoto: Boolean(value.hasProfilePhoto),
        id: Number(value.id),
        name: value.name || "Usuario",
        roleCode: value.roleCode || null,
      }
    : null;
}

/**
 * Extrae las respuestas del formulario necesarias para las métricas derivadas de la solicitud.
 * Usa los nombres de campo del registro para reutilizar el dominio, incluido el bloque del stand
 * (cuenta en completitud); el servicio las transforma en métricas y no se exponen en bruto.
 *
 * @param {object} row - Fila obtenida desde PostgreSQL.
 * @returns {object} Respuestas de la solicitud con nombres de dominio.
 */
function toWorkflowAnswers(row) {
  return {
    capitalAvailability: row.capital_availability,
    decisionMaker: row.decision_maker,
    description: row.description,
    developmentMode: row.development_mode,
    experience: row.prior_design_experience,
    hasMultipleOwners: row.has_multiple_owners,
    hasPlans: row.has_plans,
    investmentRange: row.investment_range,
    landStatus: row.land_status,
    legalDocumentationStatus: row.legal_documentation_status,
    legalDocumentTypes: Array.isArray(row.legal_document_types) ? row.legal_document_types : [],
    location: row.location,
    projectName: row.project_name,
    projectSize: row.project_size,
    projectType: row.project_type,
    quality: row.quality_expectation,
    standRequirements: row.stand_requirements ?? null,
    startTime: row.expected_start_time,
  };
}

/**
 * Mapea la cola técnica, separando workflow, reunión y requisitos informativos del evento.
 * Conserva las identidades de cliente y solicitante y normaliza bloques ausentes a null.
 * `answers` permanece interno para el cálculo de métricas en el servicio.
 *
 * @param {unknown} row - Fila obtenida desde PostgreSQL.
 * @returns {object} Resultado producido por la operación.
 */
function toWorkflowRequest(row) {
  return {
    answers: toWorkflowAnswers(row),
    assignees: Array.isArray(row.assignees)
      ? row.assignees.map(toPerson).filter(Boolean)
      : [],
    clientId: Number(row.client_id),
    compatibility: row.compatibility_score == null
      ? null
      : {
          level: row.compatibility_level,
          score: Number(row.compatibility_score),
        },
    correctionReason: row.correction_reason || null,
    createdAt: row.created_at,
    description: row.description || "",
    files: Array.isArray(row.files)
      ? row.files.map((file) => ({
          fileType: file.fileType || null,
          id: Number(file.id),
          name: file.name || "Archivo",
        }))
      : [],
    id: Number(row.id),
    location: row.location,
    projectName: row.project_name,
    projectType: row.project_type,
    requestedBy: row.requested_by == null ? null : Number(row.requested_by),
    standRequirements: row.stand_requirements ?? null,
    rejectionReason: row.rejection_reason || null,
    reviews: Array.isArray(row.reviews)
      ? row.reviews.map((review) => ({
          meetingRecommendation: review.meetingRecommendation ?? null,
          note: review.note,
          recommendation: review.recommendation,
          reviewer: toPerson(review.reviewer),
          updatedAt: review.updatedAt,
        }))
      : [],
    status: row.status,
    updatedAt: row.updated_at,
  };
}

/**
 * Busca el valor de proyecto solicitud flujo state y devuelve null cuando no existe un registro accesible.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {string} projectRequestId - Valor de `projectRequestId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function findProjectRequestWorkflowState(projectRequestId) {
  const result = await query(
    `
      select id, status
      from public.project_requests
      where id = $1 and deleted_at is null
      limit 1
    `,
    [projectRequestId],
  );
  return result.rows[0] || null;
}

/**
 * Lista la cola de revisión de solicitudes respetando el alcance y la paginación solicitados.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.cursor - Valor de `options.cursor` requerido por esta operación.
 * @param {number} options.limit - Valor de `options.limit` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 */
export async function listProjectRequestReviewQueue({ cursor, limit, user }) {
  const isAdmin = user.role?.code === "admin";
  const params = [user.id, isAdmin];
  let cursorCondition = "";

  if (cursor) {
    params.push(cursor[0], cursor[1]);
    cursorCondition = "and (request.updated_at, request.id) < ($3::timestamptz, $4::bigint)";
  }

  params.push(limit + 1);
  const result = await query(
    `
      select
        request.id,
        request.client_id,
        request.requested_by,
        request.project_name,
        request.project_type,
        request.stand_requirements,
        request.location,
        request.description,
        request.status,
        request.compatibility_score,
        request.compatibility_level,
        request.project_size,
        request.development_mode,
        request.land_status,
        request.legal_documentation_status,
        request.legal_document_types,
        request.has_multiple_owners,
        request.has_plans,
        request.investment_range,
        request.capital_availability,
        request.expected_start_time,
        request.decision_maker,
        request.quality_expectation,
        request.prior_design_experience,
        request.correction_reason,
        request.rejection_reason,
        request.created_at,
        request.updated_at,
        coalesce(assignment.assignees, '[]'::json) as assignees,
        coalesce(review.reviews, '[]'::json) as reviews,
        coalesce(attachment.files, '[]'::json) as files
      from public.project_requests request
      left join lateral (
        select json_agg(
          json_build_object(
            'id', employee.id,
            'name', concat_ws(' ', employee.first_name, employee.last_name),
            'hasProfilePhoto', employee.profile_photo_url is not null,
            'roleCode', role.code
          ) order by employee.first_name, employee.last_name, employee.id
        ) as assignees
        from public.project_request_assignees request_assignment
        inner join public.users employee on employee.id = request_assignment.user_id
        inner join public.roles role on role.id = employee.role_id
        where request_assignment.project_request_id = request.id
          and employee.deleted_at is null
      ) assignment on true
      left join lateral (
        select json_agg(
          json_build_object(
            'note', request_review.note,
            'meetingRecommendation', request_review.meeting_recommendation,
            'recommendation', request_review.recommendation,
            'updatedAt', request_review.updated_at,
            'reviewer', json_build_object(
              'id', reviewer.id,
              'name', concat_ws(' ', reviewer.first_name, reviewer.last_name),
              'hasProfilePhoto', reviewer.profile_photo_url is not null,
              'roleCode', reviewer_role.code
            )
          ) order by request_review.updated_at desc
        ) as reviews
        from public.project_request_reviews request_review
        inner join public.users reviewer on reviewer.id = request_review.reviewer_id
        inner join public.roles reviewer_role on reviewer_role.id = reviewer.role_id
        where request_review.project_request_id = request.id
      ) review on true
      left join lateral (
        select json_agg(
          json_build_object(
            'id', file.id,
            'name', coalesce(version.original_name, file.title),
            'fileType', file.file_type
          ) order by file.created_at, file.id
        ) as files
        from public.files file
        left join public.file_versions version
          on version.file_id = file.id
          and version.version_number = file.current_version
          and version.deleted_at is null
        where file.project_request_id = request.id
          and file.deleted_at is null
          and file.status <> 'deleted'
      ) attachment on true
      where request.deleted_at is null
        and request.status in ('pending_verification', 'pending_review')
        and (
          $2::boolean
          or (
            request.status = 'pending_review'
            and exists (
              select 1
              from public.project_request_assignees own_assignment
              where own_assignment.project_request_id = request.id
                and own_assignment.user_id = $1
            )
          )
        )
        ${cursorCondition}
      order by request.updated_at desc, request.id desc
      limit $${params.length}
    `,
    params,
  );

  return pageResult(
    result.rows,
    limit,
    toWorkflowRequest,
    (row) => [row.updated_at, Number(row.id)],
  );
}

/**
 * Guarda atómicamente la revisión y su decisión de reunión, bloqueando la solicitud en PostgreSQL.
 * Mantiene la reunión al omitirla; null explícito la elimina sin alterar la valoración de workflow.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string|null} [options.meetingRecommendation] - Decisión de reunión; undefined conserva el valor previo.
 * @param {unknown} options.note - Valor de `options.note` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.recommendation - Valor de `options.recommendation` requerido por esta operación.
 * @param {string} options.reviewerId - Valor de `options.reviewerId` requerido por esta operación.
 * @param {string} options.reviewerRole - Valor de `options.reviewerRole` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function upsertProjectRequestReview({
  meetingRecommendation,
  note,
  projectRequestId,
  recommendation,
  reviewerId,
  reviewerRole,
}) {
  const result = await query(
    `
      with target as (
        select request.id, request.status
        from public.project_requests request
        where request.id = $1 and request.deleted_at is null
        for update
      ),
      access as (
        select exists (
          select 1
          from target
          where $5 = 'admin'
            or exists (
              select 1
              from public.project_request_assignees assignment
              where assignment.project_request_id = target.id
                and assignment.user_id = $2
            )
        ) as allowed
      ),
      saved as (
        insert into public.project_request_reviews (
          project_request_id, reviewer_id, recommendation, note, meeting_recommendation
        )
        select target.id, $2, $3::public.project_request_review_recommendation, $4,
          $6::public.project_request_meeting_recommendation
        from target
        where target.status = 'pending_review'
          and (select allowed from access)
        on conflict (project_request_id, reviewer_id) do update
          set recommendation = excluded.recommendation,
              meeting_recommendation = case when $7::boolean
                then excluded.meeting_recommendation
                else project_request_reviews.meeting_recommendation end,
              note = excluded.note,
              updated_at = now()
        returning id, recommendation, note, meeting_recommendation, updated_at
      )
      select
        exists(select 1 from target) as target_exists,
        coalesce((select status::text from target), '') as status,
        (select allowed from access) as allowed,
        (select row_to_json(saved) from saved) as review
    `,
    [projectRequestId, reviewerId, recommendation, note, reviewerRole,
      meetingRecommendation ?? null, meetingRecommendation !== undefined],
  );

  const row = result.rows[0] || {};
  return {
    allowed: Boolean(row.allowed),
    review: row.review
      ? {
          id: Number(row.review.id),
          meetingRecommendation: row.review.meeting_recommendation ?? null,
          note: row.review.note,
          recommendation: row.review.recommendation,
          updatedAt: row.review.updated_at,
        }
      : null,
    status: row.status || null,
    targetExists: Boolean(row.target_exists),
  };
}

/**
 * Procesa el valor de decide proyecto solicitud para completar la responsabilidad asignada al módulo.
 * Consulta o modifica PostgreSQL mediante parámetros y devuelve una representación estable.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.action - Valor de `options.action` requerido por esta operación.
 * @param {unknown} options.internalNotes - Valor de `options.internalNotes` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.reason - Valor de `options.reason` requerido por esta operación.
 * @param {unknown} options.reviewedBy - Valor de `options.reviewedBy` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function decideProjectRequest({
  action,
  internalNotes,
  projectRequestId,
  reason,
  reviewedBy,
}) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const requestResult = await client.query(
      `
        select *
        from public.project_requests
        where id = $1 and deleted_at is null
        for update
      `,
      [projectRequestId],
    );
    const request = requestResult.rows[0];

    if (!request) {
      await client.query("rollback");
      return { outcome: "not_found" };
    }
    if (request.status !== "pending_review") {
      await client.query("rollback");
      return { outcome: "invalid_state", status: request.status };
    }

    const reviewerResult = await client.query(
      `
        select count(*)::integer as review_count
        from public.project_request_reviews review
        inner join public.project_request_assignees active_assignment
          on active_assignment.project_request_id = review.project_request_id
          and active_assignment.user_id = review.reviewer_id
        inner join public.users reviewer on reviewer.id = review.reviewer_id
        inner join public.roles role on role.id = reviewer.role_id
        where review.project_request_id = $1
          and role.code = 'architect'
      `,
      [projectRequestId],
    );
    if (Number(reviewerResult.rows[0]?.review_count || 0) < 1) {
      await client.query("rollback");
      return { outcome: "review_required" };
    }

    let project = null;
    let nextStatus;
    if (action === "request_changes") {
      nextStatus = "changes_requested";
    } else if (action === "reject") {
      nextStatus = "rejected";
    } else {
      const architectResult = await client.query(
        `
          select assignment.user_id
          from public.project_request_assignees assignment
          inner join public.users employee on employee.id = assignment.user_id
          inner join public.roles role on role.id = employee.role_id
          where assignment.project_request_id = $1
            and role.code = 'architect'
          order by assignment.created_at, assignment.user_id
          limit 1
        `,
        [projectRequestId],
      );
      const assignedArchitectId = architectResult.rows[0]?.user_id || null;
      const projectResult = await client.query(
        `
          insert into public.projects (
            client_id, created_by, assigned_architect_id, name, description,
            status, start_date, progress, project_type, location, has_plans,
            is_public, location_latitude, location_longitude, provider_place_id,
            formatted_address, public_slug
          ) values (
            $1, $2, $3, $4, $5,
            'pending', current_date, 0, $6, $7, coalesce($8, false),
            false, $9, $10, $11, $12, $13
          )
          returning id, name, status
        `,
        [
          request.client_id,
          reviewedBy,
          assignedArchitectId,
          request.project_name,
          request.description,
          request.project_type,
          request.location,
          request.has_plans,
          request.location_latitude,
          request.location_longitude,
          request.provider_place_id,
          request.formatted_address,
          `solicitud-${request.id}`,
        ],
      );
      project = projectResult.rows[0];
      await client.query(
        `
          insert into public.project_assignees (project_id, user_id, assigned_by)
          select $1, assignment.user_id, $2
          from public.project_request_assignees assignment
          where assignment.project_request_id = $3
          on conflict (project_id, user_id) do nothing
        `,
        [project.id, reviewedBy, projectRequestId],
      );
      await client.query(
        `
          update public.files
          set project_id = $1, updated_at = now()
          where project_request_id = $2
            and deleted_at is null
            and status <> 'deleted'
        `,
        [project.id, projectRequestId],
      );
      nextStatus = "converted";
    }

    const updatedResult = await client.query(
      `
        update public.project_requests
        set status = $2::public.project_request_status,
            reviewed_by = $3,
            reviewed_at = now(),
            rejection_reason = case when $2 = 'rejected' then $4 else null end,
            correction_reason = case when $2 = 'changes_requested' then $4 else correction_reason end,
            internal_review_notes = $5,
            converted_project_id = $6,
            updated_at = now()
        where id = $1
        returning id, status, reviewed_at, rejection_reason, correction_reason,
          converted_project_id
      `,
      [projectRequestId, nextStatus, reviewedBy, reason, internalNotes, project?.id || null],
    );

    await client.query(
      `
        insert into public.audit_logs (
          user_id, action, entity_type, entity_id, description, old_values, new_values
        ) values ($1, $2, 'project_request', $3, $4, $5::jsonb, $6::jsonb)
      `,
      [
        reviewedBy,
        `project_request.${action}`,
        projectRequestId,
        `Decision administrativa sobre solicitud: ${action}`,
        JSON.stringify({ status: request.status }),
        JSON.stringify({
          convertedProjectId: project ? Number(project.id) : null,
          status: nextStatus,
        }),
      ],
    );

    const updated = updatedResult.rows[0];

    const notificationTitle = nextStatus === "converted"
      ? "Solicitud aprobada"
      : nextStatus === "rejected"
        ? "Solicitud rechazada"
        : "Correcciones solicitadas";
    const notificationMessage = nextStatus === "converted"
      ? `Tu solicitud para ${request.project_name} fue aprobada y ya tiene un proyecto.`
      : reason;
    await client.query(
      `
        insert into public.notifications (
          user_id, project_id, created_by, title, message, type, entity_type, entity_id
        ) values ($1, $2, $3, $4, $5, $6, 'project_request', $7)
      `,
      [
        request.requested_by,
        project?.id || null,
        reviewedBy,
        notificationTitle,
        notificationMessage,
        `project_request.${nextStatus}`,
        projectRequestId,
      ],
    );

    await client.query("commit");

    return {
      outcome: "updated",
      project: project
        ? { id: Number(project.id), name: project.name, status: project.status }
        : null,
      projectRequest: {
        correctionReason: updated.correction_reason || null,
        convertedProjectId: updated.converted_project_id == null
          ? null
          : Number(updated.converted_project_id),
        id: Number(updated.id),
        rejectionReason: updated.rejection_reason || null,
        reviewedAt: updated.reviewed_at,
        status: updated.status,
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
