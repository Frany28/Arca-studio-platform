# Input: responsabilidades y contratos conservados

La API pública continúa en `Input.jsx`. El valor está controlado cuando
`value !== undefined`; `defaultValue` solo inicializa el valor interno.

| Módulo | Responsabilidad |
| --- | --- |
| `Input.jsx` | Valor común, foco/hover, estado visual, input nativo, label/hints, password y badge de pago. |
| `InputIcons.jsx` | SVG originales y resolución de adornos predeterminados. |
| `phone/phoneUtils.js` | Dígitos, prefijo y máscara, sin DOM ni efectos. |
| `phone/usePhoneInput.js` | País/prefijo, menú, filtro, formato, listeners y métricas del scroll. |
| `phone/PhoneCountrySelector.jsx` | DOM, estilos y accesibilidad del selector de país. |
| `tags/tagUtils.js` | Normalización, creación e identidad inicial de tags. |
| `tags/useInputTags.js` | Selección, sugerencias, deduplicación, teclado y coordinación de foco/scroll. |
| `tags/InputTagGroup.jsx` | Tags, avatares y sugerencias inline o en overlay. |
| `options/inputOptionsConfig.js` | Filas de 35 px, tres filas visibles y clases de estado (seleccionada, hover, foco) compartidas por los listados del Input. |
| `options/useInputOptionsScroll.js` | Métricas del ScrollBar sincronizadas con el scroll nativo oculto del listado. |
| `options/InputOptionsPanel.jsx` | Carcasa del listado unido al campo (borde, radio, padding, viewport y ScrollBar) usada por teléfono y prefijo. |
| `prefix/prefixSelectPosition.js` | Altura, posición y búsqueda por letras del listado de prefijos, sin DOM. |
| `prefix/usePrefixSelect.js` | Apertura, opción activa, teclado de listbox y cierre del selector de prefijo. |
| `prefix/InputPrefixSelect.jsx` | DOM, estilos y accesibilidad del selector de prefijo y su listado en portal. |

## Variante "Tags" con prefijo

Con `prefixOptions` no vacío, la variante `Tags` antepone el mismo selector de "Prefix select"
(`prefixValue`, `onPrefixChange`, `prefixAriaLabel`) y muestra las etiquetas seleccionadas
dentro del campo, junto al texto. Sin `prefixOptions` conserva su presentación anterior. La usa
el formulario de servicios: unidad base en el prefijo y la denominación como Tag, con
`onTagsChange` controlado para aceptar solo opciones existentes.

Con `prefixReadOnly`, el prefijo solo presenta `prefixSelectedOption` (mismo aspecto, con su
flecha) sin listado ni rol propio: es decorativo (`aria-hidden`) y un clic en él enfoca el campo.
Sirve a combobox que eligen prefijo y etiqueta en una única lista, como «Unidad de medida»
(símbolo de la base + categoría); el consumidor expone la selección de forma accesible. Sin
opción elegida no se dibuja el segmento.

`prefixSelectedOption` permite mostrar una selección guardada que ya no está entre las opciones,
como una unidad histórica inactiva. Solo presenta la opción cuyo id coincide con `prefixValue`;
no la añade al listado ni a la navegación por teclado. Sin otras opciones el prefijo queda
bloqueado. Se conserva la variante anterior cuando no se proporciona esta prop.

## Variante "Prefix select"

Texto libre precedido por un selector (Figma `5790:360030`, “Nueva unidad de medida”):
`prefixOptions` (`{ id, label, description? }`), `prefixValue` controlado, `onPrefixChange`,
`prefixAriaLabel` y `prefixDisabled` (bloquea solo el prefijo, por ejemplo cuando la unidad
base no es editable). Comparte con el teléfono la estructura selector + campo nativo y el
borde separador, sin su lógica de país.

- El listado es flotante: vive en un portal con `position: fixed` y `z-[var(--z-tooltip)]`, por
  encima del modal, así que no se recorta y puede cubrir temporalmente el contenido posterior
  (incluidas las acciones) sin desplazarlo ni cambiar la altura del contenedor. Solo lo acota el
  viewport: se abre debajo del segmento si cabe y, si no, encima, y el área de opciones se limita
  al espacio visible de ese lado (al menos una fila) para que todas sigan alcanzables con su
  scroll. Se recalcula con resize y con el scroll de los contenedores. Al cerrarlo (selección,
  Escape o clic exterior) el contenido que cubría vuelve a recibir la interacción.
- El scroll del listado es del usuario: la opción activa solo se revela (ajustando el área del
  listado, sin `scrollIntoView`) cuando cambia por apertura o teclado, y el listener de scroll
  que recoloca el panel ignora el scroll del propio listado. Recolocar o revelar en cada scroll
  devolvía el listado a la opción activa y bloqueaba el arrastre del ScrollBar y la rueda. El
  hover solo cambia la opción activa con movimiento real del puntero, no cuando el contenido
  se desplaza bajo un puntero quieto.
- El disparador es un `combobox` con `aria-activedescendant`: el foco permanece en él, así
  que el ciclo de Tab de `useDialogKeyboard` no se rompe. Flechas, Home/End, Enter/Espacio,
  búsqueda por letras, Tab y Escape; Escape no se propaga al diálogo contenedor.
- El listado comparte con el selector telefónico `InputOptionsPanel`, `getInputOptionClassName`
  y `useInputOptionsScroll`: mismas filas de 35 px, tres visibles (113 px), tipografía Body/b4,
  fondo, bordes y radios y estados (seleccionada y hover en
  `neutral-200`, foco de teclado con anillo `primary-10`). Como el foco permanece en el
  disparador, la opción activa por teclado dibuja ese anillo; el puntero solo aplica hover.
- Diferencia deliberada con el teléfono: como el listado solo muestra abreviaturas (≈60 px de
  ancho), no muestra ScrollBar (`hideScrollbar` de `InputOptionsPanel`). El área conserva
  `overflow-y: auto` con la barra nativa oculta, así que rueda, touchpad y gestos táctiles la
  desplazan, y al navegar con teclado `usePrefixSelect` ajusta el área para revelar la opción
  activa. Sin ScrollBar no se reserva espacio lateral: las filas ocupan todo el ancho interior
  del panel. El teléfono conserva su ScrollBar estándar (16 px de track, thumb de 8 px).
- Se ancla al segmento del prefijo con la misma relación que el teléfono
  (`INPUT_OPTIONS_ANCHOR_OFFSET`): unido a su borde inferior, 1 px a su izquierda, con el
  divisor compartido `getInputOptionsAnchorDividerClassName` y al menos el ancho del segmento
  + 1 px. Las opciones muestran solo `label` (la abreviatura); `description` (el nombre
  completo) se expone en el nombre accesible de cada opción y del disparador, sin mostrarse.
  El ancho se ajusta a la abreviatura más larga, limitado al viewport; nunca ocupa el campo de
  texto completo. Se monta en portal con `position: fixed` porque los
  modales recortan su contenido, y si no cabe debajo se une al borde superior del segmento.

## Contratos sensibles

- `showDisabledTags` (false por defecto) conserva las etiquetas seleccionadas de un
  Input Tags deshabilitado para su lectura. No habilita texto, sugerencias, eliminación
  ni callbacks. AssigneeMultiSelect reenvía la opción; Gestión de proyectos la activa
  en su variante informativa. Los demás consumidores conservan la presentación anterior.
- El selector telefónico muestra como máximo tres opciones de 35 px con gaps de
  4 px (113 px de área desplazable). El viewport y `ScrollBar` comparten la altura
  calculada; con menos resultados el menú se ajusta a su contenido.
- El teléfono modifica `event.target.value` antes de llamar a `onChange`.
  Solo reformatea el estado interno cuando el valor no está controlado.
- Seleccionar un país actualiza país/prefijo, llama a `onPhoneCountryChange`,
  reformatea el valor interno si corresponde y cierra el menú, en ese orden.
  Escribir una coincidencia exacta de prefijo conserva el menú abierto.
- `onTagsChange` determina el control de la selección de tags, independientemente
  del control del texto. Sin ese callback, `tags` solo inicializa la selección.
- Enter/coma consumen el evento cuando hay texto. Backspace lo consume cuando
  no hay texto y hay tags. `onKeyDown` se ejecuta después y solo sin preventDefault.
- La deduplicación al crear compara ID o etiqueta normalizada; la búsqueda
  conserva espacios interiores, ignora acentos y convierte a minúsculas.
- `onTagOptionSelect` intercepta exclusivamente el clic en sugerencias:
  no cambia selección ni limpia consulta. Enter/coma mantienen su flujo propio.
- La eliminación notifica antes de restaurar el foco mediante requestAnimationFrame.
  Solo conserva el último frame pendiente y lo cancela al desmontar o salir de Tags.
  El scroll horizontal vuelve al inicio al cambiar la identidad de la selección.
- El botón de password alterna visibilidad antes de su callback y conserva foco,
  valor, nombre accesible y el indicador de requisitos original.

## Correcciones de contrato verificadas

- Todas las ramas del campo nativo, incluido el número telefónico, comparten
  `onKeyDown`: la lógica de tags va primero y el callback público se ejecuta solo
  si el evento no fue prevenido. El callback puede prevenir el envío del formulario.
  El prefijo es un control auxiliar con teclado propio; Enter selecciona país
  sin enviar el formulario ni invocar el teclado público del número.
- `disabled || state === "Disabled"` es el bloqueo efectivo de todas las variantes:
  campo, adornos, prefijo, países, scrollbar personalizado, tags, eventos y estilos. No existe un modo
  Disabled visual con interacción activa. Deshabilitar cancela también el foco de tags pendiente.
- `required` expresa obligatoriedad en el label y en el campo nativo (no en el
  buscador de prefijos). Los formularios con validación personalizada conservan
  `noValidate`; `preventDefault` por sí solo no evita la validación previa del navegador.
  Buscadores y selectores opcionales deben proporcionar `required={false}`.
- `information` se consume y descarta por compatibilidad. No controla el label:
  esa responsabilidad pertenece a `showLabelInfo`. Los atributos HTML, data-* y
  aria-* del consumidor siguen llegando al campo nativo.
- Los frames de foco de tags, medición telefónica y reinicio de scroll se cancelan
  cuando dejan de ser aplicables. Una eliminación cuyo callback desmonta Input
  no programa foco sobre otro control que reutilice su ref.

## País y prefijo: decisión de compatibilidad

La ausencia de sincronización posterior se conserva deliberadamente. Estas props
son valores iniciales en el contrato actual, no valores controlados. Añadir un
efecto que las reaplique cambiaría la API semántica y podría sobrescribir la
selección del usuario. `onPhoneCountryChange` es una notificación: guardar sus
datos en el padre no cambia ese contrato.

| Prop | Clasificación | Comportamiento |
| --- | --- | --- |
| `countryCode` | Valor inicial | Inicializa el país; prevalece sobre el fallback por prefijo. |
| `countryPrefix` | Valor inicial | Inicializa el texto del prefijo y sirve de fallback de país. |
| `phoneOptions` | Configuración del catálogo | Define opciones, máscaras y placeholders; no controla la selección. |
| `value` | Valor controlado del número | Se actualiza desde el padre cuando es distinto de undefined. |
| `defaultValue` | Valor inicial del número | Solo inicializa el estado interno, sin formateo automático. |

Los consumidores actuales de país/prefijo son:

- `CreateAccount`: constantes VE/+58 como selección inicial; el usuario puede cambiarlas.
- `ProfilePanel`: constantes US/+1 en campos deshabilitados.
- `CreateAdminUserModal` / `EditAdminUserModal`: país/prefijo del usuario al montar;
  después reflejan las notificaciones en el borrador para construir el payload.
  No realizan una sustitución independiente del país durante esa edición.
- Los demás inputs telefónicos y el catálogo visual usan los valores iniciales por defecto.

Para reemplazar esos valores iniciales hay que montar otra instancia (por ejemplo,
con una nueva key). No se renombraron props ni se añadió un modo controlado de país.
Una futura necesidad de selección controlada requiere definir ese contrato por
separado, incluyendo prioridad entre país y prefijo. Los cambios de props actuales
no reformatean el número ni disparan onChange/onPhoneCountryChange artificialmente.

Las pruebas de comportamiento están en `tests/browser/input.test.js`; los
helpers puros se verifican en `tests/inputDomainUtils.test.js`. Las pruebas
estructurales previas siguen verificando layout y consumidores en sus módulos
correspondientes.

## Validación del menú de tres opciones

Se verificaron 320, 375, 430, 768, 1024, 1280 y 1440 px en claro y oscuro: tres
filas completas sin una cuarta fila parcial, catálogo completo, rueda y arrastre
internos, ausencia de overflow horizontal, banderas de 20 px, Tab hacia una opción
fuera del área inicial, Enter para seleccionarla y Escape para cerrar. También se
comprobaron cero/uno/tres resultados, callbacks, valores controlados/no controlados
y los teléfonos deshabilitados de Perfil. El fixture de Input bloquea las imágenes
externas y comprueba el fallback existente de las banderas; su componente no cambia.

Resultados: lint correcto; `Backend/pnpm verify` correcto (239 tests backend,
282 tests frontend y build); las suites completas de Input y formularios aprueban
34/34 pruebas. Las cuatro integraciones PostgreSQL opcionales se omiten por no
habilitar `ARCA_REQUEST_CLIENT_DB_TESTS`, `ARCA_WORKFLOW_DB_TESTS`,
`ARCA_STAND_REPOSITORY_DB_TESTS` ni configurar `ARCA_STAND_TEST_DATABASE_URL`.
No son necesarias para la geometría de este selector.

Desde `Frontend`, la regresión se reproduce con:

```powershell
node --test tests/browser/input.test.js tests/browser/formResponsiveLayout.test.js
```

Logs locales en `$env:TEMP`: `arca-phone-dropdown-lint.log`,
`arca-phone-dropdown-verify.log` y `arca-phone-dropdown-related-browser.log`.
Las capturas claro/oscuro se regeneran definiendo `ARCA_PHONE_CAPTURE_DIR` antes
de ejecutar la suite de Input; las de esta revisión están en
`$env:TEMP/arca-phone-dropdown-validation`.
