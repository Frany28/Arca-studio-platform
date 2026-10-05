# Auditor?a estructural del frontend

Fecha: 1 de octubre de 2026. Alcance: organizaci?n y c?digo sin consumidores; sin cambios funcionales, visuales, de rutas o de contratos.

## M?todo y l?mites

Se inventari? todo `src` antes de editar. Se resolvieron imports relativos est?ticos, imports din?micos literales, reexports e ?ndices en c?digo, configuraci?n y tests de todo el repositorio (excluyendo dependencias y bundles). Se complement? con b?squeda textual de nombres/rutas, revisi?n de `main.jsx`, `index.html` y configuraci?n Vite. No se encontraron `import.meta.glob` ni cargas din?micas con rutas calculadas en el frontend. Los tests tambi?n leen fuentes mediante `new URL`, por lo que la b?squeda textual complementa el grafo. Ausencia de imports por s? sola no demuestra que un archivo pueda eliminarse.

## Eliminaciones comprobadas

| Archivo dentro de src | Evidencia |
| --- | --- |
| `layouts/AuthLayout.jsx` | Archivo de cero bytes, sin implementaci?n ni exports. Sin imports, cargas din?micas, reexports entrantes, referencias de tests ni configuraci?n. |
| `layouts/MainLayout.jsx` | Archivo de cero bytes, sin implementaci?n ni exports. Sin imports, cargas din?micas, reexports entrantes, referencias de tests ni configuraci?n. |
| `components/ui/Card.jsx` | Archivo de cero bytes, sin implementaci?n ni exports. Sin imports, cargas din?micas, reexports entrantes, referencias de tests ni configuraci?n. |
| `components/ui/Navbar.jsx` | Archivo de cero bytes, sin implementaci?n ni exports. Sin imports, cargas din?micas, reexports entrantes, referencias de tests ni configuraci?n. |
| `components/ui/Select.jsx` | Archivo de cero bytes, sin implementaci?n ni exports. Sin imports, cargas din?micas, reexports entrantes, referencias de tests ni configuraci?n. |
| `components/ui/Sidebar.jsx` | Archivo de cero bytes, sin implementaci?n ni exports. Sin imports, cargas din?micas, reexports entrantes, referencias de tests ni configuraci?n. |
| `components/ui/Table.jsx` | Archivo de cero bytes, sin implementaci?n ni exports. Sin imports, cargas din?micas, reexports entrantes, referencias de tests ni configuraci?n. |
| `pages/pages.js` | Barrel de 17 reexports sin consumidores; main.jsx carga las p?ginas directamente con lazy(). Sin imports, cargas din?micas, reexports entrantes, referencias de tests ni configuraci?n. |

`components/layout/AuthLayout.jsx` es la implementaci?n real y sigue utilizado por seis p?ginas de autenticaci?n. `pages/ProjectDetails.jsx` y `pages/Settings.jsx` siguen usados por lazy() en main.jsx y se conservan como entradas estables. Ning?n import necesita modificarse.

## Organizaci?n por features

| Feature | Responsabilidades actuales | Decisi?n |
| --- | --- | --- |
| home | Entrada Home.jsx; components y hooks locales | Conservar |
| project-request | Entrada ProjectRequestPage.jsx; components y hooks locales | Conservar |
| projects | ProjectDetailsPage; components, hooks, panels, utils y datos | Conservar |
| admin-users | P?gina, modales y drawer junto a pol?tica; hooks locales | Conservar, sin crear carpetas artificiales |
| admin-files | P?gina encapsulada | Conservar |
| architect-dashboard | P?ginas, components, hooks y datos | Conservar |
| settings | SettingsPage; panels, components y helpers locales | Conservar |

Hay helpers puros locales junto a componentes (`adminProjectBulkActions.js`, `adminProjectPagination.js`), y helpers de settings en la ra?z de la feature. Su ubicaci?n es comprensible y trasladarlos no aporta una ventaja suficiente. `ui/EmptyState/emptyStage.svg` es un recurso preexistente junto al componente; queda documentado como excepci?n a la ubicaci?n de assets, sin migrarlo. Los contextos de sesi?n/proyectos recientes en auth tienen una responsabilidad ligada a la sesi?n. No se dividieron Input, DropdownMenu ni viewers por tama?o.

## API e interfaces p?blicas

`client.js` conserva infraestructura HTTP y helpers compartidos; `http.js` conserva api, reexports de dominios y getApiUrl. authApi, adminApi, projectsApi, projectRequestsApi, environmentCommentsApi y supportApi conservan sus exports. adminDashboardOverview.js adapta los datos del dominio administrativo y permanece en api. No se eliminaron exports ni m?todos p?blicos por falta de uso local: podr?an ser interfaces de compatibilidad.

## Reexports y candidatos conservados

Los archivos ra?z de UI como Avatar.jsx y Accordion.jsx son reexports intencionales, no duplicaciones de implementaci?n. Tambi?n se conservan entradas index.js y reexports sin import local para mantener las rutas p?blicas del Design System. Los m?dulos *ShowcaseData.js son cat?logos de demostraci?n y se conservan. No se detect? una duplicaci?n real cuya eliminaci?n fuera necesaria.

Archivos JS/JSX sin import entrante en el grafo previo (una lista de candidatos, no una autorizaci?n de eliminaci?n):

- `assets/logos/index.js`
- `components/Icon.jsx`
- `components/ui/Accordion/accordionShowcaseData.js`
- `components/ui/Accordion.jsx`
- `components/ui/Alert/alertShowcaseData.js`
- `components/ui/AssigneeMultiSelect.jsx`
- `components/ui/Avatar/avatarShowcaseData.js`
- `components/ui/Avatar.jsx`
- `components/ui/AvatarGroup/avatarGroupShowcaseData.js`
- `components/ui/AvatarGroup.jsx`
- `components/ui/AvatarLabel/avatarLabelShowcaseData.js`
- `components/ui/AvatarLabel.jsx`
- `components/ui/Badge.jsx`
- `components/ui/Button/buttonShowcaseData.js`
- `components/ui/ButtonGroupItem/buttonGroupItemShowcaseData.js`
- `components/ui/Checkbox/checkboxShowcaseData.js`
- `components/ui/CircleProgressBarLabel/circleProgressBarLabelShowcaseData.js`
- `components/ui/CircleProgressBarLabel.jsx`
- `components/ui/CommentPanel/CommentPanel.jsx`
- `components/ui/CommentPanel/commentPanelShowcaseData.js`
- `components/ui/DropdownMenu/dropdownMenuShowcaseData.js`
- `components/ui/EmptyState/emptyStateShowcaseData.js`
- `components/ui/FileAttachmentIcons/fileAttachmentIconsShowcaseData.js`
- `components/ui/FileUploadSection/fileUploadSectionShowcaseData.js`
- `components/ui/Gallery/Panorama360Modal.jsx`
- `components/ui/HintText/hintTextShowcaseData.js`
- `components/ui/HintText.jsx`
- `components/ui/HorizontalTabMenu/horizontalTabMenuShowcaseData.js`
- `components/ui/HorizontalTabMenu.jsx`
- `components/ui/IconContainer/iconContainerShowcaseData.js`
- `components/ui/Input/inputShowcaseData.js`
- `components/ui/Input.jsx`
- `components/ui/Label/labelShowcaseData.js`
- `components/ui/Label.jsx`
- `components/ui/ListItem/listItemShowcaseData.js`
- `components/ui/ListItem/ReplyInput.jsx`
- `components/ui/ListItem.jsx`
- `components/ui/Loader/index.js`
- `components/ui/Modal/modalShowcaseData.js`
- `components/ui/Modal.jsx`
- `components/ui/NavigationBar/navigationBarShowcaseData.js`
- `components/ui/Notification/notificationShowcaseData.js`
- `components/ui/NotificationsPanel/NotificationsPanel.jsx`
- `components/ui/NotificationsPanel/notificationsPanelShowcaseData.js`
- `components/ui/PaginationDots/paginationDotsShowcaseData.js`
- `components/ui/PaginationDots.jsx`
- `components/ui/ProgressBarLabel/progressBarLabelShowcaseData.js`
- `components/ui/ProgressBarLabel.jsx`
- `components/ui/ProgressStepBase/progressStepBaseShowcaseData.js`
- `components/ui/ProgressStepGroup/progressStepGroupShowcaseData.js`
- `components/ui/ProgressStepGroup.jsx`
- `components/ui/ProjectImage/index.js`
- `components/ui/ProjectRequestModal.jsx`
- `components/ui/ScrollBar/scrollBarShowcaseData.js`
- `components/ui/SideNavigation/sideNavigationShowcaseData.js`
- `components/ui/TabItem/tabItemShowcaseData.js`
- `components/ui/TabItem.jsx`
- `components/ui/Tag/tagShowcaseData.js`
- `components/ui/TextArea/textAreaShowcaseData.js`
- `components/ui/TextArea.jsx`
- `components/ui/ThemeToggle.jsx`
- `components/ui/Toggle/toggleShowcaseData.js`
- `components/ui/Toggle.jsx`
- `components/ui/Tooltip/tooltipShowcaseData.js`
- `main.jsx`
- `theme-init.js`

main.jsx y theme-init.js son entradas desde index.html. El resto se conserva por ser API de componentes, cat?logos o candidatos que requieren confirmar su prop?sito antes de eliminar implementaci?n. No hay utilidades compartidas ni m?dulos de API completos sin import entrante.

## Inventario completo por responsabilidad (antes de la limpieza)

## Validación

- Frontend: 217 tests pasan tanto antes como después de la limpieza.
- Backend: 115 tests pasan con `pnpm test`.
- `pnpm verify`: lint de documentación y validación Prisma pasan; la consulta del estado de migraciones termina con `Schema engine error`, por lo que no completa la cadena. No se aplicaron migraciones.
- `pnpm build`: falla con seis imports relativos no resolubles en hooks de `pages/home/hooks`. Estos archivos están idénticos a HEAD y los destinos fallidos no son ninguno de los ocho archivos eliminados. Se conserva esta deuda previa sin corregir lógica ni imports fuera de la limpieza.
- `git diff --check`: pasa. Ningún archivo funcional conservado se modificó.

La primera ejecución de tests dentro del sandbox falló por `spawn EPERM`; al ejecutar los mismos tests con permiso para crear procesos, las suites pasan. No se trata de fallos de tests funcionales.

### Archivos

### api

- `api/adminApi.js`
- `api/adminDashboardOverview.js`
- `api/authApi.js`
- `api/client.js`
- `api/environmentCommentsApi.js`
- `api/http.js`
- `api/projectRequestsApi.js`
- `api/projectsApi.js`
- `api/supportApi.js`

### assets

- `assets/avatar-label-figma-40.svg`
- `assets/circles.svg`
- `assets/empty-state/circles.png`
- `assets/empty-state/Pattern.svg`
- `assets/files/TYPE=AI.svg`
- `assets/files/TYPE=DOC.svg`
- `assets/files/TYPE=PDF.svg`
- `assets/fondos/88c12dc848224c27f9236223c33f47621394518d.jpg`
- `assets/fondos/Project Card.png`
- `assets/fondos/Project Image (1).png`
- `assets/fondos/Project Image.png`
- `assets/fondos/Property 1=actualizar contraseña.png`
- `assets/fondos/Property 1=notificacion.png`
- `assets/fondos/Property 1=restablecer contraseña.png`
- `assets/fondos/Property 1=Variant2.png`
- `assets/fondos/stand-aura-2026.png`
- `assets/icons/x-mark.svg`
- `assets/logos/Group 1.svg`
- `assets/logos/index.js`
- `assets/logos/LOGO 200px.svg`
- `assets/logos/LOGO 64px.svg`
- `assets/logos/LOGO=20px (1).svg`
- `assets/logos/LOGO=24px (1).svg`
- `assets/logos/LOGO=32px (1).svg`
- `assets/logos/LOGO=48px (1).svg`
- `assets/logos/MainLogo.jsx`
- `assets/tracking/bathroom-comparison.png`

### auth

- `auth/AuthContext.jsx`
- `auth/authRoutes.js`
- `auth/authRouteState.js`
- `auth/authSession.js`
- `auth/ProtectedRoute.jsx`
- `auth/PublicOnlyRoute.jsx`
- `auth/RecentProjectsContext.jsx`
- `auth/SessionUnavailable.jsx`
- `auth/testAccess.js`
- `auth/userDisplay.js`

### components

- `components/AdminKpiMetric.jsx`
- `components/EnvironmentNavigationBar.jsx`
- `components/EnvironmentNotificationsDrawer.jsx`
- `components/ExpiredLinkCard.jsx`
- `components/Flag.jsx`
- `components/Icon.jsx`
- `components/layout/AuthLayout.jsx`
- `components/ui/Accordion/Accordion.jsx`
- `components/ui/Accordion/accordionConfig.js`
- `components/ui/Accordion/accordionShowcaseData.js`
- `components/ui/Accordion.jsx`
- `components/ui/Alert/Alert.jsx`
- `components/ui/Alert/alertConfig.js`
- `components/ui/Alert/alertShowcaseData.js`
- `components/ui/AlertToast/AlertToast.jsx`
- `components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx`
- `components/ui/AssigneeMultiSelect/AssigneeRemovalModal.jsx`
- `components/ui/AssigneeMultiSelect/assigneeSelection.js`
- `components/ui/AssigneeMultiSelect.jsx`
- `components/ui/AuthToast/AuthToast.jsx`
- `components/ui/Avatar/Avatar.jsx`
- `components/ui/Avatar/avatarConfig.js`
- `components/ui/Avatar/avatarShowcaseData.js`
- `components/ui/Avatar.jsx`
- `components/ui/AvatarGroup/AvatarGroup.jsx`
- `components/ui/AvatarGroup/avatarGroupConfig.js`
- `components/ui/AvatarGroup/avatarGroupShowcaseData.js`
- `components/ui/AvatarGroup.jsx`
- `components/ui/AvatarLabel/AvatarLabel.jsx`
- `components/ui/AvatarLabel/avatarLabelConfig.js`
- `components/ui/AvatarLabel/avatarLabelShowcaseData.js`
- `components/ui/AvatarLabel.jsx`
- `components/ui/Badge/Badge.jsx`
- `components/ui/Badge/badgeConfig.js`
- `components/ui/Badge/badgeShowcaseData.js`
- `components/ui/Badge.jsx`
- `components/ui/Button/Button.jsx`
- `components/ui/Button/buttonConfig.js`
- `components/ui/Button/buttonShowcaseData.js`
- `components/ui/Button/buttonTooltip.js`
- `components/ui/ButtonGroupItem/ButtonGroupItem.jsx`
- `components/ui/ButtonGroupItem/buttonGroupItemConfig.js`
- `components/ui/ButtonGroupItem/buttonGroupItemShowcaseData.js`
- `components/ui/Card.jsx` ? eliminado
- `components/ui/Checkbox/Checkbox.jsx`
- `components/ui/Checkbox/checkboxConfig.js`
- `components/ui/Checkbox/checkboxShowcaseData.js`
- `components/ui/Checkbox.jsx`
- `components/ui/CircleProgressBarLabel/CircleProgressBarLabel.jsx`
- `components/ui/CircleProgressBarLabel/circleProgressBarLabelConfig.js`
- `components/ui/CircleProgressBarLabel/circleProgressBarLabelShowcaseData.js`
- `components/ui/CircleProgressBarLabel.jsx`
- `components/ui/CommentPanel/CommentPanel.jsx`
- `components/ui/CommentPanel/commentPanelConfig.js`
- `components/ui/CommentPanel/commentPanelShowcaseData.js`
- `components/ui/ComposerSubmitButton.jsx`
- `components/ui/DropdownMenu/DropdownMenu.jsx`
- `components/ui/DropdownMenu/dropdownMenuConfig.js`
- `components/ui/DropdownMenu/dropdownMenuSelection.js`
- `components/ui/DropdownMenu/dropdownMenuShowcaseData.js`
- `components/ui/EmptyState/emptyStage.svg`
- `components/ui/EmptyState/EmptyState.jsx`
- `components/ui/EmptyState/emptyStateConfig.js`
- `components/ui/EmptyState/emptyStateShowcaseData.js`
- `components/ui/EmptyState.jsx`
- `components/ui/FileAttachmentIcons/FileAttachmentIcons.jsx`
- `components/ui/FileAttachmentIcons/fileAttachmentIconsShowcaseData.js`
- `components/ui/FileAttachmentIcons.jsx`
- `components/ui/FileUploadSection/FileUploadSection.jsx`
- `components/ui/FileUploadSection/fileUploadSectionConfig.js`
- `components/ui/FileUploadSection/fileUploadSectionShowcaseData.js`
- `components/ui/FileUploadSection.jsx`
- `components/ui/Gallery/ArchitecturalModelEffects.jsx`
- `components/ui/Gallery/ArchitecturalSettingsPanel.jsx`
- `components/ui/Gallery/GalleryImageCard.jsx`
- `components/ui/Gallery/GalleryImagesModal.jsx`
- `components/ui/Gallery/GalleryVideosModal.jsx`
- `components/ui/Gallery/GeneralCommentsDrawer.jsx`
- `components/ui/Gallery/ImageHighlighter.jsx`
- `components/ui/Gallery/ImageViewerModal.jsx`
- `components/ui/Gallery/model3d/Model3DAnnotations.jsx`
- `components/ui/Gallery/model3d/model3DSelection.js`
- `components/ui/Gallery/Model3DLoadingState.jsx`
- `components/ui/Gallery/Model3DThumbnail.jsx`
- `components/ui/Gallery/model3DViewerConfig.js`
- `components/ui/Gallery/Model3DViewerControls.jsx`
- `components/ui/Gallery/Model3DViewerModal.jsx`
- `components/ui/Gallery/Panorama360Modal.jsx`
- `components/ui/Gallery/Panorama360Viewer.jsx`
- `components/ui/Gallery/SelectionPreview.jsx`
- `components/ui/Gallery/useImageComments.js`
- `components/ui/Gallery/useVideoThumbnail.js`
- `components/ui/Gallery/VideoThumbnail.jsx`
- `components/ui/Gallery/VideoViewerModal.jsx`
- `components/ui/Gallery/viewerIcons.jsx`
- `components/ui/Gallery/VRModelViewer.jsx`
- `components/ui/HintText/HintText.jsx`
- `components/ui/HintText/hintTextConfig.js`
- `components/ui/HintText/hintTextShowcaseData.js`
- `components/ui/HintText.jsx`
- `components/ui/HorizontalTabMenu/HorizontalTabMenu.jsx`
- `components/ui/HorizontalTabMenu/horizontalTabMenuConfig.js`
- `components/ui/HorizontalTabMenu/horizontalTabMenuShowcaseData.js`
- `components/ui/HorizontalTabMenu.jsx`
- `components/ui/IconContainer/IconContainer.jsx`
- `components/ui/IconContainer/iconContainerConfig.js`
- `components/ui/IconContainer/iconContainerShowcaseData.js`
- `components/ui/IconContainer.jsx`
- `components/ui/Input/Input.jsx`
- `components/ui/Input/inputConfig.js`
- `components/ui/Input/inputShowcaseData.js`
- `components/ui/Input/phoneCountryOptions.js`
- `components/ui/Input/phoneCountryOptions.json`
- `components/ui/Input.jsx`
- `components/ui/Label/Label.jsx`
- `components/ui/Label/labelConfig.js`
- `components/ui/Label/labelShowcaseData.js`
- `components/ui/Label.jsx`
- `components/ui/ListItem/ListItem.jsx`
- `components/ui/ListItem/listItemConfig.js`
- `components/ui/ListItem/ListItemContent.jsx`
- `components/ui/ListItem/listItemShowcaseData.js`
- `components/ui/ListItem/ReplyInput.jsx`
- `components/ui/ListItem.jsx`
- `components/ui/Loader/index.js`
- `components/ui/Loader/Loader.jsx`
- `components/ui/LoginBackgroundCarousel.jsx`
- `components/ui/Modal/Modal.jsx`
- `components/ui/Modal/modalConfig.js`
- `components/ui/Modal/ModalOverlay.jsx`
- `components/ui/Modal/modalShowcaseData.js`
- `components/ui/Modal.jsx`
- `components/ui/Navbar.jsx` ? eliminado
- `components/ui/NavigationBar/NavigationBar.jsx`
- `components/ui/NavigationBar/navigationBarConfig.js`
- `components/ui/NavigationBar/navigationBarShowcaseData.js`
- `components/ui/Notification/Notification.jsx`
- `components/ui/Notification/notificationConfig.js`
- `components/ui/Notification/notificationShowcaseData.js`
- `components/ui/NotificationsDrawer.jsx`
- `components/ui/NotificationsPanel/NotificationsPanel.jsx`
- `components/ui/NotificationsPanel/notificationsPanelConfig.js`
- `components/ui/NotificationsPanel/notificationsPanelShowcaseData.js`
- `components/ui/ObservationTooltip/observationTooltip.js`
- `components/ui/ObservationTooltip/ObservationTooltip.jsx`
- `components/ui/PaginationDots/PaginationDots.jsx`
- `components/ui/PaginationDots/paginationDotsConfig.js`
- `components/ui/PaginationDots/paginationDotsShowcaseData.js`
- `components/ui/PaginationDots.jsx`
- `components/ui/ProgressBarLabel/ProgressBarLabel.jsx`
- `components/ui/ProgressBarLabel/progressBarLabelConfig.js`
- `components/ui/ProgressBarLabel/progressBarLabelShowcaseData.js`
- `components/ui/ProgressBarLabel.jsx`
- `components/ui/ProgressStepBase/ProgressStepBase.jsx`
- `components/ui/ProgressStepBase/progressStepBaseConfig.js`
- `components/ui/ProgressStepBase/progressStepBaseShowcaseData.js`
- `components/ui/ProgressStepBase.jsx`
- `components/ui/ProgressStepGroup/ProgressStepGroup.jsx`
- `components/ui/ProgressStepGroup/progressStepGroupConfig.js`
- `components/ui/ProgressStepGroup/progressStepGroupShowcaseData.js`
- `components/ui/ProgressStepGroup.jsx`
- `components/ui/ProjectImage/index.js`
- `components/ui/ProjectImage/ProjectImage.jsx`
- `components/ui/ProjectProgress/ProjectProgress.jsx`
- `components/ui/ProjectRequestFlow/ProjectLocationSuggestions.jsx`
- `components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx`
- `components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx`
- `components/ui/ProjectRequestFlow/ProjectRequestModalShell.jsx`
- `components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx`
- `components/ui/ProjectRequestFlow/ProjectRequestSuccessStep.jsx`
- `components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx`
- `components/ui/ProjectRequestModal.jsx`
- `components/ui/ProjectsShowcaseCarousel.jsx`
- `components/ui/ScrollBar/ScrollBar.jsx`
- `components/ui/ScrollBar/scrollBarConfig.js`
- `components/ui/ScrollBar/scrollBarShowcaseData.js`
- `components/ui/ScrollBar.jsx`
- `components/ui/Select.jsx` ? eliminado
- `components/ui/SettingsVerticalTabMenu.jsx`
- `components/ui/Sidebar.jsx` ? eliminado
- `components/ui/SideNavigation/SideNavigation.jsx`
- `components/ui/SideNavigation/sideNavigationConfig.js`
- `components/ui/SideNavigation/sideNavigationShowcaseData.js`
- `components/ui/SideOverlayDrawer.jsx`
- `components/ui/TabItem/TabItem.jsx`
- `components/ui/TabItem/tabItemConfig.js`
- `components/ui/TabItem/tabItemShowcaseData.js`
- `components/ui/TabItem.jsx`
- `components/ui/Table.jsx` ? eliminado
- `components/ui/TabPanel.jsx`
- `components/ui/Tag/Tag.jsx`
- `components/ui/Tag/tagConfig.js`
- `components/ui/Tag/tagShowcaseData.js`
- `components/ui/TextArea/TextArea.jsx`
- `components/ui/TextArea/textAreaConfig.js`
- `components/ui/TextArea/textAreaShowcaseData.js`
- `components/ui/TextArea.jsx`
- `components/ui/ThemeSync.jsx`
- `components/ui/ThemeToggle.jsx`
- `components/ui/Toggle/Toggle.jsx`
- `components/ui/Toggle/toggleConfig.js`
- `components/ui/Toggle/toggleShowcaseData.js`
- `components/ui/Toggle.jsx`
- `components/ui/Tooltip/Tooltip.jsx`
- `components/ui/Tooltip/tooltipConfig.js`
- `components/ui/Tooltip/tooltipPosition.js`
- `components/ui/Tooltip/tooltipShowcaseData.js`

### config

- `config/modelViewer.js`

### contexts

- `contexts/ProjectReadOnlyContext.jsx`

### data

- `data/environmentDrawerExamples.js`

### hooks

- `hooks/useAddressSuggestions.js`
- `hooks/useAdminRecentActivity.js`
- `hooks/useBodyScrollLock.js`
- `hooks/useDocumentComments.js`
- `hooks/useModelRenderSettings.js`
- `hooks/useProjectComments.js`
- `hooks/useScrollDirectionVisibility.js`
- `hooks/useSketchfabLikeModelWheel.js`
- `hooks/useVrViewerLaunch.js`

### index.css

- `index.css`

### layouts

- `layouts/AuthLayout.jsx` ? eliminado
- `layouts/MainLayout.jsx` ? eliminado

### main.jsx

- `main.jsx`

### pages

- `pages/admin-files/AdminFilesPage.jsx`
- `pages/admin-users/AdminUserActionsMenu.jsx`
- `pages/admin-users/AdminUserDetailsDrawer.jsx`
- `pages/admin-users/AdminUsersPage.jsx`
- `pages/admin-users/AdminUserStatusModal.jsx`
- `pages/admin-users/adminUserStatusPolicy.js`
- `pages/admin-users/CreateAdminUserModal.jsx`
- `pages/admin-users/EditAdminUserModal.jsx`
- `pages/admin-users/hooks/useAdminUsersActions.js`
- `pages/admin-users/hooks/useAdminUsersData.js`
- `pages/architect-dashboard/ArchitectDashboard.jsx`
- `pages/architect-dashboard/architectDashboardData.js`
- `pages/architect-dashboard/components/AdminActiveProjects.css`
- `pages/architect-dashboard/components/AdminActiveProjects.jsx`
- `pages/architect-dashboard/components/AdminDashboardHeader.jsx`
- `pages/architect-dashboard/components/AdminDashboardMetrics.jsx`
- `pages/architect-dashboard/components/AdminDashboardOperations.jsx`
- `pages/architect-dashboard/components/AdminDashboardOverview.jsx`
- `pages/architect-dashboard/components/adminProjectBulkActions.js`
- `pages/architect-dashboard/components/adminProjectPagination.js`
- `pages/architect-dashboard/components/AdminRequestAssignmentModal.jsx`
- `pages/architect-dashboard/components/AdminRequestLoginAlert.jsx`
- `pages/architect-dashboard/components/ArchitectProjectGroup.jsx`
- `pages/architect-dashboard/components/ArchitectProjectInformationForm.jsx`
- `pages/architect-dashboard/components/ArchitectProjectRow.jsx`
- `pages/architect-dashboard/components/ArchitectStatusBadge.jsx`
- `pages/architect-dashboard/components/ProjectCreationTabs.jsx`
- `pages/architect-dashboard/components/ProjectRequestReviewQueue.jsx`
- `pages/architect-dashboard/components/ProjectRequestWorkflowModal.jsx`
- `pages/architect-dashboard/hooks/useAdminDashboardData.js`
- `pages/architect-dashboard/hooks/useDashboardProjects.js`
- `pages/architect-dashboard/hooks/useDashboardRequestWorkflow.js`
- `pages/architect-dashboard/NewArchitectProjectPage.jsx`
- `pages/clientDrawerData.js`
- `pages/CreateAccount.jsx`
- `pages/CreatePassword.jsx`
- `pages/EmptyArchitectDashboardExample.jsx`
- `pages/EmptyProjectDocumentsExample.jsx`
- `pages/EmptyProjectInfoExample.jsx`
- `pages/EmptyProjectRendersExample.jsx`
- `pages/EmptyProjectsExample.jsx`
- `pages/EmptyProjectTrackingExample.jsx`
- `pages/EmptyProjectWarrantiesExample.jsx`
- `pages/home/components/HomeContentSections.jsx`
- `pages/home/components/HomeProjectRows.jsx`
- `pages/home/hooks/useHomeNavigation.js`
- `pages/home/hooks/useHomeNotifications.js`
- `pages/home/hooks/useHomeProjectRequests.js`
- `pages/home/hooks/useHomeProjects.js`
- `pages/home/hooks/useSyncedScrollBar.js`
- `pages/Home.jsx`
- `pages/InactiveAccount.jsx`
- `pages/Login.jsx`
- `pages/NewPassword.jsx`
- `pages/pages.js` ? eliminado
- `pages/project-request/components/ProjectRequestFormFields.jsx`
- `pages/project-request/components/ProjectRequestReceivedView.jsx`
- `pages/project-request/hooks/useProjectRequestFiles.js`
- `pages/project-request/hooks/useProjectRequestForm.js`
- `pages/project-request/hooks/useProjectRequestNavigation.js`
- `pages/project-request/hooks/useProjectRequestNotifications.js`
- `pages/project-request/hooks/useProjectRequestSubmission.js`
- `pages/ProjectDetails.jsx`
- `pages/ProjectRequestPage.jsx`
- `pages/projects/components/document-preview/DocumentFullscreenModal.jsx`
- `pages/projects/components/document-preview/DocumentMarker.jsx`
- `pages/projects/components/document-preview/DocumentViewerControls.jsx`
- `pages/projects/components/document-preview/DocxViewerSurface.jsx`
- `pages/projects/components/document-preview/PdfViewerSurface.jsx`
- `pages/projects/components/document-preview/XlsxViewerSurface.jsx`
- `pages/projects/components/ProjectActivePanel.jsx`
- `pages/projects/components/ProjectDetailTabMenu.jsx`
- `pages/projects/components/ProjectDocumentCard.jsx`
- `pages/projects/components/ProjectDocumentListCard.jsx`
- `pages/projects/components/ProjectDocumentPreview.jsx`
- `pages/projects/components/ProjectDocumentsToolbar.jsx`
- `pages/projects/components/ProjectOverviewHeader.jsx`
- `pages/projects/components/renders/ImageGallerySection.jsx`
- `pages/projects/components/renders/MediaEmptyState.jsx`
- `pages/projects/components/renders/RenderLoadingState.jsx`
- `pages/projects/components/renders/RenderStage.jsx`
- `pages/projects/components/renders/RenderThumbnailRail.jsx`
- `pages/projects/components/renders/VideoGallerySection.jsx`
- `pages/projects/components/tracking/ProjectTrackingComparisonGallery.jsx`
- `pages/projects/components/tracking/ProjectTrackingIcons.jsx`
- `pages/projects/components/tracking/ProjectTrackingMilestonesCard.jsx`
- `pages/projects/components/tracking/ProjectTrackingStagesCard.jsx`
- `pages/projects/components/tracking/ProjectTrackingSummaryRow.jsx`
- `pages/projects/hooks/useProjectDetailsComments.js`
- `pages/projects/hooks/useProjectDetailsData.js`
- `pages/projects/hooks/useProjectDetailsNavigation.js`
- `pages/projects/hooks/useProjectDetailsTabs.js`
- `pages/projects/panels/ProjectDocumentsPanel.jsx`
- `pages/projects/panels/ProjectInfoPanel.jsx`
- `pages/projects/panels/ProjectRendersPanel.jsx`
- `pages/projects/panels/ProjectTrackingPanel.jsx`
- `pages/projects/panels/ProjectUploadFilesPanel.jsx`
- `pages/projects/panels/ProjectWarrantiesPanel.jsx`
- `pages/projects/projectDetailsData.js`
- `pages/projects/ProjectDetailsPage.jsx`
- `pages/projects/projectRenderGalleryData.js`
- `pages/projects/projectTrackingData.js`
- `pages/projects/projectVideoGalleryData.js`
- `pages/projects/projectWarrantyData.js`
- `pages/projects/utils/projectDetailsPresentation.js`
- `pages/PublicProjectsGallery.jsx`
- `pages/RecoverAccount.jsx`
- `pages/settings/components/AvatarUploadModal.jsx`
- `pages/settings/panels/PreferencesPanel.jsx`
- `pages/settings/panels/ProfilePanel.jsx`
- `pages/settings/panels/SecurityPanel.jsx`
- `pages/settings/panels/SupportPanel.jsx`
- `pages/settings/PreferenceItem.jsx`
- `pages/settings/settingsIcons.jsx`
- `pages/settings/SettingsPage.jsx`
- `pages/settings/themeUtils.js`
- `pages/Settings.jsx`

### styles

- `styles/global.css`
- `styles/typography.css`

### theme-init.js

- `theme-init.js`

### utils

- `utils/adminActivity.js`
- `utils/architecturalRendering.js`
- `utils/avatarPresentation.js`
- `utils/commentDisplay.js`
- `utils/commentSelection.js`
- `utils/fileDisplayName.js`
- `utils/fileMetrics.js`
- `utils/geoapify.js`
- `utils/model3DThumbnail.js`
- `utils/modelViewerCamera.js`
- `utils/observationAccess.js`
- `utils/panoramaCoordinates.js`
- `utils/panoramaViewerState.js`
- `utils/projectAssigneeDisplay.js`
- `utils/projectImage.js`
- `utils/projectOverviewStages.js`
- `utils/projectReadOnly.js`
- `utils/projectRequestOptions.js`
- `utils/projectRequestStatus.js`
- `utils/projectRequestValidation.js`
- `utils/projectRoutes.js`
- `utils/projectStatusGroups.js`
- `utils/projectTypeDisplay.js`
- `utils/publicProjectGallery.js`
- `utils/publicProjectGalleryLayout.js`
- `utils/recentProjects.js`
- `utils/relativeTime.js`
- `utils/sideNavigationItems.js`
- `utils/userFacingError.js`
- `utils/videoObservation.js`
- `utils/videoThumbnail.js`
- `utils/vrLocomotion.js`

## Actualización de ubicaciones: fase 1 administrativa (5 de octubre de 2026)

El inventario anterior conserva las ubicaciones históricas de la auditoría. Las ubicaciones actuales de los archivos exclusivos del dashboard administrativo son:

- `src/pages/admin-dashboard/components/`: `AdminDashboardHeader.jsx`, `AdminDashboardMetrics.jsx`, `AdminDashboardOperations.jsx`, `AdminDashboardOverview.jsx`, `AdminRequestAssignmentModal.jsx` y `AdminRequestLoginAlert.jsx`.
- `src/pages/admin-dashboard/components/admin-active-projects/`: subárbol completo, con su componente, CSS, index, hooks y utils en la misma estructura interna.
- `src/pages/admin-dashboard/hooks/useAdminDashboardData.js`.

`ArchitectDashboard.jsx` permanece en `architect-dashboard/` y consume temporalmente estas nuevas ubicaciones. Esta fase solo traslada archivos y actualiza referencias; conserva rutas, lógica y comportamiento, sin crear `AdminDashboard.jsx` ni separar `useDashboardRequestWorkflow.js`.

