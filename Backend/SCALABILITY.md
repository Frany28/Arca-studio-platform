# Evaluación de escalabilidad del backend

> Los cambios de estructura de PostgreSQL se administran desde `prisma/migrations`. El procedimiento completo está documentado en `PRISMA_MIGRATIONS.md`.

## Estado actual

La revisión estática no permite certificar 100 usuarios concurrentes. El sistema debe considerarse **no validado para esa carga** hasta ejecutar las pruebas de staging y cumplir sus umbrales. La producción objetivo será un VPS; las referencias al proveedor actual describen solamente el entorno transitorio. Los riesgos principales son:

| Severidad | Hallazgo | Impacto |
|---|---|---|
| Crítica | Los uploads de hasta 50 MB usan `express.raw` y un `Buffer` completo por petición. | 100 uploads pueden requerir varios GB de memoria antes del overhead de Node y S3. |
| Alta | Cada request autenticado ejecuta `findActiveUserById`, incluyendo agregación de permisos. | Amplifica consultas y ocupa el pool aun en rutas que no necesitan refrescar permisos. |
| Alta | Cada instancia crea un pool de 10 conexiones y no existe presupuesto global. | El escalado horizontal serverless puede agotar las conexiones de Supabase. |
| Alta | SSE se almacena en `Map` locales. El rate limiting ya usa contadores compartidos en PostgreSQL (`rate_limit_buckets`, hallazgo B-2). | Los eventos no cruzan instancias. |
| Alta | SSE depende de conexiones persistentes en un despliegue serverless. | Puede cerrarse por límites de duración de la plataforma. |
| Media | Listados de proyectos y comentarios no tienen paginación. | Respuestas y consultas crecen sin límite con los datos. |
| Media | La foto de perfil se descarga y concatena completamente en memoria. | Consumo de memoria evitable durante descargas concurrentes. |
| Media | No había timeout explícito de consulta ni telemetría por request. | Saturaciones y consultas lentas eran difíciles de detectar. |

Ya se añadieron streaming de archivos, cursores, caché local de autorización, límites acotados, protección concurrente de comentarios, timeouts, telemetría y apagado ordenado. Redis y el bus distribuido quedan deliberadamente pendientes para el despliegue multiproceso en VPS. La validación usa Zod, los uploads comparten una política central y el frontend recorre páginas mediante cursores sin duplicar resultados.

## Preparación de staging

1. Desplegar exactamente el commit a evaluar en un proyecto aislado y confirmar que `BASE_URL` no apunta a producción.
2. Crear 100 usuarios activos, cada uno con acceso a `projectId` y `fileId`. Copiar `load-tests/fixtures/users.example.json` fuera del repositorio, completar las cuentas y definir `LOAD_USERS_FILE` con su ruta.
3. Usar contraseñas, bucket y base de datos exclusivos de staging. Activar `REQUEST_METRICS_ENABLED=true`.
4. Configurar `DATABASE_POOL_MAX` considerando todas las instancias: `instancias máximas × pool por instancia` debe quedar al menos 20% bajo el límite del proveedor.
5. Capturar métricas de plataforma, PostgreSQL y almacenamiento durante toda la corrida.

## Ejecución

Requiere Node 22 y k6 instalados. En PowerShell:

```powershell
$env:BASE_URL='https://staging.example.com'
$env:FRONTEND_ORIGIN='https://staging-frontend.example.com'
$env:LOAD_USERS_FILE='C:\secure\load-users.json'
pnpm load:smoke
```

Si el smoke test no genera errores inesperados, iniciar la sonda SSE y la carga mixta en dos terminales durante el mismo intervalo:

```powershell
$env:SSE_CONNECTIONS='10'
$env:SSE_DURATION_MS='3960000'
pnpm load:sse
```

```powershell
pnpm load:mixed
```

Después ejecutar archivos por separado. Probar 256 KB, 5 MB y 50 MB ajustando concurrencia si la memoria se aproxima al límite:

```powershell
$env:FILE_SIZE_BYTES='5242880'
pnpm load:files
```

Guardar el resumen de k6, la salida `sse_summary`, logs JSON del backend, métricas de memoria/CPU, conexiones de PostgreSQL y tráfico S3. Repetir la misma secuencia después de cada corrección.

## Consultas de diagnóstico

Ejecutar solamente sobre staging. Obtener planes para las consultas reales con `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` y sus mismos parámetros, especialmente autenticación, listado/detalle de proyectos, comentarios y archivos. Registrar índices usados, filas estimadas/reales, lecturas de bloques y tiempo; no ejecutar `EXPLAIN ANALYZE` sobre escrituras.

Durante la prueba observar `pg_stat_activity` agrupado por estado y espera, y `pg_stat_statements` ordenado por tiempo total y promedio si la extensión está disponible. No crear índices hasta conservar el plan anterior como evidencia.

## Dictamen y aceptación

El backend queda aprobado solo si sostiene 100 usuarios por 10 minutos con errores de servidor menores al 1%, JSON p95 < 800 ms y p99 < 1.5 s, escrituras p95 < 1.5 s, cero inconsistencias, SSE sin cierres prematuros, memoria estable y al menos 20% de conexiones libres. La etapa de 150 usuarios mide margen y no invalida por sí sola la aceptación de 100.

Después de la carga verificar conteos de comentarios/solicitudes/archivos, duplicados lógicos, registros sin versión, objetos S3 sin registro y registros cuyo objeto no existe. Si cualquier criterio falla, el dictamen permanece **no preparado** y el informe debe relacionar el fallo con endpoint, recurso saturado y corrección priorizada.

## Orden recomendado de endurecimiento

1. Subidas directas a S3 con URL firmada o streaming y descargas de foto en streaming.
2. Pooler compatible con serverless y límite global de conexiones.
3. Pub/sub compartido para SSE y mover SSE a un runtime persistente si Vercel no garantiza su duración. El rate limiting ya es compartido en PostgreSQL (`docs/RATE_LIMITING.md`).
4. Caché breve y revocable de sesión/permisos.
5. Paginación por cursor e índices definidos a partir de los planes medidos.
