# Diagnóstico SSE y tiempo real — ARCA Studio

Fecha: 2026-11-05 · Entorno medido: staging (Netlify `arca-studio-platform.netlify.app` → Vercel `sistema-web-arca-studio.vercel.app`) con la cuenta demo pública, solo lecturas, una conexión por escenario. No se modificó código productivo, Supabase ni S3.

## 1. Resumen ejecutivo

- **El SSE no aporta tiempo real en el despliegue actual.** Hay tres causas independientes y verificadas:
  1. El proxy de Netlify retiene toda la respuesta y la corta a los ~26 s. Cabeceras, primer evento y cierre llegan juntos.
  2. Vercel termina la función a los 30 s (`maxDuration: 30`).
  3. El bus de eventos vive en la memoria de cada instancia, así que un comentario creado en otra instancia nunca llega por SSE.
- **El código SSE del backend es correcto.** En local y contra Vercel directo transmite en menos de 2 s, envía heartbeat a los 25 s y libera las conexiones sin fugas.
- **Los comentarios ya llegan solo por el sondeo incremental.** El SSE añade coste sin beneficio: por cada pestaña abierta mantiene una función ocupada casi de forma continua (~2 invocaciones de 26–30 s por minuto). Además fuerza una lectura extra de comentarios en cada ciclo, también con la pestaña oculta.
- **Recomendación (alternativa C):** en el despliegue serverless, usar el sondeo incremental existente como transporte principal y desactivar el SSE mediante configuración.
  - Se conserva el código SSE para un futuro backend de larga duración.
  - Se corrigen la lectura extra por ciclo y la resincronización al recuperar la red.
  - La seguridad no cambia: misma cookie, mismo endpoint y misma autorización.

## 2. Arquitectura SSE actual

| Capa | Pieza | Comportamiento |
|---|---|---|
| Frontend | `api/projectsApi.js` `subscribeToEvents` | `EventSource` a `/api/projects/:id/events` con `withCredentials`. Expone `onOpen`, `onError({ closed })` y `project.comment.created`. |
| Frontend | `api/projectCommentFeed.js` | Una entrada por proyecto compartida por todos los hooks: una carga, una conexión SSE (máximo 3 proyectos con SSE) y sondeo incremental con `syncCursor`. Sondeo a 5 s (drawer abierto) o 15 s; con el SSE abierto pasa a 30 s. Se pausa con la pestaña oculta y aplica *backoff* con fallos. Si el servidor cierra la conexión, la reabre a los 60 s. |
| Frontend | `useProjectDetailsComments`, `hooks/useProjectComments`, `useImageCommentNotifications` | Se suscriben al feed. No crean conexiones propias. Al desmontarse, por ejemplo al cerrar sesión, el feed cierra la conexión pasados 2 s. |
| Proxy | `netlify.toml` | `/api/*` → Vercel (`status = 200`, `force = true`). Es un *rewrite* proxy de Netlify. |
| Backend | `routes/projects.js` | `GET /:projectId/events` con `requireAuth` y el controlador `streamProjectCommentEvents`. |
| Backend | `controllers/projectCommentController.js` | Valida el id, autoriza con `canAccessProjectComments` y comprueba la capacidad (429 con `Retry-After: 30`). Envía las cabeceras `text/event-stream`, `no-cache, no-transform`, `keep-alive` y `X-Accel-Buffering: no`, y llama a `flushHeaders()`. |
| Backend | `services/projectEvents.js` | Mapas en memoria del proceso. Límites: 5 conexiones por usuario y 100 por proyecto. Envía `project.connected` al conectar y un heartbeat cada 25 s. `unsubscribe` es idempotente. Los payloads pasan por `sanitizePublicPayload`. |
| Backend | `vercel.json` | Una función `api/index.js` con `maxDuration: 30`. |

Ningún middleware intercepta `res.write`: `sanitizePublicResponse` solo envuelve `res.json`, y no hay compresión.

## 3. Causa raíz

| # | Causa | Estado | Evidencia |
|---|---|---|---|
| 1 | El proxy de Netlify retiene la respuesta SSE y la corta a los ~26 s | **Confirmada** | Escenario A: cabeceras, `project.connected` y cierre llegan juntos a los 25,8 s y 27,2 s. El heartbeat de los 25 s nunca llega. Contra Vercel directo, el mismo endpoint transmite en 0,3–1,6 s. |
| 2 | Vercel cierra la función a los 30 s | **Confirmada** | Escenario B: cierres a 31,6 s y 30,4 s, coherentes con `maxDuration: 30`. |
| 3 | El bus en memoria no cruza instancias | **Confirmada por diseño** | `projectEvents.js` usa `Map` del proceso. Está documentado en `Backend/ARCHITECTURE.md` (problema pendiente 2). |
| 4 | El código del backend retiene la respuesta | **Descartada** | Escenario C: cabeceras a 52 ms, evento publicado en menos de 1 ms y heartbeat a los 25 s. |

Pendiente de confirmar con la documentación del plan contratado: los límites exactos del proxy de Netlify y los valores máximos de `maxDuration` en Vercel (dependen del plan y de *Fluid compute*). Las cifras anteriores son las observadas.

## 4. Resultados de pruebas

Los scripts de medición quedaron fuera del repositorio. Cada uno abre una sola conexión, usa solo lecturas y no crea comentarios.

**A · Netlify → Vercel y B · Vercel directo** (misma sesión demo, 75 s, reconexión a 3 s como `EventSource`):

| Métrica | A · Netlify | B · Vercel directo |
|---|---|---|
| Tiempo hasta las cabeceras | 25 758 ms / 27 164 ms | 1 634 ms (frío) / 318 ms / 469 ms |
| Tiempo hasta el primer evento (`project.connected`) | Igual que las cabeceras | +8 ms después de las cabeceras |
| Heartbeat | No llega | A los 25,0–25,3 s |
| Duración de la conexión | 25,8–27,2 s | 30,4–31,6 s |
| Conexiones por minuto | ~2 | ~2 |

**C · Express local** con el servicio real `projectEvents` y las cabeceras del controlador, sin base de datos:

- cabeceras y `project.connected` a 52–53 ms;
- `project.comment.created` publicado a los 2 057 ms y recibido a los 2 057 ms;
- heartbeat a los 25 057 ms;
- tras 7 conexiones abiertas y cortadas por el cliente se admite una nueva, con un límite de 5 por usuario: **no hay fugas**.

**Navegador** (aplicación de staging, detalle del proyecto 1):

| Situación | Conexiones `/events` | Lecturas de comentarios | Observación |
|---|---|---|---|
| Pestaña visible, 120 s | 4 | 8 | El SSE se reabre cada ~30 s; las lecturas son una cada ~15 s. |
| Pestaña oculta, 90 s | 3 | 3 | El SSE sigue abierto con la pestaña oculta. Cada ciclo `onopen` → `onerror` provoca una lectura, aunque el sondeo está en pausa. |
| 15 s sin red y recuperación | Se reabre a los 34 ms | 0 en los 20 s siguientes | El `onopen` real llega a los ~26 s (por el proxy) y el *backoff* del sondeo alarga la resincronización. |

**Latencia efectiva actual de un comentario nuevo:**
- creado en la misma instancia: llega cuando el proxy libera la respuesta, a los 26 s como máximo;
- creado en otra instancia: solo llega por el sondeo, en 5 o 15 s según el estado del drawer.

En la práctica, la latencia la determina el sondeo.

**Coste por pestaña abierta:**
- SSE: ~52–60 s de duración de función por minuto, porque hay casi siempre una invocación abierta;
- sondeo: ~4 lecturas por minuto de 0,3–0,5 s cada una, es decir, ~1–2 s por minuto.

## 5. Riesgos de la implementación existente

1. **Coste:** cada pestaña ocupa una función de forma casi continua, también si está oculta. El coste crece de forma lineal con las pestañas abiertas.
2. **Lecturas extra:** cada ciclo del SSE en Netlify dispara `onopen` y enseguida `onerror` con `wasOpen = true`. Eso provoca una lectura incremental extra, incluso con la pestaña oculta.
3. **Resincronización lenta tras perder la red:** depende del `onopen` retenido o del sondeo con *backoff*. No hay un oyente del evento `online`.
4. **Falsa sensación de tiempo real:** el estado `open` del SSE espacia el sondeo a 30 s durante el breve intervalo en que se considera abierto, aunque no lleguen eventos.
5. **Sesión revocada:** la autorización se comprueba solo al conectar. Hoy el riesgo está acotado porque las conexiones duran como máximo ~30 s; con un backend de larga duración habría que revalidar la sesión periódicamente.
6. **Límites por instancia:** los límites de 5 por usuario y 100 por proyecto se cuentan en cada instancia, no en el total del sistema.

## 6. Comparación de alternativas

| | A · Corregir SSE vía proxy | B · SSE directo a Vercel | C · Sondeo incremental optimizado | D · Tiempo real administrado |
|---|---|---|---|---|
| **Viabilidad hoy** | No: el proxy de Netlify no transmite el stream. Un proxy con Edge Functions seguiría chocando con el límite de 30 s y con el bus en memoria. | No sin cambios de dominio: la cookie `__Host-arca_session` (`SameSite=Lax`) pertenece al host de Netlify y `vercel.app` es otro sitio. | **Sí**: el mecanismo ya existe y funciona. | Sí, con una nueva dependencia y un nuevo servicio. |
| **Ventajas** | Sin cambios en el cliente. | El stream real funciona (0,3–1,6 s). | Sin infraestructura nueva. Misma autenticación y autorización. Coste mínimo y estable entre instancias. | Push real entre instancias, con latencia inferior a 1 s. |
| **Limitaciones** | Límite de duración, bus por instancia y buffering. | Requiere una cookie de terceros (`SameSite=None`, bloqueada por Safari y cada vez más por Chrome) o un token en la URL. Mantiene el límite de 30 s y el bus por instancia. | Latencia acotada por el intervalo: 5 s con el drawer abierto, 15 s cerrado. | Hay que puentear la autenticación con tokens de canal firmados por el backend y añadir una librería cliente. |
| **Riesgos** | Coste creciente si se amplía `maxDuration`. | Exposición de tokens en los logs, CORS con credenciales y CSRF. | Más lecturas si se reducen los intervalos. Se mitiga con la pausa en pestañas ocultas, que ya existe. | Fuga de datos si la autorización del canal es incorrecta, y dependencia de un proveedor. |
| **Complejidad** | Alta: proxy, plan de Vercel y pub/sub compartido. | Alta: dominio, cookies y pub/sub. | **Baja**: configuración y ajustes en `projectCommentFeed`. | Media o alta. |
| **Factores de coste** | Duración de función por pestaña abierta. | Lo mismo que A. | Número de lecturas cortas (~4 por minuto y pestaña). | Mensajes, conexiones simultáneas y plan del proveedor. |
| **Compatibilidad** | Total, pero sin efecto. | Requiere cambiar cookies y CORS. | **Total**. | Requiere un servicio nuevo, lo que está restringido por `AGENTS.md`. |

Hay una variante a largo plazo, no aplicable hoy: un dominio propio compartido (`app.` y `api.` del mismo sitio) más un backend de proceso persistente y un pub/sub compartido, por ejemplo `LISTEN/NOTIFY` de PostgreSQL con una conexión en modo sesión. Con eso el SSE sería viable sin cookies de terceros. Implica un cambio de infraestructura que requiere autorización.

## 7. Solución recomendada

**Alternativa C en staging y en el despliegue serverless actual, conservando el código SSE desactivado por configuración.**

1. **Transporte configurable en el frontend:** `VITE_REALTIME_TRANSPORT` con los valores `poll` (por defecto en Netlify/Vercel) o `sse`.
   - Con `poll`, el feed no abre `EventSource` y usa los intervalos pedidos: 5 s con el drawer abierto y 15 s cerrado.
   - Se mantienen la pausa con la pestaña oculta y la lectura inmediata al volver a mostrarla.
2. **Resincronización al recuperar la red:** lectura incremental inmediata y reinicio del *backoff* al recibir el evento `online`.
3. **Sin lecturas por ciclo con `sse`:** la lectura de recuperación tras un error solo se hace si la conexión estuvo abierta durante un tiempo mínimo (por ejemplo, más que el heartbeat) o si recibió eventos.
4. **Opcional, para clientes antiguos ya desplegados:** `SSE_ENABLED=false` en el backend devuelve `204 No Content` en `/events`. Según la especificación, `EventSource` no reconecta tras un 204, así que los clientes ya cargados dejan de mantener funciones ocupadas.

Con esto se cumplen los objetivos:
- sin reconexiones;
- comentarios sincronizados con el cursor existente;
- una sola fuente compartida por proyecto, sin multiplicar conexiones por componente;
- autenticación por cookie segura sin cambios;
- tolerancia a cortes de red;
- coste de unos 1–2 s de función por minuto y pestaña, frente a 52–60 s con el SSE actual.

## 8. Archivos afectados (implementación futura)

| Archivo | Cambio |
|---|---|
| `Frontend/src/api/projectCommentFeed.js` | Opción de transporte, oyente `online` y supresión de la lectura por ciclo. |
| `Frontend/src/config/realtime.js` (nuevo) | Lectura y validación de `VITE_REALTIME_TRANSPORT`. |
| `Frontend/tests/projectCommentFeed.test.js` | Casos para `poll`, `online` y ciclos cortos de SSE. |
| `Backend/src/controllers/projectCommentController.js` | Opcional: `SSE_ENABLED=false` → 204. |
| `Backend/tests/` | Prueba del 204 y de que no se abre suscripción. |
| `Backend/ARCHITECTURE.md` | Actualizar el problema pendiente 2 con este diagnóstico y la decisión. |

No hay que modificar `netlify.toml`, `vercel.json`, cookies, CORS, Supabase ni S3.

## 9. Plan mínimo de implementación

1. Añadir `config/realtime.js` y la opción `transport` en `createProjectCommentFeed`. Con `poll`, `wantsRealtime` devuelve `false` y `pollInterval` no aplica `healthyPollMs`.
2. Añadir el oyente `online` en `browserEnvironment`: lectura incremental y `failures = 0`.
3. Con `sse`, condicionar la lectura de recuperación en `onError` a una conexión útil.
4. Configurar `VITE_REALTIME_TRANSPORT=poll` en Netlify. Por defecto también `poll`, para no depender de la variable.
5. Opcional en el backend: `SSE_ENABLED=false` → 204, desplegado después del frontend.
6. Medir de nuevo con los mismos scripts y actualizar `ARCHITECTURE.md`.

## 10. Pruebas de aceptación

- Con `poll` no se abre ninguna conexión `/events`.
- **Pestaña visible:** como mucho ~4 lecturas por minuto con el drawer cerrado y ~12 con el drawer abierto, todas incrementales salvo la primera.
- **Pestaña oculta:** 0 lecturas.
- **Al volver a mostrar la pestaña:** una lectura incremental inmediata.
- **Tras 15 s sin red:** una lectura incremental en menos de 1 s desde el evento `online`.
- **Comentario nuevo de otro usuario:** visible en 15 s como máximo (5 s con el drawer abierto). El comentario propio aparece al instante, como hoy con `projectCommentFeed.add`.
- **Paginación e historial:** completos y sin duplicados, con la deduplicación por id existente.
- **Cambio de proyecto y cierre de sesión:** no quedan temporizadores ni lecturas del proyecto anterior.
- **Con `sse` en local:** las pruebas actuales de SSE y del feed siguen pasando, y no hay lecturas extra en ciclos cortos.
- **Con `SSE_ENABLED=false`:** `/events` responde 204 y `EventSource` no reconecta.
- `pnpm verify` (o `pnpm test` y el build del frontend si no hay base de pruebas).

## 11. Riesgos y estrategia de reversión

| Riesgo | Mitigación |
|---|---|
| Latencia percibida de hasta 15 s con el drawer cerrado | Bajar a 10 s si hace falta. Se puede medir con el coste de lecturas por minuto. |
| Más lecturas con muchas pestañas visibles | Pausa con la pestaña oculta (ya existe). Las lecturas incrementales son pequeñas. |
| Clientes antiguos con SSE | El 204 opcional del backend los detiene sin cambiar el contrato de éxito. |
| Necesidad futura de push real | Mantener el código SSE y evaluar la variante de dominio propio con pub/sub o la alternativa D. |

**Reversión:** `VITE_REALTIME_TRANSPORT=sse` y un nuevo despliegue del frontend (y `SSE_ENABLED=true` si se activó el 204) restauran el comportamiento actual sin migraciones ni cambios de datos.

## Pruebas pendientes

- **Límites exactos del plan:** confirmar en la documentación del plan contratado de Netlify (proxy) y de Vercel (`maxDuration` y *Fluid compute*).
- **Entrega entre instancias en Vercel:** requiere crear comentarios reales. El procedimiento seguro es usar un proyecto de prueba de la cuenta demo en staging, abrir dos sesiones, crear un comentario desde una y comprobar si llega por SSE o por el sondeo a la otra.
- **Medición posterior a la implementación:** repetir los escenarios A, B, C y el del navegador con `poll`.
