# Validación de sidebar y formularios — 12 de octubre de 2026

## Intervención 1: sidebar

Alcance: anchos centralizados, política de expansión existente y separación de timeouts.
No modifica formularios ni `AvatarLabel`. No se realizaron commits.

| Presentación | Ancho |
| --- | --- |
| Drawer móvil | 312 px, limitado para conservar overlay en pantallas de 320 px |
| Riel expandido, 768–1023 px | 234 px |
| Riel expandido, desde 1024 px | 312 px |
| Riel contraído | 76 px |

Los tokens permanecen en `Frontend/src/styles/global.css`; ninguna página los redefine.
`useResponsiveSidebarExpansion` restablece el estado solamente al cruzar 1280 px.
Las pruebas cubren 1023↔1024 y 1279↔1280 px, elección manual, navegación,
tema oscuro, movimiento reducido, drawer móvil y restauración de foco.

Las pruebas usan Playwright como librería sobre `node:test`, sin `playwright.config`.
`tests/helpers/browserTimeouts.js` conserva 5000 ms para interacción y permite 30000 ms
para navegación inicial de Vite en Proyectos activos.

### Hallazgos preexistentes separados

La comparación en navegador con los anchos anteriores confirmó ambos problemas antes
de adaptar los formularios. No se atribuyen a la centralización ni al cambio de tokens.

| Consumidor y estado | Desborde anterior | Desborde con anchos aprobados |
| --- | --- | --- |
| Configuración, 768 px, riel contraído | 228 px | 228 px |
| Configuración, 768 px, riel expandido | 386 px | 386 px |
| Configuración, 1024 px, riel expandido | 130 px | 208 px |
| Nuevo proyecto, 768 px, riel expandido | 34 px | 34 px |

La suite del sidebar comprueba en estos dos consumidores el ancho del riel y la
distribución del espacio. La ausencia de desborde de sus formularios se verifica
independientemente en la intervención 2, sin omitir ni marcar como exitosos esos defectos.

La deuda de truncamiento de nombres y correos de `AvatarLabel` permanece documentada
en `Frontend/DESIGN_SYSTEM.md`, sin cambiar el componente ni sus consumidores.

Resultados antes de intervenir los formularios: lint frontend correcto; `pnpm verify`
correcto (239 tests backend aprobados, cuatro integraciones PostgreSQL omitidas por su
configuración, 282 tests frontend aprobados y build correcto). Suite completa de navegador:
222 aprobados, cero fallidos, cero omitidos, 394.9 s. El timeout intermitente de navegación
no se reprodujo. Logs locales: `arca-sidebar-lint.log`, `arca-sidebar-verify.log` y
`arca-sidebar-closure.log` en el directorio temporal del sistema.

## Intervención 2: formularios responsive

Autorización: adaptar dimensiones, posiciones y distribución de Configuración y Nuevo
proyecto, conservando escritorio, componentes compartidos, estados y contratos HTTP.

### Causa raíz y elementos medidos antes de implementar

- Configuración a 768 px contraído: contenido de 692 px, sección interior de 596 px;
  el segundo bloque de teléfono conserva `min-width: 320px` y termina en x=996 px.
  El viewport termina en x=768 px, por lo que desborda 228 px. Las filas de 664 px
  contienen dos campos de 320 px y gap de 24 px. Sus reglas móviles solo se activaban
  hasta 767 px y no respondían al espacio consumido por el sidebar y el menú de pestañas.
- Nuevo proyecto a 768 px expandido: sección de 438 px, menú de 152 px y gap de 48 px.
  El formulario tiene mínimo automático de 320 px por el campo Nombre y sus hijos.
  Empieza aproximadamente en x=482 px y termina en x=802 px: 34 px fuera del viewport.
  El grid de áreas usa además un mínimo de track de 280 px, inadecuado para móvil.

Consumidores revisados: los cuatro paneles de Configuración comparten
`settingsLayoutClassNames.js`; `PreferenceItem` pertenece a Preferencias.
`SettingsVerticalTabMenu` se consume en Configuración; `ProjectCreationTabs` y
`ArchitectProjectInformationForm` en Nuevo proyecto. `Input`, `DropdownMenu`, `TextArea`,
`HintText`, `TabPanel` y el uploader son compartidos: la corrección se limita a su
composición y clases en estas funcionalidades, sin cambiar sus contratos ni estados.

Solución aplicada: queries por ancho de contenedor para separar menú y panel cuando
no caben; filas apilables y campos con mínimo cero y máximos acotados; grid de áreas
con mínimo limitado al 100 % del espacio disponible. Las medidas de escritorio se
conservan cuando caben. No se utiliza `overflow-x: hidden` ni `!important` para ocultar
el desborde, ni se añaden componentes o hooks.

Validación requerida: 320, 375, 430, 768, 1024, 1279, 1280 y 1440 px; riel contraído y
expandido desde 768 px; los cuatro paneles de Configuración, formulario de Nuevo
proyecto, estados editables, navegación de pestañas y geometría de escritorio.

### Archivos de la intervención responsive

- `Frontend/src/pages/settings/SettingsPage.jsx` y `SettingsPage.css`: composición
  condicionada al contenedor de 872 px; panel de 664 px y filas adaptables.
- `settings/settingsLayoutClassNames.js`, `PreferenceItem.jsx` y los cuatro paneles de
  `settings/panels/`: clases compartidas; se retiran mínimos y overrides de ancho
  duplicados, preservando dimensiones de 320, 325 y 447 px cuando hay espacio.
- `Frontend/src/pages/architect-dashboard/NewArchitectProjectPage.jsx` y su CSS:
  composición condicionada a 520 px y padding móvil de 16 px.
- `architect-dashboard/components/ArchitectProjectInformationForm.jsx`: mínimo cero,
  campos acotados y grid que puede bajar de 280 px en móvil; estado original intacto.
- `Frontend/tests/browser/formResponsiveLayout.test.js`: 12 pruebas independientes.

No se modificaron componentes UI compartidos, hooks, validaciones, HTTP, rutas,
proveedores, base de datos ni la política de expansión. `AvatarLabel` permanece intacto.

### Evidencia posterior

Las 12 pruebas específicas pasan: 130 combinaciones de panel/formulario, tema, ancho y
estado del riel, además de dropdowns abiertos en móvil, validación, teclado, movimiento
reducido y conservación de borradores. Miden documento, scroll del shell, scroll del
panel y posición de los controles; no consideran desborde el scroll nativo del texto
de un input. No desactivan animaciones ni usan esperas fijas.

| Consumidor y estado | Antes | Después |
| --- | --- | --- |
| Configuración, 768 px, contraído | 228 px | 0 px |
| Configuración, 768 px, expandido | 386 px | 0 px |
| Configuración, 1024 px, expandido | 208 px | 0 px |
| Nuevo proyecto, 768 px, expandido | 34 px | 0 px |

Escritorio a 1440 px: se compararon capturas antes/después y coordenadas de controles
con la misma sesión, tema y fuente Inter. Nombre y Empresa de Configuración conservan
x=690/1034 px y ancho nativo de 268 px; Nombre/Áreas de Nuevo proyecto conservan
x=750/1086 px y ancho nativo de 292 px; Ubicación conserva x=750 px y ancho de 628 px.
Las capturas móviles a 320 px muestran campos, ayudas, selector y avatar dentro del panel.

`pnpm verify` final: correcto, con 239 tests backend aprobados, cuatro integraciones
PostgreSQL omitidas por su configuración, 282 tests frontend aprobados y build correcto.
No se habilitaron integraciones de base de datos ni se aplicaron migraciones.

Suite completa final: **234 aprobados, cero fallidos y cero omitidos**, 385.9 s, usando
`pnpm test:browser` sin alterar concurrencia ni los límites de suites existentes.
Lint frontend final correcto; tras el ajuste de espera inicial también pasó ESLint del
archivo modificado. `git diff --check` correcto.

El primer intento de la suite conjunta registró dos esperas iniciales de los tests nuevos
con límite de 5000 ms: la compilación de la ruta lazy puede continuar después del evento
`load` de `page.goto`. Se corrigió exclusivamente esa fase para reutilizar
`NAVIGATION_TIMEOUT_MS` (30000 ms); las interacciones posteriores siguen con 5000 ms.
El mismo intento observó dos intermitencias en las suites existentes de respuestas y
Stand; ambas pasaron sin cambios en sus módulos, primero en el diagnóstico y después
en la suite completa final. No se añadieron retries, clics forzados ni omisiones.

Logs de esta intervención en el directorio temporal: `arca-form-responsive-targeted.log`, `arca-form-responsive-lint.log`,
`arca-form-responsive-verify.log`, `arca-form-layout-before.log`, `arca-form-layout-after.log`
y `arca-sidebar-and-forms-final-browser.log`. El intento anterior se conserva en
`arca-sidebar-and-forms-browser-attempt1.log`; el diagnóstico de las intermitencias,
en `arca-existing-browser-failure-audit.log`.

Avisos preexistentes observados: atributo `information={false}` transferido al DOM por
TextArea en Soporte y botones anidados en el drawer de respuestas. Quedan fuera de estas
intervenciones. La deuda de truncamiento de `AvatarLabel` continúa pendiente de revisión
de accesibilidad y consulta del contenido completo.
