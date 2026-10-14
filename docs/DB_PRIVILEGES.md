# Privilegios PostgreSQL de los roles de la API (hallazgo D-2)

Estado al 14 de octubre de 2026, PostgreSQL 17.6 en Supabase. Datos obtenidos con consultas de catálogo de solo lectura (`BEGIN READ ONLY` y `ROLLBACK`).

## Inventario

| Objeto | Situación |
| --- | --- |
| Tablas de ARCA en `public` | 28 tablas, todas propiedad de `postgres` y con RLS activo, sin políticas. Son los 27 modelos de `schema.prisma` anteriores a D-4 más `_prisma_migrations`. Con D-4 se suman `support_requests` y `support_request_files`. |
| `anon`, `authenticated`, `service_role` sobre esas tablas | `TRUNCATE`, `TRIGGER`, `REFERENCES` y `MAINTAIN` en las 28. Todos concedidos por `postgres`. Sin `SELECT`, `INSERT`, `UPDATE` ni `DELETE`. |
| `PUBLIC` sobre tablas | Ningún privilegio. |
| Secuencias de `public` | Los tres roles no tienen ningún privilegio. |
| Privilegios por defecto de `postgres` en `public` (tablas) | `anon`, `authenticated` y `service_role` reciben `MAINTAIN`, `REFERENCES`, `TRIGGER` y `TRUNCATE` en cada tabla nueva. |
| Privilegios por defecto de `supabase_admin` en `public` | Los tres roles reciben todos los privilegios sobre tablas, secuencias y funciones que cree `supabase_admin`. Los administra Supabase. |
| Funciones de `public` | `update_updated_at_column` (trigger) y `rls_auto_enable` (event trigger `ensure_rls`, `SECURITY DEFINER`), ambas con `EXECUTE` para `PUBLIC` por defecto. |

## Uso real de los privilegios

- El backend usa `pg.Pool` con `postgres`, propietario de las tablas, y Prisma ejecuta las migraciones con ese mismo rol. Ninguno depende de privilegios concedidos a otros roles.
- El frontend no usa Supabase y el backend no usa `@supabase/supabase-js`. Sin privilegios de datos, la Data API (PostgREST) no puede leer ni escribir esas tablas con ningún rol.
- `TRIGGER`: los cinco triggers existentes (`update_*_updated_at`) pertenecen a `postgres`. El privilegio solo sirve para crear triggers nuevos.
- `REFERENCES`: ninguna clave foránea de otro esquema apunta a `public`. El privilegio solo se comprueba al crear una clave foránea.
- `TRUNCATE` y `MAINTAIN`: ningún servicio los usa. `supabase_realtime` no publica tablas de `public`, ninguna vista de otro esquema depende de ellas y Storage trabaja en su propio esquema.
- `service_role` tiene `BYPASSRLS`, pero sin privilegios de datos no puede leer estas tablas. Si en el futuro se usa la clave de servicio, habrá que conceder explícitamente lo necesario.

## Riesgo

`TRUNCATE` no respeta RLS y vacía tablas completas. `MAINTAIN` (PostgreSQL 17) permite `LOCK TABLE`, `VACUUM`, `REINDEX` y `CLUSTER`, lo que bastaría para bloquear el servicio. Hoy ninguna vía conocida permite a esos roles ejecutar SQL arbitrario: PostgREST no emite esas sentencias y `pg_graphql` no está instalado. El riesgo es latente, pero su impacto sería alto.

## Corrección propuesta

Migración `Backend/prisma/migrations/20261014130000_revoke_api_role_table_privileges`:

- Revoca `TRUNCATE`, `TRIGGER`, `REFERENCES` y `MAINTAIN` a los tres roles en una lista explícita de 30 tablas: los modelos de Prisma, incluidas las tablas de D-4, y `_prisma_migrations`.
- Una tabla ausente, o que no pertenezca al rol que ejecuta la migración, aborta la migración para detectar divergencias.
- Omite los roles inexistentes (PostgreSQL sin Supabase) y `MAINTAIN` en versiones anteriores a la 17.
- Es idempotente.
- No concede nada, no toca datos, secuencias, funciones, otros esquemas ni la membresía de los roles.

Validación sin aplicar cambios:

- **Simulación de solo lectura de D-2** sobre la base configurada (con `EXECUTE` y las excepciones sustituidos por `NOTICE`): el bloque es válido, generaría 28 `REVOKE`, las 28 tablas pertenecen a `postgres` y detecta las dos tablas de D-4 como ausentes. Es el resultado esperado mientras D-4 esté pendiente.
- **Sintaxis de `REVOKE ... MAINTAIN`:** PostgreSQL 17.6 la analizó y la rechazó con `25006` por la transacción de solo lectura, lo que confirma la sintaxis sin modificar nada.
- **Verificación estructural de D-4:** con las tablas ausentes aborta con su propio mensaje (`P0001`). Una consulta equivalente sobre `admin_user_notes` confirmó los valores de `data_type` (`bigint`, `text`, `timestamp with time zone`) y la ordenación `COLLATE "C"` con la que se construyó la lista esperada.

Pruebas en `Backend/tests/dbPrivileges.test.js`:

- **Estáticas (se ejecutan en `pnpm verify`):**
  - la lista de tablas coincide con `schema.prisma` y `_prisma_migrations`;
  - se revocan exactamente los cuatro privilegios y solo a los tres roles;
  - no hay `GRANT`, `DEFAULT PRIVILEGES`, sentencias de datos ni referencias a esquemas de Supabase;
  - comprueba propietario y existencia de cada tabla antes de revocar;
  - la migración se ejecuta después de D-4;
  - toda migración posterior a D-2 que cree una tabla incluye el `REVOKE` de los cuatro privilegios.
- **D-4 (`tests/supportSchemaManagement.test.js`):** la verificación estructural espera exactamente las columnas de los modelos de Prisma.
- **De catálogo (opcionales, solo lectura):** se activan con `ARCA_DB_PRIVILEGE_TEST_DATABASE_URL` y comprueban que los roles no conservan privilegios sobre las tablas de ARCA. Antes de aplicar la migración fallan, lo cual es lo esperado; después deben pasar.

## Privilegios predeterminados y tablas nuevas

Decisión del 14 de octubre de 2026: los privilegios predeterminados de PostgreSQL **se mantienen sin cambios**. D-2 solo revoca privilegios sobre las tablas existentes.

1. **Privilegios por defecto de `postgres`.** Siguen concediendo `TRUNCATE`, `TRIGGER`, `REFERENCES` y `MAINTAIN` a `anon`, `authenticated` y `service_role` en cada tabla que cree `postgres` en `public`.
   - No se modifican porque no está comprobado cómo interactúan con la opción del panel de Supabase que controla la exposición automática de tablas en la Data API.
   - **Obligación para nuevas migraciones:** toda migración que cree una tabla en `public` debe incluir, junto al `ENABLE ROW LEVEL SECURITY`:

     ```sql
     REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.<tabla> FROM anon, authenticated, service_role;
     ```

   - `tests/dbPrivileges.test.js` rechaza en `pnpm verify` cualquier migración posterior a D-2 que cree una tabla sin ese `REVOKE`. La prueba de catálogo opcional detecta, además, tablas creadas fuera de Prisma.
2. **Privilegios por defecto de `supabase_admin`.** `postgres` no puede modificarlos y pertenecen a Supabase. Solo afectan a objetos que cree `supabase_admin` en `public`. No se tocan.
3. **`EXECUTE` de `PUBLIC` sobre `rls_auto_enable`.** Parece pertenecer a la función de Supabase que activa RLS automáticamente. Una función de event trigger no puede invocarse directamente ni se expone por PostgREST. No se toca.

## Comportamiento ante tablas existentes

- **D-2:** aborta si una tabla de la lista no existe o no pertenece al rol que ejecuta la migración. `REVOKE` solo retira lo concedido por ese rol, por lo que con otro propietario dejaría privilegios sin aviso. Revocar un privilegio que ya no existe no produce error.
- **D-4:** `CREATE TABLE IF NOT EXISTS` adopta tablas creadas por un backend anterior. Un bloque posterior verifica columnas, tipos, nulabilidad, claves primarias y la clave foránea con `ON DELETE CASCADE`; cualquier diferencia aborta la migración sin cambios.

## Relación con otros hallazgos

- **D-4:** su migración `20261014120000_support_tables` debe aplicarse antes. `prisma migrate deploy` respeta ese orden. Si D-2 se ejecutara sin D-4, aborta sin cambios.
- **D-1 (rol de mínimos privilegios):** D-2 no afecta a `postgres`. El futuro rol de la aplicación recibirá concesiones explícitas (`SELECT`, `INSERT`, `UPDATE` y el `DELETE` necesario) en su propia migración. No debe recibir `TRUNCATE`, `TRIGGER`, `REFERENCES` ni `MAINTAIN`. La prueba de catálogo deberá ampliarse con ese rol.

## Despliegue seguro

```text
1. Copia de seguridad de la base (o punto de restauración de Supabase).
2. Exportar los privilegios actuales para poder revertir (consulta de solo lectura):
   select c.relname, a.grantee::regrole, a.privilege_type
   from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
   where n.nspname = 'public' and a.grantee::regrole::text in ('anon','authenticated','service_role');
3. pnpm db:migrate:status    → solo deben estar pendientes 20261014120000_support_tables y 20261014130000_revoke_api_role_table_privileges
4. pnpm db:migrate:deploy    → aplica D-4 y luego D-2
5. pnpm db:migrate:status    → sin pendientes
6. ARCA_DB_PRIVILEGE_TEST_DATABASE_URL=<conexión> node --test tests/dbPrivileges.test.js
   → la prueba de tablas debe pasar
7. Comprobar /api/health/database, el inicio de sesión con la cuenta demo y una operación de escritura (comentario o solicitud de soporte).
```

No requiere publicar el backend, pero la migración D-4 obliga a publicarlo después, según `Backend/PRISMA_MIGRATIONS.md`. Aplicarla primero en una base de pruebas.

## Reversión

Prisma no ejecuta migraciones inversas. Si un servicio de Supabase llegara a necesitar alguno de estos privilegios, se restablecen con una migración nueva (no editando la aplicada):

```sql
DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[/* la misma lista de 30 tablas */] LOOP
    EXECUTE format('GRANT TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.%I TO anon, authenticated, service_role', target_table);
  END LOOP;
END
$$;
```

Conceder solo el privilegio y el rol que realmente se necesiten, tras identificar el servicio afectado.
