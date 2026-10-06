import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { RecentProjectsProvider } from "./auth/RecentProjectsContext.jsx";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import PublicOnlyRoute from "./auth/PublicOnlyRoute.jsx";
import ThemeSync from "./components/ui/ThemeSync.jsx";

const InternalDashboardRouter = lazy(
  () => import("./pages/InternalDashboardRouter.jsx"),
);
const AdminUsersPage = lazy(
  () => import("./pages/admin-users/AdminUsersPage.jsx"),
);
const AdminFilesPage = lazy(
  () => import("./pages/admin-files/AdminFilesPage.jsx"),
);
const CreateAccount = lazy(() => import("./pages/CreateAccount.jsx"));
const CreatePassword = lazy(() => import("./pages/CreatePassword.jsx"));
const EmptyArchitectDashboardExample = lazy(
  () => import("./pages/EmptyArchitectDashboardExample.jsx"),
);
const EmptyProjectDocumentsExample = lazy(
  () => import("./pages/EmptyProjectDocumentsExample.jsx"),
);
const EmptyProjectInfoExample = lazy(
  () => import("./pages/EmptyProjectInfoExample.jsx"),
);
const EmptyProjectRendersExample = lazy(
  () => import("./pages/EmptyProjectRendersExample.jsx"),
);
const EmptyProjectTrackingExample = lazy(
  () => import("./pages/EmptyProjectTrackingExample.jsx"),
);
const EmptyProjectWarrantiesExample = lazy(
  () => import("./pages/EmptyProjectWarrantiesExample.jsx"),
);
const EmptyProjectsExample = lazy(
  () => import("./pages/EmptyProjectsExample.jsx"),
);
const Requests = lazy(() => import("./pages/Home.jsx"));
const Home = lazy(() => import("./pages/Home.jsx"));
const InactiveAccount = lazy(() => import("./pages/InactiveAccount.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const NewArchitectProjectPage = lazy(
  () => import("./pages/architect-dashboard/NewArchitectProjectPage.jsx"),
);
const NewPassword = lazy(() => import("./pages/NewPassword.jsx"));
const ProjectDetails = lazy(() => import("./pages/ProjectDetails.jsx"));
const PublicProjectsGallery = lazy(
  () => import("./pages/PublicProjectsGallery.jsx"),
);
const ProjectRequestPage = lazy(() => import("./pages/ProjectRequestPage.jsx"));
const RecoverAccount = lazy(() => import("./pages/RecoverAccount.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));

function RouteFallback() {
  return <main className="min-h-screen bg-[var(--color-neutral-bg)]" />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <RecentProjectsProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <ThemeSync />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route path="/" element={<Login />} />
              <Route path="/login" element={<Login />} />
              <Route path="/crear-cuenta" element={<CreateAccount />} />
              <Route path="/crear-contrasena" element={<CreatePassword />} />
            </Route>

            <Route path="/cuenta-inactiva" element={<InactiveAccount />} />
            <Route path="/recuperar-cuenta" element={<RecoverAccount />} />
            <Route path="/nueva-contraseña" element={<NewPassword />} />

            <Route element={<ProtectedRoute allowedRoles={["client"]} />}>
              <Route path="/dashboard-clientes" element={<Home />} />
              <Route path="/solicitudes" element={<Requests view="requests" />} />
              <Route path="/solicitudes/nueva" element={<ProjectRequestPage />} />
              <Route
                path="/dashboard-clientes-vacio"
                element={<EmptyProjectsExample />}
              />
            </Route>

            <Route
              element={<ProtectedRoute allowedRoles={["admin", "architect"]} />}
            >
              <Route
                path="/dashboard-arquitecto"
                element={<InternalDashboardRouter />}
              />
              <Route
                path="/dashboard-arquitecto/nuevo-proyecto"
                element={<NewArchitectProjectPage />}
              />
              <Route
                path="/dashboard-arquitecto-vacio"
                element={<EmptyArchitectDashboardExample />}
              />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
              <Route path="/archivos" element={<AdminFilesPage />} />
              <Route path="/usuarios" element={<AdminUsersPage />} />
              <Route
                path="/usuarios-vacio"
                element={<AdminUsersPage empty />}
              />
              <Route
                path="/dashboard-admin-vacio"
                element={<InternalDashboardRouter empty />}
              />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route path="/proyectos" element={<PublicProjectsGallery />} />
              <Route path="/proyectos/:projectId" element={<ProjectDetails />} />
              <Route path="/configuraciones" element={<Settings />} />
              <Route
                path="/proyectos/quinta-bella-vista/renders-imagenes-vacio"
                element={<EmptyProjectRendersExample />}
              />
              <Route
                path="/proyectos/quinta-bella-vista/informacion-general-vacio"
                element={<EmptyProjectInfoExample />}
              />
              <Route
                path="/proyectos/quinta-bella-vista/documentos-vacio"
                element={<EmptyProjectDocumentsExample />}
              />
              <Route
                path="/proyectos/quinta-bella-vista/seguimiento-vacio"
                element={<EmptyProjectTrackingExample />}
              />
              <Route
                path="/proyectos/quinta-bella-vista/garantias-vacio"
                element={<EmptyProjectWarrantiesExample />}
              />
            </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </RecentProjectsProvider>
    </AuthProvider>
  </StrictMode>,
);
