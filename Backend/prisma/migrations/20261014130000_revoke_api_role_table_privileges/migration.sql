-- Hallazgo D-2: retira de anon, authenticated y service_role los privilegios
-- TRUNCATE, TRIGGER, REFERENCES y MAINTAIN sobre las tablas propias de ARCA
-- Studio en public.
--
-- Motivo: ninguno de esos roles los usa. El backend se conecta como postgres
-- (propietario) y no usa la Data API de Supabase. TRUNCATE no respeta RLS, y
-- MAINTAIN (PostgreSQL 17) permite LOCK TABLE, VACUUM, REINDEX y CLUSTER.
-- Antes de esta migración los tres roles ya no tenían SELECT, INSERT, UPDATE
-- ni DELETE, y sus 4 privilegios restantes los había concedido postgres, que es
-- quien ejecuta las migraciones y puede revocarlos.
--
-- Alcance deliberadamente limitado:
-- * Solo las tablas declaradas aquí (modelos de schema.prisma y
--   _prisma_migrations); una tabla ausente aborta la migración para detectar
--   divergencias.
-- * No toca SELECT, INSERT, UPDATE, DELETE, secuencias, funciones, esquemas
--   de Supabase (auth, storage, realtime…), ni la membresía de los roles.
-- * No modifica ALTER DEFAULT PRIVILEGES (decisión del 14/10/2026): las tablas
--   futuras siguen recibiendo esos privilegios por defecto, por lo que cada
--   migración que cree una tabla debe revocarlos explícitamente (ver
--   Backend/PRISMA_MIGRATIONS.md y docs/DB_PRIVILEGES.md).
-- * Va después de 20261014120000_support_tables para incluir sus dos tablas.
--
-- Si una tabla existe pero no pertenece al rol que ejecuta la migración, se
-- aborta: REVOKE solo retira lo concedido por ese rol y dejaría en silencio
-- privilegios de otros otorgantes.
--
-- Es idempotente: REVOKE sobre un privilegio inexistente no falla. Omite los
-- roles que no existan (PostgreSQL sin Supabase, base sombra) y MAINTAIN en
-- versiones anteriores a la 17.
BEGIN;

DO $$
DECLARE
  arca_tables text[] := ARRAY[
    '_prisma_migrations',
    'admin_user_notes',
    'audit_logs',
    'clients',
    'comment_anchors',
    'environment_comments',
    'file_versions',
    'files',
    'notifications',
    'password_recovery_tokens',
    'permissions',
    'project_assignees',
    'project_comments',
    'project_milestones',
    'project_progress_updates',
    'project_request_assignees',
    'project_request_reviews',
    'project_requests',
    'project_requirements',
    'project_stages',
    'project_status_history',
    'project_technical_specification_items',
    'project_technical_specifications',
    'projects',
    'role_permissions',
    'roles',
    'support_request_files',
    'support_requests',
    'user_registrations',
    'users'
  ];
  revoked_privileges text := 'TRUNCATE, TRIGGER, REFERENCES'
    || CASE WHEN current_setting('server_version_num')::integer >= 170000 THEN ', MAINTAIN' ELSE '' END;
  grantees text;
  target_table text;
  target_owner name;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname)
    INTO grantees
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role');

  IF grantees IS NULL THEN
    RAISE NOTICE 'D-2: no existen roles de la API de Supabase; no hay privilegios que revocar.';
    RETURN;
  END IF;

  FOREACH target_table IN ARRAY arca_tables LOOP
    -- to_regclass devuelve NULL si la tabla no existe: se aborta en vez de omitirla.
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'D-2: la tabla public.% no existe; revisar el orden de las migraciones.', target_table;
    END IF;
    SELECT pg_get_userbyid(relowner) INTO target_owner
      FROM pg_class
     WHERE oid = to_regclass(format('public.%I', target_table));
    IF target_owner <> current_user THEN
      RAISE EXCEPTION 'D-2: public.% pertenece a %, no a %; revisar antes de revocar.', target_table, target_owner, current_user;
    END IF;
    EXECUTE format('REVOKE %s ON TABLE public.%I FROM %s', revoked_privileges, target_table, grantees);
  END LOOP;
END
$$;

COMMIT;
