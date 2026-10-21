import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createUserSideNavigationItems, SERVICES_QUOTES_PATH } from "../src/utils/sideNavigationItems.js";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("servicios y cotizaciones: una entrada entre Historial y Configuraciones, como en Figma", () => {
  const items = createUserSideNavigationItems([], "admin");
  const ids = items.map(({ id }) => id);
  const entry = items.find(({ id }) => id === "services-quotes");

  assert.equal(ids.indexOf("services-quotes"), ids.indexOf("history") + 1);
  assert.equal(ids.indexOf("settings"), ids.indexOf("services-quotes") + 1);
  assert.deepEqual(entry, {
    id: "services-quotes",
    label: "Servicios y cotizaciones",
    icon: "services-quotes",
    wrapperHeight: "44px",
    to: "/servicios-cotizaciones",
  });
  assert.equal(SERVICES_QUOTES_PATH, entry.to);
});

test("servicios y cotizaciones: solo los administradores ven la entrada", () => {
  for (const role of ["client", "architect", "unknown"]) {
    assert.equal(createUserSideNavigationItems([], role).some(({ id }) => id === "services-quotes"), false, role);
  }
});

test("servicios y cotizaciones: ruta protegida para admin, con subrutas y vista provisional activa", async () => {
  const [main, page, icons] = await Promise.all([
    source("main.jsx"),
    source("pages/admin-services-quotes/AdminServicesQuotesPage.jsx"),
    source("components/ui/SideNavigation/SideNavigationIcons.jsx"),
  ]);

  // La ruta está dentro del bloque protegido exclusivo de administradores, antes del siguiente bloque.
  const adminBlock = main.slice(main.indexOf('allowedRoles={["admin"]}'), main.indexOf("<Route element={<ProtectedRoute />}>"));
  assert.match(adminBlock, /path="\/servicios-cotizaciones\/\*"\s+element=\{<AdminServicesQuotesPage \/>\}/);
  assert.equal((main.match(/servicios-cotizaciones/g) || []).length, 1, "una única declaración de la ruta");

  // Icono vuesax/linear/task-square del diseño, desde la librería ya usada por el riel.
  assert.match(icons, /TaskSquare,\s*\} from "iconsax-react"/);
  assert.match(icons, /"services-quotes": TaskSquare/);

  // Contenedor: shell compartido con el destino del riel activo en todas las subrutas, que se
  // resuelven dentro de la página sin declarar rutas adicionales en main.jsx.
  assert.match(page, /<InternalDashboardLayout[\s\S]*activeItemId="services-quotes"/);
  assert.match(page, /Servicios y cotizaciones/);
  assert.match(page, /<Routes>[\s\S]*path="cotizaciones"[\s\S]*path="tabulador\/\*"[\s\S]*path="unidades"/);
  // Las pestañas provisionales no inventan datos.
  assert.doesNotMatch(page, /fetch\(|UNID-\d|referenceRate/);
});
