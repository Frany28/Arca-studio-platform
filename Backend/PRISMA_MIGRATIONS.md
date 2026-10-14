# Migraciones de base de datos con Prisma

El backend usa **Prisma Migrate 7.8** para registrar y desplegar cambios de PostgreSQL. Las consultas de la aplicación siguen usando `pg`; Prisma Client no reemplaza los repositorios actuales.

## Estado inicial

Para el estado finalizado canónico `finished`, consultar [auditoría, compatibilidad y procedimiento](../docs/PROJECT_FINISHED_STATUS.md). La migración `20261013000000_project_finished_status` renombra el enum y normaliza los códigos del historial en una transacción, sin recrear datos ni modificar fechas. Su aplicación remota requiere revisión y autorización explícita.

La conexión local de Prisma se corrigió para una red IPv4 utilizando el pooler de sesión existente en puerto 5432, sin cambiar el proveedor ni la configuración runtime. Ver [diagnóstico de conexión y estado de migraciones](../docs/POSTGRES_CONNECTION_DIAGNOSIS.md). El endpoint directo IPv6 original se conserva para entornos compatibles; un exit code 1 de `verify:db` puede indicar migraciones pendientes aunque la conexión funcione.

La base ya existía antes de incorporar Prisma. La migración `20260713000000_baseline` representa su estructura completa al 13 de julio de 2026, incluidos:

- 21 tablas y sus relaciones;
- índices de proyectos, comentarios y archivos;
- restricciones `CHECK` y claves diferibles;
- índices por expresiones, incluida la unicidad de puntos 3D;
- activación de Row Level Security.

El baseline está registrado como aplicado en la base de pruebas. No debe ejecutarse manualmente sobre esa base. En una base vacía, `prisma migrate deploy` sí lo utiliza para construir toda la estructura.

## Tablas del módulo de soporte (`20261014120000_support_tables`)

Hasta esta migración, `supportRepository.ensureSupportTables` ejecutaba `CREATE TABLE IF NOT EXISTS` para `support_requests` y `support_request_files` en la primera solicitud de soporte. El esquema cambiaba en runtime y el rol de la aplicación necesitaba permisos de DDL (hallazgo D-4 de la auditoría). Ahora ambas tablas se declaran en `schema.prisma` y en la migración, y el repositorio no ejecuta DDL. `tests/supportSchemaManagement.test.js` impide que vuelva a aparecer DDL en `src/`.

La migración reproduce exactamente la definición anterior: columnas, tipos, valores por defecto, claves primarias y la clave foránea `support_request_files_support_request_id_fkey` con `ON DELETE CASCADE`. `user_id` y `uploaded_by` siguen sin clave foránea. Además activa RLS, como el resto de tablas.

Usa `CREATE TABLE IF NOT EXISTS`: si un backend anterior ya creó las tablas en algún entorno, la migración las adopta sin recrearlas ni modificar sus datos. Antes comprueba que columnas, tipos, nulabilidad, claves primarias y clave foránea coinciden; ante cualquier diferencia aborta sin cambios. Al revisarlo el 14 de octubre de 2026, las tablas no existían en la base configurada para desarrollo y staging, y todas las migraciones anteriores estaban aplicadas.

Orden seguro de despliegue:

```text
1. pnpm db:migrate:status       → confirmar que solo 20261014120000_support_tables está pendiente
2. pnpm db:migrate:deploy       → crea las tablas (o adopta las existentes)
3. pnpm db:migrate:status       → confirmar que no quedan migraciones pendientes
4. publicar el backend nuevo
5. probar POST /api/support/requests con la cuenta demo
```

Si se publica el backend antes de aplicar la migración, solo fallan los endpoints de soporte, con HTTP 500 y código `42P01` (tabla inexistente); el resto del sistema no se ve afectado. Para resolverlo, aplicar la migración. El backend anterior sigue funcionando con la migración aplicada, porque su `CREATE TABLE IF NOT EXISTS` no hace nada sobre tablas existentes.

## Privilegios de los roles de la API (`20261014130000_revoke_api_role_table_privileges`)

Revoca `TRUNCATE`, `TRIGGER`, `REFERENCES` y `MAINTAIN` a `anon`, `authenticated` y `service_role` sobre las tablas de ARCA en `public` (hallazgo D-2). Debe aplicarse después de `20261014120000_support_tables`. Si D-4 no está aplicada, D-2 aborta sin cambios. El inventario, la compatibilidad con Supabase, el despliegue y la reversión están en [docs/DB_PRIVILEGES.md](../docs/DB_PRIVILEGES.md).

## Flujo para un cambio nuevo

1. Modificar `prisma/schema.prisma` para cambios que Prisma pueda representar.
2. Ejecutar en desarrollo:

   ```powershell
   pnpm db:migrate:dev --name nombre_del_cambio
   ```

3. Revisar siempre el `migration.sql` generado antes de conservarlo.
4. Para RLS, índices por expresiones, restricciones especiales o SQL avanzado, editar ese `migration.sql` manualmente.
   Toda tabla nueva en `public` debe incluir, en la misma migración, `ALTER TABLE public.<tabla> ENABLE ROW LEVEL SECURITY;` y `REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.<tabla> FROM anon, authenticated, service_role;`. Los privilegios predeterminados de `postgres` se mantienen sin cambios a propósito y concederían esos cuatro privilegios a cada tabla nueva (ver [docs/DB_PRIVILEGES.md](../docs/DB_PRIVILEGES.md)). `tests/dbPrivileges.test.js` rechaza las migraciones posteriores a D-2 que creen una tabla sin ese `REVOKE`.
5. Validar primero sobre la base de pruebas.
6. En staging o producción ejecutar únicamente:

   ```powershell
   pnpm db:migrate:deploy
   ```

7. Confirmar el estado con:

   ```powershell
   pnpm db:migrate:status
   ```

No usar `prisma db push` ni `prisma migrate reset` sobre bases con datos. No usar `migrate dev` en producción.

## Base existente y sincronización

`pnpm db:pull` vuelve a leer la estructura real y actualiza `schema.prisma`. Debe usarse con cuidado porque Prisma no representa completamente RLS, restricciones `CHECK`, claves diferibles ni índices por expresiones. Esas características deben conservarse en SQL manual dentro de las migraciones.

Prisma mantiene su historial en la tabla `_prisma_migrations`. Los antiguos archivos SQL independientes fueron retirados porque sus cambios ya forman parte del baseline; desde ahora la única fuente de migraciones es `prisma/migrations`.

El comando `pnpm verify` ejecuta lint/JSDoc, valida el esquema, ejecuta pruebas del backend y frontend y construye el frontend sin consultar la base. `pnpm verify:db` comprueba por separado el estado de migraciones y requiere acceso a la base configurada; no aplica migraciones ni prueba por sí solo el SQL de una migración nueva.

## Despliegue futuro en VPS

Durante el despliegue:

```text
backup de PostgreSQL
→ instalar dependencias
→ pnpm db:migrate:deploy
→ pnpm db:migrate:status
→ iniciar o reiniciar el backend
```

El comando de despliegue aplica solamente migraciones pendientes. Si una falla, Prisma la registra y detiene el proceso para evitar continuar con una estructura incompleta.
