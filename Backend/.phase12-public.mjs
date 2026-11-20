import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {open,hash} from './.phase12-runtime.mjs';
import {root,save,run,fingerprints,pgEnvironment,pending,check,compare,prisma,names,configureScopedLimits,recycleIdleMigrationConnections} from './.phase12-maintenance.mjs';
import {PROJECT_FILE_REVIEW_MIGRATIONS} from './src/config/projectFileReviewSchema.js';

export const publicClone='arca_phase12_public_20261120';
assert.deepEqual(pending,PROJECT_FILE_REVIEW_MIGRATIONS.map(([name])=>name),'Only the three authorized migrations may be staged');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file)));
export async function metadata(c) {
 const results={};
 await c.query('begin isolation level repeatable read read only;set local search_path=public,pg_catalog;set local timezone=\'UTC\';set local datestyle=\'ISO,YMD\'');
 try {
  const queries={
   relations:`select c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) as owner from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S') order by 1`,
   columns:`select t.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) as default_expression from pg_attribute a join pg_class t on t.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where t.relnamespace='public'::regnamespace and t.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped order by 1,3`,
   constraints:`select c.conname,c.conrelid::regclass::text as relation,c.contype,c.convalidated,c.condeferrable,c.condeferred,pg_get_constraintdef(c.oid) as definition from pg_constraint c where c.connamespace='public'::regnamespace order by 2,1`,
   indexes:`select t.relname,i.indisunique,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) as definition from pg_index i join pg_class t on t.oid=i.indexrelid where t.relnamespace='public'::regnamespace order by 1`,
   functions:`select p.oid::regprocedure::text as name,pg_get_functiondef(p.oid) as definition,pg_get_userbyid(p.proowner) as owner from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p') order by 1`,
   enums:`select t.typname,array_agg(e.enumlabel order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname order by 1`,
   triggers:`select t.tgname,c.relname,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal order by 2,1`,
   policies:`select * from pg_policies where schemaname='public' order by tablename,policyname`,
   privileges:`select c.relname,coalesce(r.rolname,'PUBLIC') as role,a.privilege_type,a.is_grantable from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::\"char\" else 'r'::\"char\" end,c.relowner))) a left join pg_roles r on r.oid=a.grantee where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S') order by 1,2,3,4`,
   functionPrivileges:`select p.oid::regprocedure::text as name,coalesce(r.rolname,'PUBLIC') as role,a.privilege_type,a.is_grantable from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee where p.pronamespace='public'::regnamespace order by 1,2,3,4`,
   eventTriggers:`select e.evtname,e.evtevent,e.evtenabled,e.evtfoid::regprocedure::text as function,e.evttags from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid where p.pronamespace='public'::regnamespace order by 1`,
  };
  for(const [key,sql] of Object.entries(queries))results[key]=(await c.query(sql)).rows;
  await c.query('rollback');return results;
 } catch(e){await c.query('rollback');throw e;}
}
function assertBackup() {assert.equal(hash(fs.readFileSync(path.join(root,'database.dump'))),read('backup.json').sha256);}
async function restorePublic() {
 assertBackup();const dependencies=read('public-dependencies.json');assert.equal(dependencies.external.length,0);assert(dependencies.functionReferences.every(f=>f.externalReferences.length===0));
 const fullList=fs.readFileSync(path.join(root,'database.list'),'utf8').split(/\r?\n/);
 const selected=fullList.filter(line=>{
  if(!/^\d+;/.test(line))return true;
  if(/ DEFAULT ACL public /.test(line)&&line.endsWith('supabase_admin'))return false;
  return /^\d+; \d+ \d+ [A-Z ]+ public /.test(line)||/ (?:ACL|COMMENT|SCHEMA) - (?:SCHEMA )?public(?: |$)/.test(line)||/ EVENT TRIGGER - ensure_rls /.test(line);
 });
 const selection=path.join(root,'public-restore.list');fs.writeFileSync(selection,selected.join('\n')+'\n');
 const selectedData=selected.filter(l=>/ TABLE DATA public /.test(l));const expected=read('source-table-fingerprints.json').filter(t=>t.schema==='public');assert.equal(selectedData.length,expected.length);
 const c=await open();try{const baseline=await metadata(c);save('public-source-metadata.json',baseline);assert(baseline.relations.every(r=>r.owner==='postgres'),'Unexpected public object owner');assert.equal((await c.query('select 1 from pg_database where datname=$1',[publicClone])).rowCount,0);await c.query(`create database ${publicClone} template template0`);await c.query(`revoke connect on database ${publicClone} from public`);}finally{await c.end();}
 const routing=await open(publicClone);const version=(await routing.query('show server_version')).rows[0].server_version;assert.equal(version,read('backup.json').sourceVersion);await routing.end();
 await run('public-restore', 'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe',['--exit-on-error','--no-owner','--use-list',selection,'--dbname',publicClone,path.join(root,'database.dump')],pgEnvironment(publicClone));
 await verifyRestoredPublic();
 assertBackup();
}
function logicalColumns(columns) {
 const positions=new Map();return columns.map(({attnum,...column})=>{const ordinal=(positions.get(column.relname)||0)+1;positions.set(column.relname,ordinal);return {...column,ordinal};});
}
async function canonicalConstraints(c,source,restored) {
 const records=[];const proof=[];
 for(let i=0;i<source.length;i++){
  const original=source[i],actual=restored[i];
  if(original.definition===actual?.definition){records.push(original);continue;}
  assert.equal(original.contype,'c','Only CHECK parse normalization is allowed');
  assert.equal(original.conname,actual?.conname);assert.equal(original.relation,actual?.relation);
  assert(/^[a-z_][a-z_0-9]*$/.test(original.relation));assert(original.definition.startsWith('CHECK ('));
  const table=`arca_check_equivalence_${i}`;
  // Reanalizar la definición original con los mismos tipos prueba equivalencia; no se retira ningún CHECK restaurado.
  await c.query(`create temporary table ${table} (like public."${original.relation}")`);
  try {
   await c.query(`alter table ${table} add constraint arca_original_check ${original.definition}`);
   const canonical=(await c.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid=to_regclass($1) and conname='arca_original_check'",[table])).rows[0].definition;
   assert.equal(canonical,actual.definition,'Source CHECK canonical form differs from restored CHECK');
   proof.push({constraint:original.conname,relation:original.relation,original:original.definition,canonical,restored:actual.definition});records.push({...original,definition:canonical});
  }finally{await c.query(`drop table ${table}`);}
 }
 save('public-check-canonical-equivalence.json',proof);return records;
}
async function verifyRestoredPublic() {
 assertBackup();const expected=read('source-table-fingerprints.json').filter(t=>t.schema==='public');
 const restored=await open(publicClone);try{
 const version=(await restored.query('show server_version')).rows[0].server_version;assert.equal(version,read('backup.json').sourceVersion);
 const before=read('public-source-metadata.json'),after=await metadata(restored);save('public-restored-metadata.json',after);
 for(const key of Object.keys(before)){
  const expectedMetadata=key==='columns'?logicalColumns(before[key]):key==='constraints'?await canonicalConstraints(restored,before[key],after[key]):before[key];
  assert.deepEqual(key==='columns'?logicalColumns(after[key]):after[key],expectedMetadata,`Restored public metadata mismatch: ${key}`);
 }
 await restored.query('begin isolation level repeatable read read only');const actual=await fingerprints(restored,expected);await restored.query('rollback');assert.deepEqual(actual,expected,'Restored public data mismatch');save('public-restored-table-fingerprints.json',actual);
 save('public-restore-verified.json',{backupSha256:read('backup.json').sha256,database:publicClone,version,tables:expected.length,allDataMatch:true,allMetadataMatch:true,physicalAttributeNumbersNormalized:true,attributeComparison:'Names and logical order, types, defaults, nullability and identity checked; physical holes left by previously dropped columns are not logical schema objects',counts:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.length])),excludedDefaultPrivileges:'Only provider-owned supabase_admin defaults, unrelated to postgres migrations',createdAt:new Date().toISOString()});
 console.log(JSON.stringify(read('public-restore-verified.json')));
 }finally{await restored.end();}
 assertBackup();
}
export async function assertStage(c,index) {
 const history=(await c.query('select migration_name,checksum,finished_at,rolled_back_at from public._prisma_migrations')).rows;
 assert(!history.some(h=>!h.finished_at&&!h.rolled_back_at),'Unfinished migration');
 const staged=names.filter(n=>n<=pending[index]);const missing=staged.filter(n=>!history.some(h=>h.migration_name===n&&h.finished_at&&!h.rolled_back_at));assert.deepEqual(missing,[pending[index]],'Each stage must contain exactly the next pending migration');
 for(const h of history.filter(h=>h.finished_at&&!h.rolled_back_at)){assert(staged.includes(h.migration_name),'Unexpected applied migration');const b=fs.readFileSync(`prisma/migrations/${h.migration_name}/migration.sql`),s=b.toString();assert([b,Buffer.from(s.replace(/\r\n/g,'\n')),Buffer.from(s.replace(/\r?\n/g,'\r\n'))].map(hash).includes(h.checksum),'Historical checksum mismatch');}
 for(const [name,expected] of PROJECT_FILE_REVIEW_MIGRATIONS)assert.equal(hash(fs.readFileSync(`prisma/migrations/${name}/migration.sql`)),expected);
 return {historyCount:history.length,pending:missing};
}
async function rehearsePublic() {
 assertBackup();assert(read('public-restore-verified.json').allMetadataMatch);
 if(!fs.existsSync(path.join(root,`limits-original-${publicClone}.json`)))await configureScopedLimits(publicClone);
 await recycleIdleMigrationConnections(publicClone);
 for(let i=0;i<pending.length;i++){
 const c=await open(publicClone);let before;try{save(`public-stage-${i+1}-history.json`,await assertStage(c,i));before=await check(c,pending[i],'preflight','public-rehearsal');}finally{await c.end();}
 const started=Date.now();await prisma(publicClone,i,`public-rehearsal-${i+1}`);
 const post=await open(publicClone);try{const after=await check(post,pending[i],'postcheck','public-rehearsal');compare(before,after);const record=(await post.query('select checksum from public._prisma_migrations where migration_name=$1 and finished_at is not null and rolled_back_at is null',[pending[i]])).rows;assert.equal(record.length,1);assert.equal(record[0].checksum,hash(fs.readFileSync(`prisma/migrations/${pending[i]}/migration.sql`)));save(`public-rehearsal-${i+1}-result.json`,{name:pending[i],checksum:record[0].checksum,elapsedMs:Date.now()-started,fingerprintsUnchanged:true});console.log(JSON.stringify({rehearsed:pending[i],elapsedMs:Date.now()-started,checksum:record[0].checksum}));}finally{await post.end();}
 }
 await prisma(publicClone,2,'public-rehearsal-final','status');save('public-rehearsal-verified.json',{migrations:pending,allChecksPassed:true,createdAt:new Date().toISOString()});assertBackup();
}
if(process.argv[1]?.endsWith('.phase12-public.mjs')){try{if(process.argv[2]==='restore')await restorePublic();else if(process.argv[2]==='verify')await verifyRestoredPublic();else if(process.argv[2]==='rehearse')await rehearsePublic();else throw new Error('Unknown public mode');}catch(e){console.error(JSON.stringify({stopped:true,code:e.code,message:e.message}));process.exitCode=1;}}
