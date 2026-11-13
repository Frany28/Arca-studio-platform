import Alert from "../../../components/ui/Alert/Alert.jsx";
import AvatarLabel from "../../../components/ui/AvatarLabel/AvatarLabel.jsx";
import Badge from "../../../components/ui/Badge/Badge.jsx";
import { OUTDATED_REVIEW_TAG_LABEL } from "../../../utils/projectRequestOutdatedReviews.js";
import { formatCalendarDate } from "../../../utils/relativeTime.js";

// Misma retícula que el cuerpo de Figma (dos columnas de 413 px con gap 24 dentro de 850 px).
const COLUMN_CLASS_NAME = "flex min-w-[min(100%,250px)] flex-1 flex-col items-start gap-[24px]";

/**
 * Gestión administrativa de la solicitud: estado vigente, responsables asignados y revisiones
 * técnicas. Se presenta como sección complementaria bajo el bloque diseñado en Figma
 * (3727:687225), separada por un divisor y con su misma retícula y jerarquía (etiquetas h8), para
 * conservar los datos reales sin alterar la composición del diseño. Sin registros, cada bloque lo
 * indica en lugar de desaparecer.
 *
 * @param {Object} props - Modelo de `buildAdminRequestTeam` y estado de la solicitud.
 * @param {Array<Object>} props.assignees - Responsables con nombre, rol y avatar.
 * @param {Array<Object>} props.reviews - Revisiones de la más reciente a la más antigua.
 * @param {{label: string, badgeTheme: string}|null} [props.status] - Estado vigente; null lo omite.
 * @param {string|null} [props.outdatedNotice] - Aviso de revisiones anteriores a los últimos cambios
 *   relevantes; cada revisión afectada lleva además su etiqueta. Las revisiones nunca se ocultan.
 * @returns {import("react").ReactElement} Sección de gestión de la solicitud.
 */
function AdminProjectRequestTeam({ assignees, outdatedNotice = null, reviews, status = null }) {
  return (
    <section
      aria-label="Gestión de la solicitud"
      className="flex w-full max-w-[850px] flex-wrap items-start gap-[24px] border-t border-[var(--color-neutral-200)] pt-[24px]"
    >
      <div className={COLUMN_CLASS_NAME}>
        {status ? (
          <dl className="m-0 flex flex-col items-start gap-[8px]">
            <dt className="text-heading-8 text-[var(--color-text-300)]">Estado de la solicitud</dt>
            <dd className="m-0">
              <Badge label={status.label} theme={status.badgeTheme} variation="Simple" size="S" />
            </dd>
          </dl>
        ) : null}

        <section className="flex w-full flex-col items-start gap-[8px]" aria-labelledby="admin-request-assignees-title">
          <h2 id="admin-request-assignees-title" className="text-heading-8 text-[var(--color-text-300)]">Responsables asignados</h2>
          {assignees.length ? (
            <ul className="m-0 flex w-full list-none flex-col gap-[12px] p-0">
              {assignees.map((assignee) => (
                <li key={assignee.id}>
                  <AvatarLabel
                    size="S"
                    label={assignee.name}
                    subtitle={assignee.roleLabel}
                    avatarTheme="Neutral"
                    avatarContent={assignee.profilePhotoUrl ? "Image" : "Text"}
                    avatarSrc={assignee.profilePhotoUrl || null}
                    avatarName={assignee.name}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-heading-8 text-[var(--color-text-100)]">Sin responsables asignados</p>
          )}
        </section>
      </div>

      <section className={COLUMN_CLASS_NAME} aria-labelledby="admin-request-reviews-title">
        <div className="flex w-full flex-col items-start gap-[8px]">
          <h2 id="admin-request-reviews-title" className="text-heading-8 text-[var(--color-text-300)]">Revisiones técnicas</h2>
          {outdatedNotice ? (
            <Alert
              visible
              theme="Warning"
              layout="Box"
              title="Revisiones desactualizadas"
              description={`${outdatedNotice} Pide una revisión actualizada antes de aprobar.`}
              showActions={false}
              showCloseButton={false}
              aria-label="Revisiones técnicas desactualizadas"
              className="w-full"
            />
          ) : null}
          {reviews.length ? (
            <ol className="m-0 flex w-full list-none flex-col gap-[16px] p-0">
              {reviews.map((review) => (
                <li key={review.key} className="flex flex-col gap-[4px]">
                  <span className="text-heading-8 text-[var(--color-text-200)]">{review.recommendationLabel}</span>
                  {review.outdated ? <Badge label={OUTDATED_REVIEW_TAG_LABEL} theme="Neutral" variation="Simple" size="S" /> : null}
                  <span className="text-body-3 text-[var(--color-text-100)]">
                    {review.reviewerName}
                    {review.updatedAt ? ` · ${formatCalendarDate(review.updatedAt)}` : ""}
                  </span>
                  {review.note ? (
                    <p className="text-body-3 m-0 whitespace-pre-line break-words text-[var(--color-text-200)]">{review.note}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-heading-8 text-[var(--color-text-100)]">Sin revisiones técnicas registradas</p>
          )}
        </div>
      </section>
    </section>
  );
}

export default AdminProjectRequestTeam;
