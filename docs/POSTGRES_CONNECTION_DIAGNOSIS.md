# Diagnóstico de conexión PostgreSQL — 14 de octubre de 2026

**Actualización posterior del mismo día:** el desarrollador autorizó modificar Supabase y se aplicó `20261013000000_project_finished_status` con respaldo previo. La base usa ahora `finished` y no hay migraciones pendientes. Ver [aplicación y verificación](PROJECT_FINISHED_STATUS_DEPLOYMENT.md). Este diagnóstico conserva a continuación los resultados obtenidos antes de esa autorización.

## Resultado

La conexión local a Supabase funciona a través del **pooler de sesión existente**, sin cambios en PostgreSQL. El fallo `ENOTFOUND` procedía de utilizar el endpoint directo IPv6 desde una red sin ruta IPv6. No había evidencia de un proyecto eliminado, hostname inventado o contraseña incorrecta.

La única migración pendiente es `20261013000000_project_finished_status`. Continúa **sin aplicar en Supabase** y no se ha autorizado su aplicación. No se modificaron el esquema Prisma ni los archivos de migración preparados.

## Conexiones y precedencia

| Consumidor | Variable/configuración | Destino antes de la corrección | Destino local actual |
| --- | --- | --- | --- |
| Backend normal (`pg`) | `Backend/src/config/db.js` usa exclusivamente `DATABASE_URL` | `aws-1-us-east-1.pooler.supabase.com:5432`, base `postgres` | El mismo; no se modificó. |
| Prisma CLI | `Backend/prisma.config.ts` usa `DIRECT_URL` o, si está vacía, `DATABASE_URL` | `db.iragryaxvrtucpbolcey.supabase.co:5432`, base `postgres` | El pooler de sesión ya configurado y verificado. |
| Auditoría | Selecciona `DIRECT_URL` o `DATABASE_URL` antes de cargar el pool existente | El endpoint directo IPv6 | El mismo pooler de sesión que Prisma. |

Las variables se cargan mediante dotenv desde Backend. No había variables de conexión heredadas del proceso que sobrescribieran el archivo `.env`. El wrapper `scripts/prisma.mjs` transmite las variables al proceso de Prisma y corrige comillas desbalanceadas. Esta selección era coherente; el destino directo no era alcanzable desde esta red.

Se comprobó la coincidencia del identificador del proyecto entre el hostname directo y `SUPABASE_URL`. El usuario del pooler incluye el identificador de proyecto, mientras que el endpoint directo utiliza otro formato. Se reutilizó la URL completa existente, sin derivar ni inventar hostname, usuario o contraseña. No se publican URLs con credenciales en este informe.

## Evidencia del diagnóstico

| Comprobación | Resultado observado |
| --- | --- |
| Resolución del pooler | Resuelve direcciones IPv4 y acepta TCP en 5432. |
| Resolución habitual del host directo | `dns.lookup` devuelve `ENOTFOUND`. |
| DNS públicos 1.1.1.1 y 8.8.8.8 | El endpoint directo no tiene registro A; ambos devuelven el mismo AAAA `2600:1f18:6f7d:e800:4:7b1e:2f47:3a64`. |
| TCP forzado a ese IPv6 | `ENETUNREACH`, incluso fuera del sandbox. |
| Interfaces/rutas Windows | Interfaces activas con IPv4; no se observó dirección IPv6 global ni ruta predeterminada IPv6. |
| Resolutor expuesto a Node | `127.0.0.1`; las consultas DNS directas por UDP devolvían `ECONNREFUSED`. No se modificaron DNS, VPN ni red del sistema. |
| Autenticación y lectura por el pooler original | La auditoría de estados completó correctamente antes de cambiar `.env`, utilizando un override temporal. |
| `DIRECT_URL` original | Tenía una comilla desbalanceada. El wrapper ya la normalizaba; fue una irregularidad secundaria, no la causa de la incompatibilidad IPv6. |

El hostname existe en DNS público. La causa operativa demostrada es la selección de una conexión que requiere IPv6 en un entorno que no puede enrutarlo; el comportamiento del resolutor local explica el error de resolución observado. No se atribuye el problema exclusivamente a la VPN: no se cambió ni se probó la red desactivándola.

Supabase documenta el endpoint directo IPv6 y el pooler de sesión en 5432 como alternativa para redes IPv4. Su guía Prisma también permite usar esa conexión de sesión para el CLI. Fuentes: [conexiones PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres), [compatibilidad IPv4/IPv6](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP), [Prisma con Supabase](https://supabase.com/docs/guides/database/prisma).

## Correcciones realizadas

- `Backend/.env`, archivo local ignorado por Git: `DIRECT_URL` utiliza ahora la URL del pooler de sesión ya presente en `DATABASE_URL`. Se conservaron las credenciales y la configuración de ejecución; la alternativa IPv6 original quedó comentada para un entorno compatible, con sus comillas corregidas.
- `Backend/.env.example`: aclara que DIRECT_URL puede utilizar el pooler de **sesión** verificado en 5432. No incorpora credenciales reales ni una nueva dirección ficticia.
- `Backend/scripts/audit-project-status.mjs`: añade una consulta de metadatos que informa la base, versión de PostgreSQL y `transaction_read_only` para hacer comprobable el modo de lectura.
- `Backend/tests/projectFinishedStatus.integration.test.js`: reconstruye el historial local con `psql`, evitando que un único mensaje de `pg` agrupe las instrucciones en una transacción implícita. Los repositorios utilizan el pool PostgreSQL real configurado con la URL de la base efímera; las capturas de filas se leen secuencialmente en la conexión de preparación.
- Documentación: este informe y el seguimiento en `PROJECT_FINISHED_STATUS.md` y `Backend/PRISMA_MIGRATIONS.md`.

No se cambiaron `prisma.config.ts`, `scripts/prisma.mjs`, `src/config/db.js`, configuraciones de Netlify/Vercel/Supabase ni políticas SSL. La corrección corresponde al entorno local; no modifica variables de otros despliegues.

## Comprobaciones remotas autorizadas

Solo se ejecutaron `pnpm verify:db` y la auditoría de estados sobre la base remota. Las pruebas DNS/TCP no enviaron SQL ni credenciales. No se ejecutaron despliegues de migración, cambios de esquema, resets, reparaciones del historial ni mutaciones de datos.

`verify:db` está definido como `pnpm db:migrate:status`, que ejecuta `prisma migrate status`. Este comando consulta el directorio local y `_prisma_migrations`; no aplica las instrucciones SQL pendientes. Su salida final indica:

```text
22 migrations found in prisma/migrations
Following migration have not yet been applied:
20261013000000_project_finished_status
```

Su código de salida **1 es esperado por la migración pendiente**; no significa que persista un error de conexión. Esta distinción está documentada por [Prisma, migrate status](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference#migrate-status). Las sugerencias de comandos de escritura impresas por Prisma no se ejecutaron.

La auditoría inicia `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, ejecuta SELECT sobre datos/catálogos y finaliza con ROLLBACK. En la ejecución final se estableció adicionalmente `PGOPTIONS=-c default_transaction_read_only=on` en el proceso de auditoría, sin alterar la configuración del servidor. La consulta de metadatos confirmó:

```json
{"database_name":"postgres","transaction_read_only":"on","server_version":"17.6"}
```

## Estado de Supabase antes de aplicar la migración

| Elemento | Resultado |
| --- | --- |
| Migraciones locales | 22. |
| Migraciones distintas aplicadas | 21. |
| Pendientes | Solo `20261013000000_project_finished_status`. |
| Fallos activos de migración | No se observaron. |
| Registro histórico revertido | `20260825120000_project_request_legal_documentation` tiene un intento revertido y otro aplicado correctamente. No requiere volver a aplicarla ni modificar su historial. |
| Enum `project_status` | `pending`, `in_process`, `completed`, `cancelled`, `archived`; aún no contiene `finished`. |
| Proyectos | 6: uno `completed` y cinco `in_process`. Uno de los cinco conserva `archived_from_status=in_process`. Este diagnóstico no altera ese dato. |
| Historial de estados, etapas e hitos | Sin filas en la instantánea auditada. No se elimina ninguna tabla ni se asume que permanecerán vacías. |
| Dependencias del enum | Cuatro columnas, tres defaults, el tipo array y el índice `uq_projects_client_active_name` que compara `cancelled`. |
| Triggers adicionales | Existe `update_projects_updated_at` en proyectos, asociado a `update_updated_at_column`. El renombrado preparado no hace UPDATE sobre proyectos. No se observaron triggers de historial. |
| Funciones con texto `completed`/`project_status` | No se encontraron en `public` con la búsqueda de la auditoría. Esta comprobación no sustituye la revisión de consumidores externos. |

El backend actualizado debe desplegarse coordinadamente con la migración futura: sus casts SQL utilizan `finished`, mientras la base remota conserva `completed`. La conectividad corregida no autoriza aplicar la migración ni habilita por sí sola la convivencia de ambas versiones.

## Validación local y revisión final

Se ejecutó una instancia temporal de **PostgreSQL 17.6**, coincidente con la versión remota, usando los binarios portátiles oficiales de EDB enlazados desde la [página de PostgreSQL para Windows](https://www.postgresql.org/download/windows/). Se enlazó únicamente a `127.0.0.1` en un puerto libre, sin instalar servicios ni cambiar PATH. El cluster, la descarga y los binarios se eliminaron después de detener la instancia. No se utilizó una copia con datos personales de Supabase.

La primera ejecución detectó una limitación del ejecutor de pruebas al reproducir una migración histórica: enviaba todo el archivo como una consulta y PostgreSQL devolvía `55P04` al utilizar un valor de enum añadido dentro de esa transacción implícita. Se corrigió solamente la preparación del test usando `psql -X -v ON_ERROR_STOP=1 -f`, que respeta los límites de las instrucciones y las transacciones explícitas del SQL existente. **No se editó ninguna migración.**

La ejecución final de `tests/projectFinishedStatus.integration.test.js` pasó: **1 aprobada, 0 fallidas, 0 omitidas**. La prueba creó una base local efímera propia, reconstruyó las 21 migraciones anteriores, cargó datos de prueba y ejecutó el SQL preparado para finished. Verificó:

- Conservación exacta de registros, relaciones, fechas, responsables, notas y snapshots de auditoría, exceptuando las etiquetas de estado autorizadas.
- Conversión de proyectos, estados previos al archivo, etapas, hitos y códigos del historial.
- Conservación del OID de la etiqueta enum y del índice parcial dependiente.
- Rollback de enum e historial cuando una restricción de prueba provoca un fallo.
- Rechazo de `completed` como valor nuevo del enum ya migrado.
- Consulta, métricas, visibilidad, cierre operativo, archivo, recuperación y creación con los repositorios y el pool PostgreSQL reales.

Es una validación del historial versionado y datos sintéticos sobre PostgreSQL real, no una aplicación ni una copia exacta del entorno Supabase. La auditoría remota identificó un trigger adicional de proyectos que no forma parte del baseline; la migración preparada no actualiza esas filas.

| Comprobación final | Resultado |
| --- | --- |
| `pnpm verify` | Correcto: lint/JSDoc, Prisma validate, backend/frontend y build. Todas las integraciones remotas quedaron explícitamente desactivadas para este comando. |
| Backend, suite habitual | 256 aprobadas, 0 fallidas, 5 integraciones optativas omitidas. |
| Integración PostgreSQL local, ejecutada por separado | 1 aprobada, 0 fallidas, 0 omitidas. |
| Frontend | 293 aprobadas y build correcto. No se cambiaron componentes visuales en esta tarea. |
| Integridad de esquema y migraciones | Los hashes SHA-256 de los 23 archivos de `Backend/prisma` coinciden antes y después de esta tarea. |
| Revisión del diff | Sin errores de whitespace; no se alteraron configuraciones válidas ajenas a la conexión local de Prisma. |

La conectividad quedó corregida y la migración se validó localmente. Su aplicación remota permanece **pendiente de autorización**. No se ejecutaron `prisma migrate deploy`, `db push`, `migrate reset`, operaciones de datos remotos, commits ni push.
