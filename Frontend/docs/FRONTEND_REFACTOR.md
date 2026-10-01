# Refactorización estructural del frontend

Fecha: 2026-10-01. Rama: `refactor/frontend-responsibilities`.

## Alcance y distribución

La reorganización conserva las interfaces públicas y mueve las responsabilidades
existentes sin modificar endpoints, payloads, permisos, rutas, textos, estilos,
breakpoints o animaciones. No introduce dependencias, contextos globales ni una
reescritura de la aplicación.

| Entrada anterior | Responsabilidades extraídas | Ubicación actual |
| --- | --- | --- |
| `api/http.js` | Transporte, URL base, errores, paginación y uploads; endpoints por dominio | `api/client.js`, `fileUploadClient.js`, seis módulos de dominio y `index.js` |
| `ArchitectDashboard.jsx` | Proyectos, métricas, overview, asignados, cola de revisión, workflow, acciones masivas y notificaciones | `pages/architect-dashboard/hooks/` y `utils/` |
| `ProjectRequestPage.jsx` | Campos y composición del formulario; validación, Geoapify, archivos, borrador y envío | `pages/project-request/components/`, `hooks/` y `utils/` |
| `Home.jsx` privado | Proyectos, solicitudes, notificaciones, scroll sincronizado y filas | `pages/client-dashboard/` |
| `ProjectDetailsPage.jsx` | Carga y sincronización de archivos, URL/tabs, navegación, notificaciones y selección de documentos | `pages/projects/hooks/` y `utils/` |
| `useProjectComments.js` | Tres hooks de comentarios y funciones puras de mapeo/colecciones | `hooks/comments/`, `utils/commentMappers.js` y `commentCollection.js` |

Las páginas conservan navegación y composición visual. `ClientRequests` selecciona
la vista de solicitudes del contenedor compartido `ClientDashboard`, manteniendo
los mismos elementos y navegación. El lazy import correspondiente cambia de
módulo; las rutas y sus propiedades permanecen iguales.

El estado del borrador de una solicitud permanece junto al formulario y su
creación/actualización en el hook de envío: separarlo en otro hook habría agregado
una capa sin responsabilidad independiente. La secuencia de uploads y reintentos
conserva el identificador de envío y los estados por archivo existentes.

El sincronizador del sidebar y la fusión de notificaciones se comparten entre
consumidores que tenían implementaciones equivalentes. Las suscripciones y sus
limpiezas conservan el comportamiento existente. El sincronizador declara como
dependencias el breakpoint constante y el setter estable de React.

## Compatibilidad y áreas conservadas

- `api/http.js` reexporta las mismas interfaces, incluido `api.projects.listAll()`.
  `api` y las exportaciones por dominio apuntan a las mismas instancias.
- `Home.jsx` mantiene su exportación por defecto y acepta las mismas propiedades.
- `hooks/useProjectComments.js` conserva sus tres exportaciones nombradas.
- Los seis paneles de proyecto permanecen sin cambios.
- La caché existente de overview administrativo, las cookies, errores HTTP,
  cursor, aborts, SSE, timers y refresh mantienen sus implementaciones.
- `pages/publicSite/home/`, sus controladores de gestos/scroll, GSAP, Motion,
  assets, CSS y dependencias no se modifican en este refactor.

La rama contiene un primer commit separado con el mapeo y la centralización de
controles solicitados previamente. El commit estructural parte de ese estado,
por lo que los resultados comparativos siguientes usan ese estado como baseline.

## Tamaño de los contenedores

Se cuentan líneas de fuente, excluyendo la línea vacía final; reducir líneas no
constituye por sí mismo el objetivo de las extracciones.

| Módulo | Antes | Después |
| --- | ---: | ---: |
| API pública `http.js` | 736 | 2 |
| Architect Dashboard | 894 | 412 |
| Project Request Page | 929 | 342 |
| Home privado / ClientDashboard | 881 | 483 |
| Project Details Page | 844 | 286 |
| Fachada de comentarios | 592 | 4 |

## Verificación

- Se revisaron y ejecutaron las pruebas relevantes después de cada bloque.
  Las pruebas que inspeccionan fuentes leen ahora sus módulos extraídos; se
  conservan las comprobaciones existentes.
- La comparación AST confirmó los 57 métodos de los seis dominios API y las
  tres funciones completas de hooks de comentarios sin cambios.
- Se compararon los árboles JSX de arquitecto, solicitud, cliente y detalle
  con la fuente inicial, expandiendo el formulario extraído: contenido idéntico.
- Se añadieron nueve pruebas: contratos del cliente HTTP, identidad de fachadas,
  abort/error/204/cursor, funciones puras de comentarios y composición inicial
  de hooks. Las nueve pasan. Las pruebas de composición renderizan hooks en
  servidor; no verifican interacciones ni efectos del navegador.
- `pnpm build`: correcto.
- `pnpm test` frontend: 380 pruebas, 322 correctas, 58 fallidas. El baseline
  tenía 371 pruebas, 313 correctas y las mismas 58 fallidas, sin nombres nuevos.
- `pnpm lint`: 50 errores y 6 advertencias. El baseline tenía 47 errores y
  6 advertencias. Tres diagnósticos de `react-hooks/set-state-in-effect` quedan
  visibles al extraer lógica existente: `useProjectReviewQueue` (reset de cola),
  `useProjectDetails` (estado de error/carga) y `useProjectNavigation` (tab de URL).
  No se desactivaron reglas ni se agregaron timeouts para ocultarlos.
- `pnpm verify` backend: bloqueado por seis errores JSDoc preexistentes en
  `Backend/src/middlewares/auth.js`, funciones `allowedRoles` y
  `requiredPermissions`. Se detiene en `lint:docs`, antes de las comprobaciones
  de Prisma/base de datos y los pasos restantes.
- Alternativa requerida por AGENTS.md: `pnpm test` backend, 115/115 correctas;
  build del frontend correcto.
- `pnpm audit:frontend`: cero imports faltantes, cero controles nativos fuera
  de UI y cero dependencias que crucen los límites revisados. Los módulos sin
  referencias estáticas se inventarían como candidatos; no se borran módulos
  con contenido únicamente por no tener consumidores detectables.

## Límites y observaciones para revisión

El lint y la suite completa no están verdes. Corregir los problemas previos o
cambiar la sincronización de estado detectada por React modificaría alcance o
comportamiento; esos cambios requieren un trabajo separado. Se conserva incluso
la condición contradictoria existente de `providedProject` dentro del efecto de
carga de detalle, sin convertirla en una corrección funcional incidental.

No se ejecutó una comparación visual en navegador ni un flujo autenticado completo
con base de datos, uploads y SSE reales. La compilación, la comparación de fuentes
y las pruebas aisladas reducen el riesgo pero no sustituyen esa revisión antes de
integrar. El PR se entrega como borrador con estos resultados visibles.
