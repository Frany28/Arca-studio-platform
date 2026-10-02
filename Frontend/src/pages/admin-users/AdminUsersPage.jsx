import { useEffect, useMemo, useState } from "react";
import {
  Add,
  ArrowSwapVertical,
  Edit2,
  Eye,
  Filter,
  FilterRemove,
  LockCircle,
  MinusCirlce,
  Profile2User,
  SearchNormal1,
  ShieldSecurity,
  TickCircle,
  UserMinus,
  UserRemove,
  UserTick,
} from "iconsax-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import AdminKpiMetric from "../../components/AdminKpiMetric.jsx";
import Avatar from "../../components/ui/Avatar/Avatar.jsx";
import Badge from "../../components/ui/Badge/Badge.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import Checkbox from "../../components/ui/Checkbox/Checkbox.jsx";
import DropdownMenu from "../../components/ui/DropdownMenu/DropdownMenu.jsx";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import Input from "../../components/ui/Input/Input.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import Modal from "../../components/ui/Modal/Modal.jsx";
import AlertToast from "../../components/ui/AlertToast/AlertToast.jsx";
import SideNavigation from "../../components/ui/SideNavigation/SideNavigation.jsx";
import { getAvatarPresentation } from "../../utils/avatarPresentation.js";
import { formatHumanDate } from "../../utils/relativeTime.js";
import { createUserSideNavigationItems } from "../../utils/sideNavigationItems.js";
import CreateAdminUserModal from "./CreateAdminUserModal.jsx";
import EditAdminUserModal from "./EditAdminUserModal.jsx";
import AdminUserActionsMenu from "./AdminUserActionsMenu.jsx";
import AdminUserDetailsDrawer from "./AdminUserDetailsDrawer.jsx";
import AdminUserStatusModal from "./AdminUserStatusModal.jsx";
import { getBulkStatusTargets } from "./adminUserStatusPolicy.js";
import { useAdminUsersData } from "./hooks/useAdminUsersData.js";
import { useAdminUsersActions } from "./hooks/useAdminUsersActions.js";

const WEB_BREAKPOINT_PX = 1280;
const STATUS_DETAILS = {
  active: { label: "Activo", theme: "Success" },
  blocked: { label: "Suspendido", theme: "Danger" },
  inactive: { label: "Deshabilitado", theme: "Disabled" },
};
const NUMBER_FORMATTER = new Intl.NumberFormat("es-VE");
const BULK_STATUS_ACTIONS = [
  { icon: MinusCirlce, label: "Suspender", status: "blocked" },
  { icon: LockCircle, label: "Deshabilitar", status: "inactive" },
  { icon: TickCircle, label: "Activar", status: "active" },
];
function HeaderLabel({ children, filter = false }) {
  const Icon = filter ? Filter : ArrowSwapVertical;
  return (
    <span className="flex items-center gap-[8px] whitespace-nowrap">
      {children}
      <Icon size="16" variant="Linear" color="currentColor" aria-hidden="true" />
    </span>
  );
}

function AdminUsersPage({ empty = false }) {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= WEB_BREAKPOINT_PX,
  );
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState(() => new Set());
  const {
    users, metrics, roles, loading, error, filters, pagination,
    reload, setUsers, setMetrics,
  } = useAdminUsersData({ empty, setSelectedUserIds });
  const {
    query, setQuery, roleItems, statusItems, hasFilters, statusFilterIds,
    clear: clearFilters, changeRoles: changeRoleFilters,
    changeStatuses: changeStatusFilters,
  } = filters;
  const { pageIndex, nextCursor, next: goNext } = pagination;
  const [detailsUserId, setDetailsUserId] = useState(null);

  const navigationItems = useMemo(
    () => createUserSideNavigationItems([], "admin"),
    [],
  );
  const selectedCount = users.reduce(
    (count, listedUser) => count + (selectedUserIds.has(String(listedUser.id)) ? 1 : 0),
    0,
  );
  const allSelected = users.length > 0 && selectedCount === users.length;
  const headerChecked = allSelected ? "Yes" : selectedCount ? "Indeterminate" : "No";
  const bulkTargetsByStatus = useMemo(() => Object.fromEntries(
    BULK_STATUS_ACTIONS.map((action) => [
      action.status,
      getBulkStatusTargets({
        actorUserId: user?.id,
        selectedUserIds,
        status: action.status,
        users,
      }),
    ]),
  ), [selectedUserIds, user?.id, users]);

  const { creation, editing, status, feedback } = useAdminUsersActions({
    setUsers,
    setMetrics,
    setSelectedUserIds,
    statusFilterIds,
    bulkTargetsByStatus,
    reload,
    resetPagination: pagination.reset,
  });

  const { open: isCreateUserOpen, createdUser, submit: createUser } = creation;
  const { user: editingUser, loadingUserId: loadingEditUserId, open: openUserEditor, submit: updateEditedUser } = editing;
  const { updatingUserId, isBulkUpdating, pendingChange: pendingStatusChange, requestBulk: requestBulkStatusChange } = status;
  const requestIndividualStatusChange = status.requestIndividual;
  const statusFeedback = feedback.value;

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${WEB_BREAKPOINT_PX - 1}px)`);
    /**
     * Restablece la expansión al montar o cruzar el breakpoint web.
     * Los cambios manuales se conservan mientras la ventana permanezca en ese rango.
     *
     * @param {MediaQueryList|MediaQueryListEvent} event Coincidencia del rango menor a 1280 px.
     * @returns {void} Actualiza la expansión controlada por la página.
     */
    const syncSidebar = (event) => setIsSidebarExpanded(!event.matches);
    syncSidebar(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebar);
    return () => mediaQuery.removeEventListener("change", syncSidebar);
  }, []);

  function toggleAll() {
    if (isBulkUpdating) return;
    setSelectedUserIds((current) => {
      const next = new Set(current);
      users.forEach((listedUser) => {
        if (allSelected) next.delete(String(listedUser.id));
        else next.add(String(listedUser.id));
      });
      return next;
    });
  }

  function toggleUser(userId) {
    if (isBulkUpdating) return;
    setSelectedUserIds((current) => {
      const next = new Set(current);
      const id = String(userId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="h-screen overflow-hidden bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex h-full min-h-0 w-full items-stretch">
        <SideNavigation
          activeItemId="users"
          expanded={isSidebarExpanded}
          items={navigationItems}
          newOpportunityLabel="Nuevo proyecto"
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onExpandedChange={setIsSidebarExpanded}
          onItemSelect={(item) => item?.to && navigate(item.to)}
          onNewOpportunityClick={() => navigate("/dashboard-arquitecto/nuevo-proyecto")}
          onLogoutClick={() => { logout(); navigate("/"); }}
          className="h-screen shrink-0 self-stretch"
        />

        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <NavigationBar
            utilityActionActive={isNotificationsOpen}
            onUtilityActionClick={() => setIsNotificationsOpen((open) => !open)}
          />

          <section className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]" aria-labelledby="admin-users-title">
            <div className="flex flex-wrap items-center justify-between gap-[16px] pb-[24px]">
              <h1 id="admin-users-title" className="text-heading-3 m-0 text-[var(--color-text-50)] max-sm:text-[40px] max-sm:leading-[48px]">
                Gestión de usuarios
              </h1>
              <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon iconLeft={<Add size="20" color="currentColor" />} showRightIcon={false} onClick={creation.openFromNew}>
                Nuevo
              </Button>
            </div>

            {loading && !metrics ? (
              <Loader preset="adminUserMetrics" label="Cargando métricas de usuarios" />
            ) : (
              <div className="flex w-full flex-wrap content-center items-center gap-y-[16px] border-y border-[var(--color-neutral-200)] py-[24px]">
                <AdminKpiMetric label="Usuarios totales" value={metrics?.total === null || metrics?.total === undefined ? "—" : NUMBER_FORMATTER.format(metrics.total)} iconType="Accent" icon={<Profile2User size="24" color="currentColor" />} />
                <AdminKpiMetric label="Usuarios activos" value={metrics?.active === null || metrics?.active === undefined ? "—" : NUMBER_FORMATTER.format(metrics.active)} iconType="Success" icon={<UserTick size="24" color="currentColor" />} />
                <AdminKpiMetric label="Usuarios suspendidos" value={metrics?.suspended === null || metrics?.suspended === undefined ? "—" : NUMBER_FORMATTER.format(metrics.suspended)} iconType="Danger" icon={<UserMinus size="24" color="currentColor" />} />
                <AdminKpiMetric label="Usuarios Deshabilitados" value={metrics?.disabled === null || metrics?.disabled === undefined ? "—" : NUMBER_FORMATTER.format(metrics.disabled)} iconType="Disabled" icon={<UserRemove size="24" color="currentColor" />} />
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-[16px] pt-[24px]">
              <div className="flex flex-col justify-between gap-[12px] min-[900px]:flex-row">
                <Input type="Default input" size="M" value={query} placeholder="Buscar..." showLabel={false} showHint={false} showLeftIcon showRightIcon={false} leftIcon={<SearchNormal1 size="20" color="currentColor" />} className="w-full min-[900px]:max-w-[320px]" aria-label="Buscar usuarios" onChange={(event) => setQuery(event.target.value)} />
                <div className="grid w-full grid-cols-1 items-center gap-[12px] min-[560px]:grid-cols-3 min-[900px]:w-auto min-[900px]:grid-cols-[180px_180px_129px]">
                  <DropdownMenu
                    type="Text"
                    label="Filtrar por rol"
                    items={roleItems}
                    multiple
                    interactive={roleItems.length > 0}
                    onItemsChange={changeRoleFilters}
                    className="w-full min-[900px]:w-[180px]"
                    contentClassName="max-h-[168px] max-w-full overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--color-neutral-400)_transparent] [scrollbar-width:thin]"
                    contentPaddingClassName="px-[4px] py-[8px]"
                    rowHeightClassName="h-[35px]"
                    aria-label="Filtrar usuarios por rol"
                  />
                  <DropdownMenu
                    type="Text"
                    label="Filtrar por status"
                    items={statusItems}
                    multiple
                    onItemsChange={changeStatusFilters}
                    className="w-full min-[900px]:w-[180px]"
                    contentClassName="max-h-[168px] max-w-full overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--color-neutral-400)_transparent] [scrollbar-width:thin]"
                    contentPaddingClassName="px-[4px] py-[8px]"
                    rowHeightClassName="h-[35px]"
                    aria-label="Filtrar usuarios por status"
                  />
                  <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon iconLeft={<FilterRemove size="20" color="currentColor" />} showRightIcon={false} disabled={!hasFilters} className="w-full" onClick={clearFilters}>Quitar filtros</Button>
                </div>
              </div>

              {loading ? (
                <Loader preset="adminUserTable" label="Cargando usuarios" />
              ) : error ? (
                <div className="rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
                  <EmptyState
                    title="No se pudieron cargar los usuarios"
                    description={error}
                    size="S"
                    showFeaturedIcon={false}
                    showActions
                    showSecondaryAction={false}
                    primaryActionLabel="Reintentar"
                    onPrimaryAction={reload}
                  />
                </div>
              ) : users.length ? (
                <>
                  <div className="w-full overflow-hidden rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
                    <div className="w-full overflow-x-auto">
                      <table className="w-full min-w-[1092px] table-fixed border-collapse text-left">
                      <colgroup><col className="w-[48px]" /><col className="w-[130px]" /><col className="w-[190px]" /><col className="w-[250px]" /><col className="w-[160px]" /><col className="w-[140px]" /><col className="w-[174px]" /></colgroup>
                      <thead className="bg-[var(--color-neutral-200)] text-[var(--color-text-300)]">
                        <tr className="h-[49px] text-body-4">
                          <th className="p-[16px]"><Checkbox size="S" checked={headerChecked} interactive={!isBulkUpdating} aria-label="Seleccionar todos los usuarios visibles" onCheckedChange={toggleAll} /></th>
                          <th className="px-[24px] py-[16px]"><HeaderLabel filter>Rol</HeaderLabel></th>
                          <th className="px-[24px] py-[16px]"><HeaderLabel>Nombre</HeaderLabel></th>
                          <th className="px-[24px] py-[16px]">Correo</th>
                          <th className="px-[24px] py-[16px]"><HeaderLabel>Último acceso</HeaderLabel></th>
                          <th className="px-[24px] py-[16px]"><HeaderLabel filter>Status</HeaderLabel></th>
                          <th className="px-[24px] py-[16px]">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((listedUser) => {
                          const status = STATUS_DETAILS[listedUser.status] || STATUS_DETAILS.inactive;
                          const avatar = getAvatarPresentation({
                            identity: listedUser.id,
                            name: listedUser.name,
                            roleCode: listedUser.role?.code,
                            src: listedUser.profilePhotoUrl,
                          });
                          const isSelected = selectedUserIds.has(String(listedUser.id));
                          return (
                            <tr
                              key={listedUser.id}
                              className={`h-[68px] transition-colors duration-150 ${
                                isSelected
                                  ? "bg-[var(--color-neutral-300)]"
                                  : "bg-[var(--color-neutral-100)]"
                              }`}
                              data-selected={isSelected ? "true" : undefined}
                            >
                              <td className="p-[16px]"><Checkbox size="S" checked={isSelected ? "Yes" : "No"} interactive={!isBulkUpdating} aria-label={`Seleccionar ${listedUser.name}`} onCheckedChange={() => toggleUser(listedUser.id)} /></td>
                              <td className="px-[24px] py-[16px]"><Badge label={listedUser.role?.name || "Sin rol"} theme="Brand 1" variation="Simple" size="S" /></td>
                              <td className="px-[24px] py-[16px]"><div className="flex min-w-0 items-center gap-[8px]"><Avatar size="S" name={listedUser.name} {...avatar} /><span className="text-body-4 truncate text-[var(--color-text-300)]">{listedUser.name}</span></div></td>
                              <td className="text-heading-8 truncate px-[24px] py-[16px] text-[var(--color-text-300)]">{listedUser.email}</td>
                              <td className="text-heading-8 px-[24px] py-[16px] text-[var(--color-text-300)]">{formatHumanDate(listedUser.lastLoginAt, undefined, "Sin acceso")}</td>
                              <td className="px-[24px] py-[16px]"><Badge label={status.label} theme={status.theme} variation="Simple" size="S" /></td>
                              <td className="px-[24px] py-[16px]"><div className="flex items-center gap-[8px]">
                                <Button
                                  theme="Primary"
                                  type="Ghost"
                                  size="S"
                                  showText={false}
                                  showLeftIcon
                                  iconLeft={<Eye size="20" color="currentColor" />}
                                  showRightIcon={false}
                                  tooltip="Detalles de usuario"
                                  aria-label={`Ver detalles de ${listedUser.name}`}
                                  onClick={() => setDetailsUserId(listedUser.id)}
                                />
                                <Button
                                  theme="Primary"
                                  type="Ghost"
                                  size="S"
                                  showText={false}
                                  showLeftIcon
                                  iconLeft={<Edit2 size="20" color="currentColor" />}
                                  showRightIcon={false}
                                  disabled={
                                    isBulkUpdating
                                    || updatingUserId !== null
                                    || loadingEditUserId !== null
                                  }
                                  tooltip={loadingEditUserId === String(listedUser.id) ? "Cargando usuario..." : "Editar usuario"}
                                  aria-label={`Editar ${listedUser.name}`}
                                  onClick={() => openUserEditor(listedUser)}
                                />
                                <AdminUserActionsMenu
                                  user={listedUser}
                                  disabled={
                                    isBulkUpdating
                                    || updatingUserId === String(listedUser.id)
                                    || String(user?.id) === String(listedUser.id)
                                  }
                                  onStatusChange={requestIndividualStatusChange}
                                />
                              </div></td>
                            </tr>
                          );
                        })}
                      </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-1 items-center gap-[12px] min-[900px]:grid-cols-[1fr_auto_1fr]">
                    <span className="text-heading-8 text-[var(--color-text-300)]">{selectedCount} de {users.length} seleccionados</span>
                    <div className="flex min-h-[44px] flex-wrap items-center justify-center gap-[8px]" aria-label="Acciones para usuarios seleccionados">
                      {selectedCount ? BULK_STATUS_ACTIONS.map((action) => {
                        const ActionIcon = action.icon;
                        const targets = bulkTargetsByStatus[action.status] || [];
                        return (
                          <Button
                            key={action.status}
                            theme="Primary"
                            type="Ghost"
                            size="M"
                            fitContent
                            showLeftIcon
                            iconLeft={<ActionIcon size="20" color="currentColor" />}
                            showRightIcon={false}
                            disabled={isBulkUpdating || updatingUserId !== null || targets.length === 0}
                            onClick={() => requestBulkStatusChange(action.status)}
                          >
                            {action.label}
                          </Button>
                        );
                      }) : null}
                    </div>
                    <div className="flex items-center gap-[8px] justify-self-end">
                      <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={pageIndex === 0} className="disabled:!border-[var(--color-neutral-400)] disabled:!text-[var(--color-neutral-400)]" onClick={pagination.previous}>Anterior</Button>
                      <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={!nextCursor} onClick={goNext}>Siguiente pág.</Button>
                    </div>
                  </div>
                </>
              ) : hasFilters ? (
                <EmptyState
                  title="No hay coincidencias"
                  description="Ajusta o elimina los filtros para ver otros usuarios."
                  size="S"
                  showFeaturedIcon={false}
                  showActions
                  showSecondaryAction={false}
                  primaryActionLabel="Quitar filtros"
                  onPrimaryAction={clearFilters}
                  className="min-h-[280px] flex-1"
                />
              ) : (
                <EmptyState
                  title="No hay usuarios registrados"
                  description="Los usuarios aparecerán aquí cuando estén disponibles."
                  size="M"
                  showFeaturedIcon
                  showActions
                  showSecondaryAction
                  secondaryActionLabel="Añadir"
                  primaryActionLabel="Actualizar"
                  onSecondaryAction={creation.openFromEmpty}
                  onPrimaryAction={() => {
                    if (empty) navigate("/usuarios");
                    else reload();
                  }}
                  className="min-h-[320px] flex-1"
                />
              )}
            </div>
          </section>

          <NotificationsDrawer open={isNotificationsOpen} onClose={() => setIsNotificationsOpen(false)} recentActivity={[]} />
          <AdminUserDetailsDrawer
            open={detailsUserId !== null}
            userId={detailsUserId}
            roles={roles}
            onClose={() => setDetailsUserId(null)}
            onUserUpdated={reload}
          />
          {isCreateUserOpen ? <CreateAdminUserModal open roles={roles} onClose={creation.close} onCreate={createUser} /> : null}
          {editingUser ? (
            <EditAdminUserModal
              open
              roles={roles}
              user={editingUser}
              onClose={editing.close}
              onUpdate={updateEditedUser}
            />
          ) : null}
          <Modal
            mount="viewport"
            visible={Boolean(createdUser)}
            showDialog
            alignment="Centered"
            overlayVariant="blurred"
            transitionPreset="fade-scale"
            title="Usuario creado correctamente"
            description="El usuario quedó registrado. El enlace de activación se enviará cuando se habilite este flujo."
            secondaryActionLabel="Cancelar"
            primaryActionLabel="Aceptar"
            icon={<ShieldSecurity size="20" color="currentColor" />}
            onClose={creation.dismissConfirmation}
            onSecondaryAction={creation.dismissConfirmation}
            onPrimaryAction={creation.dismissConfirmation}
            className="z-[90]"
            aria-label="Usuario creado correctamente"
          />
          <AdminUserStatusModal
            change={pendingStatusChange}
            onCancel={status.cancel}
            onConfirm={status.confirm}
          />
          <AlertToast
            trigger={statusFeedback}
            title={statusFeedback?.title || "Estado del usuario actualizado"}
            description={statusFeedback?.message || ""}
            theme={statusFeedback?.tone === "danger" ? "Danger" : "Success"}
            aria-label={statusFeedback?.tone === "danger" ? "Error al actualizar el usuario" : "Usuario actualizado correctamente"}
            onDismiss={feedback.dismiss}
          />
        </div>
      </div>
    </main>
  );
}

export default AdminUsersPage;
