# Entorno aislado de pruebas de carga — ARCA Studio (Fase 3)

Entorno reproducible para medir capacidad, concurrencia y estabilidad del backend sin tocar ningún servicio real. Las pruebas intensivas (escenarios A–H) **solo se ejecutan con autorización** (`LOADTEST_AUTHORIZED=1`).

## Qué contiene

| Pieza | Archivo | Función |
|---|---|---|
| Orquestación | `docker-compose.yml` | PostgreSQL 18 y MinIO desechables (tmpfs), backend real, k6 y herramientas Node en una red **interna sin salida a internet**. |
| Imagen | `Dockerfile`, `Dockerfile.dockerignore` | Backend y herramientas; nunca copia `.env`. |
| Aislamiento | `isolation.mjs` | Se detiene si algo apunta a infraestructura real (ver abajo). |
| Arranque | `server.mjs` | `src/app.js` sin `dotenv`, con métricas y registro de arranque y salida (detecta caídas). |
| Datos | `seed.mjs` | Migraciones completas y datos ficticios con semilla fija. |
| Integridad | `integrity-check.mjs` | Duplicados, archivos sin versión, objetos huérfanos, filas sin objeto, transacciones y bloqueos. |
| Resultados | `collect-results.mjs` | Informe por escenario, endpoint, tipo de operación y fase, con los criterios de aceptación. |
| Ejecución | `run-scenario.sh` | Comprobación previa, línea base, k6, SSE, integridad y consolidación. |
| Cargas k6 | `../mixed-workload.js`, `../file-workload.js`, `../comments-workload.js` | Uso por rol, transferencias, comentarios. |
| Node | `../sse-probe.mjs`, `../auth-smoke.mjs` | Tiempo real; comprobación de cookies, Origin, roles y aislamiento. |

## Aislamiento

Garantías del entorno Docker:

- Red `internal: true`: ningún contenedor puede alcanzar Supabase, Resend, Geoapify ni dominios públicos. El backend lo verifica al arrancar resolviendo esos nombres por DNS (sin conectarse); si se resuelven, no arranca.
- Base y almacenamiento en memoria: desaparecen al detener el entorno. No hay copias de datos reales.
- Credenciales ficticias definidas en `docker-compose.yml`. `Backend/.env` nunca se usa ni se copia a la imagen.
- Las claves de Resend y Geoapify están vacías. Esas rutas (registro, recuperación de contraseña, direcciones) no forman parte de los escenarios. Simularlos exigiría cambiar URL fijas del código de negocio, y la red interna ya impide cualquier llamada real.

`isolation.mjs` rechaza, antes de sembrar, arrancar o comprobar:

- Bases que no sean locales (`localhost` o el servicio `postgres`) o cuyo nombre no empiece por `arca_loadtest`. Esto incluye la base local de desarrollo.
- Almacenamiento que no sea MinIO local, o buckets que no se llamen `arca-loadtest*`.
- Claves de Resend o Geoapify, `SUPABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY` definidas.
- Variables de conexión que apunten a dominios reales.
- La ausencia de `ARCA_LOADTEST=1` o de un `AUTH_TOKEN_SECRET` ficticio (con «loadtest»).

Los scripts de k6 y Node rechazan además destinos que no sean locales (`BASE_URL`) y cuentas que no sean `@loadtest.invalid`. Eso excluye las credenciales de demostración compartidas.

## Preparación (Docker)

Requisitos: Docker Engine 24+ con Compose v2 y BuildKit. Desde `Backend/`:

```bash
docker compose -f load-tests/env/docker-compose.yml build
docker compose -f load-tests/env/docker-compose.yml up -d postgres minio
docker compose -f load-tests/env/docker-compose.yml run --rm seed      # recrea la base y siembra
docker compose -f load-tests/env/docker-compose.yml up -d --wait backend
load-tests/env/run-scenario.sh smoke                                     # 2 usuarios, 1 minuto
```

Para volver al estado inicial entre escenarios, repetir el `run --rm seed`. Para borrarlo todo: `docker compose -f load-tests/env/docker-compose.yml down -v`.

## Preparación sin Docker (comprobaciones locales)

Para validar scripts y datos sin Docker hace falta un PostgreSQL local desechable y, para descargas, un MinIO local. Las variables son las mismas que en `docker-compose.yml`, con `localhost`:

```bash
export ARCA_LOADTEST=1 NODE_ENV=test DATABASE_URL=postgres://postgres@localhost:54329/arca_loadtest \
  AUTH_TOKEN_SECRET=loadtest-secret-ficticio-0123456789abcdef CSRF_ALLOW_NO_ORIGIN=false CORS_ORIGINS=http://localhost:5173 \
  SUPABASE_STORAGE_S3_ENDPOINT=http://localhost:9000 SUPABASE_STORAGE_S3_ACCESS_KEY_ID=loadtest-access \
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=loadtest-secret-ficticio SUPABASE_STORAGE_BUCKET=arca-loadtest-files
node load-tests/env/seed.mjs --reset [--skip-objects]
REQUEST_METRICS_ENABLED=true LOADTEST_METRICS_FILE=load-tests/results/backend-metrics.jsonl PORT=3000 node load-tests/env/server.mjs
BASE_URL=http://127.0.0.1:3000 node load-tests/auth-smoke.mjs        # SMOKE_SKIP_DOWNLOADS=1 sin MinIO
```

En este modo no hay red interna: el aislamiento depende de las comprobaciones de `isolation.mjs`. Las mediciones de capacidad deben hacerse en Docker, con recursos fijos.

## Datos ficticios (`seed.mjs`)

Generados con una semilla fija, así que dos ejecuciones producen los mismos datos:

| Dato | Volumen | Detalle |
|---|---|---|
| Usuarios | 120 | 5 administradores, 25 arquitectos, 90 clientes, todos `@loadtest.invalid`. |
| Proyectos | 360 | 60 % en curso, 15 % pendientes, 15 % finalizados (la mitad públicos), 5 % archivados, 5 % cancelados. |
| Responsables | — | Arquitecto principal; la mitad de los proyectos tiene un segundo responsable. |
| Archivos | 12 por proyecto | Con versión vigente y objeto en MinIO. El primero es un PDF de 512 KB para las descargas. |
| Comentarios | unos 17.800 | 60 por proyecto activo, más respuestas. |
| Otros | — | 2.400 notificaciones, 180 solicitudes (borrador y pendiente de revisión). |
| Catálogo | — | 30 servicios y 60 cotizaciones creados con `createService`/`createQuote`, que aplican sus reglas. |

Escalas configurables: `SEED_CLIENTS`, `SEED_ARCHITECTS`, `SEED_ADMINS`, `SEED_FILES_PER_PROJECT` y `SEED_COMMENTS_PER_PROJECT`.

La matriz de permisos por rol es una aproximación ficticia. Si la de producción difiere, hay que ajustar `PERMISSIONS` en `seed.mjs`.

Las cuentas se escriben en `env/.out/accounts.json` (ignorado por git), con su rol, su proyecto, el archivo descargable y los proyectos de notificaciones.

## Escenarios

| Id | Qué mide | Carga | Comando |
|---|---|---|---|
| A | Carga inicial | 10 usuarios constantes, `DURATION` (10 min) | `LOADTEST_AUTHORIZED=1 load-tests/env/run-scenario.sh A` |
| B | Carga moderada | 25 usuarios | `… run-scenario.sh B` |
| C | Carga elevada | 50 usuarios | `… run-scenario.sh C` |
| D | Pico | 100 usuarios | `… run-scenario.sh D` |
| E | Uso continuo | 50 usuarios durante 60 min | `… run-scenario.sh E` |
| F | Subidas y descargas con consultas y comentarios | 25 usuarios (`VUS`), PDF de 5 MB (`FILE_SIZE_BYTES`) | `… run-scenario.sh F` |
| G | Comentarios y SSE | 25 usuarios k6 y 50 conexiones SSE (`SSE_CONNECTIONS`) | `… run-scenario.sh G` |
| H | Saturación y recuperación | Pico de 150 usuarios con el pool reducido (2 conexiones, cola de 20, espera de 1 s) y después 5 usuarios durante 3 min | `… run-scenario.sh H` |

Detalles de los escenarios:

- **A–E y H** usan la carga mixta por rol:
  - Clientes y arquitectos: proyectos, comentarios incrementales, notificaciones, solicitudes y descargas parciales.
  - Administradores: paneles, usuarios, servicios, cotizaciones y algún PDF de cotización.
- **Usuarios virtuales y peticiones por segundo** son métricas distintas: el informe recoge ambas (`virtualUsersMax`, `requestsPerSecond`).

## Límites de uso

Los límites reales siguen activos por defecto. Para las pruebas de **capacidad** hay que subir los límites por usuario, para que los 429 no oculten la capacidad real:

```bash
COMMENT_RATE_LIMIT_MAX=100000 PROJECT_REQUEST_RATE_LIMIT_MAX=100000 UPLOAD_RATE_LIMIT_MAX=100000 \
  docker compose -f load-tests/env/docker-compose.yml up -d --wait --force-recreate backend
```

Limitaciones de este ajuste:

- **No se pueden subir sin cambiar código:** el límite de login (20 por hora y cuenta) y los límites de administración (por ejemplo, 120 escrituras de cotización por hora). El arnés inicia sesión una sola vez por cuenta y ejecución, así que admite unas 20 ejecuciones por hora con las mismas cuentas; volver a sembrar reinicia los contadores. Los administradores hacen sobre todo lecturas.
- **Las pruebas de límites** (comprobar que devuelven 429 sin error) se hacen con los valores por defecto.

## Pool de PostgreSQL

| Variante | Configuración | Qué representa |
|---|---|---|
| Por defecto | Sin `DATABASE_POOL_MAX` | 2 conexiones, el valor del código para un servidor con base remota. |
| Vercel | `DATABASE_POOL_MAX=1` | Una conexión por instancia. Una sola instancia no reproduce el reparto entre instancias de Vercel. |
| Comparación | `DATABASE_POOL_MAX=10` | Separar límites de configuración de límites del código. |

Hay que registrar en cada informe la variante usada. La cola de espera se ajusta con `DATABASE_MAX_WAITING` (200 por defecto, pendiente de calibrar).

## Métricas y resultados

Cada ejecución crea `load-tests/results/<fecha>-<escenario>/` (ignorado por git) con:

| Archivo | Contenido |
|---|---|
| `summary.json` | Resumen de k6: peticiones por segundo, `vus_max`, latencia media, p50/p95/p99, `http_req_failed` y métricas propias: `rate_limited` (429), `saturated` (503), `auth_failures`, `system_errors` y `comments_created`. |
| `raw.json.gz` | Cada petición con sus etiquetas: endpoint, tipo (json, write, file), escenario y estado. |
| `../backend-metrics.jsonl` | Resumen del backend cada 5 s: CPU, RSS y heap, retraso del event loop, pool (activas, libres, en espera), duración por percentiles, 429/503, más el arranque y la salida del proceso. |
| `integrity-after.json` | Integridad y diferencias con la línea base (por ejemplo, comentarios guardados frente a `comments_created`). |
| `report.json` | Informe consolidado: por endpoint, tipo y fase (en H, `spike` y `recovery`), backend, entrega SSE y criterios de aceptación. |

## Criterios de aceptación (orientativos)

| Criterio | Objetivo | Fuente |
|---|---|---|
| Lecturas JSON | p95 < 800 ms | `byKind.json` |
| Escrituras | p95 < 1.500 ms | `byKind.write` |
| Event loop | p99 < 100 ms (máximo de las muestras) | `backend.eventLoopP99Ms` |
| Errores inesperados | 5xx sin 503 < 0,1 % | `acceptance.unexpectedServerErrors` |
| Memoria | Pendiente del heap < 50 MB/h en E | `backend.heapGrowthMbPerHour` |
| Integridad | Sin duplicados, huérfanos, filas sin objeto, transacciones abiertas ni bloqueos | `integrity-after.json` |
| Fallos de autenticación del arnés | 0 (si no, los resultados no son válidos) | `k6.authFailures` |
| Caídas del proceso | 0 | `backend.crashes` |
| Recuperación (H) | En `recovery`, p95 < 800 ms, sin 5xx ni 503 | `acceptance.recoveredAfterSaturation` |

**Los 429 y 503 se informan aparte y se analizan:** un 503 controlado en el pico de H es lo esperado; en A–E indica que el pool o la cola limitan la capacidad.

## Cómo interpretar los resultados

Clasificar cada hallazgo antes de proponer cambios:

1. **Problema del código:** por ejemplo, una consulta lenta que crece con el volumen, retención de conexiones o bloqueos.
2. **Restricción de configuración:** tamaño del pool, `DATABASE_MAX_WAITING`, límites de uso o plazos.
3. **Limitación del entorno de pruebas:**
   - Una sola instancia y recursos fijos.
   - k6 en la misma máquina que el backend.
   - MinIO en lugar de Supabase Storage.
   - Latencia de red casi nula, cuando en producción es Vercel–Supabase.
4. **Capacidad de infraestructura:** solo con evidencia de que lo anterior no lo explica.

No se proponen más conexiones, recursos, Redis, colas ni microservicios sin esa evidencia.

## Hallazgo detectado al preparar el entorno

`files.file_type` es `varchar(50)` desde la migración base. La aplicación guarda el tipo MIME completo, así que subir un **DOCX** (71 caracteres) o un **XLSX** (65) a un proyecto falla con `22001` y responde 500 en una base creada con las migraciones del repositorio.

El sembrado y las cargas usan solo PDF y PNG. Queda pendiente de decisión: no se ha modificado el esquema.
