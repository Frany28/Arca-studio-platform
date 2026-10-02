import { createRoot } from "react-dom/client";

import { AuthProvider } from "../../../src/auth/AuthContext.jsx";
import { RecentProjectsProvider } from "../../../src/auth/RecentProjectsContext.jsx";
import SideNavigation from "../../../src/components/ui/SideNavigation/SideNavigation.jsx";
import "../../../src/index.css";

const root = createRoot(document.getElementById("root"));
const events = [];
let sidebarProps = {
  defaultActiveItemId: "dashboard",
  items: [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "requests", label: "Solicitudes", icon: "requests" },
    { id: "settings", label: "Configuraciones", icon: "settings" },
    { id: "unknown", label: "Otro destino", icon: "unknown" },
  ],
  userName: "Persona de prueba",
  userEmail: "sidebar@example.test",
};

/**
 * Actualiza las props externas del componente real conservando su identidad React.
 * Permite comprobar que los modos controlados esperan al padre y los internos conservan estado.
 *
 * @param {Object} [nextProps] Props públicas que se desean cambiar.
 * @returns {void} Solicita el render y registra los argumentos de los callbacks públicos.
 */
function setProps(nextProps = {}) {
  sidebarProps = { ...sidebarProps, ...nextProps };
  root.render(
    <AuthProvider>
      <RecentProjectsProvider>
        <SideNavigation
          {...sidebarProps}
          onExpandedChange={(value) => events.push({ type: "expanded", value })}
          onCollapseClick={(value) => events.push({ type: "collapse", value })}
          onItemSelect={(value) => events.push({ type: "select", value })}
          onSearchChange={(event) => events.push({ type: "search", value: event.target.value })}
          onLogoutClick={() => events.push({ type: "logout" })}
          onNewOpportunityClick={() => events.push({ type: "new-opportunity" })}
        />
      </RecentProjectsProvider>
    </AuthProvider>,
  );
}

window.sideNavigationHarness = { setProps, events };
setProps();
