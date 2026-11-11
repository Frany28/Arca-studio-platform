-- Comprobación previa de 20261110130000_user_pending_status y 20261110131000_pending_client_accounts.
-- SOLO LECTURA.
--
-- Uso (psql 17+, con la URL de la base que se va a migrar; nunca guardar la salida en el
-- repositorio):
--   psql "$DIRECT_URL" -X -f prisma/checks/20261110131000_pending_client_accounts/preflight.sql > preflight.txt
--
-- Toda la ejecución ocurre en una transacción READ ONLY que termina con ROLLBACK.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. Ninguna migración a medias.
SELECT count(*) AS unfinished_migrations, count(*) = 0 AS ok_no_unfinished
FROM public._prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

-- 2. Objetos nuevos todavía ausentes y pg_c_utf8 disponible (PostgreSQL 17+).
SELECT NOT EXISTS (
         SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'user_status' AND e.enumlabel = 'pending'
       ) AS ok_pending_absent,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname IN ('chk_users_identity_unless_pending', 'chk_users_pending_without_password')
       ) AS ok_constraints_absent,
       to_regprocedure('public.person_name_key(text)') IS NULL AS ok_function_absent,
       EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'pg_c_utf8') AS ok_pg_c_utf8;

-- 3. Las filas existentes cumplirán las restricciones nuevas al validarlas.
SELECT count(*) FILTER (WHERE email IS NULL OR password_hash IS NULL) AS users_missing_identity,
       count(*) FILTER (WHERE email IS NULL OR password_hash IS NULL) = 0 AS ok_users_complete
FROM public.users;

-- 4. Huella de los datos que la migración no debe modificar (comparar con el postcheck).
SELECT count(*) AS users_total,
       md5(string_agg(id::text || ':' || status::text || ':' || coalesce(email, '') || ':' || md5(coalesce(password_hash, '')), ',' ORDER BY id)) AS users_fingerprint
FROM public.users;
SELECT count(*) AS clients_total,
       md5(string_agg(id::text || ':' || status::text || ':' || name || ':' || coalesce(email, ''), ',' ORDER BY id)) AS clients_fingerprint
FROM public.clients;

-- 5. Contexto para la creación desde cotizaciones (solo recuento).
SELECT u.status::text AS user_status, count(*) AS users
FROM public.users u WHERE u.deleted_at IS NULL GROUP BY 1 ORDER BY 1;
SELECT count(*) AS client_role_users_without_client
FROM public.users u JOIN public.roles r ON r.id = u.role_id
WHERE r.code = 'client' AND u.client_id IS NULL AND u.deleted_at IS NULL;

ROLLBACK;
