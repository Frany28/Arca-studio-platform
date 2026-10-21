import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AdminPageTitle from "../../components/AdminPageTitle.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import TabPanel from "../../components/ui/TabPanel.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import ModuleInDevelopmentPanel from "./components/ModuleInDevelopmentPanel.jsx";
import ServicesQuotesMetrics from "./components/ServicesQuotesMetrics.jsx";
import ServicesQuotesTabMenu from "./components/ServicesQuotesTabMenu.jsx";
import MeasurementUnitsPanel from "./measurement-units/MeasurementUnitsPanel.jsx";
import {
  SERVICES_QUOTES_DEFAULT_TAB_SLUG,
  SERVICES_QUOTES_TABS,
  getServicesQuotesTabIndex,
  getServicesQuotesTabPath,
} from "./utils/servicesQuotesTabs.js";

// El módulo administrativo no ofrece accesos a proyectos recientes en la navegación.
const NO_PROJECT_SHORTCUTS = [];
// Ruta absoluta: dentro de una ruta comodín, un destino relativo se resolvería desde la URL
// completa (relativeSplatPath de React Router v7) y una subruta desconocida no se corregiría.
const DEFAULT_TAB_PATH = getServicesQuotesTabPath(SERVICES_QUOTES_DEFAULT_TAB_SLUG);

/**
 * Contenedor del módulo «Servicios y cotizaciones» (Figma 5790:339391) dentro del shell interno
 * compartido: título, indicadores, pestañas horizontales y el panel de la subruta activa.
 * La ruta protegida `/servicios-cotizaciones/*` (solo administradores) delega aquí sus subrutas:
 * Unidades es funcional; Tabulador de servicios y Cotizaciones muestran su estado provisional.
 *
 * @returns {import("react").ReactElement} Módulo con el destino del riel siempre activo.
 */
function AdminServicesQuotesPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const navigation = useDashboardNavigation({ projectRows: NO_PROJECT_SHORTCUTS, roleCode: "admin" });
  const { isNotificationsDrawerOpen, setIsNotificationsDrawerOpen } = navigation;
  const location = useLocation();
  const navigate = useNavigate();
  const activeIndex = getServicesQuotesTabIndex(location.pathname);
  const activeTab = SERVICES_QUOTES_TABS[activeIndex];

  return (
    <InternalDashboardLayout
      currentUser={currentUser}
      navigation={navigation}
      activeItemId="services-quotes"
      showGreeting={false}
      onNotificationsToggle={() => setIsNotificationsDrawerOpen((open) => !open)}
    >
      {/* Sin min-h-0: la sección crece con su contenido y el layout hace el scroll. */}
      <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-[24px] px-[16px] pb-[48px] sm:px-[24px] min-[768px]:gap-[48px] lg:px-[48px]" aria-labelledby="admin-services-quotes-title">
        <header className="flex flex-col gap-[16px]">
          <AdminPageTitle id="admin-services-quotes-title">Servicios y cotizaciones</AdminPageTitle>
          <ServicesQuotesMetrics />
        </header>

        <div className="flex flex-col gap-[24px] min-[768px]:gap-[48px]">
          <ServicesQuotesTabMenu
            activeIndex={activeIndex}
            onChange={(index) => navigate(getServicesQuotesTabPath(SERVICES_QUOTES_TABS[index].slug))}
          />

          <TabPanel transitionKey={activeTab?.id ?? "redirect"}>
            <Routes>
              <Route index element={<Navigate to={DEFAULT_TAB_PATH} replace />} />
              <Route
                path="cotizaciones"
                element={(
                  <ModuleInDevelopmentPanel
                    title="Cotizaciones en desarrollo"
                    description="Aquí podrás crear y consultar cotizaciones a partir del tabulador de servicios."
                  />
                )}
              />
              <Route
                path="tabulador/*"
                element={(
                  <ModuleInDevelopmentPanel
                    title="Tabulador de servicios en desarrollo"
                    description="Aquí podrás gestionar los servicios, sus tarifas de referencia y unidades de medida."
                  />
                )}
              />
              <Route path="unidades" element={<MeasurementUnitsPanel />} />
              <Route path="*" element={<Navigate to={DEFAULT_TAB_PATH} replace />} />
            </Routes>
          </TabPanel>
        </div>
      </section>

      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        recentActivity={[]}
      />
    </InternalDashboardLayout>
  );
}

export default AdminServicesQuotesPage;
