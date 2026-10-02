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

## Contratos sensibles

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
