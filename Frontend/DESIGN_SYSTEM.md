# Sistema de diseño del frontend

Este documento define cómo construir y modificar interfaces en ARCA Studio sin perder consistencia ni duplicar componentes. Es obligatorio consultarlo antes de crear una página, un componente visual o una variante nueva.

## Fuente de verdad

El sistema actual está compuesto por:

- React para componentes y estado.
- Tailwind CSS para composición y estilos locales.
- `src/styles/global.css` para colores, espaciado, radios, sombras, breakpoints y modo oscuro.
- `src/styles/typography.css` para la escala tipográfica.
- `src/components/ui` para componentes reutilizables.
- `clsx` para clases condicionales.
- Iconsax y los iconos internos existentes para iconografía.

Los tokens y componentes existentes son la fuente de verdad. Una maqueta o valor aislado no debe crear un segundo sistema visual dentro de la aplicación.

## Regla obligatoria: preservar posiciones existentes

La posición, alineación, orden, tamaño y espaciado de los componentes existentes forman parte del diseño aprobado y **no deben modificarse** salvo que el usuario lo solicite de manera explícita.

- Corregir datos, estados de carga, errores o comportamiento no autoriza a mover ni reordenar elementos visuales.
- Una mejora interna de un componente debe conservar su geometría y su ubicación actuales en todos los breakpoints.
- Las capas flotantes, menús, tooltips y modales deben respetar su anclaje, centrado y nivel de superposición existentes.
- Si una necesidad técnica exige cambiar una posición y no existe una instrucción explícita, se debe consultar antes de implementar el cambio.
- Cuando el usuario proporcione una nueva ubicación o un diseño de referencia, solo se modificarán los elementos indicados; el resto de la composición permanecerá intacto.

## Regla contra duplicados

Antes de crear un componente:

1. Buscar por función y no solo por nombre dentro de `src/components/ui` y las páginas.
2. Comprobar si el resultado se puede lograr mediante las propiedades o variantes del componente existente.
3. Si falta una capacidad reutilizable, añadir una variante al componente compartido y documentarla en su archivo de configuración.
4. Crear un componente nuevo únicamente cuando tenga una responsabilidad distinta.

No copiar el JSX o las clases de botones, inputs, modales, alertas, avatares, menús, etiquetas, estados vacíos ni controles existentes dentro de una página.

Si un patrón aparece dos veces, debe evaluarse su extracción. Si aparece tres veces, debe convertirse en componente o utilidad compartida, salvo que exista una razón documentada para mantenerlo local.

## Jerarquía de componentes

```text
src/components/ui       componentes visuales reutilizables
src/components          componentes compartidos con lógica de producto
src/pages/*/components  composición propia de una sección o página
src/pages               páginas y coordinación de datos
```

- Un componente de `ui` no debe conocer endpoints, rutas de negocio ni la forma completa de una respuesta de API.
- Una página coordina datos y estados, pero debe delegar la presentación repetible.
- Los menús de pestañas que intercambian paneles deben renderizar su contenido dentro de `TabPanel`, usando el identificador de la pestaña como `transitionKey` para mantener la transición estándar.
- La lógica de carga, paginación y transformación compartida debe vivir en hooks o utilidades, no repetirse en cada pantalla.
- Usar nombres PascalCase para componentes y nombres que expresen su función, no su apariencia temporal.

## Regla obligatoria: orden estructural de carpetas

Todo archivo nuevo o trasladado dentro de `Frontend/src` debe ubicarse según su responsabilidad. No se deben crear carpetas genéricas, duplicar capas existentes ni colocar archivos en la raíz de `src` salvo los puntos de entrada de la aplicación.

```text
src/
├── api/          clientes HTTP y funciones de acceso a endpoints
├── assets/       imágenes, iconos, fuentes y otros recursos estáticos
├── auth/         políticas y utilidades propias de autenticación y autorización
├── components/
│   ├── layout/   piezas compartidas que estructuran la aplicación
│   └── ui/       componentes visuales reutilizables y agnósticos del negocio
├── config/       configuración estática y constantes globales
├── contexts/     contextos y proveedores globales de React
├── data/         catálogos o datos estáticos compartidos
├── hooks/        hooks reutilizables entre funcionalidades
├── layouts/      composiciones de página y shells de navegación
├── pages/        rutas, pantallas y módulos propios de cada funcionalidad
├── styles/       tokens, tipografía y estilos globales
└── utils/        funciones puras y utilidades compartidas
```

Las siguientes reglas determinan la ubicación y las dependencias:

1. `pages/<funcionalidad>/` agrupa los componentes, hooks, datos y helpers usados exclusivamente por esa funcionalidad. Sus subcarpetas deben expresar una responsabilidad concreta, como `components`, `hooks` o `utils`.
2. Un elemento se mueve a una carpeta compartida únicamente cuando tiene consumidores reales fuera de su funcionalidad. No se anticipa reutilización creando abstracciones globales sin uso.
3. Los componentes visuales genéricos pertenecen a `components/ui/<NombreComponente>/`. El componente principal, su configuración, pruebas específicas y archivo `index.js`, cuando corresponda, permanecen juntos.
4. Los componentes que estructuran varias páginas pertenecen a `components/layout`; las composiciones completas asociadas a rutas pertenecen a `layouts`.
5. Los hooks compartidos pertenecen a `hooks` y usan el prefijo `use`. Un hook exclusivo de una página permanece dentro de `pages/<funcionalidad>/hooks`.
6. Las llamadas HTTP se centralizan en `api`; ni componentes, hooks visuales ni utilidades deben construir endpoints duplicados o ejecutar peticiones directas si ya existe un cliente de API aplicable.
7. `utils` contiene lógica pura y sin renderizado. Una utilidad exclusiva de una funcionalidad permanece dentro del módulo de esa página hasta que exista reutilización real.
8. Los recursos estáticos se agrupan en `assets` por dominio o funcionalidad. No se almacenan imágenes, SVG, fuentes ni videos dentro de carpetas de componentes o páginas.
9. `styles` se reserva para reglas globales y tokens. Los estilos locales permanecen junto al componente mediante las convenciones vigentes de Tailwind.
10. La dirección de dependencias debe ir desde páginas y layouts hacia módulos compartidos. `components/ui`, `utils`, `api` y `config` no pueden importar desde `pages`.
11. Antes de crear una carpeta nueva se debe comprobar que ninguna carpeta existente representa ya esa responsabilidad. Los nombres deben describir dominio o función; se prohíben nombres ambiguos como `misc`, `common2`, `new`, `temp` o `otros`.
12. Los archivos preexistentes que todavía no sigan esta estructura pueden migrarse de forma gradual cuando sean modificados, siempre que el traslado no mezcle un cambio funcional con una reorganización amplia ni rompa sus consumidores.

## Tokens visuales

Usar siempre las variables expuestas en `global.css`. No introducir colores hexadecimales, radios, sombras o separaciones arbitrarias si ya existe un token equivalente.

### Color

- `--color-primary-*`: acciones y énfasis principal.
- `--color-neutral-*`: superficies, bordes y contenido neutral.
- `--color-text-*`: jerarquía de texto.
- `--color-danger-*`: errores y acciones destructivas.
- `--color-warning-*`: advertencias.
- `--color-success-*`: confirmaciones.
- `--color-info-*`: información y acciones informativas.
- `--color-accent-*`: acentos de marca.

Ejemplo:

```jsx
<section className="bg-[var(--color-neutral-100)] text-[var(--color-text-50)]">
  ...
</section>
```

No usar un color semántico solo porque visualmente se parece a otro. Un error usa `danger`, una confirmación usa `success` y una ayuda usa `info`.

### Espaciado, radio y sombra

- Espaciado: escala `--spacing-spacing-gap-*` o utilidades Tailwind equivalentes a la escala existente.
- Radios: `--radius-1` a `--radius-4`, `--radius-none` y `--radius-full`.
- Bordes: `--stroke-0` a `--stroke-3`.
- Elevación: `--shadow-e1` a `--shadow-e3`.

Los valores particulares solo se permiten cuando representan una medida estructural que no corresponde a un token, y deben mantenerse cerca del componente que la necesita.

### Tipografía

Usar las clases de `src/styles/typography.css`, como `text-heading-*` y las escalas de texto disponibles. No recrear manualmente combinaciones de tamaño, peso, interlineado y espaciado que ya estén definidas.

La fuente de interfaz es Inter mediante `--font-sans`. Todo texto debe conservar una jerarquía clara: título, contenido, dato secundario y ayuda.

## Componentes base

Antes de desarrollar un equivalente, revisar especialmente:

- Acciones: `Button`, `ButtonGroupItem`, `Toggle`, `Checkbox`, `ActionMenu` (menú de acciones con encabezado opcional, divisores y tono `danger`, abierto desde un botón de icono).
- Formularios: `Input`, `TextArea`, `DropdownMenu`, `Label`, `HintText`, `Tag`.
- Navegación: `NavigationBar`, `SideNavigation`, `HorizontalTabMenu`, `TabItem`.
- Retroalimentación: `Alert`, `Notification`, `AuthToast`, `Tooltip`, `EmptyState`.
- Capas: `Modal` y los modales compartidos ya existentes.
- Identidad y contenido: `Avatar`, `AvatarGroup`, `Badge`, `Gallery`.
- Progreso: `ProgressBarLabel`, `ProgressStepBase`, `ProgressStepGroup`, `CircleProgressBarLabel` (tema `Accent` por defecto; `Success`, `Warning` y `Danger` para valoraciones como la compatibilidad de solicitudes).

### Botones

Usar `Button` y sus propiedades existentes:

- `theme`: `Primary`, `Danger` o `Info`.
- `type`: `Solid`, `Outline`, `Ghost` o `Link`, según lo admita el tema.
- `size`: `S`, `M` o `L`.
- `disabled` para bloquear la interacción real.
- `fitContent` cuando la etiqueta no deba ocupar el ancho predeterminado.
- `htmlType="submit"` dentro de formularios.

No simular un botón con un `div`. Las acciones solo con icono necesitan nombre accesible mediante `aria-label` y un `Tooltip` descriptivo visible tanto por hover como por foco. El tooltip debe usar portal, la capa flotante global y ajuste al viewport para sobreponerse sin quedar recortado; su incorporación no puede alterar la posición ni las dimensiones del botón.

Todo botón o control con `role="button"` que esté habilitado debe mostrar obligatoriamente `cursor: pointer`. Esta conducta se define de forma global y no debe eliminarse ni sobrescribirse con `cursor: default` o `cursor: auto`. Los controles deshabilitados deben usar `cursor: not-allowed` y declarar el estado mediante `disabled` o `aria-disabled="true"`.

Los botones cuyo único contenido visual sea una `X` para cerrar o quitar contenido conservan un `aria-label` descriptivo, pero no muestran `Tooltip`.

### Badges de estado

Usar `Badge` y sus temas semánticos para que un mismo estado conserve su identidad en todas las vistas:

- `Info`: proyecto en progreso.
- `Brand 2`: proyecto en revisión.
- `Neutral`: solicitud pendiente.
- `Success`: proyecto finalizado.
- `Archived`: proyecto archivado. Usa fondo sutil, texto y punto de la familia `warning`; su borde coincide con el fondo para mantener la misma estética limpia de los demás estados.

Los estados de solicitudes de proyecto obtienen su tema desde `getProjectRequestStatus(status).badgeTheme` (`src/utils/projectRequestStatus.js`); no se asignan temas locales en cada vista.

El tema `Archived` identifica contenido conservado pero fuera del flujo activo. No debe reutilizarse para advertencias, errores ni acciones destructivas.

### Formularios

- Cada control debe tener una etiqueta visible o un nombre accesible.
- Mostrar ayuda con `HintText` y errores junto al campo correspondiente.
- El `TextArea` compartido reproduce las variantes de Figma `Default`, `Hover`, `Focused`, `Filled`, `Disabled` y `Error`. En interacción normal, `Focused` y `Hover` prevalecen sobre `Filled`; `Disabled` y `Error` conservan prioridad semántica. El foco usa el anillo de cuatro píxeles formado con `--color-primary-10` sin modificar las dimensiones del campo, y oculta temporalmente el hint tal como define la variante enfocada de Figma.
- Conservar los datos escritos cuando una petición falle.
- La asignación de responsables muestra el `AlertToast` compartido con tema `Success` únicamente después de que la API confirme el alta. Si falla, mantiene el contenido del control, presenta el error junto al campo y muestra el mismo alert con tema `Danger`. Esta regla aplica a cualquier uso de `AssigneeMultiSelect`.
- Diferenciar claramente estados normal, hover, focus, disabled y error.
- No validar la misma regla de manera distinta en dos formularios; compartir esquema o utilidad cuando aplique.
- Deshabilitar o proteger el envío mientras exista una petición equivalente en curso.
- Los filtros de tablas que admiten más de un valor usan `DropdownMenu` con opciones `Checkbox` y selección múltiple. El menú muestra como máximo cuatro filas simultáneas y habilita desplazamiento vertical cuando existen más opciones.
- Todo `DropdownMenu` conserva una línea inferior visible en su trigger. Al abrirse, esa línea actúa como divisor y el panel comienza inmediatamente debajo, sin superponerla; trigger y panel comparten exactamente los mismos bordes laterales y ancho mediante el anclaje central del componente. La variante cerrada sin contenedor mantiene la línea inferior aunque oculte los demás bordes. No se permiten correcciones locales de posición o divisores que contradigan este patrón.
- El selector de país de `Input` con tipo `Phone number` utiliza todo el contenedor de bandera, prefijo y flecha como una zona interactiva. El signo `+` es fijo y no editable; únicamente los dígitos del prefijo funcionan como `combobox`: escribirlos filtra por código telefónico y una coincidencia exacta selecciona el país. Al pulsar `Enter`, selecciona la primera coincidencia visible, cierra el menú y evita enviar accidentalmente el formulario. Pulsar la bandera, el espacio del contenedor o la flecha abre las opciones; la flecha no utiliza tooltip en este contexto. El menú se une al borde inferior, alinea sus bordes y ancho exactamente con el selector, muestra como máximo cuatro países de `35px` y reutiliza el componente `ScrollBar`, ocultando el scrollbar nativo. Cada opción alinea bandera, prefijo y abreviatura compacta; el nombre completo se conserva como información accesible. Mantiene selección visible y cierre con `Escape`.

### Modales y capas

Usar `Modal` y sus configuraciones antes de crear overlays nuevos. Toda capa debe:

- tener título o nombre accesible;
- ofrecer una forma clara de cierre;
- cerrar y limpiar sus efectos correctamente;
- conservar la acción destructiva visualmente separada;
- evitar que una animación sea imprescindible para comprender el estado.

Los modales con `mount="viewport"` deben renderizarse mediante portal en `document.body`. No deben quedar anidados dentro de layouts, paneles o contenedores transformados, porque eso altera el sistema de referencia de `position: fixed`, desplaza el centrado y puede recortar el overlay. Solo `mount="contained"` permanece dentro del contenedor que lo invoca.

Cuando se añadan animaciones, respetar `prefers-reduced-motion`, como ya hace el progreso de proyectos.

## Estados obligatorios de una pantalla

### Cargas de datos

- Cada carga de contenido debe usar el componente compartido `Loader` con un preset que reproduzca la geometría del componente final; no se permiten skeletons genéricos sin relación con el contenido.
- Los controles que ya disponen de estado desactivado, como barras de búsqueda, filtros y botones, permanecen visibles y usan `disabled` mientras esperan datos. El `Loader` se reserva para el contenido sin representación propia durante la carga.
- La animación estándar es un shimmer amplio, tenue y lento (aproximadamente 2.2 s), basado en tokens de tema y compatible con `prefers-reduced-motion`; no debe producir destellos blancos ni cambios bruscos de opacidad.
- Loader, contenido, estado vacío y error son estados mutuamente excluyentes. Las listas usan `count` para aproximar la cantidad visible de elementos.
- Ninguna sección conectada a base de datos puede desaparecer ni sustituirse por texto improvisado cuando no existan registros o falle la consulta; debe conservar su contexto y usar `EmptyState` con una acción pertinente.
- Todo componente que dependa de datos o recursos debe definir un skeleton con sus dimensiones finales para evitar saltos de layout. Imágenes, portadas, miniaturas y reproductores usan presets de medios ajustados a su relación de aspecto.
- Una sección sin API puede mostrar un skeleton permanente únicamente si se documenta que todavía no existe una fuente real. En ese caso no se muestran datos de demostración ni scrollbar de contenido cargado.
- El flujo completo de autenticación queda excluido del skeleton global y conserva sus mensajes y estados de botón propios.
- Los visores interactivos 3D y VR conservan sus loaders especializados; las miniaturas estáticas 3D sí utilizan el preset correspondiente.
- Uploads con porcentaje real conservan su barra de progreso en lugar de superponer otro loader.

### Imágenes de proyectos

#### Optimización obligatoria de medios del home

- Toda imagen o video nuevo o reemplazado en el home debe convertirse y optimizarse antes de utilizarse. La regla incluye la introducción, servicios, proyectos destacados, fondos, galerías y posters.
- Convertir imágenes raster a WebP y ajustar la compresión para reducir su peso conservando la calidad visual. Mantener proporciones y transparencia; dimensionar según el tamaño de presentación y la densidad de pantalla necesaria. Conservar los SVG como vectores optimizados.
- Recodificar los videos para web con resolución, tasa de bits y compresión ajustadas a su presentación. Utilizar WebM y un MP4 compatible de respaldo cuando corresponda; preparar el MP4 para reproducción progresiva (`faststart`). Generar posters optimizados en WebP.
- Cambiar la extensión del archivo no constituye conversión. Un recurso ya convertido debe comprobarse y optimizarse si sigue siendo pesado; evitar recomprimir sucesivamente archivos con pérdida y utilizar el original como fuente cuando esté disponible.
- Actualizar imports, URLs, precargas y fuentes de reproductores para servir únicamente las versiones optimizadas. Los originales de edición no deben formar parte de las descargas del home.
- Registrar el tamaño antes y después y comprobar decodificación, calidad visual y, para videos, reproducción en los navegadores compatibles. Conservar duración, proporciones, audio funcional, accesibilidad, diseño responsive y todas las animaciones existentes.

#### Presentación de imágenes de proyectos

- Toda portada o miniatura de proyecto debe usar el componente compartido `ProjectImage`.
- Mientras una imagen carga, si no tiene URL o si la descarga falla, debe conservar el mismo espacio y mostrar el placeholder neutral con el icono de imagen centrado.
- No sustituir una imagen ausente por una portada de demostración. El contenido real reemplaza el placeholder únicamente después de cargar correctamente.
- Esta regla aplica a dashboards, solicitudes y tarjetas públicas de proyectos; no aplica a logos, avatares ni visores multimedia, que tienen estados especializados.

Toda vista que dependa de datos debe diseñar explícitamente:

- carga inicial;
- contenido disponible;
- colección vacía;
- error recuperable;
- permiso insuficiente, cuando corresponda;
- carga de una página adicional;
- fin de la paginación.

No reemplazar la pantalla completa por un texto improvisado. Reutilizar los componentes de estado y mantener el contexto para que el usuario pueda reintentar.

La colección de Solicitudes es un caso visual especial: cuando esté vacía debe usar `EmptyState` en tamaño `M`, con icono destacado, el título “Tu espacio de proyectos está listo”, la descripción “Aquí podrás visualizar y dar seguimiento a tus proyectos.” y la acción “Nueva oportunidad”.

- Los `Tooltip` interactivos se montan mediante portal por defecto, usan la capa flotante global y se ajustan a los bordes del viewport para no quedar recortados por contenedores, scroll, drawers o modales.

## Responsive

El enfoque es mobile-first. Los breakpoints de referencia existentes son:

- móvil: base, con referencia de 375 px;
- tablet: desde 768 px;
- web: desde 1280 px.

Los breakpoints viven en `src/utils/layoutBreakpoints.js`. Para elegir props de presentación que no aceptan clases responsive (tamaño de `Button`, `IconContainer`, `Tag` o la clase tipográfica) se usa `useMobileLayout`; el layout se resuelve con clases `max-[767px]:`/`min-[768px]:`. Las clases de `typography.css` no están en una capa de Tailwind y ganan a cualquier utilidad responsive (`max-[767px]:text-[24px]` no tiene efecto sobre `text-heading-3`), por lo que el cambio de escala tipográfica debe hacerse eligiendo la clase.

Una implementación debe comprobar como mínimo 375, 768, 1024 y 1440 px. Evitar anchos fijos para contenedores principales; usar límites máximos, rejillas y envoltura. Ninguna acción esencial debe depender de hover.

En pantallas pequeñas:

- priorizar una sola columna;
- permitir que acciones secundarias se apilen;
- evitar desplazamiento horizontal de la página;
- mantener objetivos táctiles suficientemente grandes;
- truncar texto solo cuando exista una forma de consultar el contenido completo.

## Modo oscuro

El modo oscuro se activa con la clase `.dark`. Los componentes deben consumir tokens semánticos para heredar los valores correctos. Evitar pares manuales `light/dark` cuando el token ya cambia con el tema.

Antes de entregar, comprobar contraste, bordes, overlays, estados disabled y feedback semántico en ambos temas.

## Accesibilidad

- Utilizar elementos HTML según su función: `button`, `a`, `label`, encabezados y listas.
- Mantener navegación completa con teclado y foco visible.
- Asociar mensajes de error y ayuda con el control correspondiente.
- Añadir texto alternativo útil a imágenes informativas; usar `alt=""` en imágenes decorativas.
- Marcar iconos decorativos con `aria-hidden="true"`.
- No comunicar un estado únicamente mediante color.
- No retirar el outline sin proporcionar un indicador de foco equivalente.
- Anunciar cambios asíncronos relevantes con el patrón accesible apropiado.

## Datos, paginación y tiempo real

### Presentación de fechas recientes

Cuando una fecha represente cuánto tiempo ha transcurrido desde una acción —por ejemplo, último acceso, última modificación o una actividad equivalente— y la interfaz requiera este estilo progresivo, debe reutilizar `src/utils/relativeTime.js` mediante `formatHumanDate`. No se deben recrear umbrales, pluralizaciones ni formatos locales dentro de páginas o componentes.

La presentación estándar es:

- Menos de un minuto: “Hace menos de un minuto”.
- De 1 a 59 minutos: “Hace 1 minuto” o “Hace N minutos”.
- De 1 a 23 horas: “Hace 1 hora” o “Hace N horas”.
- De 1 a 30 días: “Hace 1 día” o “Hace N días”.
- De 31 a 59 días: “Hace un mes”.
- Desde 60 días: fecha exacta localizada en español, como “19 jun”.
- Si la fecha pertenece a otro año, se incluye el año para evitar ambigüedad, como “17 feb 2025”.
- Los valores ausentes o inválidos usan un texto contextual, como “Sin acceso” o “Sin fecha”.

El formato relativo compacto destinado a espacios restringidos constituye una variante diferente y solo debe utilizarse cuando el diseño aprobado exija expresamente abreviaturas.

### Proyectos archivados

- Un proyecto archivado es de solo lectura hasta que un administrador lo desarchive.
- Se mantienen disponibles la consulta, navegación, búsqueda, filtros, galerías, visores y descargas autorizadas.
- Se desactivan todas las mutaciones del proyecto: edición, publicación, asignación o retiro de encargados, carga o eliminación de archivos y creación o respuesta de observaciones en cualquier visor.
- La interfaz debe comunicar el estado archivado y el backend debe rechazar igualmente cualquier mutación con `PROJECT_ARCHIVED`; no se puede depender solo de controles deshabilitados.
- Desarchivar es la única mutación permitida sobre un proyecto archivado. Los accesos de proyectos recientes no incluyen proyectos archivados.

### Proyectos finalizados

- Un proyecto finalizado conserva la consulta, navegación, filtros, galerías, visores, descargas, publicación y archivado.
- Se bloquean las mutaciones operativas: edición, progreso, etapas, asignación o retiro de responsables, carga o eliminación de archivos y creación o respuesta de observaciones.
- Los responsables y contenidos existentes se conservan como historial. Si se necesita acceso posterior, debe resolverse con un flujo administrativo específico y no alterando el equipo finalizado.
- El frontend debe comunicar el cierre y el backend debe rechazar las mutaciones operativas con `PROJECT_FINALIZED`.

### Solicitudes de proyecto

- El flujo usa los estados `draft`, `pending_verification`, `pending_review`, `changes_requested`, `rejected` y `converted`.
- El cliente solo edita borradores y solicitudes devueltas para corrección. Al reenviar una corrección, la solicitud vuelve a verificación administrativa.
- Asignar el primer arquitecto inicia la revisión técnica. Una solicitud en revisión debe conservar al menos un arquitecto asignado.
- Solamente administradores y arquitectos asignados consultan la cola técnica. El arquitecto registra una recomendación con motivo; el administrador conserva la decisión final.
- El drawer de solicitudes muestra la decisión de reunión persistida en `meetingRecommendation` de la revisión más reciente. `projectRequestMeetingRecommendation.js` centraliza etiquetas y temas: `SCHEDULE_MEETING` → “Agendar reunión” (`Info`, visto bueno), `DO_NOT_SCHEDULE_MEETING` → “No agendar reunión” (`Danger`, X). La decisión no se deriva de `recommendation` (workflow) ni de `note` (justificación); históricos sin reunión usan un fallback neutral.
- La baja compatibilidad del drawer sigue `getCompatibilityPresentation` y el nodo Figma `3727:677617`: círculo `Danger`. “Información completada” es una barra real (`completeness` de la API): `Success` solo al 100 % y `Warning` si falta alguna pregunta aplicable, sin umbrales intermedios. “Viabilidad financiera” muestra un estado textual, sin barra mientras `score` sea null: “Sin incoherencias financieras detectadas” (tono neutral + aclaración “No equivale a una aprobación financiera.”), “Requiere revisión financiera” (`--color-warning-100`), “Riesgo financiero elevado” (`--color-danger-100` + aclaración “No demuestra que el proyecto sea inviable.”), “Información financiera insuficiente” o “Pendiente de reglas de evaluación”. Debajo, los motivos en una lista accesible (`aria-label` “Motivos de la evaluación financiera”). Ningún estado usa `Success`. Ninguna de las dos se deriva del nivel de compatibilidad (`utils/projectRequestMetrics.js`). Conservar las animaciones, los tokens claro/oscuro y la geometría del drawer.
- El formulario técnico exige elegir explícitamente la reunión mediante un campo separado de las tres acciones de workflow. No preselecciona una reunión, conserva su borrador ante errores y bloquea controles durante el guardado. La decisión administrativa no muestra ni envía este campo.
- Aprobar, rechazar o solicitar correcciones exige al menos una revisión de un arquitecto que continúe asignado.
- Correcciones y rechazo son decisiones diferentes: `changes_requested` vuelve a habilitar la edición del cliente; `rejected` es final y permite iniciar una solicitud nueva reutilizando los datos.
- El rechazo conserva responsables, datos y archivos como historial y siempre muestra al cliente un motivo. Las notas internas nunca se exponen al cliente.
- La aprobación crea el proyecto y convierte la solicitud de forma atómica. La solicitud conserva `converted_project_id` para impedir conversiones duplicadas y permitir navegar al proyecto resultante.
- Toda transición se valida en backend, se registra en auditoría y genera una notificación al cliente cuando existe una decisión administrativa.

### Estados de usuarios administrativos

- La tabla de gestión de usuarios muestra un máximo de 10 usuarios reales por página. La API y el frontend aplican el mismo límite y la navegación continúa mediante cursor; cuando existen menos de 10 resultados no se crean filas vacías ni datos de demostración.
- El modal “Nuevo usuario” mantiene sus acciones en un footer separado por un borde superior. “Cancelar” usa `Button` primario `Outline` y “Crear usuario” usa `Button` primario `Solid`; ambos ocupan el mismo ancho con `16px` de separación en escritorio y se apilan a ancho completo en móvil. En staging, la creación persiste sin depender del correo. Después muestra el modal centrado “Usuario creado correctamente” con icono de seguridad y acciones “Cancelar” y “Aceptar”. El enlace de activación por correo pertenece a una etapa futura y, hasta implementarla, la interfaz no debe afirmar que fue enviado.
- El icono de vista de cada fila abre el drawer compartido de detalles del usuario. El panel consulta el registro seleccionado por identificador y muestra rol, fecha de creación, identidad, empresa, correo, teléfono, proyectos asociados y notas internas reales; nunca completa campos ausentes con datos de demostración. Debe conservar estados de carga, error recuperable y ausencia de datos, cerrarse con `Escape` o al seleccionar el overlay y adaptarse al ancho móvil. El encabezado y el footer de acción permanecen visibles; únicamente el contenido central se desplaza, de modo que la acción “Editar” siempre quede accesible. En su jerarquía tipográfica, el título usa `--color-text-50`, las etiquetas usan `--color-text-300`, los valores usan `--color-text-200` y el texto auxiliar del área de notas usa `--color-text-100`, de acuerdo con Figma.
- Las notas del drawer son privadas por administrador: solo su autor puede consultarlas, modificarlas o eliminarlas y esta restricción debe aplicarse también en backend. El `TextArea` permanece visible como compositor y utiliza la acción compartida con flecha; `Enter` guarda y `Shift+Enter` crea una nueva línea. La vista inicial muestra como máximo las dos notas más recientes en una lista compacta. Cada fila agrupa las acciones de editar y eliminar; eliminar requiere confirmación. Cuando existen más, “Mostrar más (N)” abre una lista paginada con altura limitada y scrollbar. Las operaciones correctas actualizan la interfaz sin mostrar alerts; los alerts compartidos se reservan para errores.
- En el cuerpo de la tabla de gestión de usuarios, el rol se presenta con `Badge` en tema `Brand 1`, variación `Simple` y tamaño `S`; la celda conserva `24px` de padding horizontal y `16px` vertical según el componente de Figma.
- La celda de nombre de cada usuario debe mostrar su foto de perfil real mediante la URL autenticada del recurso cuando `hasProfilePhoto` sea verdadero. Las iniciales o el icono correspondiente al rol se utilizan únicamente como fallback si no existe una foto o si su carga falla; nunca deben sustituir preventivamente una imagen disponible.
- Un usuario `active` puede suspenderse temporalmente (`blocked`) o deshabilitarse de forma indefinida (`inactive`).
- Un usuario suspendido muestra las acciones “Reactivar” y “Deshabilitar”; un usuario deshabilitado muestra únicamente “Habilitar”.
- Las acciones individuales “Habilitar” y “Deshabilitar” utilizan el mismo icono de bloqueo para conservar su relación visual; “Reactivar” mantiene el icono de usuario habilitado por corresponder a una suspensión temporal.
- Reactivar o habilitar devuelve la cuenta a `active`. Suspender o deshabilitar impide el acceso y excluye al usuario de nuevas asignaciones, sin eliminar su historial ni sus asignaciones existentes.
- Toda transición requiere un modal de confirmación. Los alerts de éxito o error solo se muestran después de confirmar y recibir el resultado de la API.
- El frontend adapta las acciones al estado actual y el backend valida la transición; nunca se depende únicamente del texto o la disponibilidad visual del menú.
- Al seleccionar uno o más usuarios, el footer muestra las acciones masivas centradas entre el contador y la paginación. Sin selección, ese grupo de acciones no se renderiza.
- “Suspender” actúa únicamente sobre usuarios activos; “Deshabilitar” actúa sobre usuarios activos o suspendidos; “Activar” actúa únicamente sobre usuarios suspendidos o deshabilitados. Una cuenta que ya se encuentra en el estado solicitado no genera una petición redundante.
- La cuenta del administrador autenticado se excluye de cualquier cambio masivo. Cada botón permanece deshabilitado cuando la selección no contiene al menos un usuario elegible para esa transición.
- Las acciones masivas reutilizan el modal de advertencia antes de ejecutarse, bloquean envíos equivalentes mientras están en curso y muestran el alert compartido de éxito, error o resultado parcial. Los usuarios actualizados se deseleccionan; los que fallen permanecen seleccionados para permitir un reintento.

### Navegación superior persistente

- Ninguna animación existente se elimina ni desactiva sin una petición explícita del usuario para ese efecto. Los cambios de layout, spacing o scroll deben conservar las demás animaciones. El navbar responde tanto a desplazamientos nativos como a gestos consumidos por el selector; sigue funcionando cuando crece el contenido. Solo el foco de teclado mantiene el navbar visible durante la navegación, no el foco residual de un clic. Se conserva el soporte existente de movimiento reducido.

- En Servicios y Proyectos destacados, el padding superior de sección usa `--spacing-gap-9` (64 px) para reservar el navbar. Servicios adapta sus separaciones a la altura disponible mediante `ServicesSection.css`: compacta el padding vertical del encabezado, elimina el padding vertical duplicado del selector y ajusta sus gaps y el tamaño proporcional de la imagen. Conserva tipografía, padding horizontal y efectos de aparición. La sección tiene una altura mínima de un viewport, pero permite crecer y hacer scroll en ventanas demasiado pequeñas sin recortar contenido. El encabezado de Proyectos conserva `--spacing-gap-8`; en móvil ambos encabezados conservan 16 px horizontales. Los gaps internos de 24 px entre textos permanecen independientes del padding de sección.

- Servicios y el encabezado de Proyectos destacados forman un flujo de scroll continuo sin saltos por sección. Todos los encabezados de sección, excepto el video, deben conservar el mismo revelado de Arquitectura, Construcción e Interiorismo: una máscara abre de arriba hacia abajo sobre texto fijo, con la transición compartida de `sectionReveal.js` (spring de 0.9 s, rebote 0.12 y espera de 0.1 s al aparecer). Servicios, cada proyecto destacado y Procesos revelan su título automáticamente al entrar; una vez revelado, permanece abierto mientras cualquier parte de su sección o panel intersecte el viewport y solo se reinicia cuando ese ámbito sale completamente. Este reveal no constituye una fase de navegación ni bloquea wheel, teclado o touch. Estas secciones reutilizan `SectionTitleReveal`; no usan desplazamientos por línea, stagger ni scrub. Movimiento reducido muestra el contenido inmediatamente. Se conservan el gradiente animado del título y la geometría. Únicamente el segundo contenedor de Servicios aparece desde el montaje sin revelado: su recorrido interno por rueda y touch permanece activo, manteniendo la posición mientras cambian categoría, imagen e indicador. El recorrido captura rueda únicamente dentro del layout de lista e imagen, incluidos los gestos continuos, y mantiene el indicador lateral y el cambio de imagen. Fuera de ese contenedor el scroll queda libre. Al llegar a la última opción y finalizar su transición, el siguiente gesto descendente libera el scroll, incluso si se llegó mediante clic o teclado; no obliga a visitar opciones omitidas. Subir desde la primera categoría permite volver hacia el video. Clic y teclado siguen disponibles, y la selección se conserva al desplazarse entre secciones.
- Las galerías de imágenes de Proyectos destacados conservan sus seis imágenes, composición bento, geometría y máscara de aparición compartida. Las imágenes son contenido no interactivo y no abren modal por clic. Al llegar al final de cada panel, la card grande de la columna central se expande mediante progreso scrubbed controlado por wheel, trackpad, touch o teclado; las demás cards salen progresivamente y la protagonista termina sin margen en `100vw × 100dvh`. El proyecto permanece activo durante todo el scrub y solo habilita la transición compartida al siguiente panel después de alcanzar fullscreen. Al regresar, el proyecto anterior entra en fullscreen y el gesto ascendente contrae la imagen hasta coincidir exactamente con su card antes de devolver el scroll nativo. La geometría se mide desde el DOM y se recalcula en resize/orientation change; movimiento reducido omite el scrub sin bloquear la navegación. La interacción de videos de Procesos conserva su click, modal, reproducción y transición independientes. El navbar actualiza la sección activa por la posición real del contenido y mantiene la navegación directa.
- La introducción y el video conservan sus pasos y bloqueos originales. Al subir y cruzar el inicio de Servicios se activa la transición completa al video, sin esperar a recorrerlo mediante scroll normal. Durante esa transición se bloquean nuevos gestos y después se restablece el efecto interno del video; movimiento reducido realiza el cambio inmediatamente. Redimensionar la ventana no activa este regreso. Ctrl+rueda conserva el zoom y el foco de teclado mantiene visible el navbar. La ruta `/servicios` sigue redirigiendo a `/#services`.

- Los estados del menú público siguen Figma `4925:10028` (fondo oscuro) y `4925:9786` (fondo claro): normal sin subrayado; hover con texto gris (`text-200` del contexto oscuro o `primary-400` para fondo claro) y subrayado de 2 px en el color base; seleccionado con texto y subrayado en el color base. La selección prevalece sobre hover. El color base es blanco sobre oscuro y `primary-300` sobre claro. Estos colores dependen del fondo detectado, dentro del contexto oscuro que conserva el header; el foco de teclado mantiene su indicador visible.

- El header público adapta el logo y los enlaces a la luminancia del fondo bajo su posición, según las variantes de Figma `4922:8080`. `useHeaderBackground` centraliza el muestreo de colores e imágenes locales con recorte `object-cover` centrado, con histéresis para evitar parpadeos. Hover, selección y foco conservan el contraste. El botón de contacto mantiene su variante original. Los degradados negros declaran sus tres opacidades en `data-navbar-scrim`; las superficies complejas con máscaras SVG pueden declarar `data-navbar-background="dark"` o `"light"`. Los medios no legibles por CORS conservan la variante anterior. El muestreo no realiza peticiones ni persiste píxeles, omite pestañas ocultas y libera sus recursos al desmontarse.




- Los títulos de Arquitectura, Construcción e Interiorismo comparten el anclaje del nodo Figma `4848:6515`: bloque de 385 px centrado verticalmente en cada sección, máscara a 65 px de su borde superior y texto a 89,5 px dentro de la máscara. El revelado amplía la máscara de 57 a 255 px sin desplazar el título. No limitar la posición vertical con un `clamp` en píxeles: debe seguir el centro de la sección al cambiar la altura de ventana.

- El navbar público muestra únicamente «Contáctanos» como acción derecha, según el nodo Figma `4781:135050`. Reutiliza `Button` Primary/Solid/S con ancho al contenido, padding de 8 px, radio de 8 px y tipografía `text-heading-8`; su altura se ajusta al contenido sin borde. Sustituye los accesos a registro e inicio de sesión. El destino de contacto permanece pendiente y se comunica mediante `aria-disabled` hasta conectarlo.



- El navbar comienza a reaparecer con el primer gesto ascendente de rueda, trackpad, pantalla táctil o teclado, incluso si una animación consume el gesto sin cambiar `scrollTop`. Una transición descendente en curso no debe ocultarlo de nuevo mientras la última intención del usuario siga siendo subir. Esta detección pertenece al hook compartido `useScrollDirectionVisibility`.


- Todas las pantallas del entorno autenticado deben renderizar `EnvironmentNavigationBar`; las páginas no pueden importar directamente `ui/NavigationBar/NavigationBar.jsx` ni recrear el navbar con JSX o estilos locales.
- `EnvironmentNavigationBar` es la única fuente de verdad para la variante, fecha, ancho máximo, espaciado responsive, botón de notificaciones y visibilidad del menú móvil. Una página solo puede proporcionar los callbacks funcionales y el estado activo de sus acciones; no puede sobrescribir `variant`, `utilityText`, `showUtilityMenu` ni `className`.
- La campana debe abrir el panel compartido `EnvironmentNotificationsDrawer` y permanecer funcional en cualquier pantalla donde aparezca el navbar. No se permiten implementaciones particulares del panel por página.
- Cualquier cambio visual o funcional del navbar que deba afectar al entorno se implementa una sola vez en `EnvironmentNavigationBar` y debe conservar el mismo resultado para cliente, arquitecto y administrador.
- Todo navbar, tanto público como autenticado, debe ocultarse suavemente al desplazarse hacia abajo y reaparecer al desplazarse hacia arriba. El comportamiento se implementa mediante `useScrollDirectionVisibility`, debe detectar el contenedor desplazable más cercano y no puede duplicarse ni desactivarse localmente; únicamente se omite el movimiento cuando el usuario solicita movimiento reducido.

### Navegación lateral persistente

- Los destinos disponibles en `SideNavigation` se definen de forma centralizada por rol y deben conservarse en todas las pantallas del entorno autenticado del usuario.
- Una página no puede ocultar, omitir ni reconstruir parcialmente botones autorizados como Panel, Solicitudes, Ver más proyectos o Configuraciones.
- Los accesos exclusivos de un rol solo se muestran a usuarios autorizados. Por ejemplo, Solicitudes pertenece al entorno del cliente y debe aparecer en todas sus vistas, pero no enlazarse desde roles sin acceso a esa ruta.
- Los accesos dinámicos a proyectos pueden variar según los proyectos disponibles, sin alterar los destinos persistentes del rol.
- La navegación responsive se compone con `ResponsiveSideNavigation` y `useMobileNavigationDrawer` (Figma `3727:678728` cerrado y `3727:544029` abierto). Desde 768 px se muestra el riel persistente expandible; en móvil, el riel se oculta y el botón “Abrir menú” de `EnvironmentNavigationBar` abre un drawer modal de 312 px (`min(312px, 100vw - 32px)`) sobre `SideOverlayDrawer`, con la variante `drawer` de `SideNavigation`: logo centrado, sin botón de expansión y botón principal de 52 px con `--radius-3`.
- El drawer se cierra con el overlay, `Escape`, el botón de cierre accesible por teclado, al navegar o al alcanzar 768 px. Mantiene el foco dentro del panel, lo devuelve al botón de menú y bloquea el scroll del body mientras está abierto. Su apertura es independiente de la expansión del riel: abrir o cerrar el drawer nunca cambia el estado de tablet o escritorio. Ninguna página debe recrear este patrón con estados o drawers locales; todas las páginas autenticadas pasan `onMenuClick={mobileNavigation.open}` y `mobileMenuExpanded={mobileNavigation.isOpen}` al navbar.
- En móvil, `EnvironmentNavigationBar` aplica la barra de Figma `3727:678728`: 68 px de alto, 16 px laterales, botones de 44 px, fecha en Headings/h8 con día y mes capitalizados (`utils/environmentDate.js`) y línea inferior interna.

### Dashboard administrativo móvil

El dashboard administrativo sigue Figma `3727:678728` por debajo de 768 px; tablet y escritorio conservan su presentación. `pages/admin-dashboard/utils/adminDashboardMobilePresentation.js` centraliza los tamaños móviles de botones (44 px de icono, 41 px de texto) y tags (Body/b3, 25 px).

- Título en Headings/h4 y acciones “Exportar reporte”/“Ver historial” a todo el ancho con igual tamaño.
- Métricas en dos columnas (16 px horizontal, 24 px vertical), etiqueta Body/b2, valor h4 e icono de 40 px. “Archivos registrados” se oculta en móvil, como en Figma.
- Eventos críticos: la etiqueta y la acción pasan a la segunda línea, con la acción a la derecha. Actividad reciente y Nuevas Solicitudes reproducen la estructura que se envuelve en Figma.
- Fechas de entrega con `utils/projectDeliveryDate.js` (“24 Mar 2026”), formateadas en UTC porque `end_date` es `@db.Date`.
- Proyectos activos: filtros en una fila (180 px y resto). “Quitar filtros”, que Figma deja fuera del ancho, pasa a la fila siguiente para seguir siendo accesible. Los nombres largos de la tabla se truncan dentro de su columna.

- En las filas de proyectos del dashboard, el avatar junto al nombre del proyecto debe representar al arquitecto asignado mediante su foto real o sus iniciales como fallback y mostrar su nombre en un `Tooltip` al hacer hover o recibir foco. Esta regla es local a esas filas: no se debe activar el tooltip globalmente en `AvatarGroup`, comentarios, navegación ni carruseles.


- Todo componente conectado a datos dinámicos (por ejemplo, comentarios, avatares, notificaciones o actividad) debe conservar y renderizar los campos relacionados en todas sus transformaciones, variantes y puntos de uso. Una actualización debe propagarse tanto para clientes como para arquitectos, administradores y cualquier rol existente, en desarrollo, pruebas y producción; no se permiten datos de demostración ni valores visuales fijos cuando exista una fuente real conectada.
- Las conversaciones del proyecto se denominan **Observaciones**. Sus tipos visibles son “Observación general”, “Observación sobre imagen”, “Observación sobre video” y “Observación en panorámica 360”. Los valores internos de API son `general`, `image`, `video`, `panorama` y `document`.
- El compositor “Observación general” del panel global crea una observación del entorno y no exige un proyecto específico. La conversación solo es visible para el autor y para clientes o arquitectos que compartan al menos un proyecto con el autor raíz. Las respuestas heredan la audiencia de la conversación raíz. Las observaciones de proyecto conservan el proyecto original y sus permisos; ambos orígenes se combinan únicamente para su presentación en el panel.
- Toda observación temporal de video debe conservar el instante en una selección `video-time`, mostrar “Observación sobre video” y su tiempo en el cuadro de referencia, y permitir navegación bidireccional entre la marca de la barra y la observación del panel. Las observaciones de video sin referencia temporal se mantienen como observaciones generales asociadas al recurso.
- Las tarjetas y visores de video deben usar como portada un fotograma extraído del propio archivo y reutilizarlo durante la sesión. Solo un campo explícito `poster` puede reemplazar esa captura; queda prohibido reutilizar como portada una imagen general del proyecto. Si la extracción no está permitida o falla, se conserva el fallback visual del componente.
- Las tarjetas de modelos 3D deben mostrar una vista estática generada desde el propio archivo, con cámara e iluminación predeterminadas y sin controles interactivos. Una portada proporcionada tiene prioridad y, si el modelo no puede cargarse o capturarse, se conserva el fallback “Modelo 3D”.
- Las tarjetas muestran avatar, nombre del autor, fecha y contenido. En el panel de observaciones generales no se renderiza el nombre del proyecto. El tipo no se repite como texto secundario bajo el autor: se utiliza como título de la previsualización asociada. Los números de referencia solo aparecen dentro del marcador visual. El rol y el proyecto pueden conservarse en el modelo para permisos, navegación o lógica, pero no deben renderizarse en la tarjeta para evitar truncamiento y ruido visual.
- Cliente y arquitecto solo pueden visualizar observaciones cuando comparten el mismo proyecto: el cliente pertenece al proyecto y el arquitecto está asignado a él. Que un proyecto sea público no concede acceso a sus observaciones. El administrador no visualiza, crea ni responde observaciones desde el panel global en ninguna vista del entorno.
- `EnvironmentNotificationsDrawer` aplica la política por rol de forma centralizada: para administradores siempre renderiza únicamente “Actividad Reciente”, ignora cualquier propiedad de comentarios recibida y no inicia cargas de observaciones. Ninguna página debe depender de pasar manualmente `activityOnly` para cumplir esta restricción.
- Todo panel agregado de observaciones disponible para clientes o arquitectos debe obtener IDs numéricos desde los proyectos autorizados y mantenerse actualizado mediante SSE o refresco periódico. El proyecto de origen se conserva en los datos, pero no se muestra en el panel de observaciones generales. Se prohíben IDs, slugs y observaciones de demostración cuando exista una fuente real.
- Reutilizar las utilidades de paginación del frontend para combinar páginas y eliminar duplicados.
- Reiniciar cursores al cambiar usuario, proyecto o filtros.
- Impedir peticiones duplicadas durante una carga.
- Combinar eventos SSE por identificador estable; no insertar el mismo elemento dos veces.
- “Cargar más” debe indicar carga, bloquear envíos repetidos y desaparecer cuando no exista `nextCursor`.
- No ocultar errores de páginas posteriores si el contenido previo todavía puede mostrarse.

## Organización de estilos

- Usar Tailwind para composición local.
- Usar `clsx` para estados y variantes condicionales.
- Mantener configuraciones extensas de variantes junto al componente, siguiendo `Button/buttonConfig.js` e `Input/inputConfig.js`.
- Añadir a `global.css` únicamente tokens o reglas verdaderamente globales.
- Evitar `style` inline salvo valores dinámicos que no se expresen razonablemente con clases.
- No usar `!important` para resolver conflictos ordinarios.

## Proceso para añadir una variante

1. Confirmar que el cambio pertenece a un componente existente.
2. Nombrar la variante según intención: `Danger`, `compact`, `loading`; no según un color concreto.
3. Mantener los valores por defecto compatibles con las pantallas actuales.
4. Cubrir estados interactivos, responsive, modo oscuro y accesibilidad.
5. Añadir una prueba cuando la variante cambie comportamiento, no solo apariencia.
6. Actualizar este documento si se introduce una nueva regla general.

## Checklist de revisión visual

- [ ] Los archivos nuevos respetan el orden estructural de `src` y la dirección de dependencias.
- [ ] Se buscaron componentes equivalentes antes de crear uno nuevo.
- [ ] Se reutilizan tokens de color, tipografía, espacio, radio y sombra.
- [ ] No hay colores o estilos duplicados sin justificación.
- [ ] Existen estados de carga, vacío, error y éxito cuando aplican.
- [ ] La interfaz funciona a 375, 768, 1024 y 1440 px.
- [ ] La interfaz funciona en tema claro y oscuro.
- [ ] Teclado, foco, etiquetas y nombres accesibles funcionan.
- [ ] Las acciones durante peticiones evitan dobles envíos.
- [ ] La paginación no duplica elementos y reinicia su cursor correctamente.
- [ ] Los cambios reutilizables están en `src/components/ui`, no copiados en páginas.
- [ ] `pnpm build` finaliza correctamente.

### Movimiento de Proyectos destacados

- La expansión de cada galería bento utiliza una timeline pausada de GSAP Flip, inspirada en el demo oficial `Scrubbed Bento Gallery`. Las cards secundarias salen físicamente del viewport y la card central ocupa progresivamente `100vw × 100dvh`, sin overlay de oscurecimiento ni fade como movimiento principal. La timeline se conduce exclusivamente con el progreso compartido de wheel, trackpad, touch o teclado; no crea un `ScrollTrigger` ni un pin adicional. La apertura y el cierre recorren el mismo estado FLIP en sentidos opuestos, y la geometría se reconstruye con `gsap.context().revert()` al cambiar el viewport.
- Mientras el progreso esté entre cero y uno, el controlador fija `scrollTop` en el borde final del panel: el gesto solo modifica la timeline y no desplaza verticalmente la sección. La transición al proyecto siguiente, anterior o Procesos se habilita únicamente después de fullscreen completo; al retroceder, primero se recompone el bento hasta progreso cero.

## Criterio de entrega

Una pantalla no está terminada solo porque coincide visualmente con una maqueta. También debe ser reutilizable, responsive, accesible, compatible con ambos temas y representar correctamente todos sus estados de datos.
