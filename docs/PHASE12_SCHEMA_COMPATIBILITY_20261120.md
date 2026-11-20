# Fase 1.2: diagnóstico de esquema y detención operativa

Fecha: 20 de noviembre de 2026. Entorno: desarrollo/staging/demo según `AGENTS.md`.

El desarrollador autorizó la aplicación ordenada de las migraciones pendientes de Fase 1.2 únicamente con destino confirmado, respaldo restaurado, historial coherente y preflight correcto. También autorizó la corrección de activación/errores y un plan B9 de solo lectura; mantuvo excluidos su aplicación, commits, push y nuevos despliegues.

La aplicación de migraciones se detuvo antes de modificar el esquema remoto: falló la restauración de prueba del respaldo completo por ausencia de `supabase_vault` en PostgreSQL local. Se respetó la condición del desarrollador de detener la operación ante una comprobación fallida. **Migraciones aplicadas: ninguna.** No se pausó el servicio, no se modificó el historial remoto y no se ejecutó B9.

## Destino comprobado

| Elemento | Resultado |
| --- | --- |
| Interfaz comprobada | `https://arca-studio-platform.netlify.app` |
| Backend del proxy de Netlify | `https://sistema-web-arca-studio.vercel.app` |
| Proyecto Vercel | `prj_loIeWV8vtCWm7ytaUKHflV8Z7xzA` |
| Despliegue observado | `dpl_6emi54uDu4HFyeM8SgGXh1YZtrLe` |
| Commit del despliegue | `7364ac6779322ad68a22dd85e2e78b2dc7da4ada` |
| Destino PostgreSQL | `postgres@aws-1-us-east-1.pooler.supabase.com:5432` |
| Servidor PostgreSQL | 17.6 |
| Intención de activar revisión en Vercel | `PROJECT_FILE_REVIEW_ENABLED=true` |

La etiqueta técnica del despliegue en Vercel es `production`; su clasificación funcional sigue siendo staging/demo. La API de Vercel no entrega el contenido de `DATABASE_URL`, marcada como sensible. Para confirmar el destino efectivo se inició una sesión con la cuenta demo mediante el backend desplegado y se comprobó la existencia de esa misma sesión y usuario en `public.user_sessions` de la base inspeccionada. No se imprimieron cookies, JWT, identificadores de sesión ni credenciales. El login produjo sus escrituras normales de sesión; no alteró el esquema ni datos de negocio.

El runtime (`Backend/src/config/db.js`) utiliza **`DATABASE_URL`**. Prisma (`Backend/prisma.config.ts`) utiliza **`DIRECT_URL || DATABASE_URL`**. La configuración local contiene ambas y sus host, puerto, base e identidad de conexión coinciden; el respaldo se realizó con la selección efectiva de `DIRECT_URL`. Las variables del proyecto Vercel consultadas no incluyen `DIRECT_URL`. No se sustituyó una URL por otra ni se alteraron archivos `.env`.

Las conexiones de inspección de Node y de `pg_dump` verificaron la CA configurada en Vercel. En Node se usó `rejectUnauthorized: true`; libpq usó `sslmode=verify-full`. La verificación corresponde al canal cliente→pooler. `pg_stat_ssl` del servidor informó `false` para la conexión interna observada tras el pooler; no se afirma cifrado de extremo a extremo con ese dato.

## Historial y catálogo previos

La inspección de PostgreSQL se realizó en una transacción `REPEATABLE READ READ ONLY`, terminada con `ROLLBACK`, con consultas limitadas a 30 s. Se consultaron `_prisma_migrations`, `information_schema.columns`, `pg_class` y `pg_index`.

- 47 migraciones terminadas; ningún intento sin terminar y no revertido.
- Última aplicada: `20261114120000_approved_request_projects_to_draft`.
- Sin diferencias de contenido en el historial aplicado al cotejar SHA-256 con las representaciones históricas LF/CRLF documentadas por el repositorio. No se reescribieron migraciones para igualar hashes.
- Tres pendientes, exactamente en el siguiente orden. Sus SHA-256 son los de los bytes originales en disco y los esperados para su aplicación futura; **no son registros de migraciones aplicadas en esta intervención**.

| Migración pendiente | SHA-256 |
| --- | --- |
| `20261117120000_project_folder_system_keys` | `d71840d8b0837aae5b0427ff0555380c452d88060102b633082f869c8e67cefd` |
| `20261118120000_project_file_review_audience_expand` | `405291f62106b4216aff8929814524d5d7fc4da8eb619a4909a289a883848ac2` |
| `20261119120000_project_comment_version_points` | `41b9363e31d9a956260db403c0dce11d665267b1f4921cad1c9fd70d37c83c92` |

Faltantes confirmados en el catálogo:

| Área | Estado |
| --- | --- |
| `project_folders.system_key` | Ausente |
| `files.access_policy` | Ausente |
| `file_versions` | Ausentes `content_type`, `review_status`, `reviewed_by`, `reviewed_at`, `review_reason`, `restored_from_version_id` |
| Tablas | Ausentes `project_file_audience_grants` y `project_warranty_documents` |
| Índices comprobados | Ausentes `uq_project_folders_system_key`, `idx_file_versions_review_queue` y `project_comments_panorama_version_point_unique_idx` |
| Índice anterior de puntos | `project_comments_panorama_point_unique_idx` existe y es válido |

El defecto nace al utilizar directamente la bandera para componer SQL y habilitar rutas que requieren esos objetos. En el backend desplegado, las cuatro lecturas autenticadas comprobadas respondieron HTTP 500 con `code: "42703"`: `/api/projects`, `/api/admin/files/metrics`, `/api/admin/files/items` y `/api/admin/files/tree`.

## Respaldo y punto de detención

Se siguieron los requisitos de respaldo y restauración previa descritos en `Backend/ARCHITECTURE.md` (B3 y configuración de drafts). No se llegó a la aplicación.

| Comprobación | Resultado |
| --- | --- |
| Respaldo PostgreSQL completo, formato custom | Creado, 664 562 bytes |
| Ubicación privada | `%USERPROFILE%/ARCA_PRIVATE_BACKUPS/phase12-authorized-20261120/database.dump` |
| SHA-256, recalculado tras el intento de restauración | `387645885462dd3a90bc7b981af226c5a48ad5062535e8594fbd9ad1a0c16d31` |
| `pg_restore --list` | Correcto; inventario en `database.list` |
| Restauración aislada con `--exit-on-error` | **Fallida**: extensión `supabase_vault` no disponible |
| Servidor local de ensayo | PostgreSQL 18.6, `127.0.0.1:54329` |
| Ensayo de migraciones sobre ese respaldo | No ejecutado |
| Preflight remoto de aplicación | No ejecutado tras fallar la restauración requerida |
| Migraciones y postchecks remotos | No ejecutados; esquema remoto sin cambios |

Se conservan `backup.json`, `database.list` y `rehearse-pg_restore-error.log` junto al respaldo, fuera del repositorio. El respaldo **no se declara verificado para autorizar una migración**. La base local parcialmente restaurada se eliminó después de comprobar su nombre exacto y ausencia de conexiones; no se eliminaron respaldos ni datos remotos.

El dump utilizó límites de bloqueo y sentencia de 3 s y 60 s, respectivamente, y `--lock-wait-timeout=3s`. No se ejecutaron sentencias de migración remotas. Las migraciones B3 y B6 conservan sus límites originales de 3 s/60 s; no se modificó el SQL de carpetas para añadirlos. Una operación futura debe preparar un destino de restauración compatible con las extensiones y la versión del origen, restaurar y ensayar el respaldo, y volver a comprobar destino, historial y preflight antes de cualquier escritura. El procedimiento histórico de B3 detiene una ejecución con varias pendientes: será necesario definir explícitamente una aplicación por etapas con una sola pendiente por invocación de Prisma, conservando los archivos originales y sus postchecks. En esta intervención no se preparó ni ejecutó un despliegue conjunto que saltara esa condición.

## Código preparado para revisión

- `Backend/src/config/projectFileReview.js`: separa intención y estado efectivo por contexto asíncrono. El estado permanece estable durante cada petición; fuera de un contexto verificado está apagado.
- `Backend/src/config/projectFileReviewSchema.js`: manifiesto de migraciones, checksums y dependencias de esquema.
- `Backend/src/repositories/projectFileReviewSchemaRepository.js`: consulta historial y catálogo; exige registros terminados con checksum exacto, columnas, valores de enums, restricciones validadas e índices válidos, listos y con la unicidad necesaria. Comprueba si ya existen archivos con política nueva antes de permitir lecturas heredadas.
- `Backend/src/services/projectFileReviewActivationService.js`: resolución común, caché por instancia y deduplicación. Positivos 30 s, negativos 5 s, invalidación al apagar; errores sin caché. Ante estructura incompleta mantiene el flujo heredado únicamente si no amplía audiencias.
- `Backend/src/middlewares/projectFileReview.js` y `Backend/src/app.js`: fijan el mismo estado para rutas y consultas antes de entrar en los routers. Conservan el registro técnico interno, incluidos esquema, tabla, columna, restricción y rutina cuando PostgreSQL los proporciona.
- `Backend/src/errors/appError.js`: traducción común a 503 `DATABASE_SCHEMA_NOT_READY` para dependencias ausentes, con causa preservada y mensaje público genérico. Los SQLSTATE desconocidos dejan de salir como códigos públicos; se conservan las traducciones existentes de conflictos y disponibilidad.
- Pruebas de activación y fixtures de ocho integraciones: historial local con hashes reales mediante `recordMigrations`; consulta interna directa ejecutada dentro del mismo contexto verificado que usaría HTTP.
- Documentación de arquitectura y contrato HTTP actualizada.

No se modificaron migraciones, frontend, animaciones, proveedores ni arquitectura de persistencia. No se hicieron commits, push ni nuevos despliegues. El código corregido **todavía no está en el backend desplegado**.

## B9 y pantalla real

Recuentos de origen, leídos sin nombres ni contenido: 13 proyectos no retirados, 21 archivos, 21 versiones, 0 carpetas y 32 comentarios. De los archivos, 12 tienen proyecto y no están retirados. Este es un recuento previo, **no una clasificación B9**.

No se generó un plan B9 válido ni su huella: la herramienta documentada consulta las columnas y tablas todavía ausentes. Convertibles, casos en revisión y sus motivos quedan **sin determinar**, no en cero. No se creó un plan contra una copia con estructura inventada y no se ejecutó `--apply`. La aplicación de B9 sigue requiriendo autorización posterior, además de disponer primero del esquema y del plan revisable.

Se inspeccionó la interfaz real en Brave, con sesión administrativa existente:

- Gestión de proyectos: muestra «No se pudieron cargar los proyectos» y métricas de proyectos sin valores.
- Gestión de archivos: aparecen «Aprobados», «Pendientes por aprobación» y «Rechazados».
- Las métricas muestran «No se pudieron cargar las métricas».
- El árbol muestra «No se pudo cargar el árbol».
- El listado muestra «No se pudieron cargar los archivos»; crear carpeta y subir archivo permanecen deshabilitados sin selección.

No se declara recuperada la pantalla. No se guardaron capturas de validación en disco.

## Validación

Comprobaciones ejecutadas y omisiones:

- `pnpm verify`: **aprobado, salida 0**. Lint backend y frontend, validación Prisma y build correctos; backend **892 aprobadas, 0 fallos y 265 opcionales omitidas por sus guardas**; frontend **565 aprobadas, 0 fallos y 0 omitidas**. Las integraciones relacionadas se habilitaron y ejecutaron por separado como se indica a continuación.
- Integraciones locales relacionadas: **84 aprobadas, 0 fallos y 0 omitidas** en diez archivos; versiones, audiencias, comentarios/SSE, garantías, archivos, compatibilidad B9 en datos ficticios, solicitudes, expansión B3 y comprobación de activación.
- Regresiones específicas: SQL heredado, bloqueo de rutas con esquema incompleto, caché/deduplicación, expiración, concurrencia de contextos, protección de audiencias y traducción de errores. **15 pruebas específicas aprobadas**, incluida la invalidación de lecturas en vuelo y el descarte de respuestas antiguas tras apagar y reactivar. La prueba del manifiesto compara los SHA-256 de los tres archivos originales.
- `git diff --check` y revisión de alcance; ninguna migración existente modificada.

Las integraciones B9 de este apartado se ejecutan exclusivamente en bases locales desechables con datos ficticios; no convierten archivos de staging. Las integraciones opcionales ajenas al alcance conservan sus guardas y no se habilitan contra staging. No se ejecutaron pruebas de navegador con fixtures: no cambió la presentación y se inspeccionó la pantalla desplegada directamente. Permanecen pendientes las verificaciones operativas bloqueadas por el respaldo, la aplicación del esquema y el plan B9 real.

Logs de verificación: `%TEMP%/arca-phase12-verify.log` y `%TEMP%/arca-phase12-regression.log`. Los scripts operativos temporales se retiraron del repositorio; se conservaron los artefactos privados del respaldo y del fallo de restauración.
