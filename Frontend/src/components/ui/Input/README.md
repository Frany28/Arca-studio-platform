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
  El scroll horizontal vuelve al inicio al cambiar la identidad de la selección.
- El botón de password alterna visibilidad antes de su callback y conserva foco,
  valor, nombre accesible y el indicador de requisitos original.

## Deuda funcional deliberadamente pendiente

Este refactor no modifica los siguientes comportamientos:

- La rama del número telefónico no conecta el `onKeyDown` público.
- `state="Disabled"` aplica estado visual; solo `disabled` bloquea interacción.
- `required` se usa en el label y no como atributo del input nativo.
- `information` no se consume en Input y se propaga al DOM mediante `...props`.
- `countryCode` y `countryPrefix` no sincronizan cambios posteriores de props.
- El frame que restaura foco al eliminar tags sigue sin cancelarse. Los frames
  de medición telefónica y reinicio de scroll sí conservan su limpieza existente.

Las pruebas de comportamiento están en `tests/browser/input.test.js`; los
helpers puros se verifican en `tests/inputDomainUtils.test.js`. Las pruebas
estructurales previas siguen verificando layout y consumidores en sus módulos
correspondientes.
