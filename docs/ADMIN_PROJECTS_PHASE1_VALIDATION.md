# Gestión de Proyectos — fase 1

Fecha: 13 de octubre de 2026. Interfaz administrativa de presentación y responsive,
integrada con lecturas existentes. Sin commits ni push.

Referencia: [Figma, contenido 3727:686421](https://www.figma.com/design/Vy3rWOkJ1WIiDLcPoHbHuQ/ARCA-WEBSITE?node-id=3727-686421&m=dev).
Se inspeccionaron también escritorio `3727:686867`, tablet `3727:686872`, móvil
`3727:686874`, header/KPIs, toolbar, encabezados y filas de la tabla.

## Diagnóstico y baseline

El destino administrativo Proyectos abría la galería, cuya finalidad y composición
son diferentes. La tabla de Proyectos activos ya resolvía las siete columnas,
filtros, selección, responsables, paginación y desplazamiento horizontal del diseño.
La solución extiende esa tabla y compone una página breve, sin copiarla ni crear
otro sistema de componentes. Usuarios aportaba el patrón compartido de toolbar y KPIs.

Antes de modificar código:

| Comprobación | Resultado |
| --- | --- |
| `Frontend: pnpm test` | 282 aprobadas, 0 fallos |
| Navegador: `adminActiveProjects.test.js` + `adminResponsiveLayout.test.js` | 44 aprobadas, 0 fallos; 70,7 s |

Los logs se conservaron en `%TEMP%/arca-project-management-baseline-unit.log` y
`%TEMP%/arca-project-management-baseline-browser.log`.

## Reutilización y arquitectura

| Bloque | Implementación reutilizada |
| --- | --- |
| Shell, sidebar, drawer y navbar | `InternalDashboardLayout`, `useDashboardNavigation`, navegación responsive y política centralizada existentes |
| Título y métricas | `AdminPageTitle`, `AdminKpiMetric`, `IconContainer` e iconos Iconsax existentes |
| Tabla y presentación de celdas | `AdminActiveProjects`, `Tag`, `Avatar`, `Badge`, `AssigneeMultiSelect` |
| Controles | `AdminTableToolbar`, `Input`, `DropdownMenu`, `Button`, `Checkbox`, `ScrollBar` |
| Filtros, selección, paginación y scroll | Hooks locales y helpers de Proyectos activos existentes |
| Carga, vacío, sin resultados y error | Presets de `Loader`, `EmptyState`, `HintText` y reintento existentes |
| Datos y navegación | `useDashboardProjects`, `useAdminDashboardData`, `getProjectPath` y drawer de notificaciones existentes |

Único componente nuevo: `AdminProjectsPage`, una composición de página. No se
crearon nuevos componentes UI, hooks, dependencias ni servicios HTTP.
`adminProjectMetrics.js` concentra el cálculo puro de los tres contadores de proyectos;
`adminProjectTable.js` mantiene una sola configuración de anchos para tabla y skeleton.

La ruta `/gestion-proyectos` se añadió al grupo administrativo protegido existente.
El destino Proyectos del administrador apunta a ella. `/proyectos` conserva su
galería y los destinos de cliente y arquitecto. No se modificó la implementación
de autenticación ni permisos.

La página usa la colección real recogida por cursor por `useDashboardProjects`.
Total, en progreso y finalizados se calculan antes de filtros y paginación; se
usa `finished` como estado canónico y reconoce temporalmente el alias histórico
`completed` según [la unificación de estados](PROJECT_FINISHED_STATUS.md). Solicitudes usa
`GET /admin/dashboard-metrics`, campo `requests.total`: solicitudes pendientes según
el contrato existente, no todas las solicitudes históricas. Los valores de Figma
no se incorporaron como estadísticas. Los fixtures están exclusivamente en tests.

`useAdminDashboardData` permite omitir overview y catálogo de responsables con dos
opciones que conservan true por defecto. Así esta vista no carga datos de edición
innecesarios y el dashboard operativo mantiene sus lecturas originales.

Las variantes compartidas conservan los valores por defecto:

- `AdminActiveProjects`: dashboard de cinco filas; management de diez, sin subtítulo,
  encabezados del diseño y controles de mutación bloqueados sin integración.
- `AdminKpiMetric`: Usuarios y Archivos mantienen mínimo 235 px y padding original.
  Projects permite ancho intrínseco en tablet, gaps de 16 px y columnas de 235 px
  desde 940 px disponibles. Móvil apila las cuatro métricas.
- `Input` y `AssigneeMultiSelect`: `showDisabledTags=false` por defecto. La nueva página
  lo activa para leer los responsables de un control bloqueado; no habilita cambios.
- `Loader`: variantes para diez filas/siete columnas y métricas de proyectos. Sus
  presets y consumidores anteriores conservan la presentación por defecto.

No se alteraron endpoints, clientes HTTP, reglas de negocio, PostgreSQL, Prisma,
animaciones, tokens globales ni política de expansión del sidebar.

## Responsive y comportamiento

La matriz de navegador recorre ambos temas y todos los estados indicados:

| Anchos (px) | Sidebar | Comprobación |
| --- | --- | --- |
| 320, 375, 430 | Riel oculto; shell móvil compartido | Cuatro KPIs apilados, columnas legibles y footer accesible |
| 768 | Contraído 76 / expandido 234 | Métricas y toolbar se envuelven; scroll interno de tabla |
| 1024, 1279 | Contraído 76 / expandido 312 | Distribución según espacio disponible; a 1024 contraído cuatro KPIs en una fila |
| 1280, 1440, 1920 | Contraído 76 / expandido 312 | Cuatro KPIs en una fila; tabla completa cuando cabe |

Resultado: **0 px de overflow horizontal del documento y del shell** en los
30 escenarios (15 combinaciones de ancho/riel × dos temas). Las siete columnas
mantienen los mínimos 48/155/184/300/117/117/172 px, total 1093 px. Se comprobó
encabezado de 49 px y diez filas de 68 px, incluidos los selectores bloqueados.
Cuando no cabe, el scroll interno permite acceder a todas las columnas.

La prueba incluye nombres extensos de proyecto y cliente, ambos estados de selección
del footer en cada escenario, lectura de responsables y bloqueo de sus cambios,
filtros, búsqueda, limpieza, sin resultados, paginación 10 + 2, carga inicial, vacío,
error y reintento. Nuevo se activa con foco y Enter y abre el formulario existente.
Los contratos compartidos cubren además selección por teclado, dropdowns, scroll,
mutaciones existentes del dashboard, estados de error y feedback.

Las lecturas HTTP del navegador se interceptan con fixtures; cualquier mutación o
endpoint no previsto produce un fallo. No se hizo una sesión manual contra una base
de datos real. La política de timeouts compartida conserva interacción 5000 ms y
navegación 30000 ms; no se aumentaron límites de otras pruebas.

## Comparación visual y diferencias

Se compararon imágenes reales del navegador con capturas oficiales de Figma,
incluyendo escritorio oscuro con riel contraído, tablet clara contraída y móvil claro.
Las capturas de navegador usan fixtures extensos, fecha actual y diez filas;
no son datos reales de usuarios ni capturas de producción.

Se revisaron también ambos temas y estados del riel a 1024/1440, y móvil oscuro.
Las capturas esperaron las transiciones existentes, sin desactivar animaciones.
Después de la revisión se eliminaron las imágenes del repositorio y de la carpeta
temporal de esta validación, según la instrucción del usuario. Se conservan aquí
los resultados de la comparación y las referencias a los nodos oficiales de Figma.

Coinciden composición de bloques, jerarquía del título, iconografía/temas de KPIs,
orden de columnas, diez filas, geometría de tabla y desplazamiento interno.
No se declara igualdad píxel a píxel. Diferencias explícitas:

- Datos, fotografías/fallbacks y fecha corresponden al contenido disponible. Los
  valores 20/10/10 de Figma no sustituyen estadísticas reales.
- En móvil Quitar filtros ocupa una fila accesible; Figma lo deja fuera del frame.
  Esto desplaza verticalmente la tabla. La búsqueda usa todo el ancho disponible.
- El footer reutiliza el patrón de proyectos: paginación envuelve cuando no cabe
  junto al contador, incluso a 375 px con la tipografía y botones compartidos.
  Figma muestra una sola fila a ese ancho. No se copiaron overrides del footer de Usuarios.
- Botones conservan tamaños del sistema (M de 44 px); Figma ilustra algunos de 41 px.
  Los tags de proyecto usan Body/b3: el tamaño L de escritorio del sistema mide
  aproximadamente 29 px frente a 25 px del frame; móvil reutiliza el patrón de 25 px.
- El título desktop usa el line-height de 56 px del sistema frente a 58 px del frame.
- Archivado mantiene el tema Archived del sistema (familia warning); progreso conserva
  el Badge Neutral existente, frente a otros rellenos ilustrados en Figma.
- Responsables y acciones pendientes muestran el estado Disabled del sistema.
  Figma ilustra algunos de ellos activos; la fase 1 no presenta operaciones ficticias.

## Validación final

| Comando / comprobación | Resultado |
| --- | --- |
| `Frontend: pnpm lint` | Aprobado |
| `Backend: pnpm verify` | Aprobado: lint de JSDoc, validación Prisma, tests backend/frontend y build |
| Tests backend | 239 aprobados, 4 PostgreSQL opcionales omitidos, 0 fallos (243 total) |
| Tests unitarios frontend | 285 aprobados, 0 fallos |
| Navegador: cuatro archivos relacionados completos | 71 aprobados, 0 fallos, 0 omitidos |
| `git diff --check` y revisión de alcance | Sin errores de whitespace; cambios limitados a esta composición y APIs compatibles |

Comando de navegador, desde Frontend:

```powershell
node --test tests/browser/adminProjectsPage.test.js tests/browser/adminActiveProjects.test.js tests/browser/adminResponsiveLayout.test.js tests/browser/input.test.js
```

Se ejecutaron los archivos completos, no solo casos aislados. Cubren la nueva página,
Proyectos activos, dashboard, Usuarios, Archivos y contratos de Input. No se ejecutó
en esta intervención la suite global de navegador de funcionalidades ajenas.
Logs: `%TEMP%/arca-project-management-lint.log`,
`%TEMP%/arca-project-management-verify.log` y
`%TEMP%/arca-project-management-related-browser.log`.
Capturas reproducibles configurando `ARCA_PROJECT_CAPTURE_DIR` antes del comando;
deben eliminarse después de su revisión.

Cuatro PostgreSQL omitidas por las guardas existentes, sin acceso/configuración
explícita de su entorno opcional:

| Archivo / caso | Motivo |
| --- | --- |
| `Backend/tests/adminRequestClient.integration.test.js`: cola HTTP identifica solicitante y detalles/errores | `ARCA_REQUEST_CLIENT_DB_TESTS` no es 1 |
| `Backend/tests/projectRequestMeetingRecommendation.integration.test.js`: reunión, históricos, omisiones y permisos | `ARCA_WORKFLOW_DB_TESTS` no es 1 |
| `Backend/tests/projectRequestStand.integration.test.js`: creación/edición/cola de stands con repositorio real | `ARCA_STAND_REPOSITORY_DB_TESTS` no es 1 |
| Mismo archivo: migración aditiva, históricos NULL y restricción de aplicabilidad | Sin `ARCA_STAND_TEST_DATABASE_URL` exclusiva de pruebas |

Ninguna valida esta composición frontend: no cambiaron repositorios, migraciones,
solicitudes ni contratos. No se habilitaron pruebas que escriben sobre una base sin
su configuración específica.

## Archivos de la intervención

Nuevos:

- `Frontend/src/pages/admin-projects/AdminProjectsPage.jsx`
- `Frontend/src/pages/admin-projects/utils/adminProjectMetrics.js`
- `Frontend/src/config/adminProjectTable.js`
- `Frontend/tests/adminProjectsPage.test.js`
- `Frontend/tests/browser/adminProjectsPage.test.js`
- Este informe.

Modificados:

- `Frontend/src/main.jsx`, `Frontend/src/utils/sideNavigationItems.js`.
- `Frontend/src/components/AdminKpiMetric.jsx`.
- `Frontend/src/components/ui/AssigneeMultiSelect/AssigneeMultiSelect.jsx`.
- `Frontend/src/components/ui/Input/Input.jsx`, su `README.md` y `ui/Loader/Loader.jsx`.
- `Frontend/src/pages/admin-dashboard/hooks/useAdminDashboardData.js`.
- `Frontend/src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.jsx`,
  `hooks/useAdminProjectFilters.js` y `utils/adminProjectPresentation.js`.
- `Frontend/tests/adminFilesPage.test.js`, `adminProjectSelection.test.js` y `browser/input.test.js`:
  adaptación de asserts estructurales y regresión de etiquetas bloqueadas.
- `Frontend/DESIGN_SYSTEM.md`, `Frontend/STRUCTURE_AUDIT.md`.

## Siguiente fase y deuda conservada

Nuevo y Ver usan navegación existente. Búsqueda, filtros, selección, reintento y
paginación ya operan localmente con datos reales. Para una fase posterior quedan
las integraciones de edición, asignación, menú Más opciones y operaciones masivas
en esta página, con sus validaciones, confirmaciones y permisos correspondientes.
Los iconos de ordenación conservan la presentación existente; no se añadió sorting.

Se mantiene registrada la deuda de truncamiento de nombres/correos en AvatarLabel
para revisión transversal de accesibilidad y consulta del contenido completo.
No se corrigió ni se cambió ese componente en esta tarea.
