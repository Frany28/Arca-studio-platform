import dotenv from "dotenv";

dotenv.config({ quiet: true });
process.env.DATABASE_URL = (process.env.DIRECT_URL || process.env.DATABASE_URL || "").trim().replace(/^"|"$/g, "");
let pool;
let client;

// Auditoría exclusivamente de lectura; no imprime URLs, credenciales ni filas de usuarios.
try {
  ({ pool } = await import("../src/config/db.js"));
  client = await pool.connect();
  await client.query("begin isolation level repeatable read read only");
  const queries = {
    connection: `select current_database() as database_name,
      current_setting('transaction_read_only') as transaction_read_only,
      current_setting('server_version') as server_version`,
    enum: `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'project_status' order by e.enumsortorder`,
    columns: `select table_name, column_name, data_type, column_default from information_schema.columns
      where table_schema = 'public' and (udt_name = 'project_status' or
        (table_name = 'project_status_history' and column_name in ('previous_status', 'new_status')))
      order by table_name, column_name`,
    projectStates: `select status::text, archived_from_status::text, count(*)::int as records
      from public.projects group by status, archived_from_status order by status, archived_from_status`,
    history: `select previous_status, new_status, count(*)::int as records
      from public.project_status_history group by previous_status, new_status order by previous_status, new_status`,
    stages: `select status::text, count(*)::int as records from public.project_stages group by status`,
    milestones: `select status::text, count(*)::int as records from public.project_milestones group by status`,
    dependencies: `select pg_describe_object(d.classid, d.objid, d.objsubid) as dependent, d.deptype
      from pg_depend d where d.refobjid = 'public.project_status'::regtype order by dependent`,
    constraints: `select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid in ('public.projects'::regclass, 'public.project_stages'::regclass,
        'public.project_milestones'::regclass, 'public.project_status_history'::regclass) order by conname`,
    indexes: `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'
      and tablename in ('projects', 'project_stages', 'project_milestones', 'project_status_history') order by indexname`,
    triggers: `select c.relname as table_name, t.tgname, p.proname as function_name from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal and t.tgrelid in ('public.projects'::regclass, 'public.project_stages'::regclass,
        'public.project_milestones'::regclass, 'public.project_status_history'::regclass)`,
    functions: `select n.nspname as schema_name, p.proname as function_name,
      p.prosrc like '%completed%' as references_completed from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and (p.prosrc like '%project_status%' or p.prosrc like '%completed%')`,
    migrations: `select migration_name, finished_at is not null as applied, rolled_back_at is not null as rolled_back
      from public._prisma_migrations order by migration_name`,
  };
  for (const [name, sql] of Object.entries(queries)) {
    console.log(JSON.stringify({ [name]: (await client.query(sql)).rows }));
  }
  await client.query("rollback");
} catch (error) {
  console.error(JSON.stringify({ auditFailed: true, code: error.code || error.name }));
  process.exitCode = 1;
} finally {
  // Al cerrar el pool se revierte también una transacción de lectura interrumpida.
  client?.release();
  if (pool) await pool.end();
}
