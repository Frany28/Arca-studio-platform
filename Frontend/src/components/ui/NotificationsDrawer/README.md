# Envío de observaciones y respuestas

`MessageInput` recibe `onSubmit(message)`, con texto recortado y no vacío. El callback
puede devolver un valor síncrono, `undefined`, una Promise o un thenable. Terminar
normalmente significa éxito; lanzar o rechazar significa error. No se interpretan
valores como `false` como fallos: el consumidor debe propagar los errores de envío.

Cada instancia conserva su borrador y administra su propio pending. Una referencia
bloquea inmediatamente eventos duplicados, incluso antes del siguiente render.
Mientras espera, mantiene el texto y deshabilita el campo y la acción de enviar para
no perder nuevas ediciones al confirmar. En éxito limpia el borrador; en error lo
conserva, muestra el mensaje con `HintText` y permite reintentar. Al desmontarse
descarta actualizaciones visuales tardías; la petición pertenece al consumidor y
no se cancela, porque podría haber creado ya el comentario.

`NotificationsDrawer` conserva los payloads públicos y la selección de callbacks:
las respuestas usan su scope y el compositor general prioriza el entorno. Cada
apertura de respuesta tiene un `sessionId` nuevo, incluso para el mismo comentario.
Solo un envío exitoso de la sesión todavía activa puede cerrarla. Una solicitud
anterior no puede cerrar otra respuesta ni una reapertura del mismo comentario.

Los hooks de observaciones reservan `loading` para lecturas. `readError` contiene
errores de carga y alimenta `commentsError`; `error` sigue disponible como error
combinado de lectura/envío. Los errores de creación se conservan en el hook y se
propagan al compositor, sin sustituir la lista ni desmontar el borrador. Los
destinos ausentes y los proyectos de solo lectura también rechazan el envío.

Las pruebas de navegador cubren callbacks síncronos/asíncronos, errores, reintentos,
eventos duplicados, sesiones posteriores, cierre/desmontaje y pending independiente.
También montan `EnvironmentNotificationsDrawer` y los hooks reales con una API
simulada para detectar pérdidas de borrador causadas por carga o errores globales.

Quedan fuera de esta tarea los botones anidados, labels, estilos de foco, focus trap,
eventos pointer/touch y cambios de foco automático al responder.
