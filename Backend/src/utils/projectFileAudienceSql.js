import { isProjectFileReviewEnabled } from "../config/projectFileReview.js";

/*
 * Política común de audiencias de archivos de proyecto en SQL (Fase 1.2, B5). Es la traducción de
 * domain/projectFileAccess.js para listados, detalle, galerías, documentos recientes y miniaturas:
 * elige, para cada archivo y usuario, la versión que puede ver. Se compone dentro del FROM y su
 * condición va en el WHERE, antes de LIMIT y del cursor, para que las páginas sean completas.
 *
 * - Archivo heredado (`access_policy` NULL): la versión vigente (`current_version`), como siempre.
 * - Política 1.2:
 *   - equipo (administrador; arquitecto asignado o responsable): la vigente aprobada;
 *   - cliente propietario: la versión con autorización activa del cliente o, si es su autor, la
 *     suya más reciente; las autorizaciones sustituidas o revocadas no dan acceso;
 *   - resto (escaparate): la versión con autorización activa del escaparate, solo en proyectos
 *     públicos finalizados y para imágenes y videos.
 *
 * Con la activación apagada devuelve exactamente la unión anterior (versión vigente) y no usa las
 * columnas ni tablas de la migración 20261118120000_project_file_review_audience_expand. Las
 * condiciones de acceso al proyecto y de drafts siguen siendo responsabilidad de cada consulta.
 * Los alias y los códigos son constantes del código; el usuario solo llega como parámetro.
 */

/**
 * Subconsulta de las versiones con autorización activa de una audiencia para un archivo.
 * La audiencia es una constante del código (`client_owner` o `showcase`), nunca una entrada.
 *
 * @param {string} fileAlias - Alias de public.files.
 * @param {"client_owner"|"showcase"} audience - Audiencia.
 * @returns {string} Subconsulta SQL entre paréntesis.
 */
export function activeGrantSql(fileAlias, audience) {
  return `(select audience_grant.file_version_id
    from public.project_file_audience_grants audience_grant
    where audience_grant.file_id = ${fileAlias}.id and audience_grant.audience = '${audience}' and audience_grant.ended_at is null)`;
}

/**
 * Subconsulta con el id de la versión de un adjunto de solicitud que se sirve por la ruta de la
 * solicitud (Fase 1.2, B5). Mientras pertenece a la solicitud, la vigente, como siempre. Tras pasar
 * al proyecto (`origin_project_request_id`), la versión que aportó el cliente: la más reciente
 * creada hasta la aprobación de la solicitud (`reviewed_at`), o la v1. Las versiones que el equipo
 * incorpore después nunca se sirven por esta ruta; se consultan por la del proyecto con su política.
 *
 * @param {string} fileAlias - Alias de public.files.
 * @returns {string} Subconsulta SQL entre paréntesis.
 */
export function requestAttachmentVersionIdSql(fileAlias) {
  const f = fileAlias;
  return `(select origin_version.id
    from public.file_versions origin_version
    where origin_version.file_id = ${f}.id
      and origin_version.deleted_at is null
      and case
        when ${f}.origin_project_request_id is null then origin_version.version_number = ${f}.current_version
        else origin_version.version_number = 1 or origin_version.created_at <= (
          select origin_request.reviewed_at from public.project_requests origin_request
          where origin_request.id = ${f}.origin_project_request_id)
      end
    order by origin_version.version_number desc
    limit 1)`;
}

/**
 * Construye la unión que expone, con el alias indicado, la versión visible de cada archivo para el
 * usuario, la condición que exige que exista y las expresiones de formato y número de versión.
 *
 * @param {object} options - Alias, usuario y primer parámetro libre.
 * @param {{ id: number, clientId?: number|null, role?: { code?: string } }} options.user - Usuario autenticado.
 * @param {number} options.firstParam - Número del primer parámetro posicional libre de la consulta.
 * @param {string} [options.fileAlias] - Alias de public.files.
 * @param {string} [options.projectAlias] - Alias de public.projects.
 * @param {string} [options.versionAlias] - Alias que tendrá la versión visible.
 * @param {boolean} [options.enabled] - Activación de la revisión (por defecto, la del entorno).
 * @returns {{ join: string, visibleCondition: string, requireVersion: string, fileTypeSql: string,
 *   versionNumberSql: string, params: unknown[] }} Fragmentos SQL y sus parámetros.
 */
export function buildVisibleFileVersionSql({
  enabled = isProjectFileReviewEnabled(),
  fileAlias = "file",
  firstParam,
  projectAlias = "p",
  user,
  versionAlias = "version",
}) {
  const f = fileAlias;
  const p = projectAlias;
  const v = versionAlias;
  if (!enabled) {
    return {
      fileTypeSql: `${f}.file_type`,
      join: `left join public.file_versions ${v}
        on ${v}.file_id = ${f}.id
        and ${v}.version_number = ${f}.current_version
        and ${v}.deleted_at is null`,
      params: [],
      requireVersion: `${v}.id is not null`,
      versionNumberSql: `${f}.current_version`,
      visibleCondition: "true",
    };
  }

  const role = `$${firstParam}`;
  const userId = `$${firstParam + 1}::bigint`;
  const clientId = `$${firstParam + 2}::bigint`;
  // Como en el dominio, un draft solo existe para el administrador.
  const notDraft = `${p}.status <> 'draft'::public.project_status`;
  const staff = `(${role} = 'admin' or (${role} = 'architect' and ${notDraft} and (${p}.assigned_architect_id = ${userId}
    or exists (select 1 from public.project_assignees staff_assignment
      where staff_assignment.project_id = ${p}.id and staff_assignment.user_id = ${userId}))))`;
  const owner = `(${role} = 'client' and ${notDraft} and ${clientId} is not null and ${p}.client_id = ${clientId})`;

  return {
    fileTypeSql: `coalesce(${v}.content_type, ${f}.file_type)`,
    join: `left join lateral (
        select visible.id, visible.version_number, visible.file_name, visible.file_extension,
          visible.file_size, visible.created_at, visible.content_type
        from public.file_versions visible
        where visible.file_id = ${f}.id
          and visible.deleted_at is null
          and (
            (${f}.access_policy is null and visible.version_number = ${f}.current_version)
            or (${f}.access_policy = 1 and (
              (${staff} and visible.version_number = ${f}.current_version)
              or (not ${staff} and ${owner} and (
                visible.id = ${activeGrantSql(f, "client_owner")} or visible.uploaded_by = ${userId}))
              or (not ${staff} and not ${owner}
                and ${p}.is_public = true and ${p}.status = 'finished'::public.project_status
                and coalesce(visible.content_type, ${f}.file_type) ~ '^(image|video)/'
                and visible.id in ${activeGrantSql(f, "showcase")})
            ))
          )
        order by (visible.id = coalesce(${activeGrantSql(f, "client_owner")}, 0)) desc, visible.version_number desc
        limit 1
      ) ${v} on true`,
    params: [user?.role?.code ?? "", Number(user?.id) || null, user?.clientId ?? null],
    requireVersion: `${v}.id is not null`,
    versionNumberSql: `coalesce(${v}.version_number, ${f}.current_version)`,
    visibleCondition: `(${f}.access_policy is null or ${v}.id is not null)`,
  };
}
