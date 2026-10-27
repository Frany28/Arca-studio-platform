import { useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AdminPageTitle from "../../components/AdminPageTitle.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import TabPanel from "../../components/ui/TabPanel.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import ServicesQuotesMetrics from "./components/ServicesQuotesMetrics.jsx";
import ServicesQuotesTabMenu from "./components/ServicesQuotesTabMenu.jsx";
import { useQuoteSummary } from "./hooks/useQuoteSummary.js";
import { useServiceCatalogSummary } from "./hooks/useServiceCatalogSummary.js";
import MeasurementUnitsPanel from "./measurement-units/MeasurementUnitsPanel.jsx";
import QuoteEditorPage from "./quote-editor/QuoteEditorPage.jsx";
import QuotesPanel from "./quotes/QuotesPanel.jsx";
import ServiceCatalogPanel from "./service-catalog/ServiceCatalogPanel.jsx";
import {
  QUOTE_CREATE_SEGMENT,
  QUOTE_EDIT_SEGMENT,
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
 * Vista con pestañas del módulo: título, indicadores, menú horizontal y el panel de la subruta
 * activa (Cotizaciones, Tabulador de servicios o Unidades).
 *
 * @param {Object} props - Resúmenes compartidos y aviso pendiente del listado.
 * @param {Object} props.catalogSummary - Resumen del tabulador (useServiceCatalogSummary).
 * @param {Object} props.quoteSummary - Total de cotizaciones (useQuoteSummary).
 * @param {Object|null} props.quoteNotice - Aviso de un guardado confirmado para el listado.
 * @param {() => void} props.onQuoteNoticeDismiss - Retira ese aviso.
 * @returns {import("react").ReactElement} Vista con pestañas.
 */
function ServicesQuotesTabsView({ catalogSummary, onQuoteNoticeDismiss, quoteNotice, quoteSummary }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeIndex = getServicesQuotesTabIndex(location.pathname);
  const activeTab = SERVICES_QUOTES_TABS[activeIndex];

  return (
    // Sin min-h-0: la sección crece con su contenido y el layout hace el scroll.
    <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-[24px] px-[16px] pb-[48px] sm:px-[24px] min-[768px]:gap-[48px] lg:px-[48px]" aria-labelledby="admin-services-quotes-title">
      <header className="flex flex-col gap-[16px]">
        <AdminPageTitle id="admin-services-quotes-title">Servicios y cotizaciones</AdminPageTitle>
        <ServicesQuotesMetrics summary={catalogSummary} quoteSummary={quoteSummary} />
      </header>

      <div className="flex flex-col gap-[24px] min-[768px]:gap-[48px]">
        <ServicesQuotesTabMenu
          activeIndex={activeIndex}
          onChange={(index) => navigate(getServicesQuotesTabPath(SERVICES_QUOTES_TABS[index].slug))}
        />

        <TabPanel transitionKey={activeTab?.id ?? "redirect"}>
          <Routes>
            <Route index element={<Navigate to={DEFAULT_TAB_PATH} replace />} />
            <Route path="cotizaciones" element={<QuotesPanel notice={quoteNotice} onNoticeDismiss={onQuoteNoticeDismiss} />} />
            <Route path="tabulador/*" element={<ServiceCatalogPanel summary={catalogSummary} />} />
            <Route path="unidades" element={<MeasurementUnitsPanel />} />
            <Route path="*" element={<Navigate to={DEFAULT_TAB_PATH} replace />} />
          </Routes>
        </TabPanel>
      </div>
    </section>
  );
}

/**
 * Contenedor del módulo «Servicios y cotizaciones» (Figma 5790:339391) dentro del shell interno
 * compartido. La ruta protegida `/servicios-cotizaciones/*` (solo administradores) delega aquí sus
 * subrutas: las tres pestañas y el formulario de cotización (alta y edición, Figma 5771:452483),
 * que sustituye la cabecera con pestañas por su ruta de navegación. Los resúmenes del tabulador y
 * de cotizaciones se leen una vez aquí y se recargan tras los cambios que los afectan.
 *
 * @returns {import("react").ReactElement} Módulo con el destino del riel siempre activo.
 */
function AdminServicesQuotesPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const navigation = useDashboardNavigation({ projectRows: NO_PROJECT_SHORTCUTS, roleCode: "admin" });
  const { isNotificationsDrawerOpen, setIsNotificationsDrawerOpen } = navigation;
  const catalogSummary = useServiceCatalogSummary();
  const quoteSummary = useQuoteSummary();
  // Aviso de un guardado confirmado: el formulario vuelve al listado, que lo muestra una vez.
  const [quoteNotice, setQuoteNotice] = useState(null);
  const editorProps = {
    catalog: catalogSummary,
    onSaved: (notice) => {
      quoteSummary.reload();
      setQuoteNotice({ ...notice, id: Date.now() });
    },
  };

  return (
    <InternalDashboardLayout
      currentUser={currentUser}
      navigation={navigation}
      activeItemId="services-quotes"
      showGreeting={false}
      onNotificationsToggle={() => setIsNotificationsDrawerOpen((open) => !open)}
    >
      <Routes>
        <Route path={`cotizaciones/${QUOTE_CREATE_SEGMENT}`} element={<QuoteEditorPage mode="create" {...editorProps} />} />
        <Route path={`cotizaciones/:quoteId/${QUOTE_EDIT_SEGMENT}`} element={<QuoteEditorPage mode="edit" {...editorProps} />} />
        <Route
          path="*"
          element={(
            <ServicesQuotesTabsView
              catalogSummary={catalogSummary}
              quoteSummary={quoteSummary}
              quoteNotice={quoteNotice}
              onQuoteNoticeDismiss={() => setQuoteNotice(null)}
            />
          )}
        />
      </Routes>

      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        recentActivity={[]}
      />
    </InternalDashboardLayout>
  );
}

export default AdminServicesQuotesPage;
