import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";

import { orderCommentsByThread } from "../../utils/commentDisplay.js";
import { ENVIRONMENT_DRAWER_RECENT_ACTIVITY } from "../../data/environmentDrawerExamples.js";

import EmptyState from "./EmptyState/EmptyState.jsx";
import Loader from "./Loader/Loader.jsx";
import SideOverlayDrawer from "./SideOverlayDrawer.jsx";
import ActivityItem from "./NotificationsDrawer/ActivityItem.jsx";
import CommentCard from "./NotificationsDrawer/CommentCard.jsx";
import MessageInput, { ReplyComposer } from "./NotificationsDrawer/MessageInput.jsx";

/**
 * Orquesta observaciones y actividad con la API pública original del panel.
 * Coordina acciones de respuesta, ordenación, payloads y estados de contenido;
 * delega apertura, animación y restauración de foco a SideOverlayDrawer.
 * @param {Object} props Datos, callbacks y opciones reenviadas al drawer base.
 * @returns {import("react").ReactElement} Composición del panel de notificaciones.
 */
function NotificationsDrawer({
  activityOnly = false,
  open = false,
  onClose,
  className,
  comments = [],
  commentsError = "",
  commentsLoading = false,
  recentActivity = ENVIRONMENT_DRAWER_RECENT_ACTIVITY,
  recentActivityError = "",
  recentActivityLoading = false,
  onActivitySelect,
  onCommentSelect,
  onRefreshActivity,
  onRefreshComments,
  onSubmitComment,
  onSubmitEnvironmentComment,
  ...props
}) {
  const [visibleReplyAction, setVisibleReplyAction] = useState(null);
  const [activeReplyComposer, setActiveReplyComposer] = useState(null);
  const replySessionSequenceRef = useRef(0);
  const generalCommentInputId = useId();
  const canSubmitComments = typeof onSubmitComment === "function";
  const canSubmitEnvironmentComments =
    typeof onSubmitEnvironmentComment === "function";
  const orderedComments = orderCommentsByThread(comments, {
    limitRootThreads: 3,
  });

  /**
   * Reinicia acciones y respuesta en el siguiente turno al cerrar el panel.
   * Conserva el cierre diferido original y cancela el timeout al reabrir o desmontar.
   */
  useEffect(() => {
    if (!open) {
      const resetTimeout = window.setTimeout(() => {
        setVisibleReplyAction(null);
        setActiveReplyComposer(null);
      }, 0);

      return () => {
        window.clearTimeout(resetTimeout);
      };
    }
  }, [open]);

  /**
   * Escucha mousedown global únicamente mientras existe una interacción de respuesta.
   * Conserva el marcador compartido y retira el listener al cambiar estado o desmontar;
   * no amplía deliberadamente el contrato a eventos pointer o touch.
   */
  useEffect(() => {
    if (!visibleReplyAction && !activeReplyComposer) {
      return undefined;
    }

    /**
     * Cierra acciones y compositor al pulsar fuera de una zona protegida.
     * El nombre histórico se conserva, aunque el listener utiliza mousedown.
     * @param {MouseEvent} event Pulsación global con elemento de origen.
     * @returns {void} Conserva o descarta la interacción de respuesta actual.
     */
    function handlePointerDown(event) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("[data-reply-interaction='true']")
      ) {
        return;
      }

      setVisibleReplyAction(null);
      setActiveReplyComposer(null);
    }

    window.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [visibleReplyAction, activeReplyComposer]);

  /**
   * Alterna la acción Responder de una tarjeta y descarta cualquier compositor.
   * Conserva la comparación estricta de IDs y no mueve el foco.
   * @param {string|number} commentId Identificador recibido con la observación.
   * @returns {void} Actualiza la coordinación local de acciones.
   */
  function handleMoreClick(commentId) {
    setActiveReplyComposer(null);
    setVisibleReplyAction((currentId) =>
      currentId === commentId ? null : commentId,
    );
  }

  /**
   * Abre una sesión nueva de respuesta para la observación seleccionada.
   * El identificador monotónico diferencia reaperturas del mismo comentario y evita
   * que una solicitud antigua cierre un compositor creado después.
   * @param {string|number} commentId Identificador de la tarjeta activada.
   * @returns {void} Abre la respuesta y oculta su acción previa.
   */
  function handleReplyClick(commentId) {
    replySessionSequenceRef.current += 1;
    setVisibleReplyAction(null);
    setActiveReplyComposer({
      commentId,
      sessionId: replySessionSequenceRef.current,
    });
  }

  /**
   * Construye y envía el payload de una observación o respuesta.
   * Los errores se propagan al compositor para conservar el borrador y permitir
   * reintentos. Una respuesta solo cierra la misma sesión que originó el envío,
   * por lo que una finalización antigua no puede afectar otra apertura posterior.
   * @param {string} message Texto ya recortado por el compositor.
   * @param {Object|string|number|null} [parentComment=null] Observación padre o ID.
   * @param {number|null} [replySessionId=null] Sesión concreta de respuesta.
   * @returns {Promise<void>} Finaliza cuando el callback externo termina con éxito.
   */
  async function handleCommentSubmit(
    message,
    parentComment = null,
    replySessionId = null,
  ) {
    const parentCommentId =
      parentComment && typeof parentComment === "object"
        ? parentComment.parentCommentId || parentComment.id
        : parentComment;
    const projectId =
      parentComment && typeof parentComment === "object"
        ? parentComment.projectId
        : null;
    const parentCommentPayload =
      parentComment && typeof parentComment === "object"
        ? {
            commentType: parentComment.commentType,
            image: parentComment.image,
            selection: parentComment.selection,
            targetId: parentComment.targetId || parentComment.imageId,
          }
        : {};

    const submitComment = parentComment
      ? parentComment.scope === "environment"
        ? onSubmitEnvironmentComment
        : onSubmitComment
      : onSubmitEnvironmentComment || onSubmitComment;

    await Promise.resolve(
      submitComment?.({
        ...parentCommentPayload,
        message,
        parentCommentId,
        projectId,
      }),
    );

    if (replySessionId !== null) {
      setActiveReplyComposer((currentComposer) =>
        currentComposer?.sessionId === replySessionId
          ? null
          : currentComposer,
      );
    }
  }

  /**
   * Solicita foco en el compositor general desde la acción Añadir del estado vacío.
   * Usa el ID de useId sin cambiar la coordinación de foco del drawer base.
   * @returns {void} Enfoca el campo si continúa montado y admite foco.
   */
  function focusCommentInput() {
    document.getElementById(generalCommentInputId)?.focus();
  }

  return (
    <SideOverlayDrawer
      open={open}
      onClose={onClose}
      className={clsx("z-50", className)}
      panelClassName="flex flex-col bg-[var(--color-neutral-100)] p-[16px]"
      {...props}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-[24px] overflow-y-auto pr-[2px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {!activityOnly ? (
          <section className="flex w-[280px] max-w-full flex-col gap-[16px] border-b border-[var(--color-neutral-200)] pb-[24px]">
            {commentsLoading ? (
              <Loader
                preset="commentCard"
                count={3}
                label="Cargando observaciones"
              />
            ) : (
              <div className="content-reveal flex flex-col gap-[16px]">
                <MessageInput
                  id={generalCommentInputId}
                  multiline
                  disabled={
                    !canSubmitEnvironmentComments && !canSubmitComments
                  }
                  placeholder="Escribe algo..."
                  onSubmit={(message) => handleCommentSubmit(message)}
                />

                {commentsError ? (
                  <EmptyState
                    title="No se pudieron cargar los comentarios"
                    description={commentsError}
                    size="S"
                    showFeaturedIcon={false}
                    showActions
                    showSecondaryAction={false}
                    primaryActionLabel="Reintentar"
                    onPrimaryAction={onRefreshComments}
                  />
                ) : orderedComments.length ? (
                  <div className="flex flex-col gap-[8px]">
                    {orderedComments.map((item) => (
                      <div key={item.id} className="flex flex-col gap-[8px]">
                        <CommentCard
                          {...item}
                          showReplyAction={visibleReplyAction === item.id}
                          onMoreClick={() => handleMoreClick(item.id)}
                          onSelect={
                            item.imageComment && onCommentSelect
                              ? () => onCommentSelect(item)
                              : undefined
                          }
                          onReplyClick={() => handleReplyClick(item.id)}
                        />

                        {activeReplyComposer?.commentId === item.id ? (
                          <ReplyComposer
                            disabled={
                              item.scope === "environment"
                                ? !canSubmitEnvironmentComments
                                : !canSubmitComments
                            }
                            onSubmit={(message) =>
                              handleCommentSubmit(
                                message,
                                item,
                                activeReplyComposer.sessionId,
                              )
                            }
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No hay comentarios"
                    description="Los comentarios y observaciones aparecerán aquí."
                    size="S"
                    showFeaturedIcon={false}
                    showActions
                    showSecondaryAction
                    secondaryActionLabel="Añadir"
                    primaryActionLabel="Actualizar"
                    onSecondaryAction={focusCommentInput}
                    onPrimaryAction={onRefreshComments}
                  />
                )}
              </div>
            )}
          </section>
        ) : null}

        <section
          className={clsx(
            "flex w-[280px] max-w-full flex-col gap-[8px]",
            activityOnly && "min-h-0 flex-1",
          )}
        >
          <h3 className="text-[14px] font-medium leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)]">
            Actividad Reciente
          </h3>

          <div
            className={clsx(
              "flex flex-col gap-[8px]",
              activityOnly && "min-h-0 flex-1",
            )}
          >
            {recentActivityLoading ? (
              <Loader
                preset="activityItem"
                count={3}
                label="Cargando actividad reciente"
              />
            ) : recentActivityError ? (
              <div
                className={clsx(
                  activityOnly &&
                    "flex min-h-0 flex-1 items-center justify-center",
                )}
              >
                <EmptyState
                  title="No se pudieron cargar los eventos"
                  description={recentActivityError}
                  size="S"
                  showFeaturedIcon={false}
                  showActions
                  showSecondaryAction={false}
                  primaryActionLabel="Reintentar"
                  onPrimaryAction={onRefreshActivity}
                />
              </div>
            ) : recentActivity.length ? (
              <div className="content-reveal flex flex-col gap-[8px]">
                {recentActivity.map((item) => (
                  <ActivityItem
                    key={item.id}
                    {...item}
                    onSelect={
                      onActivitySelect ? () => onActivitySelect(item) : undefined
                    }
                  />
                ))}
              </div>
            ) : (
              <div
                className={clsx(
                  activityOnly &&
                    "flex min-h-0 flex-1 items-center justify-center",
                )}
              >
                <EmptyState
                  title="No hay eventos recientes"
                  description="Los eventos y cambios del proyecto aparecerán aquí."
                  size="S"
                  showFeaturedIcon={false}
                  showActions
                  showSecondaryAction
                  secondaryActionLabel="Cerrar"
                  primaryActionLabel="Actualizar"
                  onSecondaryAction={onClose}
                  onPrimaryAction={onRefreshActivity}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </SideOverlayDrawer>
  );
}

export default NotificationsDrawer;
