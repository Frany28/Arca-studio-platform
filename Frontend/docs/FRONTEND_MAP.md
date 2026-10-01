# Mapeo del frontend

Generado con `pnpm audit:frontend`. El JSON adjunto contiene todos los archivos y las dependencias directas, incluidos imports dinámicos y reexportaciones.

## Alcance y límites

La alcanzabilidad parte de los scripts de index.html y sigue imports locales de JavaScript/JSX. Un componente alcanzable puede pertenecer a una ruta de ejemplo; esto no confirma que se visite en ejecución. Los consumidores son módulos importadores, no un conteo de renders. No se ejecuta ni elimina código para analizarlo.

Un módulo no alcanzable es candidato a revisión, no prueba suficiente para borrarlo: puede ser catálogo, configuración, compatibilidad, recurso usado por CSS o consumidor externo. Los recursos y estilos se enumeran; sus referencias indirectas o construidas en ejecución no se resuelven. No se auditan exports individuales ni la interacción visual.

HTML semántico (div, section, form, enlaces, imágenes y videos) sigue siendo necesario. Los controles nativos pertenecen a los componentes base; fuera de ui se revisan contra sus equivalentes. Los inputs file/hidden tienen una finalidad técnica y se identifican aparte.

## Resumen

| Indicador | Cantidad |
| --- | --- |
| files | 503 |
| modules | 386 |
| components | 213 |
| reachableComponents | 177 |
| dormantModules | 90 |
| nativeControlsOutsideUI | 0 |
| missingImports | 0 |
| boundaryViolations | 0 |

## Organización

| Carpeta | Responsabilidad | Archivos |
| --- | --- | --- |
| api | Cliente HTTP y endpoints | 2 |
| assets | Medios, fuentes e iconos | 108 |
| auth | Sesión, permisos y proveedores de autenticación | 10 |
| components | UI compartida y composición de producto | 198 |
| config | Configuración global | 1 |
| contexts | Contextos compartidos | 1 |
| data | Catálogos compartidos | 1 |
| hooks | Comportamiento reutilizable | 8 |
| layouts | Composición de páginas | 0 |
| pages | Rutas y módulos funcionales | 138 |
| styles | Tokens y tipografía | 2 |
| utils | Lógica pura | 31 |

## Rutas

| Ruta | Declaración |
| --- | --- |
| / | src/main.jsx:75 |
| /servicios | src/main.jsx:76 |
| /login | src/main.jsx:77 |
| /crear-cuenta | src/main.jsx:78 |
| /crear-contrasena | src/main.jsx:79 |
| /cuenta-inactiva | src/main.jsx:82 |
| /recuperar-cuenta | src/main.jsx:83 |
| /nueva-contraseña | src/main.jsx:84 |
| /dashboard-clientes | src/main.jsx:87 |
| /solicitudes | src/main.jsx:88 |
| /solicitudes/nueva | src/main.jsx:89 |
| /dashboard-clientes-vacio | src/main.jsx:90 |
| /dashboard-arquitecto | src/main.jsx:99 |
| /dashboard-arquitecto/nuevo-proyecto | src/main.jsx:103 |
| /dashboard-arquitecto-vacio | src/main.jsx:107 |
| /archivos | src/main.jsx:114 |
| /usuarios | src/main.jsx:115 |
| /usuarios-vacio | src/main.jsx:116 |
| /dashboard-admin-vacio | src/main.jsx:120 |
| /proyectos | src/main.jsx:127 |
| /proyectos/:projectId | src/main.jsx:128 |
| /configuraciones | src/main.jsx:129 |
| /proyectos/quinta-bella-vista/renders-imagenes-vacio | src/main.jsx:130 |
| /proyectos/quinta-bella-vista/informacion-general-vacio | src/main.jsx:134 |
| /proyectos/quinta-bella-vista/documentos-vacio | src/main.jsx:138 |
| /proyectos/quinta-bella-vista/seguimiento-vacio | src/main.jsx:142 |
| /proyectos/quinta-bella-vista/garantias-vacio | src/main.jsx:146 |

## Componentes y consumidores

| Componente | Estado | Consumidores directos |
| --- | --- | --- |
| src/assets/logos/MainLogo.jsx | Alcanzable | src/assets/logos/index.js<br>src/components/ui/FooterSection/FooterSection.jsx<br>src/components/ui/Gallery/ImageViewerModal.jsx<br>src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/components/ui/Gallery/VideoViewerModal.jsx<br>src/components/ui/LoginBackgroundCarousel.jsx<br>src/components/ui/NavigationBar/NavigationBar.jsx<br>src/components/ui/ProjectsShowcaseCarousel.jsx<br>src/components/ui/SideNavigation/SideNavigation.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx<br>src/pages/publicSite/components/PublicSiteHeader/PublicSiteHeader.jsx<br>src/pages/publicSite/featuredProjects/components/FeaturedProjectsGallery.jsx |
| src/auth/AuthContext.jsx | Alcanzable | src/auth/ProtectedRoute.jsx<br>src/auth/PublicOnlyRoute.jsx<br>src/auth/RecentProjectsContext.jsx<br>src/components/EnvironmentNotificationsDrawer.jsx<br>src/components/ui/Gallery/useImageComments.js<br>src/components/ui/SideNavigation/SideNavigation.jsx<br>src/hooks/useDocumentComments.js<br>src/main.jsx<br>src/pages/CreatePassword.jsx<br>src/pages/EmptyProjectRendersExample.jsx<br>src/pages/EmptyProjectsExample.jsx<br>src/pages/Home.jsx<br>src/pages/Login.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/admin-files/AdminFilesPage.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/ArchitectDashboard.jsx<br>src/pages/architect-dashboard/NewArchitectProjectPage.jsx<br>src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/settings/SettingsPage.jsx |
| src/auth/ProtectedRoute.jsx | Alcanzable | src/main.jsx |
| src/auth/PublicOnlyRoute.jsx | Alcanzable | src/main.jsx |
| src/auth/RecentProjectsContext.jsx | Alcanzable | src/components/ui/SideNavigation/SideNavigation.jsx<br>src/main.jsx<br>src/pages/ProjectRequestPage.jsx |
| src/auth/SessionUnavailable.jsx | Alcanzable | src/auth/ProtectedRoute.jsx<br>src/auth/PublicOnlyRoute.jsx |
| src/components/AdminKpiMetric.jsx | Alcanzable | src/pages/admin-files/AdminFilesPage.jsx<br>src/pages/admin-users/AdminUsersPage.jsx |
| src/components/EnvironmentNavigationBar.jsx | Alcanzable | src/pages/EmptyProjectRendersExample.jsx<br>src/pages/EmptyProjectsExample.jsx<br>src/pages/Home.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/admin-files/AdminFilesPage.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/ArchitectDashboard.jsx<br>src/pages/architect-dashboard/NewArchitectProjectPage.jsx<br>src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/settings/SettingsPage.jsx |
| src/components/EnvironmentNotificationsDrawer.jsx | Alcanzable | src/pages/EmptyProjectRendersExample.jsx<br>src/pages/EmptyProjectsExample.jsx<br>src/pages/Home.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/admin-files/AdminFilesPage.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/ArchitectDashboard.jsx<br>src/pages/architect-dashboard/NewArchitectProjectPage.jsx<br>src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/settings/SettingsPage.jsx |
| src/components/ExpiredLinkCard.jsx | Alcanzable | src/pages/CreatePassword.jsx<br>src/pages/NewPassword.jsx |
| src/components/Flag.jsx | Alcanzable | src/components/ui/Badge/Badge.jsx<br>src/components/ui/DropdownMenu/DropdownMenu.jsx<br>src/components/ui/Input/Input.jsx<br>src/components/ui/Tag/Tag.jsx |
| src/components/Icon.jsx | No alcanzable | Sin importadores en src |
| src/components/layout/AuthLayout.jsx | Alcanzable | src/pages/CreateAccount.jsx<br>src/pages/CreatePassword.jsx<br>src/pages/InactiveAccount.jsx<br>src/pages/Login.jsx<br>src/pages/NewPassword.jsx<br>src/pages/RecoverAccount.jsx |
| src/components/ui/Accordion.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/Accordion/Accordion.jsx | Alcanzable | src/components/ui/Accordion.jsx<br>src/pages/projects/panels/ProjectInfoPanel.jsx |
| src/components/ui/AlertToast/AlertToast.jsx | Alcanzable | src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/ArchitectDashboard.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/AdminRequestLoginAlert.jsx |
| src/components/ui/Alert/Alert.jsx | Alcanzable | src/components/ui/AlertToast/AlertToast.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/projects/ProjectDetailsPage.jsx |
| src/components/ui/AssigneeMultiSelect.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx | Alcanzable | src/components/ui/AssigneeMultiSelect.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOverview.jsx<br>src/pages/architect-dashboard/components/AdminRequestAssignmentModal.jsx |
| src/components/ui/AssigneeMultiSelect/AssigneeRemovalModal.jsx | Alcanzable | src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx |
| src/components/ui/AuthToast/AuthToast.jsx | Alcanzable | src/pages/CreateAccount.jsx<br>src/pages/Home.jsx<br>src/pages/Login.jsx<br>src/pages/RecoverAccount.jsx<br>src/pages/projects/panels/ProjectUploadFilesPanel.jsx<br>src/pages/settings/SettingsPage.jsx |
| src/components/ui/Avatar.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/AvatarGroup.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/AvatarGroup/AvatarGroup.jsx | Alcanzable | src/components/ui/AvatarGroup.jsx<br>src/components/ui/ProjectsShowcaseCarousel.jsx<br>src/pages/Home.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectRow.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx |
| src/components/ui/AvatarLabel.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/AvatarLabel/AvatarLabel.jsx | Alcanzable | src/components/ui/AvatarLabel.jsx<br>src/components/ui/Gallery/GalleryVideosModal.jsx<br>src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/components/ui/SideNavigation/SideNavigation.jsx<br>src/pages/projects/components/ProjectDocumentCard.jsx |
| src/components/ui/Avatar/Avatar.jsx | Alcanzable | src/components/ui/Avatar.jsx<br>src/components/ui/AvatarGroup/AvatarGroup.jsx<br>src/components/ui/AvatarLabel/AvatarLabel.jsx<br>src/components/ui/DropdownMenu/DropdownMenu.jsx<br>src/components/ui/ListItem/ListItem.jsx<br>src/components/ui/Notification/Notification.jsx<br>src/components/ui/NotificationsDrawer.jsx<br>src/components/ui/ObservationTooltip/ObservationTooltip.jsx<br>src/components/ui/Tag/Tag.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/panels/ProjectInfoPanel.jsx<br>src/pages/settings/components/AvatarUploadModal.jsx<br>src/pages/settings/panels/ProfilePanel.jsx |
| src/components/ui/Badge.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/Badge/Badge.jsx | Alcanzable | src/components/ui/Badge.jsx<br>src/components/ui/ListItem/ListItemContent.jsx<br>src/components/ui/NotificationsDrawer.jsx<br>src/pages/Home.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/AdminDashboardMetrics.jsx<br>src/pages/projects/panels/ProjectWarrantiesPanel.jsx<br>src/pages/settings/panels/ProfilePanel.jsx |
| src/components/ui/ButtonGroupItem/ButtonGroupItem.jsx | Alcanzable | src/components/ui/Gallery/Model3DViewerModal.jsx |
| src/components/ui/Button/Button.jsx | Alcanzable | src/auth/SessionUnavailable.jsx<br>src/components/ExpiredLinkCard.jsx<br>src/components/ui/Alert/Alert.jsx<br>src/components/ui/EmptyState/EmptyState.jsx<br>src/components/ui/FileUploadSection/FileUploadSection.jsx<br>src/components/ui/FooterSection/FooterSection.jsx<br>src/components/ui/Gallery/GalleryImagesModal.jsx<br>src/components/ui/Gallery/GalleryVideosModal.jsx<br>src/components/ui/Gallery/ImageViewerModal.jsx<br>src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/components/ui/Gallery/Panorama360Modal.jsx<br>src/components/ui/Gallery/Panorama360Viewer.jsx<br>src/components/ui/Gallery/VRModelViewer.jsx<br>src/components/ui/Gallery/VideoViewerModal.jsx<br>src/components/ui/ListItem/ListItemContent.jsx<br>src/components/ui/Modal/Modal.jsx<br>src/components/ui/NavigationBar/NavigationBar.jsx<br>src/components/ui/Notification/Notification.jsx<br>src/components/ui/NotificationsDrawer.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestModalShell.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestSuccessStep.jsx<br>src/components/ui/ProjectsShowcaseCarousel.jsx<br>src/components/ui/SideNavigation/SideNavigation.jsx<br>src/pages/CreateAccount.jsx<br>src/pages/CreatePassword.jsx<br>src/pages/EmptyProjectsExample.jsx<br>src/pages/Home.jsx<br>src/pages/InactiveAccount.jsx<br>src/pages/Login.jsx<br>src/pages/NewPassword.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/RecoverAccount.jsx<br>src/pages/admin-users/AdminUserActionsMenu.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/admin-users/CreateAdminUserModal.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/AdminDashboardHeader.jsx<br>src/pages/architect-dashboard/components/AdminDashboardMetrics.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOperations.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOverview.jsx<br>src/pages/architect-dashboard/components/AdminRequestAssignmentModal.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectRow.jsx<br>src/pages/architect-dashboard/components/ProjectCreationTabs.jsx<br>src/pages/architect-dashboard/components/ProjectRequestReviewQueue.jsx<br>src/pages/architect-dashboard/components/ProjectRequestWorkflowModal.jsx<br>src/pages/project-request/components/ProjectRequestReceivedView.jsx<br>src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/projects/components/ProjectDocumentCard.jsx<br>src/pages/projects/components/ProjectDocumentListCard.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/components/ProjectDocumentsToolbar.jsx<br>src/pages/projects/components/tracking/ProjectTrackingComparisonGallery.jsx<br>src/pages/projects/panels/ProjectInfoPanel.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx<br>src/pages/projects/panels/ProjectWarrantiesPanel.jsx<br>src/pages/publicSite/components/PublicSiteHeader/PublicSiteHeader.jsx<br>src/pages/publicSite/components/PublicSiteHeader/PublicSiteMobileMenu.jsx<br>src/pages/publicSite/components/PublicSiteHeader/PublicSiteNavigationMenu.jsx<br>src/pages/publicSite/contact/components/ContactSection.jsx<br>src/pages/publicSite/processes/components/ProcessesVideoGrid.jsx<br>src/pages/publicSite/services/components/ServicesCategoryShowcase.jsx<br>src/pages/settings/components/AvatarUploadModal.jsx<br>src/pages/settings/panels/ProfilePanel.jsx<br>src/pages/settings/panels/SecurityPanel.jsx<br>src/pages/settings/panels/SupportPanel.jsx |
| src/components/ui/Checkbox.jsx | Alcanzable; reexportación de compatibilidad | src/components/ui/Modal/Modal.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx |
| src/components/ui/Checkbox/Checkbox.jsx | Alcanzable | src/components/ui/Checkbox.jsx<br>src/components/ui/DropdownMenu/DropdownMenu.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx |
| src/components/ui/CircleProgressBarLabel.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/CircleProgressBarLabel/CircleProgressBarLabel.jsx | Alcanzable | src/components/ui/CircleProgressBarLabel.jsx<br>src/pages/projects/components/ProjectOverviewHeader.jsx<br>src/pages/projects/components/tracking/ProjectTrackingSummaryRow.jsx |
| src/components/ui/CommentPanel/CommentPanel.jsx | No alcanzable | Sin importadores en src |
| src/components/ui/ComposerSubmitButton.jsx | Alcanzable | src/components/ui/NotificationsDrawer.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx |
| src/components/ui/DropdownMenu/DropdownMenu.jsx | Alcanzable | src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/admin-users/CreateAdminUserModal.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectInformationForm.jsx<br>src/pages/projects/components/tracking/ProjectTrackingComparisonGallery.jsx<br>src/pages/projects/panels/ProjectWarrantiesPanel.jsx<br>src/pages/settings/panels/PreferencesPanel.jsx<br>src/pages/settings/panels/SupportPanel.jsx |
| src/components/ui/EmptyState.jsx | Alcanzable; reexportación de compatibilidad | src/pages/EmptyProjectsExample.jsx<br>src/pages/Home.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/projects/components/tracking/ProjectTrackingComparisonGallery.jsx<br>src/pages/projects/components/tracking/ProjectTrackingMilestonesCard.jsx<br>src/pages/projects/components/tracking/ProjectTrackingStagesCard.jsx<br>src/pages/projects/panels/ProjectInfoPanel.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx<br>src/pages/projects/panels/ProjectWarrantiesPanel.jsx |
| src/components/ui/EmptyState/EmptyState.jsx | Alcanzable | src/components/ui/EmptyState.jsx<br>src/components/ui/NotificationsDrawer.jsx<br>src/pages/admin-files/AdminFilesPage.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/ArchitectDashboard.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOperations.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOverview.jsx<br>src/pages/architect-dashboard/components/ProjectRequestReviewQueue.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/panels/ProjectDocumentsPanel.jsx |
| src/components/ui/FileAttachmentIcons.jsx | Alcanzable; reexportación de compatibilidad | src/components/ui/FileUploadSection/FileUploadSection.jsx |
| src/components/ui/FileAttachmentIcons/FileAttachmentIcons.jsx | Alcanzable | src/components/ui/FileAttachmentIcons.jsx<br>src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/components/ui/NotificationsDrawer.jsx<br>src/pages/projects/components/ProjectDocumentCard.jsx<br>src/pages/projects/components/ProjectDocumentListCard.jsx<br>src/pages/projects/panels/ProjectInfoPanel.jsx |
| src/components/ui/FileUploadSection.jsx | No alcanzable; reexportación de compatibilidad | src/components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx |
| src/components/ui/FileUploadSection/FileUploadSection.jsx | Alcanzable | src/components/ui/FileUploadSection.jsx<br>src/pages/projects/panels/ProjectUploadFilesPanel.jsx<br>src/pages/settings/components/AvatarUploadModal.jsx<br>src/pages/settings/panels/SupportPanel.jsx |
| src/components/ui/FooterSection.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/FooterSection/FooterSection.jsx | Alcanzable | src/components/ui/FooterSection.jsx<br>src/pages/publicSite/contact/components/ContactSection.jsx |
| src/components/ui/Gallery/ArchitecturalModelEffects.jsx | Alcanzable | src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/ArchitecturalSettingsPanel.jsx | Alcanzable | src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/GalleryImageCard.jsx | Alcanzable | src/components/ui/Gallery/GalleryImagesModal.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/GalleryImagesModal.jsx | Alcanzable | src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/GalleryVideosModal.jsx | Alcanzable | src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/ImageHighlighter.jsx | Alcanzable | src/components/ui/Gallery/ImageViewerModal.jsx<br>src/components/ui/Gallery/Model3DViewerModal.jsx |
| src/components/ui/Gallery/ImageViewerModal.jsx | Alcanzable | src/components/ui/Gallery/GalleryImagesModal.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/Model3DThumbnail.jsx | Alcanzable | src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/Model3DViewerModal.jsx | Alcanzable | src/components/ui/Gallery/ImageViewerModal.jsx<br>src/components/ui/Gallery/Panorama360Viewer.jsx<br>src/components/ui/Gallery/VideoViewerModal.jsx<br>src/components/ui/NotificationsDrawer.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/Panorama360Modal.jsx | No alcanzable | Sin importadores en src |
| src/components/ui/Gallery/Panorama360Viewer.jsx | No alcanzable | src/components/ui/Gallery/Panorama360Modal.jsx |
| src/components/ui/Gallery/VRModelViewer.jsx | Alcanzable | src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/VideoThumbnail.jsx | Alcanzable | src/components/ui/Gallery/GalleryVideosModal.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/Gallery/VideoViewerModal.jsx | Alcanzable | src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/HintText.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/HintText/HintText.jsx | Alcanzable | src/components/ui/HintText.jsx<br>src/components/ui/Input/Input.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx<br>src/components/ui/TextArea/TextArea.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/admin-users/CreateAdminUserModal.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectInformationForm.jsx<br>src/pages/projects/panels/ProjectUploadFilesPanel.jsx<br>src/pages/settings/panels/ProfilePanel.jsx<br>src/pages/settings/panels/SupportPanel.jsx |
| src/components/ui/HorizontalTabMenu.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/HorizontalTabMenu/HorizontalTabMenu.jsx | Alcanzable | src/components/ui/FooterSection/FooterSection.jsx<br>src/components/ui/HorizontalTabMenu.jsx<br>src/components/ui/NavigationBar/NavigationBar.jsx<br>src/pages/CreateAccount.jsx<br>src/pages/projects/components/ProjectDetailTabMenu.jsx |
| src/components/ui/IconContainer.jsx | Alcanzable; reexportación de compatibilidad | src/components/ui/Modal/Modal.jsx<br>src/pages/architect-dashboard/components/AdminRequestAssignmentModal.jsx<br>src/pages/projects/components/tracking/ProjectTrackingMilestonesCard.jsx<br>src/pages/projects/components/tracking/ProjectTrackingSummaryRow.jsx<br>src/pages/projects/panels/ProjectDocumentsPanel.jsx |
| src/components/ui/IconContainer/IconContainer.jsx | Alcanzable | src/components/AdminKpiMetric.jsx<br>src/components/ui/IconContainer.jsx<br>src/components/ui/Notification/Notification.jsx<br>src/pages/architect-dashboard/components/AdminDashboardMetrics.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOperations.jsx |
| src/components/ui/Input.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/Input/Input.jsx | Alcanzable | src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx<br>src/components/ui/FooterSection/FooterSection.jsx<br>src/components/ui/Input.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx<br>src/components/ui/SideNavigation/SideNavigation.jsx<br>src/pages/CreateAccount.jsx<br>src/pages/CreatePassword.jsx<br>src/pages/Login.jsx<br>src/pages/NewPassword.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/RecoverAccount.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/admin-users/CreateAdminUserModal.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectInformationForm.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/components/ProjectDocumentsToolbar.jsx<br>src/pages/projects/panels/ProjectWarrantiesPanel.jsx<br>src/pages/settings/panels/ProfilePanel.jsx<br>src/pages/settings/panels/SecurityPanel.jsx<br>src/pages/settings/panels/SupportPanel.jsx |
| src/components/ui/Label.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/Label/Label.jsx | Alcanzable | src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/components/ui/Input/Input.jsx<br>src/components/ui/Label.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx<br>src/components/ui/TextArea/TextArea.jsx<br>src/pages/admin-users/CreateAdminUserModal.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOperations.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOverview.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectInformationForm.jsx<br>src/pages/projects/components/tracking/ProjectTrackingMilestonesCard.jsx |
| src/components/ui/ListItem.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/ListItem/ListItem.jsx | No alcanzable | src/components/ui/CommentPanel/CommentPanel.jsx<br>src/components/ui/ListItem.jsx<br>src/components/ui/NotificationsPanel/NotificationsPanel.jsx |
| src/components/ui/ListItem/ListItemContent.jsx | No alcanzable | src/components/ui/ListItem/ListItem.jsx |
| src/components/ui/ListItem/ReplyInput.jsx | No alcanzable | Sin importadores en src |
| src/components/ui/Loader/Loader.jsx | Alcanzable | src/components/ui/Gallery/Model3DThumbnail.jsx<br>src/components/ui/Gallery/VideoThumbnail.jsx<br>src/components/ui/Gallery/VideoViewerModal.jsx<br>src/components/ui/Loader/index.js<br>src/components/ui/NotificationsDrawer.jsx<br>src/components/ui/ProjectImage/ProjectImage.jsx<br>src/pages/Home.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/admin-files/AdminFilesPage.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/ArchitectDashboard.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/AdminDashboardMetrics.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOperations.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOverview.jsx<br>src/pages/architect-dashboard/components/ProjectRequestReviewQueue.jsx<br>src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/panels/ProjectDocumentsPanel.jsx<br>src/pages/settings/panels/SecurityPanel.jsx<br>src/pages/settings/panels/SupportPanel.jsx |
| src/components/ui/LoginBackgroundCarousel.jsx | Alcanzable | src/components/layout/AuthLayout.jsx |
| src/components/ui/Modal.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/Modal/Modal.jsx | Alcanzable | src/components/ui/AssigneeMultiSelect/AssigneeRemovalModal.jsx<br>src/components/ui/Gallery/GalleryImagesModal.jsx<br>src/components/ui/Gallery/GalleryVideosModal.jsx<br>src/components/ui/Modal.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestModalShell.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestSuccessStep.jsx<br>src/components/ui/SideOverlayDrawer.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/admin-users/AdminUserStatusModal.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/admin-users/CreateAdminUserModal.jsx<br>src/pages/architect-dashboard/components/AdminRequestAssignmentModal.jsx<br>src/pages/architect-dashboard/components/ProjectRequestWorkflowModal.jsx<br>src/pages/settings/components/AvatarUploadModal.jsx |
| src/components/ui/Modal/ModalOverlay.jsx | Alcanzable | src/components/ui/Modal/Modal.jsx |
| src/components/ui/NavigationBar/NavigationBar.jsx | Alcanzable | src/components/EnvironmentNavigationBar.jsx |
| src/components/ui/Notification/Notification.jsx | Alcanzable | src/components/ui/AuthToast/AuthToast.jsx |
| src/components/ui/NotificationsDrawer.jsx | Alcanzable | src/components/EnvironmentNotificationsDrawer.jsx |
| src/components/ui/NotificationsPanel/NotificationsPanel.jsx | No alcanzable | Sin importadores en src |
| src/components/ui/ObservationTooltip/ObservationTooltip.jsx | Alcanzable | src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx |
| src/components/ui/PaginationDots.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/PaginationDots/PaginationDots.jsx | No alcanzable | src/components/ui/PaginationDots.jsx |
| src/components/ui/ProgressBarLabel.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/ProgressBarLabel/ProgressBarLabel.jsx | Alcanzable | src/components/ui/ProgressBarLabel.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOperations.jsx<br>src/pages/project-request/components/ProjectRequestReceivedView.jsx |
| src/components/ui/ProgressStepBase.jsx | Alcanzable; reexportación de compatibilidad | src/components/ui/ProgressStepGroup/ProgressStepGroup.jsx<br>src/pages/projects/components/tracking/ProjectTrackingStagesCard.jsx |
| src/components/ui/ProgressStepBase/ProgressStepBase.jsx | Alcanzable | src/components/ui/ProgressStepBase.jsx<br>src/pages/project-request/components/ProjectRequestReceivedView.jsx |
| src/components/ui/ProgressStepGroup.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/ProgressStepGroup/ProgressStepGroup.jsx | No alcanzable | src/components/ui/ProgressStepGroup.jsx |
| src/components/ui/ProjectImage/ProjectImage.jsx | Alcanzable | src/components/ui/Gallery/GalleryImageCard.jsx<br>src/components/ui/ProjectImage/index.js<br>src/components/ui/ProjectsShowcaseCarousel.jsx<br>src/pages/Home.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectRow.jsx<br>src/pages/publicSite/featuredProjects/components/FeaturedProjectsGallery.jsx |
| src/components/ui/ProjectProgress/ProjectProgress.jsx | Alcanzable | src/pages/Home.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectRow.jsx |
| src/components/ui/ProjectRequestFlow/ProjectLocationSuggestions.jsx | Alcanzable | src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx<br>src/pages/ProjectRequestPage.jsx |
| src/components/ui/ProjectRequestFlow/ProjectRequestCancelModal.jsx | Alcanzable | src/pages/ProjectRequestPage.jsx |
| src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx | No alcanzable | src/components/ui/ProjectRequestModal.jsx |
| src/components/ui/ProjectRequestFlow/ProjectRequestModalShell.jsx | Alcanzable | src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx |
| src/components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx | No alcanzable | src/components/ui/ProjectRequestModal.jsx |
| src/components/ui/ProjectRequestFlow/ProjectRequestSuccessStep.jsx | No alcanzable | src/components/ui/ProjectRequestModal.jsx |
| src/components/ui/ProjectRequestFlow/ProjectRequestValidationStep.jsx | Alcanzable | src/pages/ProjectRequestPage.jsx |
| src/components/ui/ProjectRequestModal.jsx | No alcanzable | Sin importadores en src |
| src/components/ui/ProjectsShowcaseCarousel.jsx | Alcanzable | src/pages/Home.jsx |
| src/components/ui/ScrollBar.jsx | Alcanzable; reexportación de compatibilidad | src/components/ui/FileUploadSection/FileUploadSection.jsx<br>src/pages/projects/panels/ProjectDocumentsPanel.jsx<br>src/pages/projects/panels/ProjectRendersPanel.jsx |
| src/components/ui/ScrollBar/ScrollBar.jsx | Alcanzable | src/components/ui/Gallery/GalleryImagesModal.jsx<br>src/components/ui/Gallery/GalleryVideosModal.jsx<br>src/components/ui/Input/Input.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx<br>src/components/ui/ScrollBar.jsx<br>src/pages/Home.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx |
| src/components/ui/SettingsVerticalTabMenu.jsx | Alcanzable | src/pages/settings/SettingsPage.jsx |
| src/components/ui/SideNavigation/SideNavigation.jsx | Alcanzable | src/pages/EmptyProjectRendersExample.jsx<br>src/pages/EmptyProjectsExample.jsx<br>src/pages/Home.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/admin-files/AdminFilesPage.jsx<br>src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/architect-dashboard/ArchitectDashboard.jsx<br>src/pages/architect-dashboard/NewArchitectProjectPage.jsx<br>src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/settings/SettingsPage.jsx |
| src/components/ui/SideOverlayDrawer.jsx | Alcanzable | src/components/ui/NotificationsDrawer.jsx<br>src/pages/Home.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx |
| src/components/ui/TabItem.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/TabItem/TabItem.jsx | Alcanzable | src/components/ui/FooterSection/FooterSection.jsx<br>src/components/ui/SettingsVerticalTabMenu.jsx<br>src/components/ui/SideNavigation/SideNavigation.jsx<br>src/components/ui/TabItem.jsx |
| src/components/ui/TabPanel.jsx | Alcanzable | src/pages/EmptyProjectRendersExample.jsx<br>src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/settings/SettingsPage.jsx |
| src/components/ui/Tag/Tag.jsx | Alcanzable | src/components/ui/Input/Input.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/architect-dashboard/components/AdminActiveProjects.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOperations.jsx<br>src/pages/architect-dashboard/components/AdminDashboardOverview.jsx |
| src/components/ui/TextArea.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/TextArea/TextArea.jsx | Alcanzable | src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/components/ui/NotificationsDrawer.jsx<br>src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx<br>src/components/ui/TextArea.jsx<br>src/pages/ProjectRequestPage.jsx<br>src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectInformationForm.jsx<br>src/pages/architect-dashboard/components/ProjectRequestWorkflowModal.jsx<br>src/pages/settings/panels/SupportPanel.jsx |
| src/components/ui/ThemeToggle.jsx | No alcanzable | Sin importadores en src |
| src/components/ui/Toggle.jsx | No alcanzable; reexportación de compatibilidad | Sin importadores en src |
| src/components/ui/Toggle/Toggle.jsx | Alcanzable | src/components/ui/Toggle.jsx<br>src/pages/settings/panels/PreferencesPanel.jsx |
| src/components/ui/Tooltip/Tooltip.jsx | Alcanzable | src/components/ui/ButtonGroupItem/ButtonGroupItem.jsx<br>src/components/ui/Button/Button.jsx<br>src/components/ui/ComposerSubmitButton.jsx<br>src/components/ui/Gallery/ImageViewerModal.jsx<br>src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/components/ui/Gallery/VideoViewerModal.jsx<br>src/components/ui/Input/Input.jsx<br>src/components/ui/NavigationBar/NavigationBar.jsx<br>src/components/ui/NotificationsDrawer.jsx<br>src/components/ui/PaginationDots/PaginationDots.jsx<br>src/components/ui/ProjectsShowcaseCarousel.jsx<br>src/components/ui/SideNavigation/SideNavigation.jsx<br>src/pages/EmptyProjectsExample.jsx<br>src/pages/Home.jsx<br>src/pages/PublicProjectsGallery.jsx<br>src/pages/architect-dashboard/components/ArchitectProjectRow.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/components/tracking/ProjectTrackingComparisonGallery.jsx<br>src/pages/projects/panels/ProjectInfoPanel.jsx<br>src/pages/projects/panels/ProjectWarrantiesPanel.jsx |
| src/contexts/ProjectReadOnlyContext.jsx | Alcanzable | src/components/ui/Gallery/ImageViewerModal.jsx<br>src/components/ui/Gallery/Model3DViewerModal.jsx<br>src/components/ui/Gallery/Panorama360Viewer.jsx<br>src/components/ui/Gallery/VideoViewerModal.jsx<br>src/components/ui/Gallery/useImageComments.js<br>src/hooks/useDocumentComments.js<br>src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/panels/ProjectUploadFilesPanel.jsx |
| src/main.jsx | Alcanzable | Sin importadores en src |
| src/pages/CreateAccount.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/CreatePassword.jsx | Alcanzable | src/main.jsx |
| src/pages/EmptyArchitectDashboardExample.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/EmptyProjectDocumentsExample.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/EmptyProjectInfoExample.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/EmptyProjectRendersExample.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/EmptyProjectTrackingExample.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/EmptyProjectWarrantiesExample.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/EmptyProjectsExample.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/Home.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/InactiveAccount.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/Login.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/NewPassword.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/ProjectDetails.jsx | Alcanzable; reexportación de compatibilidad | src/main.jsx<br>src/pages/pages.js |
| src/pages/ProjectRequestPage.jsx | Alcanzable | src/main.jsx |
| src/pages/PublicProjectsGallery.jsx | Alcanzable | src/main.jsx |
| src/pages/RecoverAccount.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/Settings.jsx | Alcanzable; reexportación de compatibilidad | src/main.jsx<br>src/pages/pages.js |
| src/pages/admin-files/AdminFilesPage.jsx | Alcanzable | src/main.jsx |
| src/pages/admin-users/AdminUserActionsMenu.jsx | Alcanzable | src/pages/admin-users/AdminUsersPage.jsx |
| src/pages/admin-users/AdminUserDetailsDrawer.jsx | Alcanzable | src/pages/admin-users/AdminUsersPage.jsx |
| src/pages/admin-users/AdminUserStatusModal.jsx | Alcanzable | src/pages/admin-users/AdminUsersPage.jsx |
| src/pages/admin-users/AdminUsersPage.jsx | Alcanzable | src/main.jsx |
| src/pages/admin-users/CreateAdminUserModal.jsx | Alcanzable | src/pages/admin-users/AdminUsersPage.jsx<br>src/pages/admin-users/EditAdminUserModal.jsx |
| src/pages/admin-users/EditAdminUserModal.jsx | Alcanzable | src/pages/admin-users/AdminUserDetailsDrawer.jsx<br>src/pages/admin-users/AdminUsersPage.jsx |
| src/pages/architect-dashboard/ArchitectDashboard.jsx | Alcanzable | src/main.jsx<br>src/pages/EmptyArchitectDashboardExample.jsx<br>src/pages/pages.js |
| src/pages/architect-dashboard/NewArchitectProjectPage.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/architect-dashboard/components/AdminActiveProjects.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/AdminDashboardHeader.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/AdminDashboardMetrics.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/AdminDashboardOperations.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/AdminDashboardOverview.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/AdminRequestAssignmentModal.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/AdminRequestLoginAlert.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/ArchitectProjectGroup.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/ArchitectProjectInformationForm.jsx | Alcanzable | src/pages/architect-dashboard/NewArchitectProjectPage.jsx |
| src/pages/architect-dashboard/components/ArchitectProjectRow.jsx | Alcanzable | src/pages/architect-dashboard/components/ArchitectProjectGroup.jsx |
| src/pages/architect-dashboard/components/ArchitectStatusBadge.jsx | Alcanzable | src/pages/architect-dashboard/components/ArchitectProjectGroup.jsx |
| src/pages/architect-dashboard/components/ProjectCreationTabs.jsx | Alcanzable | src/pages/architect-dashboard/NewArchitectProjectPage.jsx |
| src/pages/architect-dashboard/components/ProjectRequestReviewQueue.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/architect-dashboard/components/ProjectRequestWorkflowModal.jsx | Alcanzable | src/pages/architect-dashboard/ArchitectDashboard.jsx |
| src/pages/project-request/components/ProjectRequestReceivedView.jsx | Alcanzable | src/pages/ProjectRequestPage.jsx |
| src/pages/projects/ProjectDetailsPage.jsx | Alcanzable | src/pages/EmptyProjectDocumentsExample.jsx<br>src/pages/EmptyProjectInfoExample.jsx<br>src/pages/EmptyProjectTrackingExample.jsx<br>src/pages/EmptyProjectWarrantiesExample.jsx<br>src/pages/ProjectDetails.jsx |
| src/pages/projects/components/ProjectDetailTabMenu.jsx | Alcanzable | src/pages/EmptyProjectRendersExample.jsx<br>src/pages/projects/ProjectDetailsPage.jsx |
| src/pages/projects/components/ProjectDocumentCard.jsx | Alcanzable | src/pages/projects/components/ProjectDocumentPreview.jsx<br>src/pages/projects/panels/ProjectDocumentsPanel.jsx |
| src/pages/projects/components/ProjectDocumentListCard.jsx | Alcanzable | src/pages/projects/panels/ProjectDocumentsPanel.jsx |
| src/pages/projects/components/ProjectDocumentPreview.jsx | Alcanzable | src/pages/projects/ProjectDetailsPage.jsx<br>src/pages/projects/panels/ProjectDocumentsPanel.jsx |
| src/pages/projects/components/ProjectDocumentsToolbar.jsx | Alcanzable | src/pages/PublicProjectsGallery.jsx<br>src/pages/projects/panels/ProjectDocumentsPanel.jsx |
| src/pages/projects/components/ProjectOverviewHeader.jsx | Alcanzable | src/pages/EmptyProjectRendersExample.jsx<br>src/pages/projects/ProjectDetailsPage.jsx |
| src/pages/projects/components/tracking/ProjectTrackingComparisonGallery.jsx | Alcanzable | src/pages/projects/panels/ProjectTrackingPanel.jsx |
| src/pages/projects/components/tracking/ProjectTrackingIcons.jsx | Alcanzable | src/pages/projects/components/tracking/ProjectTrackingMilestonesCard.jsx<br>src/pages/projects/components/tracking/ProjectTrackingSummaryRow.jsx |
| src/pages/projects/components/tracking/ProjectTrackingMilestonesCard.jsx | Alcanzable | src/pages/projects/panels/ProjectTrackingPanel.jsx |
| src/pages/projects/components/tracking/ProjectTrackingStagesCard.jsx | Alcanzable | src/pages/projects/panels/ProjectTrackingPanel.jsx |
| src/pages/projects/components/tracking/ProjectTrackingSummaryRow.jsx | Alcanzable | src/pages/projects/panels/ProjectTrackingPanel.jsx |
| src/pages/projects/panels/ProjectDocumentsPanel.jsx | Alcanzable | src/pages/projects/ProjectDetailsPage.jsx |
| src/pages/projects/panels/ProjectInfoPanel.jsx | Alcanzable | src/pages/EmptyProjectRendersExample.jsx<br>src/pages/projects/ProjectDetailsPage.jsx |
| src/pages/projects/panels/ProjectRendersPanel.jsx | Alcanzable | src/pages/EmptyProjectRendersExample.jsx<br>src/pages/projects/ProjectDetailsPage.jsx |
| src/pages/projects/panels/ProjectTrackingPanel.jsx | Alcanzable | src/pages/projects/ProjectDetailsPage.jsx |
| src/pages/projects/panels/ProjectUploadFilesPanel.jsx | Alcanzable | src/pages/projects/ProjectDetailsPage.jsx |
| src/pages/projects/panels/ProjectWarrantiesPanel.jsx | Alcanzable | src/pages/projects/ProjectDetailsPage.jsx |
| src/pages/publicSite/about/components/AboutSection.jsx | Alcanzable | src/pages/publicSite/home/OpeningHome.jsx |
| src/pages/publicSite/about/components/AboutStory.jsx | Alcanzable | src/pages/publicSite/about/components/AboutSection.jsx |
| src/pages/publicSite/components/PublicSiteHeader/PublicSiteHeader.jsx | Alcanzable | src/pages/publicSite/components/PublicSiteHeader/index.js<br>src/pages/publicSite/home/OpeningHome.jsx |
| src/pages/publicSite/components/PublicSiteHeader/PublicSiteMobileMenu.jsx | Alcanzable | src/pages/publicSite/components/PublicSiteHeader/PublicSiteHeader.jsx |
| src/pages/publicSite/components/PublicSiteHeader/PublicSiteNavigationMenu.jsx | Alcanzable | src/pages/publicSite/components/PublicSiteHeader/PublicSiteHeader.jsx<br>src/pages/publicSite/components/PublicSiteHeader/PublicSiteMobileMenu.jsx |
| src/pages/publicSite/components/SectionTitleReveal.jsx | Alcanzable | src/pages/publicSite/about/components/AboutSection.jsx<br>src/pages/publicSite/featuredProjects/components/FeaturedProjectsProjectPanel.jsx<br>src/pages/publicSite/featuredProjects/components/FeaturedProjectsSection.jsx<br>src/pages/publicSite/processes/components/ProcessesSection.jsx<br>src/pages/publicSite/services/components/ServicesHeading.jsx |
| src/pages/publicSite/contact/components/ContactSection.jsx | Alcanzable | src/pages/publicSite/home/OpeningHome.jsx |
| src/pages/publicSite/contact/components/ContactTiltCard.jsx | Alcanzable | src/pages/publicSite/contact/components/ContactSection.jsx |
| src/pages/publicSite/contact/components/lib/custom-effect-runtime/index.jsx | Alcanzable | src/pages/publicSite/contact/components/ContactTiltCard.jsx |
| src/pages/publicSite/featuredProjects/components/FeaturedProjectsGallery.jsx | Alcanzable | src/pages/publicSite/featuredProjects/components/FeaturedProjectsProjectPanel.jsx<br>src/pages/publicSite/featuredProjects/components/FeaturedProjectsSection.jsx |
| src/pages/publicSite/featuredProjects/components/FeaturedProjectsProjectPanel.jsx | Alcanzable | src/pages/publicSite/featuredProjects/components/FeaturedProjectsSection.jsx |
| src/pages/publicSite/featuredProjects/components/FeaturedProjectsSection.jsx | Alcanzable | src/pages/publicSite/home/OpeningHome.jsx |
| src/pages/publicSite/home/OpeningHome.jsx | Alcanzable | src/main.jsx<br>src/pages/pages.js |
| src/pages/publicSite/home/components/ArcaOpeningMark/ArcaOpeningMark.jsx | Alcanzable | src/pages/publicSite/home/OpeningHome.jsx |
| src/pages/publicSite/home/components/HomeHeroTitle/HomeHeroTitle.jsx | Alcanzable | src/pages/publicSite/home/components/HomeHeroTitle/index.js<br>src/pages/publicSite/home/components/HomeScrollPanel/HomeScrollPanel.jsx |
| src/pages/publicSite/home/components/HomeScrollPanel/HomeScrollPanel.jsx | Alcanzable | src/pages/publicSite/home/components/HomeScrollPanel/index.js<br>src/pages/publicSite/home/components/HomeSections.jsx |
| src/pages/publicSite/home/components/HomeSections.jsx | Alcanzable | src/pages/publicSite/home/OpeningHome.jsx |
| src/pages/publicSite/home/components/HomeStatementPanel/HomeStatementPanel.jsx | Alcanzable | src/pages/publicSite/home/components/HomeSections.jsx<br>src/pages/publicSite/home/components/HomeStatementPanel/index.js |
| src/pages/publicSite/processes/components/ProcessesSection.jsx | Alcanzable | src/pages/publicSite/home/OpeningHome.jsx |
| src/pages/publicSite/processes/components/ProcessesVideoGrid.jsx | Alcanzable | src/pages/publicSite/processes/components/ProcessesSection.jsx |
| src/pages/publicSite/processes/components/ProcessesVideoModal.jsx | Alcanzable | src/pages/publicSite/processes/components/ProcessesSection.jsx |
| src/pages/publicSite/services/components/MovingGradientTitle.jsx | Alcanzable | src/pages/publicSite/services/components/ServicesHeading.jsx |
| src/pages/publicSite/services/components/ServicesCategoryShowcase.jsx | Alcanzable | src/pages/publicSite/services/components/ServicesSection.jsx |
| src/pages/publicSite/services/components/ServicesHeading.jsx | Alcanzable | src/pages/publicSite/services/components/ServicesSection.jsx |
| src/pages/publicSite/services/components/ServicesSection.jsx | Alcanzable | src/pages/publicSite/home/OpeningHome.jsx |
| src/pages/settings/PreferenceItem.jsx | Alcanzable | src/pages/settings/panels/PreferencesPanel.jsx |
| src/pages/settings/SettingsPage.jsx | Alcanzable | src/pages/Settings.jsx |
| src/pages/settings/components/AvatarUploadModal.jsx | Alcanzable | src/pages/settings/SettingsPage.jsx |
| src/pages/settings/panels/PreferencesPanel.jsx | Alcanzable | src/pages/settings/SettingsPage.jsx |
| src/pages/settings/panels/ProfilePanel.jsx | Alcanzable | src/pages/settings/SettingsPage.jsx |
| src/pages/settings/panels/SecurityPanel.jsx | Alcanzable | src/pages/settings/SettingsPage.jsx |
| src/pages/settings/panels/SupportPanel.jsx | Alcanzable | src/pages/settings/SettingsPage.jsx |
| src/pages/settings/settingsIcons.jsx | Alcanzable | src/pages/settings/SettingsPage.jsx<br>src/pages/settings/panels/PreferencesPanel.jsx<br>src/pages/settings/panels/ProfilePanel.jsx<br>src/pages/settings/panels/SupportPanel.jsx |

## Imports locales inexistentes

| Archivo | Línea | Import |
| --- | --- | --- |

## Dependencias compartidas hacia páginas

| Archivo | Línea | Destino |
| --- | --- | --- |

## Controles nativos fuera de ui

| Archivo | Línea | Control | Clasificación |
| --- | --- | --- | --- |

## Módulos no alcanzables

- src/assets/logos/index.js
- src/auth/testAccess.js
- src/components/Icon.jsx
- src/components/ui/Accordion.jsx
- src/components/ui/Accordion/accordionShowcaseData.js
- src/components/ui/Alert/alertShowcaseData.js
- src/components/ui/AssigneeMultiSelect.jsx
- src/components/ui/Avatar.jsx
- src/components/ui/AvatarGroup.jsx
- src/components/ui/AvatarGroup/avatarGroupShowcaseData.js
- src/components/ui/AvatarLabel.jsx
- src/components/ui/AvatarLabel/avatarLabelShowcaseData.js
- src/components/ui/Avatar/avatarShowcaseData.js
- src/components/ui/Badge.jsx
- src/components/ui/Badge/badgeShowcaseData.js
- src/components/ui/ButtonGroupItem/buttonGroupItemShowcaseData.js
- src/components/ui/Button/buttonShowcaseData.js
- src/components/ui/Checkbox/checkboxShowcaseData.js
- src/components/ui/CircleProgressBarLabel.jsx
- src/components/ui/CircleProgressBarLabel/circleProgressBarLabelShowcaseData.js
- src/components/ui/CommentPanel/CommentPanel.jsx
- src/components/ui/CommentPanel/commentPanelConfig.js
- src/components/ui/CommentPanel/commentPanelShowcaseData.js
- src/components/ui/DropdownMenu/dropdownMenuShowcaseData.js
- src/components/ui/EmptyState/emptyStateShowcaseData.js
- src/components/ui/FileAttachmentIcons/fileAttachmentIconsShowcaseData.js
- src/components/ui/FileUploadSection.jsx
- src/components/ui/FileUploadSection/fileUploadSectionShowcaseData.js
- src/components/ui/FooterSection.jsx
- src/components/ui/FooterSection/footerSectionConfig.js
- src/components/ui/FooterSection/footerSectionShowcaseData.js
- src/components/ui/Gallery/Panorama360Modal.jsx
- src/components/ui/Gallery/Panorama360Viewer.jsx
- src/components/ui/HintText.jsx
- src/components/ui/HintText/hintTextShowcaseData.js
- src/components/ui/HorizontalTabMenu.jsx
- src/components/ui/HorizontalTabMenu/horizontalTabMenuShowcaseData.js
- src/components/ui/IconContainer/iconContainerShowcaseData.js
- src/components/ui/Input.jsx
- src/components/ui/Input/inputShowcaseData.js
- src/components/ui/Label.jsx
- src/components/ui/Label/labelShowcaseData.js
- src/components/ui/ListItem.jsx
- src/components/ui/ListItem/ListItem.jsx
- src/components/ui/ListItem/ListItemContent.jsx
- src/components/ui/ListItem/ReplyInput.jsx
- src/components/ui/ListItem/listItemConfig.js
- src/components/ui/ListItem/listItemShowcaseData.js
- src/components/ui/Loader/index.js
- src/components/ui/Modal.jsx
- src/components/ui/Modal/modalShowcaseData.js
- src/components/ui/NavigationBar/navigationBarConfig.js
- src/components/ui/NavigationBar/navigationBarShowcaseData.js
- src/components/ui/Notification/notificationShowcaseData.js
- src/components/ui/NotificationsPanel/NotificationsPanel.jsx
- src/components/ui/NotificationsPanel/notificationsPanelConfig.js
- src/components/ui/NotificationsPanel/notificationsPanelShowcaseData.js
- src/components/ui/PaginationDots.jsx
- src/components/ui/PaginationDots/PaginationDots.jsx
- src/components/ui/PaginationDots/paginationDotsConfig.js
- src/components/ui/PaginationDots/paginationDotsShowcaseData.js
- src/components/ui/ProgressBarLabel.jsx
- src/components/ui/ProgressBarLabel/progressBarLabelShowcaseData.js
- src/components/ui/ProgressStepBase/progressStepBaseShowcaseData.js
- src/components/ui/ProgressStepGroup.jsx
- src/components/ui/ProgressStepGroup/ProgressStepGroup.jsx
- src/components/ui/ProgressStepGroup/progressStepGroupConfig.js
- src/components/ui/ProgressStepGroup/progressStepGroupShowcaseData.js
- src/components/ui/ProjectImage/index.js
- src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx
- src/components/ui/ProjectRequestFlow/ProjectRequestReferencesStep.jsx
- src/components/ui/ProjectRequestFlow/ProjectRequestSuccessStep.jsx
- src/components/ui/ProjectRequestModal.jsx
- src/components/ui/ScrollBar/scrollBarShowcaseData.js
- src/components/ui/SideNavigation/sideNavigationShowcaseData.js
- src/components/ui/TabItem.jsx
- src/components/ui/TabItem/tabItemShowcaseData.js
- src/components/ui/Tag/tagShowcaseData.js
- src/components/ui/TextArea.jsx
- src/components/ui/TextArea/textAreaShowcaseData.js
- src/components/ui/ThemeToggle.jsx
- src/components/ui/Toggle.jsx
- src/components/ui/Toggle/toggleShowcaseData.js
- src/components/ui/Tooltip/tooltipShowcaseData.js
- src/pages/pages.js
- src/pages/publicSite/components/PublicSiteHeader/index.js
- src/pages/publicSite/home/components/HomeHeroTitle/index.js
- src/pages/publicSite/home/components/HomeScrollPanel/index.js
- src/pages/publicSite/home/components/HomeStatementPanel/index.js
- src/pages/publicSite/services/utils/servicesProgress.js
