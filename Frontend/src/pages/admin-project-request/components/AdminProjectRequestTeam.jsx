import AvatarLabel from "../../../components/ui/AvatarLabel/AvatarLabel.jsx";
import { formatCalendarDate } from "../../../utils/relativeTime.js";

/**
 * Responsables asignados y revisiones técnicas registradas, al final de la segunda columna
 * con la misma jerarquía de etiqueta (h8) que los demás datos del diseño. Sin registros,
 * cada bloque lo indica en lugar de desaparecer.
 *
 * @param {Object} props - Modelo de `buildAdminRequestTeam`.
 * @param {Array<Object>} props.assignees - Responsables con nombre, rol y avatar.
 * @param {Array<Object>} props.reviews - Revisiones de la más reciente a la más antigua.
 * @returns {import("react").ReactElement} Equipo y revisiones de la solicitud.
 */
function AdminProjectRequestTeam({ assignees, reviews }) {
  return (
    <>
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

      <section className="flex w-full flex-col items-start gap-[8px]" aria-labelledby="admin-request-reviews-title">
        <h2 id="admin-request-reviews-title" className="text-heading-8 text-[var(--color-text-300)]">Revisiones técnicas</h2>
        {reviews.length ? (
          <ol className="m-0 flex w-full list-none flex-col gap-[16px] p-0">
            {reviews.map((review) => (
              <li key={review.key} className="flex flex-col gap-[4px]">
                <span className="text-heading-8 text-[var(--color-text-200)]">{review.recommendationLabel}</span>
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
      </section>
    </>
  );
}

export default AdminProjectRequestTeam;
