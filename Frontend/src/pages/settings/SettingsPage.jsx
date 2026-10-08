import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../../api/http.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AuthToast, {
  AuthToastLockIcon,
} from "../../components/ui/AuthToast/AuthToast.jsx";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import { useRecentProjectComments } from "../../hooks/useProjectComments.js";
import {
  getCommentableProjectsForUser,
  getProjectNamesById,
} from "../../utils/commentDisplay.js";
import { canAccessObservations } from "../../utils/observationAccess.js";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import ResponsiveSideNavigation from "../../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";
import SettingsVerticalTabMenu from "../../components/ui/SettingsVerticalTabMenu.jsx";
import TabPanel from "../../components/ui/TabPanel.jsx";
import { CLIENT_DRAWER_RECENT_ACTIVITY } from "../../data/clientDrawerData.js";
import { getCommentNavigationParams } from "../../utils/commentSelection.js";
import PreferencesPanel from "./panels/PreferencesPanel.jsx";
import ProfilePanel from "./panels/ProfilePanel.jsx";
import SecurityPanel from "./panels/SecurityPanel.jsx";
import SupportPanel from "./panels/SupportPanel.jsx";
import AvatarUploadModal from "./components/AvatarUploadModal.jsx";
import { SendIcon } from "./settingsIcons.jsx";
import {
  applyThemePreference,
  getThemePreferenceFromDocument,
} from "./themeUtils.js";
import {
  createUserSideNavigationItems,
  getDashboardPath,
} from "../../utils/sideNavigationItems.js";

const EXPANDED_SIDEBAR_WIDTH = 312;
const COLLAPSED_SIDEBAR_WIDTH = 76;
const TABLET_BREAKPOINT_PX = 768;
const AVATAR_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_MAX_SIZE_BYTES = 50 * 1024 * 1024;
const AVATAR_UPLOAD_MAX_BYTES = 3.5 * 1024 * 1024;
const AVATAR_UPLOAD_MAX_DIMENSION = 1600;
const AVATAR_UPLOAD_QUALITY_STEPS = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5];

function getCompressedAvatarName(fileName = "avatar") {
  const baseName = fileName.replace(/\.[^/.]+$/, "") || "avatar";
  return `${baseName}.jpg`;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("No se pudo optimizar la imagen."));
      },
      type,
      quality,
    );
  });
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la imagen."));
    };
    image.src = objectUrl;
  });
}

async function loadAvatarImageSource(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  return loadImageElement(file);
}

async function prepareAvatarFileForUpload(file) {
  if (!file || file.size <= AVATAR_UPLOAD_MAX_BYTES) {
    return file;
  }

  const imageSource = await loadAvatarImageSource(file);
  const sourceWidth = imageSource.width || imageSource.naturalWidth;
  const sourceHeight = imageSource.height || imageSource.naturalHeight;
  const scale = Math.min(
    1,
    AVATAR_UPLOAD_MAX_DIMENSION / sourceWidth,
    AVATAR_UPLOAD_MAX_DIMENSION / sourceHeight,
  );
  const width = Math.max(Math.round(sourceWidth * scale), 1);
  const height = Math.max(Math.round(sourceHeight * scale), 1);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(imageSource, 0, 0, width, height);
  imageSource.close?.();

  for (const quality of AVATAR_UPLOAD_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);

    if (blob.size <= AVATAR_UPLOAD_MAX_BYTES) {
      return new File([blob], getCompressedAvatarName(file.name), {
        lastModified: Date.now(),
        type: "image/jpeg",
      });
    }
  }

  throw new Error("No se pudo reducir la imagen lo suficiente para subirla.");
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { logout, updateUser, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const mobileNavigation = useMobileNavigationDrawer();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] =
    useState(false);
  const [activeSettingsTabId, setActiveSettingsTabId] = useState("profile");

  const [profileName, setProfileName] = useState(currentUser.name);
  const [companyName, setCompanyName] = useState("Next C.A.");
  const [isAvatarUploadModalOpen, setIsAvatarUploadModalOpen] =
    useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [themePreference, setThemePreference] = useState(
    getThemePreferenceFromDocument,
  );
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [commentsNotificationsEnabled, setCommentsNotificationsEnabled] =
    useState(false);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] =
    useState(false);
  const [whatsappNotificationsEnabled, setWhatsappNotificationsEnabled] =
    useState(false);
  const [supportIssueType, setSupportIssueType] = useState(null);
  const [isSupportIssueTypeMenuOpen, setIsSupportIssueTypeMenuOpen] =
    useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportDescription, setSupportDescription] = useState("");
  const [supportToastTrigger, setSupportToastTrigger] = useState(0);
  const [avatarToast, setAvatarToast] = useState(null);
  const [passwordToast, setPasswordToast] = useState(null);

  const [passwordValidationErrors, setPasswordValidationErrors] = useState({});
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(true);
  const commentableProjects = useMemo(
    () => getCommentableProjectsForUser(projects, user),
    [projects, user],
  );
  const navigationItems = useMemo(
    () => createUserSideNavigationItems(projects, currentUser.roleCode),
    [currentUser.roleCode, projects],
  );
  const projectNamesById = useMemo(
    () => getProjectNamesById(commentableProjects),
    [commentableProjects],
  );
  const {
    drawerComments: projectObservations,
    error: observationsError,
    loading: observationsLoading,
    refresh: refreshObservations,
  } = useRecentProjectComments({
    enabled: commentableProjects.length > 0,
    projectIds: commentableProjects.map((project) => project.id),
    projectNamesById,
    refreshIntervalMs: isNotificationsDrawerOpen ? 5000 : 15000,
    user,
  });

  useEffect(() => {
    let isMounted = true;
    setProjectsLoading(true);
    setProjectsError("");

    api.projects
      .listAll()
      .then((data) => {
        if (isMounted) setProjects(Array.isArray(data.projects) ? data.projects : []);
      })
      .catch((error) => {
        if (isMounted) setProjectsError(error.message || "No se pudieron cargar los proyectos.");
      })
      .finally(() => {
        if (isMounted) setProjectsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (isNotificationsDrawerOpen) refreshObservations?.();
  }, [isNotificationsDrawerOpen, refreshObservations]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(max-width: ${TABLET_BREAKPOINT_PX - 1}px)`,
    );

    function syncSidebarForViewport(event) {
      setIsSidebarExpanded(!event.matches);
    }

    syncSidebarForViewport(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebarForViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncSidebarForViewport);
    };
  }, []);

  useEffect(() => {
    setProfileName(currentUser.name);
  }, [currentUser.name]);

  const handleSideNavigationSelect = (item) => {
    if (item?.to) {
      navigate(item.to);
      return;
    }

    if (item?.id === "dashboard") {
      navigate(getDashboardPath(currentUser.roleCode));
      return;
    }

    if (item?.id?.startsWith("project-")) {
      const projectId = Number(item.id.replace("project-", ""));

      if (Number.isInteger(projectId)) {
        navigate(`/proyectos/${projectId}`);
      }
      return;
    }

    if (item?.id === "more-projects") {
      navigate("/proyectos");
      return;
    }

    if (item?.id === "requests") {
      navigate("/solicitudes");
      return;
    }

    if (item?.id === "settings") {
      navigate("/configuraciones");
    }
  };

  const handleActivitySelect = (activity) => {
    if (!activity?.to) {
      return;
    }

    setIsNotificationsDrawerOpen(false);
    navigate(activity.to);
  };

  const openImageComment = (comment) => {
    const sourceProject = commentableProjects.find(
      (project) => String(project.id) === String(comment?.projectId),
    );
    const projectRouteId = sourceProject?.publicSlug || sourceProject?.id;

    if (!projectRouteId) {
      return;
    }

    const params = getCommentNavigationParams(comment);

    setIsNotificationsDrawerOpen(false);
    navigate(`/proyectos/${encodeURIComponent(projectRouteId)}?${params.toString()}`);
  };

  const passwordRequirements = [
    {
      id: "uppercase",
      label: "Al menos 1 mayúscula",
      test: (value) => /[A-Z]/.test(value),
    },
    {
      id: "number",
      label: "Al menos 1 número",
      test: (value) => /\d/.test(value),
    },
    {
      id: "special",
      label: "Al menos 1 carácter especial",
      test: (value) => /[^A-Za-z0-9]/.test(value),
    },
    {
      id: "length",
      label: "Al menos 8 caracteres",
      test: (value) => value.length >= 8,
    },
  ];

  const handlePasswordChange = async () => {
    const newPasswordIsValid = passwordRequirements.every((requirement) =>
      requirement.test(newPassword),
    );
    const validationErrors = {
      currentPassword: !currentPassword,
      newPassword: !newPasswordIsValid || newPassword === currentPassword,
      confirmPassword:
        !confirmPassword || confirmPassword !== newPassword,
    };

    setPasswordValidationErrors(validationErrors);

    if (Object.values(validationErrors).some(Boolean)) {
      setPasswordToast({
        trigger: Date.now(),
        title: "No se pudo cambiar la contraseña",
        description:
          newPassword === currentPassword && currentPassword
            ? "La nueva contraseña debe ser diferente a la actual."
            : "Verifica la contraseña actual, los requisitos y la confirmación.",
      });
      return;
    }

    setIsChangingPassword(true);

    try {
      await api.auth.changePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordValidationErrors({});
      setPasswordToast({
        trigger: Date.now(),
        title: "Contraseña restablecida",
        description:
          "Tu contraseña ha sido actualizada con éxito. Por razones de seguridad, por favor verifica la actividad reciente.",
      });
    } catch (error) {
      setPasswordValidationErrors((current) => ({
        ...current,
        currentPassword: error.code === "CURRENT_PASSWORD_INCORRECT",
        newPassword:
          error.code === "INVALID_PASSWORD" ||
          error.code === "PASSWORD_UNCHANGED",
      }));
      setPasswordToast({
        trigger: Date.now(),
        title: "No se pudo cambiar la contraseña",
        description:
          error.message || "Intenta nuevamente en unos minutos.",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleAvatarUpload = async (file, uploadOptions = {}) => {
    if (!AVATAR_ALLOWED_TYPES.has(file?.type)) {
      const error = new Error("Sube una imagen JPG, PNG o WEBP.");
      setAvatarToast({
        trigger: Date.now(),
        title: "No se pudo actualizar el avatar",
        description: error.message,
      });
      throw error;
    }

    if (file.size > AVATAR_MAX_SIZE_BYTES) {
      const error = new Error("La imagen no puede superar 50 MB.");
      setAvatarToast({
        trigger: Date.now(),
        title: "No se pudo actualizar el avatar",
        description: error.message,
      });
      throw error;
    }

    setIsUploadingAvatar(true);

    try {
      const uploadFile = await prepareAvatarFileForUpload(file);

      if (uploadOptions.signal?.aborted) {
        const error = new Error("La subida del avatar fue cancelada.");
        error.code = "UPLOAD_ABORTED";
        throw error;
      }

      const data = await api.auth.uploadProfilePhoto({
        file: uploadFile,
        onUploadProgress: uploadOptions.onUploadProgress,
        signal: uploadOptions.signal,
      });

      return data;
    } catch (error) {
      if (error.code === "UPLOAD_ABORTED") {
        throw error;
      }

      setAvatarToast({
        trigger: Date.now(),
        title: "No se pudo actualizar el avatar",
        description: error.message || "Intenta nuevamente en unos minutos.",
      });
      throw error;
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleAvatarUploadConfirm = (uploadResult) => {
    if (uploadResult?.user) {
      updateUser({
        ...uploadResult.user,
      });
    }

    setAvatarToast({
      trigger: Date.now(),
      title: "Avatar actualizado",
      description: "Tu foto de perfil se actualizo correctamente.",
    });
    setIsAvatarUploadModalOpen(false);
  };

  let activePanel = (
    <ProfilePanel
      profileName={profileName}
      setProfileName={setProfileName}
      companyName={companyName}
      setCompanyName={setCompanyName}
      email={currentUser.email}
      primaryPhone={currentUser.phone}
      secondaryPhone={currentUser.phone}
      roleLabel={currentUser.roleName}
      avatarInitials={getUserDisplay({ name: profileName }).initials}
      avatarSrc={currentUser.profilePhotoUrl}
      onUploadImageClick={() => setIsAvatarUploadModalOpen(true)}
    />
  );

  if (activeSettingsTabId === "security") {
    activePanel = (
      <SecurityPanel
        currentPassword={currentPassword}
        setCurrentPassword={(value) => {
          setCurrentPassword(value);
          setPasswordValidationErrors((current) => ({
            ...current,
            currentPassword: false,
          }));
        }}
        newPassword={newPassword}
        setNewPassword={(value) => {
          setNewPassword(value);
          setPasswordValidationErrors((current) => ({
            ...current,
            newPassword: false,
          }));
        }}
        confirmPassword={confirmPassword}
        setConfirmPassword={(value) => {
          setConfirmPassword(value);
          setPasswordValidationErrors((current) => ({
            ...current,
            confirmPassword: false,
          }));
        }}
        passwordRequirements={passwordRequirements}
        onSubmit={handlePasswordChange}
        isSubmitting={isChangingPassword}
        validationErrors={passwordValidationErrors}
      />
    );
  } else if (activeSettingsTabId === "preferences") {
    activePanel = (
      <PreferencesPanel
        themePreference={themePreference}
        setThemePreference={setThemePreference}
        isThemeMenuOpen={isThemeMenuOpen}
        setIsThemeMenuOpen={setIsThemeMenuOpen}
        commentsNotificationsEnabled={commentsNotificationsEnabled}
        setCommentsNotificationsEnabled={setCommentsNotificationsEnabled}
        emailNotificationsEnabled={emailNotificationsEnabled}
        setEmailNotificationsEnabled={setEmailNotificationsEnabled}
        whatsappNotificationsEnabled={whatsappNotificationsEnabled}
        setWhatsappNotificationsEnabled={setWhatsappNotificationsEnabled}
        applyThemePreference={applyThemePreference}
        showObservationNotifications={canAccessObservations(user)}
      />
    );
  } else if (activeSettingsTabId === "support") {
    activePanel = (
      <SupportPanel
        supportIssueType={supportIssueType}
        setSupportIssueType={setSupportIssueType}
        isSupportIssueTypeMenuOpen={isSupportIssueTypeMenuOpen}
        setIsSupportIssueTypeMenuOpen={setIsSupportIssueTypeMenuOpen}
        supportSubject={supportSubject}
        setSupportSubject={setSupportSubject}
        supportDescription={supportDescription}
        setSupportDescription={setSupportDescription}
        onSubmit={() => setSupportToastTrigger((current) => current + 1)}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex min-h-screen w-full items-stretch">
        <ResponsiveSideNavigation
          mobileOpen={mobileNavigation.isOpen}
          onMobileClose={mobileNavigation.close}
          activeItemId="settings"
          expanded={isSidebarExpanded}
          items={navigationItems}
          newOpportunityLabel={
            currentUser.roleCode === "client"
              ? "Nueva oportunidad"
              : "Nuevo proyecto"
          }
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onExpandedChange={setIsSidebarExpanded}
          onItemSelect={handleSideNavigationSelect}
          onNewOpportunityClick={() =>
            currentUser.roleCode === "client"
              ? navigate("/solicitudes/nueva")
              : navigate("/dashboard-arquitecto/nuevo-proyecto")
          }
          onLogoutClick={() => {
            logout();
            navigate("/");
          }}
          className="min-h-screen shrink-0 self-stretch"
        />

        <div className="relative flex min-h-screen min-w-0 flex-1 flex-col self-stretch overflow-y-auto transition-[width] duration-300 ease-out">
          <AuthToast
            trigger={supportToastTrigger > 0 ? supportToastTrigger : null}
            title="Tu solicitud fue enviada"
            description="Estaremos verificando la información y te contactaremos en breve."
            leading={
              <span className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[8px] shadow-[var(--shadow-e1)] text-[var(--color-text-300)]">
                <SendIcon className="size-5" />
              </span>
            }
            autoHideMs={4200}
          />
          <AuthToast
            trigger={passwordToast?.trigger ?? null}
            title={passwordToast?.title ?? ""}
            description={passwordToast?.description ?? ""}
            leading={<AuthToastLockIcon />}
            autoHideMs={4200}
          />
          <AuthToast
            trigger={avatarToast?.trigger ?? null}
            title={avatarToast?.title ?? ""}
            description={avatarToast?.description ?? ""}
            leading={<AuthToastLockIcon />}
            autoHideMs={4200}
          />

          <NavigationBar
            onMenuClick={mobileNavigation.open}
            mobileMenuExpanded={mobileNavigation.isOpen}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={() =>
              setIsNotificationsDrawerOpen((current) => !current)
            }
          />

          {/* En móvil se usa el padding del entorno (16 px) y el menú se apila sobre el panel. */}
          <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-start px-[48px] pt-[48px] max-[767px]:px-[16px] max-[767px]:pb-[24px] max-[767px]:pt-[16px]">
            <section className="flex w-full min-w-0 items-start gap-12 self-stretch max-[767px]:flex-col max-[767px]:gap-[24px]">
              <SettingsVerticalTabMenu
                activeItemId={activeSettingsTabId}
                onChange={setActiveSettingsTabId}
              />
              <TabPanel
                transitionKey={activeSettingsTabId}
                className="min-w-0 flex-1 max-[767px]:w-full"
              >
                {activePanel}
              </TabPanel>
            </section>
          </div>

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={() => setIsNotificationsDrawerOpen(false)}
            comments={projectObservations}
            commentsError={projectsError || observationsError}
            commentsLoading={projectsLoading || observationsLoading}
            recentActivity={CLIENT_DRAWER_RECENT_ACTIVITY}
            onActivitySelect={handleActivitySelect}
            onCommentSelect={openImageComment}
          />
          <AvatarUploadModal
            open={isAvatarUploadModalOpen}
            onClose={() => setIsAvatarUploadModalOpen(false)}
            onConfirm={handleAvatarUploadConfirm}
            onUpload={handleAvatarUpload}
            isSubmitting={isUploadingAvatar}
          />
        </div>
      </div>
    </main>
  );
}
