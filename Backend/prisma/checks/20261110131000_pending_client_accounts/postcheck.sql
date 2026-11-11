-- Comprobación posterior de 20261110130000_user_pending_status y 20261110131000_pending_client_accounts.
-- SOLO LECTURA.
--
-- Uso: psql "$DIRECT_URL" -X -f prisma/checks/20261110131000_pending_client_accounts/postcheck.sql > postcheck.txt
-- Comparar la huella del punto 4 con la del preflight: debe ser idéntica.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

-- 1. Valor del enum.
SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) AS user_status_values,
       'pending' = ANY (array_agg(e.enumlabel)) AS ok_pending_present
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'user_status';

-- 2. Restricciones creadas y validadas.
WITH expected(name) AS (
  VALUES ('chk_users_identity_unless_pending'), ('chk_users_pending_without_password')
)
SELECT e.name, con.conname IS NOT NULL AS ok_exists, coalesce(con.convalidated, false) AS ok_validated
FROM expected e
LEFT JOIN pg_constraint con ON con.conname = e.name AND con.connamespace = 'public'::regnamespace
ORDER BY e.name;

-- 3. Nulabilidad, función inmutable e índice no único.
SELECT table_name, column_name, is_nullable = 'YES' AS ok_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'users' AND column_name IN ('email', 'password_hash'))
    OR (table_name = 'clients' AND column_name = 'email'))
ORDER BY table_name, column_name;
SELECT p.provolatile = 'i' AS ok_immutable,
       public.person_name_key('  José   PÉREZ ') = 'jose perez' AS ok_normalizes
FROM pg_proc p WHERE p.oid = to_regprocedure('public.person_name_key(text)');
SELECT i.indisunique = false AS ok_not_unique
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname = 'idx_clients_name_key';

-- 4. Huella de los datos (idéntica a la del preflight).
SELECT count(*) AS users_total,
       md5(string_agg(id::text || ':' || status::text || ':' || coalesce(email, '') || ':' || md5(coalesce(password_hash, '')), ',' ORDER BY id)) AS users_fingerprint
FROM public.users;
SELECT count(*) AS clients_total,
       md5(string_agg(id::text || ':' || status::text || ':' || name || ':' || coalesce(email, ''), ',' ORDER BY id)) AS clients_fingerprint
FROM public.clients;

ROLLBACK;
