# Footer responsive de Gestión de Usuarios

Referencia: [Figma 4270:675497](https://www.figma.com/design/Vy3rWOkJ1WIiDLcPoHbHuQ/ARCA-WEBSITE?node-id=4270-675497). Alcance corregido por el usuario: exclusivamente el footer y el orden de sus controles.

## Causa y adaptación

El grupo de acciones usaba `order-last` y `basis-full`, por lo que aparecía después de la paginación en móvil. Además, la paginación envuelta se alineaba a la derecha y el grid se activaba a 900 px de viewport sin considerar el espacio ocupado por el sidebar.

El footer conserva el orden DOM contador → acciones → paginación. Se envuelve con flex según el ancho disponible, sin estado responsive en JavaScript. Hasta 767 px disponibles, las acciones muestran únicamente iconos; desde 768 px muestran sus etiquetas y desde 900 px las acciones se centran mediante el grid existente. La paginación envuelta comienza a la izquierda, como en Figma.

Se reutilizan `Button` M y `Tooltip` con portal: área de 44 px, icono de 20 px, nombre accesible, tooltip por hover/foco y estados deshabilitados existentes. `Tooltip` se compone explícitamente porque el texto de `Button` se oculta mediante CSS y su tooltip automático solo se activa con `showText=false`.

No se modificaron columnas, filas, buscador, filtros, selección, permisos, mutaciones, contratos HTTP, animaciones ni otras tablas. La deuda de truncamiento de `AvatarLabel` permanece registrada en la validación anterior y fuera de esta intervención.

## Comparación visual

Con diez usuarios seleccionados, a 375 y 430 px el contador y las acciones comparten la primera fila; Anterior/Siguiente aparecen debajo a la izquierda. A 320 px, el contador y los tres botones de 44 px necesitan filas separadas para conservar sus dimensiones y el orden. La variante proporcionada de Figma mide 375 px; esta envoltura adicional adapta el mismo patrón al viewport menor.

![Footer de usuarios a 375 px, tema claro](screenshots/users-footer/375-light.png)

![Footer de usuarios a 375 px, tema oscuro](screenshots/users-footer/375-dark.png)

Se conserva la altura de 44 px de `Button` M del sistema de diseño. La paginación de Figma mide 41 px; el cambio solicitado corresponde al orden responsive y no introduce una variante de tamaño nueva.

## Regresión y verificaciones

`Frontend/tests/browser/adminResponsiveLayout.test.js` verifica 320, 375, 430, 768, 1024, 1280 y 1440 px en ambos temas, con el sidebar expandido/contraído desde tablet y sin/con selección. Comprueba orden, colisiones del contador y botones, límites del footer, ausencia de desborde del shell, dimensiones de iconos y conservación de las proporciones originales de columnas. Verifica también restricciones de acciones ante estados mixtos, tooltip por teclado, apertura/cancelación de confirmación y paginación por cursor.

Para regenerar capturas y medidas de los 22 escenarios de tema/ancho/sidebar, desde `Frontend`:

```powershell
$env:ARCA_FOOTER_CAPTURE_DIR = Join-Path $env:TEMP 'arca-users-footer-validation'
node --test tests/browser/adminResponsiveLayout.test.js
```

Las interacciones conservan 5000 ms y la carga inicial utiliza la política compartida de navegación de 30000 ms. No se incrementaron los timeouts de las demás pruebas.

Resultados de cierre:

| Comprobación | Resultado |
| --- | --- |
| `Frontend/pnpm lint` | Correcto |
| `Backend/pnpm verify` | Correcto: lint de documentación, validación Prisma, 239 tests backend aprobados y cuatro integraciones PostgreSQL omitidas; 282 tests frontend aprobados; build correcto |
| Regresiones administrativas, incluido footer (`adminResponsiveLayout.test.js`) | 12/12 aprobadas dentro de ambas ejecuciones completas; 44 combinaciones de geometría con/sin selección y 22 capturas |
| Primera suite completa de navegador | 235/237 aprobadas; dos fallos en `projectRequestWorkflow.test.js` (368.4 s) |
| Repetición independiente de `projectRequestWorkflow.test.js`, sin cambios | 39/39 aprobadas (113.7 s) |
| Segunda suite completa de navegador, sin lint/build en paralelo | 236/237 aprobadas; un fallo distinto en el mismo archivo (331.3 s) |
| `git diff --check` | Correcto |

La suite completa **no queda completamente verde**. En la primera ejecución fallaron “Architect: recomendación, pending, cierre bloqueado y refresco de la cola” y “Admin: payload changes_requested y notificación de invalidación tras confirmación”: el conteo de lecturas esperaba 2 y obtuvo 1. En la segunda falló “Cola: error, reintento y respuesta anterior descartada al cambiar de rol”: `reads[0]` aún no existía al llamar `fulfill` (`projectRequestWorkflow.test.js:263`). `openPage` espera el harness, pero con `holdQueue=true` no espera la captura HTTP antes de devolver `reads`. Estas pruebas no fueron modificadas, pasan aisladas y presentan una intermitencia de sincronización del fixture. Se registra para una intervención independiente; no se aumentaron sus timeouts ni se modificó el flujo de solicitudes.

Logs locales reproducibles de esta revisión, en `$env:TEMP`: `arca-users-footer-lint.log`, `arca-users-footer-verify.log`, `arca-users-footer-full-browser.log`, `arca-users-footer-workflow-recheck.log` y `arca-users-footer-full-browser-final.log`. Las capturas y medidas completas están en `$env:TEMP/arca-users-footer-validation`.

Las cuatro omisiones PostgreSQL corresponden a:

| Prueba | Motivo de omisión |
| --- | --- |
| `adminRequestClient.integration.test.js`: “PostgreSQL y HTTP: cola identifica al solicitante y detalles devuelve identidad y errores específicos” | `ARCA_REQUEST_CLIENT_DB_TESTS` no está habilitada con `1` |
| `projectRequestMeetingRecommendation.integration.test.js`: “PostgreSQL: persiste reunión, conserva históricos, omisiones y permisos con el repositorio real” | `ARCA_WORKFLOW_DB_TESTS` no está habilitada con `1` |
| `projectRequestStand.integration.test.js`: “PostgreSQL real: creación, edición vigente e histórica y cola conservan tipos y requisitos” | `ARCA_STAND_REPOSITORY_DB_TESTS` no está habilitada con `1` |
| `projectRequestStand.integration.test.js`: “PostgreSQL: migración aditiva, históricos NULL y restricción de aplicabilidad” | No se configuró `ARCA_STAND_TEST_DATABASE_URL` para una base local exclusiva |

Estas integraciones validan persistencia, migraciones y contratos de solicitudes; ninguna es necesaria para el orden responsive del footer, que conserva los contratos existentes y se verifica con respuestas HTTP aisladas.

No se realizaron commits ni push.
