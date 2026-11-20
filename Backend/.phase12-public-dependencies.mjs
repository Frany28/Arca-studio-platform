import fs from 'node:fs';
import path from 'node:path';
import {open,inspect} from './.phase12-runtime.mjs';
import {root,save} from './.phase12-maintenance.mjs';
const c=await open();
try {
 await c.query('begin isolation level repeatable read read only');
 const external=(await c.query(`select distinct obj.type, obj.identity, ref.type as referenced_type, ref.schema as referenced_schema, ref.identity as referenced_identity
 from pg_depend d
 cross join lateral pg_identify_object(d.classid,d.objid,d.objsubid) obj
 cross join lateral pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) ref
 where obj.schema='public' and ref.schema is not null and ref.schema not in ('public','pg_catalog','information_schema') order by 2,5`)).rows;
 const functions=(await c.query(`select p.oid::regprocedure::text as name,pg_get_functiondef(p.oid) as definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') order by 1`)).rows;
 const functionReferences=functions.map(f=>({name:f.name,externalReferences:[...new Set(f.definition.match(/\b(?:vault|auth|storage|extensions|realtime|graphql|graphql_public)\.[a-zA-Z_][a-zA-Z_0-9]*/g)||[])]}));
 const eventTriggers=(await c.query(`select distinct e.evtname from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows;
 const dependencies={external,functionReferences,eventTriggers};save('public-dependencies.json',dependencies);fs.writeFileSync(path.join(root,'public-functions-review.json'),JSON.stringify(functions,null,2));
 await c.query('rollback');console.log(JSON.stringify(dependencies,null,2));
}finally{await c.end();}
