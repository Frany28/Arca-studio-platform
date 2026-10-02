import Badge from "../../../components/ui/Badge/Badge.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import ProjectsShowcaseCarousel from "../../../components/ui/ProjectsShowcaseCarousel.jsx";
import ScrollBar from "../../../components/ui/ScrollBar/ScrollBar.jsx";
import {
  ProjectRequestRow,
  ProjectStatusGroup,
} from "./HomeProjectRows.jsx";

const REQUEST_SKELETON_COUNT = 2;

export function HomeProjectsSection({
  projectGroups,
  projectsContainerRef,
  projectsError,
  projectsLoading,
  handleProjectScroll,
  projectScrollLength,
  projectScrollPosition,
  setProjectScrollPosition,
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] items-start gap-[4px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
      <div
        ref={projectsContainerRef}
        className="max-h-none flex-1 overflow-y-visible pr-[2px] [scrollbar-width:none] [-ms-overflow-style:none] lg:max-h-[232px] lg:overflow-y-auto [&::-webkit-scrollbar]:hidden"
        onScroll={handleProjectScroll}
      >
        {projectsLoading ? (
          <Loader
            preset="projectRow"
            count={3}
            label="Cargando proyectos"
            className="min-h-[232px] py-[24px]"
          />
        ) : projectsError ? (
          <p className="text-body-3 py-[24px] text-[var(--color-danger-100)]">
            {projectsError}
          </p>
        ) : projectGroups.length ? (
          <div className="content-reveal flex flex-col gap-[24px]">
            {projectGroups.map((group) => (
              <ProjectStatusGroup key={group.id} group={group} />
            ))}
          </div>
        ) : (
          <p className="text-body-3 py-[24px] text-[var(--color-text-200)]">
            No tienes proyectos asignados.
          </p>
        )}
      </div>

      {!projectsLoading ? (
        <ScrollBar
          height={232}
          length={projectScrollLength}
          position={projectScrollPosition}
          interactive
          onPositionChange={setProjectScrollPosition}
          className="hidden shrink-0 lg:block"
        />
      ) : null}
    </div>
  );
}

export function HomeRequestsSection({
  handleRequestScroll,
  loadMoreProjectRequests,
  onNewOpportunity,
  onReviewRequest,
  projectRequests,
  projectRequestsError,
  projectRequestsLoading,
  projectRequestsLoadingMore,
  projectRequestsNextCursor,
  requestScrollLength,
  requestScrollPosition,
  requestsContainerRef,
  retryProjectRequests,
  setRequestScrollPosition,
}) {
  return (
    <section className="mx-auto flex w-full max-w-[1200px] flex-col px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
      <div className="flex items-center pb-[4px]">
        <Badge
          label="Solicitudes"
          theme="Brand 1"
          variation="Simple"
          size="S"
        />
      </div>

      <div className="flex w-full items-start gap-[4px]">
        <div
          ref={requestsContainerRef}
          onScroll={handleRequestScroll}
          className="min-w-0 flex-1 overflow-y-visible pr-[2px] [scrollbar-width:none] [-ms-overflow-style:none] lg:max-h-[232px] lg:overflow-y-auto [&::-webkit-scrollbar]:hidden"
        >
          {projectRequestsLoading ? (
            <Loader
              preset="requestRow"
              count={REQUEST_SKELETON_COUNT}
              label="Cargando solicitudes"
            />
          ) : projectRequestsError && !projectRequests.length ? (
            <EmptyState
              className="min-h-[320px]"
              title="No pudimos cargar tus solicitudes"
              description={projectRequestsError}
              size="M"
              showFeaturedIcon
              showActions
              showSecondaryAction={false}
              primaryActionLabel="Actualizar"
              onPrimaryAction={retryProjectRequests}
            />
          ) : projectRequests.length ? (
            <div className="content-reveal flex flex-col">
              <div>
                {projectRequests.map((projectRequest) => (
                  <ProjectRequestRow
                    key={projectRequest.id}
                    projectRequest={projectRequest}
                    onReview={onReviewRequest}
                  />
                ))}
              </div>
              {projectRequestsNextCursor ? (
                <Button
                  theme="Primary"
                  type="Outline"
                  size="M"
                  fitContent
                  showLeftIcon={false}
                  showRightIcon={false}
                  disabled={projectRequestsLoadingMore}
                  className="mt-[16px] self-center"
                  onClick={loadMoreProjectRequests}
                >
                  {projectRequestsLoadingMore ? "Cargando..." : "Cargar más"}
                </Button>
              ) : null}
              {projectRequestsError ? (
                <p className="text-body-3 mt-[12px] text-center text-[var(--color-danger-100)]">
                  {projectRequestsError}
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState
              className="min-h-[320px]"
              title="Tu espacio de proyectos está listo"
              description="Aquí podrás visualizar y dar seguimiento a tus proyectos."
              size="M"
              showFeaturedIcon
              showActions
              showSecondaryAction={false}
              primaryActionLabel="Nueva oportunidad"
              onPrimaryAction={onNewOpportunity}
            />
          )}
        </div>

        {!projectRequestsLoading && projectRequests.length ? (
          <ScrollBar
            height={232}
            length={requestScrollLength}
            position={requestScrollPosition}
            interactive
            onPositionChange={setRequestScrollPosition}
            className="hidden shrink-0 lg:block"
          />
        ) : null}
      </div>
    </section>
  );
}

export function HomePublicProjectsSection({
  loadProjects,
  projectsError,
  projectsLoading,
  publicProjectRows,
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] px-[16px] pb-[24px] sm:px-[24px] lg:px-[48px]">
      {projectsLoading ? (
        <section className="flex w-full min-w-0 flex-col gap-[16px]">
          <h2 className="text-heading-4 text-[var(--color-text-100)]">
            Ver más proyectos
          </h2>
          <Loader
            preset="projectShowcase"
            label="Cargando más proyectos"
          />
        </section>
      ) : projectsError ? (
        <section className="flex w-full min-w-0 flex-col gap-[16px]">
          <h2 className="text-heading-4 text-[var(--color-text-100)]">
            Ver más proyectos
          </h2>
          <EmptyState
            title="No pudimos cargar los proyectos"
            description={projectsError}
            size="M"
            showFeaturedIcon
            showActions
            showSecondaryAction={false}
            primaryActionLabel="Actualizar"
            onPrimaryAction={loadProjects}
          />
        </section>
      ) : publicProjectRows.length ? (
        <ProjectsShowcaseCarousel
          title="Ver más proyectos"
          items={publicProjectRows}
        />
      ) : (
        <section className="flex w-full min-w-0 flex-col gap-[16px]">
          <h2 className="text-heading-4 text-[var(--color-text-100)]">
            Ver más proyectos
          </h2>
          <EmptyState
            title="No se encontraron proyectos"
            description="Aquí podrás visualizar otros proyectos que pueden interesarte."
            size="M"
            showFeaturedIcon
            showActions
            showSecondaryAction={false}
            primaryActionLabel="Actualizar"
            onPrimaryAction={loadProjects}
          />
        </section>
      )}
    </div>
  );
}
