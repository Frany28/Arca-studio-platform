# Revisión del frontend — 1 de octubre de 2026

## Resultado

El inventario está en [FRONTEND_MAP.md](FRONTEND_MAP.md); [FRONTEND_MAP.json](FRONTEND_MAP.json) incluye todos los archivos y dependencias locales. Regenerarlo con `pnpm audit:frontend` desde Frontend. La auditoría devuelve un error si encuentra imports inexistentes, dependencias de módulos compartidos hacia páginas o controles nativos fuera de ui.

- Se revisaron 213 archivos de componentes: 177 alcanzables desde las entradas de la aplicación y 36 no alcanzables. Estos 36 incluyen 21 reexportaciones de compatibilidad y 15 implementaciones. Alcanzable incluye las rutas de ejemplo; no equivale a uso efectivo en una sesión del navegador.
- Los 31 controles nativos detectados en 17 archivos de páginas y autenticación ahora usan Button, Input o TextArea compartidos. Los elementos HTML semánticos y los controles nativos internos del sistema UI siguen siendo necesarios.
- Se extendió Button con `layout="content"` y los campos con `presentation="control"` para conservar los hijos directos y la geometría de composiciones existentes. Los valores predeterminados mantienen las variantes visuales anteriores. Esta migración centraliza el control, pero conserva las clases especializadas; no constituye una eliminación de todos los estilos locales o duplicados visuales.
- Se corrigió la reexportación de FooterSection que apuntaba a sí misma y se retiró del índice pages.js la exportación de ServicesPage, cuyo archivo ya no existe. La sección pública de servicios sigue disponible desde el home.
- Se retiraron siete archivos completamente vacíos y sin referencias: ui/Card.jsx, Navbar.jsx, Select.jsx, Sidebar.jsx, Table.jsx y layouts/AuthLayout.jsx, MainLayout.jsx. No representaban componentes implementados.
- ESLint impide nuevas declaraciones de button/input/textarea/select/dialog fuera de components/ui. Las variantes y su propósito se documentan en DESIGN_SYSTEM.md y en sus configuraciones.

## Preservación y validación

Se creó una copia temporal del código anterior de Git para comparar el estado original y el resultado sin sustituir los archivos de trabajo.

| Comprobación | Resultado |
| --- | --- |
| Auditoría de imports, consumidores y controles | Sin imports locales rotos, sin dependencias compartidas hacia páginas y sin controles nativos fuera de ui |
| Comparación AST de 107 componentes alcanzables fuera de ui | Idénticos al normalizar únicamente imports y sustituciones de controles; se conservan clases, handlers, atributos y animaciones |
| Frontend `pnpm build` | Correcto; se ejecutó fuera del sandbox porque Vite requiere subprocesos |
| Cuatro pruebas nuevas de composición | Correctas: hijos, referencias, eventos, disabled, tipos de campo, valores y validación; incluyen renderizado estático |
| Comprobación final de composición y galerías | 11 pruebas correctas |
| Suite frontend original | 309 correctas y 58 fallidas, sobre 367 pruebas |
| Suite frontend final | 313 correctas y las mismas 58 fallidas, sobre 371 pruebas; ningún fallo nuevo |
| Lint frontend original y final | Los mismos 47 errores y 6 advertencias; ningún diagnóstico nuevo, normalizando los números de línea |
| Backend `pnpm test` | 115 correctas |
| Backend `pnpm verify` | Se detiene en los seis errores JSDoc preexistentes de src/middlewares/auth.js; no llega a validar Prisma ni migraciones |

La prueba de videos de procesos se actualizó para comprobar el Button compartido en lugar del tag nativo; conserva las comprobaciones de apertura del video y del modal. No se corrigieron los fallos ajenos de tests o lint.

No se realizaron pruebas visuales interactivas en navegador, comparaciones de capturas ni un recorrido manual por todos los roles, tamaños de pantalla y temas. La comparación estructural, las pruebas y la compilación reducen el riesgo, pero no garantizan por sí solas todos esos escenarios.

## Elementos conservados para revisión posterior

No se añadieron usos artificiales para que todos los componentes aparezcan como utilizados. Tampoco se eliminaron implementaciones completas por ausencia de consumidores en las rutas actuales.

- Los archivos ShowcaseData y Config conservan el catálogo de variantes. No estar importados por una ruta no basta para considerarlos desechables.
- Las reexportaciones de compatibilidad se mantienen; cada una y sus consumidores están identificados en el inventario.
- CommentPanel, NotificationsPanel, ListItem, ReplyInput, PaginationDots, ProgressStepGroup, ThemeToggle, Icon, el flujo antiguo ProjectRequestModal y los visores Panorama360 no son alcanzables desde las entradas actuales. Se conservan hasta decidir si son compatibilidad, reserva funcional o código que debe retirarse. Los visores 360 actuales pueden usar otras implementaciones; este resultado se limita a los archivos señalados.
- ProjectRequestModal y Gallery/useImageComments contienen coordinación de API dentro de ui. Una reorganización futura debe separar esa lógica hacia componentes de producto/hooks, revisando todos los visores consumidores y sus pruebas. Las descargas de medios del visor VR tienen otra finalidad y no se deben confundir automáticamente con duplicación de endpoints.
- Se conserva assets y las animaciones existentes. No hubo incorporación o sustitución de imágenes o videos.

La organización vigente y la dirección de dependencias se describen por carpeta en el mapeo. Quedan documentadas las implementaciones antiguas y los fallos previos; no se afirma que toda la deuda del frontend esté resuelta.
