import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";

import { api } from "../../api/http.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import MainLogo from "../../assets/logos/MainLogo.jsx";
import AvatarGroup from "../../components/ui/AvatarGroup/AvatarGroup.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import ProjectImage from "../../components/ui/ProjectImage/ProjectImage.jsx";
import SideNavigation from "../../components/ui/SideNavigation/SideNavigation.jsx";
import SideOverlayDrawer from "../../components/ui/SideOverlayDrawer.jsx";
import Tooltip from "../../components/ui/Tooltip/Tooltip.jsx";
import ProjectDocumentsToolbar from "./components/ProjectDocumentsToolbar.jsx";
import { getProjectAssigneeAvatar } from "../../utils/projectAssigneeDisplay.js";
import { getProjectImageSource } from "../../utils/projectImage.js";
import { getProjectPath } from "../../utils/projectRoutes.js";
import { getProjectTypeDisplay } from "../../utils/projectTypeDisplay.js";
import { getAvatarPresentation } from "../../utils/avatarPresentation.js";
import {
  filterPublicProjects,
  getPublicGalleryProjects,
  sortPublicProjects,
} from "../../utils/publicProjectGallery.js";
import { getPublicGalleryColumnCount } from "../../utils/publicProjectGalleryLayout.js";
import {
  createUserSideNavigationItems,
  getDashboardPath,
} from "../../utils/sideNavigationItems.js";

const TABLET_BREAKPOINT_PX = 768;

function getCardHeight(index, columns, projectCount) {
  if (projectCount === 1) return 560;
  if (projectCount <= 3) return 479;

  const column = index % columns;
  const row = Math.floor(index / columns);
  return (column + row) % 2 === 0 ? 479 : 282;
}

function getGalleryColumnCount() {
  return getPublicGalleryColumnCount(
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
}

function getCardAssignees(project) {
  const architect = getProjectAssigneeAvatar(project);
  if (architect) return [architect];

  const clientName = String(project?.client?.name || "Cliente");
  const clientAvatar = getAvatarPresentation({
    identity: project?.client?.id || clientName,
    name: clientName,
    roleCode: "client",
    src: project?.client?.profilePhotoUrl || project?.client?.avatarUrl || "",
  });
  return [
    {
      ...clientAvatar,
      decorative: false,
      name: clientName,
    },
  ];
}

export function ProjectGalleryCard({ project, height, onOpen }) {
  const assignees = getCardAssignees(project);
  const assigneeNames = assignees.map((item) => item.name).join(", ");

  return (
    <article
      className="group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-[var(--radius-2)] p-[16px] shadow-[var(--shadow-e1)]"
      style={{ height }}
    >
      <ProjectImage
        src={getProjectImageSource(project)}
        alt={project.name}
        className="!absolute inset-0 !size-full"
        imageClassName="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.20)_0%,rgba(0,0,0,0.04)_48%,rgba(0,0,0,0.58)_100%)]" />
      <MainLogo
        size="20px"
        appearance="auto"
        alt="ARCA Studio"
        className="relative z-[1] h-[20px] w-[109px] shrink-0 self-start"
        imgClassName="size-full"
      />

      <div className="relative z-[1] flex min-w-0 flex-col">
        <h2 className="text-heading-4 text-[var(--color-neutral-100-uniform)]">
          {project.name}
        </h2>
        <p className="text-body-1 text-[var(--color-neutral-100-uniform)]">
          {getProjectTypeDisplay(project.projectType)}
        </p>
        <div className="flex min-h-[41px] items-center justify-between gap-[12px]">
          <Tooltip text={assigneeNames} tipPosition="Top center" showTip portal>
            <AvatarGroup
              size="S"
              items={assignees}
              tabIndex={0}
              aria-label={`Encargados: ${assigneeNames}`}
              className="[&>span]:border-[var(--color-neutral-bg)] [&>span]:shadow-[var(--shadow-e1)]"
            />
          </Tooltip>
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            className="shrink-0"
            onClick={() => onOpen(project)}
          >
            Ver más
          </Button>
        </div>
      </div>
    </article>
  );
}

export function GalleryColumns({ columns, projects, onOpen }) {
  const navigate = useNavigate();
  const effectiveColumns = Math.min(Math.max(projects.length, 1), columns);
  const openProject = onOpen || ((item) => navigate(getProjectPath(item)));
  const usesAlternatingLayout = projects.length > 3;
  const groupedProjects = Array.from(
    { length: effectiveColumns },
    (_, column) =>
      projects
        .map((project, index) => ({ index, project }))
        .filter(({ index }) => index % effectiveColumns === column),
  );

  return (
    <div
      className="grid w-full gap-[24px]"
      style={{ gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))` }}
    >
      {usesAlternatingLayout
        ? groupedProjects.map((items, column) => (
            <div key={column} className="flex min-w-0 flex-col gap-[24px]">
              {items.map(({ index, project }) => (
                <ProjectGalleryCard
                  key={project.id}
                  project={project}
                  height={getCardHeight(
                    index,
                    effectiveColumns,
                    projects.length,
                  )}
                  onOpen={openProject}
                />
              ))}
            </div>
          ))
        : projects.map((project, index) => (
            <ProjectGalleryCard
              key={project.id}
              project={project}
              height={getCardHeight(index, effectiveColumns, projects.length)}
              onOpen={openProject}
            />
          ))}
    </div>
  );
}

export default function PublicProjectsGallery() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortDirection, setSortDirection] = useState("desc");
  const [galleryColumns, setGalleryColumns] = useState(getGalleryColumnCount);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] =
    useState(false);

  const loadProjects = useCallback(() => {
    setLoading(true);
    setError("");

    if (!user) {
      setProjects([]);
      setError("Vuelve a iniciar sesión para cargar los proyectos.");
      setLoading(false);
      return;
    }

    api.projects
      .listAll()
      .then((data) => setProjects(data.projects || []))
      .catch(() => {
        setProjects([]);
        setError("No se pudieron cargar los proyectos públicos.");
      })
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(loadProjects);
    return () => window.cancelAnimationFrame(frameId);
  }, [loadProjects]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(max-width: ${TABLET_BREAKPOINT_PX - 1}px)`,
    );
    const syncSidebar = (event) => setIsSidebarExpanded(!event.matches);
    syncSidebar(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebar);
    return () => mediaQuery.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    const syncColumns = () => setGalleryColumns(getGalleryColumnCount());
    window.addEventListener("resize", syncColumns);
    return () => window.removeEventListener("resize", syncColumns);
  }, []);

  const publicProjects = useMemo(
    () => getPublicGalleryProjects(projects, user),
    [projects, user],
  );
  const displayedProjects = useMemo(
    () =>
      sortPublicProjects(
        filterPublicProjects(publicProjects, query),
        sortDirection,
      ),
    [publicProjects, query, sortDirection],
  );
  const navigationItems = useMemo(
    () => createUserSideNavigationItems(projects, currentUser.roleCode),
    [currentUser.roleCode, projects],
  );
  const isArchitect =
    currentUser.roleCode === "architect" || currentUser.roleCode === "admin";

  const handleNavigation = (item) => {
    if (item?.to) {
      navigate(item.to);
      return;
    }

    if (item?.id === "dashboard") {
      navigate(getDashboardPath(currentUser.roleCode));
    } else if (item?.id === "requests") {
      navigate("/solicitudes");
    } else if (item?.id === "more-projects") {
      navigate("/proyectos");
    } else if (item?.id === "settings") {
      navigate("/configuraciones");
    } else if (item?.id?.startsWith("project-")) {
      const project = projects.find(
        (candidate) => `project-${candidate.id}` === item.id,
      );
      if (project) navigate(getProjectPath(project));
    }
  };

  const sideNavigationProps = {
    activeItemId:
      currentUser.roleCode === "admin" ? "projects" : "more-projects",
    expanded: true,
    items: navigationItems,
    newOpportunityLabel: isArchitect ? "Nuevo proyecto" : "Nueva oportunidad",
    userName: currentUser.name,
    userEmail: currentUser.email,
    userAvatarSrc: currentUser.profilePhotoUrl,
    onItemSelect: handleNavigation,
    onNewOpportunityClick: () =>
      navigate(
        isArchitect
          ? "/dashboard-arquitecto/nuevo-proyecto"
          : "/solicitudes/nueva",
      ),
    onLogoutClick: () => {
      logout();
      navigate("/");
    },
  };

  return (
    <main className="min-h-screen bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex min-h-screen w-full items-stretch">
        <SideNavigation
          {...sideNavigationProps}
          expanded={isSidebarExpanded}
          onExpandedChange={setIsSidebarExpanded}
          className={clsx(
            "min-h-screen shrink-0 self-stretch max-[767px]:hidden min-[768px]:max-[1023px]:!px-[12px]",
            isSidebarExpanded && "min-[768px]:max-[1023px]:!w-[234px]",
          )}
        />

        <div className="relative flex min-h-screen min-w-0 flex-1 flex-col self-stretch overflow-y-auto">
          <NavigationBar
            onMenuClick={() => setIsMobileNavigationOpen(true)}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={() =>
              setIsNotificationsDrawerOpen((current) => !current)
            }
          />

          <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-[16px] pb-[48px] pt-0 min-[768px]:px-[48px]">
            <ProjectDocumentsToolbar
              disabled={loading}
              query={query}
              sortDirection={sortDirection}
              placeholder="Buscar proyecto por nombre, tipo, año o arquitecto..."
              searchAriaLabel="Buscar proyectos públicos"
              onQueryChange={setQuery}
              onToggleSort={() =>
                setSortDirection((current) =>
                  current === "desc" ? "asc" : "desc",
                )
              }
            />

            {loading ? (
              <Loader
                className="mt-[24px]"
                preset="projectGallery"
                label="Cargando proyectos públicos"
              />
            ) : (
              <>
                {error ? (
                  <EmptyState
                    className="mt-[48px]"
                    title="No pudimos cargar los proyectos"
                    description={error}
                    size="M"
                    showFeaturedIcon
                    showActions
                    showSecondaryAction={false}
                    primaryActionLabel="Reintentar"
                    onPrimaryAction={loadProjects}
                  />
                ) : displayedProjects.length ? (
                  <div className="mt-[24px]">
                    <GalleryColumns
                      columns={galleryColumns}
                      projects={displayedProjects}
                    />
                  </div>
                ) : (
                  <EmptyState
                    className="mt-[48px]"
                    title={
                      query
                        ? "No encontramos proyectos"
                        : "Aún no hay proyectos públicos"
                    }
                    description={
                      query
                        ? "Prueba con otro nombre, tipo, año o arquitecto."
                        : "Los proyectos publicados aparecerán en esta sección."
                    }
                    size="M"
                    showFeaturedIcon
                    showActions={Boolean(query)}
                    showSecondaryAction={false}
                    primaryActionLabel="Limpiar búsqueda"
                    onPrimaryAction={() => setQuery("")}
                  />
                )}
              </>
            )}
          </section>

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={() => setIsNotificationsDrawerOpen(false)}
            comments={[]}
            commentsLoading={false}
            recentActivity={[]}
          />
        </div>
      </div>

      <SideOverlayDrawer
        open={isMobileNavigationOpen}
        onClose={() => setIsMobileNavigationOpen(false)}
        side="left"
        widthClassName="w-[min(312px,calc(100vw-32px))]"
        className="z-[80] min-[768px]:hidden"
        panelClassName="rounded-none"
      >
        <SideNavigation
          {...sideNavigationProps}
          onItemSelect={(item) => {
            setIsMobileNavigationOpen(false);
            handleNavigation(item);
          }}
          onExpandedChange={(expanded) => {
            if (!expanded) setIsMobileNavigationOpen(false);
          }}
          className="!h-full !min-h-full !w-full border-r-0 shadow-none"
        />
      </SideOverlayDrawer>
    </main>
  );
}
