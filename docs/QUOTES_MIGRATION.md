# Procedimiento: migración `20261026120000_quotes` en la base compartida

Estado: **aplicada en Supabase de desarrollo/staging el 27/10/2026 (03:00 UTC)** junto con
`20261021120000_measurement_unit_denomination_base_change`, tras autorización expresa. Pasos 1,
2 (respaldo `migrations-20261027-025804Z`, verificado con `pg_restore --list` y la huella, sin
ensayo de restauración local) y 4 completados; quedan el paso 3 (opcional ahora) y el 5. Para
otra base, este procedimiento requiere autorización expresa antes del paso 4. Ningún paso guarda
URLs, contraseñas ni salidas de la base en el repositorio.

## Qué cambia

- Crea `quotes`, `quote_versions` y `quote_items` (vacías, con RLS y el `REVOKE` de D-2), dos
  funciones y dos triggers de inmutabilidad, y siete índices.
- Único cambio sobre una tabla existente: `ALTER TABLE service_versions ADD CONSTRAINT
  uq_service_versions_id_service UNIQUE (id, service_id)`, siempre cierta porque `id` es la clave
  primaria. Construye un índice y toma un bloqueo exclusivo breve de `service_versions`.
- No modifica datos. Las FK nuevas son `ON DELETE RESTRICT` hacia `users`, `clients`,
  `projects`, `services` y `service_versions`: una vez existan cotizaciones, borrar físicamente
  esos registros fallará con `23001`. El backend actual no los borra (los usuarios se desactivan;
  `deleteCreatedAdminUser` no se usa en ninguna ruta).
- El backend que la usa no funciona sin ella (`/api/admin/quotes` y `kindLocked` en servicios):
  **aplicar la migración antes de publicar ese backend**.

## Requisitos

- Cliente PostgreSQL 17+ (`psql`, `pg_dump`, `pg_restore`) y un PostgreSQL 17+ local y
  desechable para el ensayo (Docker o instalación local). En la máquina de desarrollo actual no
  hay ninguno de los dos.
- `DIRECT_URL` (o `DATABASE_URL`) de la base compartida solo en la sesión de terminal, nunca en
  archivos versionados. Prisma usa `DIRECT_URL` si existe (`prisma.config.ts`).
- Árbol de trabajo con la migración confirmada en Git (commit publicado), para que cualquier
  copia vea la misma carpeta de migraciones que la base.
- Carpeta de respaldos fuera del repositorio y de OneDrive.

## 1. Estado de migraciones (solo lectura)

```powershell
cd Backend
pnpm db:migrate:status
```

`migrate deploy` aplica **todas** las migraciones pendientes, en orden. Anotar la lista exacta;
cada pendiente distinta de `20261026120000_quotes` (por ejemplo
`20261020150000_measurement_unit_denomination_public_code` o
`20261021120000_measurement_unit_denomination_base_change`, si no se aplicaron) requiere su propia
revisión y autorización antes de continuar.

## 2. Respaldo verificable

```powershell
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss") + "Z"
$dir = "$env:USERPROFILE\ARCA_PRIVATE_BACKUPS\quotes-$stamp"
New-Item -ItemType Directory -Force $dir | Out-Null
pg_dump --format=custom --no-owner --file "$dir\arca.dump" $env:DIRECT_URL
Get-FileHash "$dir\arca.dump" -Algorithm SHA256 | Format-List
pg_restore --list "$dir\arca.dump" > "$dir\arca.toc"
```

Verificación del respaldo: restaurarlo en el PostgreSQL local desechable y comparar huellas.

El volcado es completo (sirve para restaurar la base real). Para verificarlo en un PostgreSQL
estándar se restaura solo `public`, porque los esquemas propios de Supabase (`auth`, `storage`…)
no existen fuera de Supabase, y se crean antes sus tres roles para que el bloque D-2 de la
migración se ejecute igual que en la base real.

```powershell
$env:RESTORE_URL = "postgresql://postgres:postgres@localhost:5432/arca_restore_check"
createdb -h localhost -U postgres arca_restore_check
psql $env:RESTORE_URL -X -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"
pg_restore --no-owner --schema=public --dbname $env:RESTORE_URL "$dir\arca.dump"
psql $env:DIRECT_URL  -X -f prisma/checks/20261026120000_quotes/preflight.sql > "$dir\preflight-live.txt"
psql $env:RESTORE_URL -X -f prisma/checks/20261026120000_quotes/preflight.sql > "$dir\preflight-restore.txt"
```

Las secciones de huella (`table_name`, `row_count`, `content_md5`) de ambos archivos deben ser
idénticas en las tablas no `volatile`. Si no lo son, el respaldo no es válido: no continuar.

## 3. Ensayo sobre la copia restaurada

```powershell
$env:DIRECT_URL_SHARED = $env:DIRECT_URL      # conservarla aparte durante el ensayo
$env:DIRECT_URL = $env:RESTORE_URL
pnpm db:migrate:deploy
pnpm db:migrate:status
psql $env:RESTORE_URL -X -f prisma/checks/20261026120000_quotes/postcheck.sql > "$dir\postcheck-restore.txt"
```

Criterios: todas las columnas `ok_*` en `true`, ninguna `missing_*`, y la huella de las tablas
existentes igual a la de `preflight-restore.txt`. Después, pruebas de integración sobre una base
local vacía (no la copia):

```powershell
$env:ARCA_SERVICE_CATALOG_DB_TESTS = "1"
$env:ARCA_SERVICE_CATALOG_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/arca_integration"
pnpm test
```

Las pruebas `quotes.integration` y `serviceCatalog.integration` deben ejecutarse (no `SKIP`) y
pasar: cubren inmutabilidad, FK compuesta, `CHECK` del subtotal, versión vigente única y la
carrera entre el alta de un concepto y el cambio de modalidad. Al terminar, restaurar
`$env:DIRECT_URL = $env:DIRECT_URL_SHARED` y borrar las bases locales.

## 4. Aplicación en la base compartida (requiere autorización)

En un momento sin actividad de escritura y sin otro despliegue en curso:

```powershell
psql $env:DIRECT_URL -X -f prisma/checks/20261026120000_quotes/preflight.sql > "$dir\preflight-before-deploy.txt"
pnpm db:migrate:status          # misma lista que en el paso 1
pnpm db:migrate:deploy
pnpm db:migrate:status          # "Database schema is up to date"
psql $env:DIRECT_URL -X -f prisma/checks/20261026120000_quotes/postcheck.sql > "$dir\postcheck-live.txt"
```

Aceptación: `ok_*` en `true` en `preflight-before-deploy.txt` (incluido `ok_no_locks`) y en
`postcheck-live.txt`, tablas nuevas vacías y huella de las tablas existentes no `volatile`
idéntica antes y después.

## 5. Publicación y prueba de humo

1. Publicar el backend (Vercel) con la versión que contiene el módulo.
2. Con la cuenta demo de administración: `Servicios y cotizaciones → Cotizaciones` muestra el
   estado vacío y «Cotizaciones totales» en 0; crear una cotización de prueba identificada como
   tal, editarla (versión 2), ver y descargar el PDF.
3. En el tabulador, intentar cambiar la modalidad de un servicio incluido en esa cotización:
   debe mostrarse bloqueada con el motivo.

## Reversión

Mientras las tablas estén vacías y con autorización:

```sql
BEGIN;
DROP TABLE public.quote_items, public.quote_versions, public.quotes;
DROP FUNCTION public.prevent_quote_item_mutation(), public.prevent_quote_version_mutation();
ALTER TABLE public.service_versions DROP CONSTRAINT uq_service_versions_id_service;
DELETE FROM public._prisma_migrations WHERE migration_name = '20261026120000_quotes';
COMMIT;
```

y volver a publicar el backend anterior. Con cotizaciones guardadas, la reversión implica perder
datos: restaurar desde el respaldo del paso 2 solo tras una decisión explícita.
