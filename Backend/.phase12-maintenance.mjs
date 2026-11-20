import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open,environment,selectedUrl,target,hash,inspect} from './.phase12-runtime.mjs';

export const root=path.join(os.homedir(),'ARCA_PRIVATE_BACKUPS','phase12-resumed-20261120');
export const clone='arca_phase12_rehearsal_20261120b';
export const names=fs.readdirSync('prisma/migrations').filter(n=>/^\d{14}_/.test(n)).sort();
export const pending=names.filter(n=>n>='20261117120000');
const bin='C:/Program Files/PostgreSQL/18/bin';
const execute=promisify(execFile);
export const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value,null,2)+'\n');
const read=(file)=>JSON.parse(fs.readFileSync(path.join(root,file)));
export function pgEnvironment(database) {return {...process.env,PGHOST:selectedUrl.hostname,PGPORT:selectedUrl.port||'5432',PGDATABASE:database,PGUSER:decodeURIComponent(selectedUrl.username),PGPASSWORD:decodeURIComponent(selectedUrl.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:path.join(root,'root.crt'),PGCONNECT_TIMEOUT:'15',PGOPTIONS:'-c lock_timeout=3000 -c statement_timeout=60000'};}
export async function run(label,command,args,env=process.env) {
 try{const r=await execute(command,args,{env,windowsHide:true,timeout:600000,maxBuffer:20*1024*1024});fs.writeFileSync(path.join(root,`${label}.log`),r.stdout+'\n'+r.stderr);return r.stdout;}
 catch(e){fs.writeFileSync(path.join(root,`${label}.log`),(e.stdout||'')+'\n'+(e.stderr||''));throw new Error(`${label} failed (${e.code}); private log saved`);}
}
export async function fingerprints(c,tables) {
 const result=[];await c.query("set local timezone='UTC';set local datestyle='ISO,YMD';set local statement_timeout='60s';set local lock_timeout='3s'");
 for(const {schema,table} of tables){const quote=v=>'"'+v.replaceAll('"','""')+'"';const sql=`select count(*)::text as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as fingerprint from ${quote(schema)}.${quote(table)} t`;result.push({schema,table,...(await c.query(sql)).rows[0]});}
 return result;
}
export async function check(c,name,which,label) {
 const source=fs.readFileSync(`prisma/checks/${name}/${which}.sql`,'utf8').replace(/^\\.*$/gm,'');
 let rows;try {rows=(await c.query(source)).flatMap(r=>r.rows);}catch(e){await c.query('rollback').catch(()=>{});throw e;}
 save(`${label}-${name}-${which}.json`,rows);
 const indicators=rows.flatMap(row=>Object.entries(row).filter(([k])=>k.startsWith('ok_')));
 assert(indicators.length>0);assert(indicators.every(([,v])=>v===true),`${label} ${name} ${which}: failed indicators ${indicators.filter(([,v])=>v!==true).map(([k])=>k).join(',')}`);
 console.log(JSON.stringify({label,name,which,indicators:indicators.length,passed:true}));return rows;
}
export function compare(before,after){for(const row of before.filter(r=>r.fingerprint)){assert.deepEqual(after.find(r=>r.table_name===row.table_name&&r.fingerprint),row,'Data fingerprint mismatch');}}
export function prepareStage(index) {
 const stage=path.join(root,`stage-${index+1}`);fs.mkdirSync(path.join(stage,'migrations'),{recursive:true});
 for(const name of names.filter(n=>n<=pending[index])){const d=path.join(stage,'migrations',name);fs.mkdirSync(d,{recursive:true});const b=fs.readFileSync(`prisma/migrations/${name}/migration.sql`);fs.writeFileSync(path.join(d,'migration.sql'),b);assert.equal(hash(fs.readFileSync(path.join(d,'migration.sql'))),hash(b));}
 const lock=path.join(stage,'migrations/migration_lock.toml');
 if(fs.existsSync('prisma/migrations/migration_lock.toml'))fs.copyFileSync('prisma/migrations/migration_lock.toml',lock);
 else fs.writeFileSync(lock,'provider = "postgresql"\n');
 const config=path.join(stage,'prisma.config.ts');fs.writeFileSync(config,`export default ${JSON.stringify({schema:path.resolve('prisma/schema.prisma'),migrations:{path:path.join(stage,'migrations')},datasource:{url:'REPLACED_AT_RUNTIME'}}).replace('"REPLACED_AT_RUNTIME"','process.env.PHASE12_PRISMA_URL')};\n`);
 const probe=path.join(stage,'limits.sql');fs.writeFileSync(probe,"DO $$ BEGIN IF current_setting('lock_timeout')::interval <> interval '3 seconds' OR current_setting('statement_timeout')::interval <> interval '60 seconds' THEN RAISE EXCEPTION 'Session limits mismatch'; END IF; END $$;\n");
 return {config,probe};
}
export async function configureScopedLimits(database) {
 assert(database==='postgres'||/^arca_phase12_[a-z_0-9]+$/.test(database));
 const c=await open(database);try{
 const settings=(await c.query("select s.setconfig from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database()) and s.setrole=(select oid from pg_roles where rolname=current_user)")).rows[0]?.setconfig||[];
 const old=Object.fromEntries(settings.filter(v=>/^(lock_timeout|statement_timeout)=/.test(v)).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
 const file=`limits-original-${database}.json`;assert(!fs.existsSync(path.join(root,file)),'Original settings already captured; do not overwrite');save(file,{database,role:'postgres',values:old});
 await c.query(`alter role postgres in database "${database}" set lock_timeout='3s'`);
 await c.query(`alter role postgres in database "${database}" set statement_timeout='60s'`);
 save(`limits-active-${database}.json`,{database,lock_timeout:'3s',statement_timeout:'60s'});
 }finally{await c.end();}
}
export async function restoreScopedLimits(database) {
 const original=read(`limits-original-${database}.json`);assert.equal(original.database,database);assert(database==='postgres'||/^arca_phase12_[a-z_0-9]+$/.test(database));
 const c=await open(database);try{for(const key of ['lock_timeout','statement_timeout']){if(original.values[key]===undefined)await c.query(`alter role postgres in database "${database}" reset ${key}`);else await c.query(`alter role postgres in database "${database}" set ${key}='${original.values[key].replaceAll("'","''")}'`);}save(`limits-restored-${database}.json`,{...original,restoredAt:new Date().toISOString()});}finally{await c.end();}
}
export async function prisma(database,index,label,action='deploy') {
 const {config,probe}=prepareStage(index);const u=new URL(selectedUrl);u.pathname='/'+database;u.searchParams.set('sslmode','require');u.searchParams.set('sslaccept','strict');u.searchParams.set('sslcert',path.join(root,'root.crt').replaceAll('\\','/'));u.searchParams.set('options','-c lock_timeout=3000 -c statement_timeout=60000');
 const env={...process.env,PHASE12_PRISMA_URL:u.toString()};
 await run(`${label}-limits`,process.execPath,['scripts/prisma.mjs','db','execute','--file',probe,'--config',config],env);
 if(action==='deploy') await run(`${label}-deploy`,process.execPath,['scripts/prisma.mjs','migrate','deploy','--config',config],env);
 else await run(`${label}-status`,process.execPath,['scripts/prisma.mjs','migrate','status','--config',config],env);
}
async function backup() {
 fs.mkdirSync(root,{recursive:true});assert(!fs.existsSync(path.join(root,'database.dump')),'Existing backup must not be overwritten');fs.writeFileSync(path.join(root,'root.crt'),environment.DATABASE_SSL_CA_CERT.replace(/\\n/g,'\n'));
 const {result}=await inspect();assert.deepEqual(result.pending,pending);assert.equal(result.mismatches.length,0);assert.equal(result.unfinished.length,0);save('target-before.json',result);
 const c=await open();try{
 await c.query("begin isolation level repeatable read read only;set local statement_timeout='60s';set local lock_timeout='3s';set local idle_in_transaction_session_timeout='10min'");
 const snapshot=(await c.query('select pg_export_snapshot() as id')).rows[0].id;
 await run('backup-pg_dump',path.join(bin,'pg_dump.exe'),['-Fc','--lock-wait-timeout=3s','--snapshot',snapshot,'--file',path.join(root,'database.dump')],pgEnvironment('postgres'));
 const list=await run('backup-list',path.join(bin,'pg_restore.exe'),['--list',path.join(root,'database.dump')]);fs.writeFileSync(path.join(root,'database.list'),list);
 const tables=[...list.matchAll(/^\d+; \d+ \d+ TABLE DATA (\S+) (\S+) /gm)].map(m=>({schema:m[1],table:m[2]}));assert(tables.length>0);
 const rows=await fingerprints(c,tables);save('source-table-fingerprints.json',rows);await c.query('rollback');
 save('backup.json',{target,createdAt:new Date().toISOString(),sha256:hash(fs.readFileSync(path.join(root,'database.dump'))),bytes:fs.statSync(path.join(root,'database.dump')).size,tables:tables.length,sourceVersion:result.identity.version});
 console.log(JSON.stringify(read('backup.json')));
 }finally{await c.end();}
}
async function restore() {
 const manifest=read('backup.json');assert.equal(hash(fs.readFileSync(path.join(root,'database.dump'))),manifest.sha256);
 const admin=await open();try{assert.equal((await admin.query('select 1 from pg_database where datname=$1',[clone])).rowCount,0,'Clone already exists');await admin.query(`create database ${clone} template template0`);await admin.query(`revoke connect on database ${clone} from public`);}finally{await admin.end();}
 const routing=await open(clone);const version=(await routing.query('show server_version')).rows[0].server_version;assert.equal(version,manifest.sourceVersion);await routing.end();
 await run('restore-full',path.join(bin,'pg_restore.exe'),['--exit-on-error','--no-owner','--no-privileges','--no-comments','--dbname',clone,path.join(root,'database.dump')],pgEnvironment(clone));
 const c=await open(clone);try{await c.query('begin isolation level repeatable read read only');const expected=read('source-table-fingerprints.json');const actual=await fingerprints(c,expected);assert.deepEqual(actual,expected,'Full restored data differs from exported source snapshot');await c.query('rollback');save('restore-verified.json',{backupSha256:manifest.sha256,targetDatabase:clone,version,tables:actual.length,allFingerprintsMatch:true,privilegesAndOwnersRestored:false,commentsRestored:false,createdAt:new Date().toISOString()});console.log(JSON.stringify({restored:true,database:clone,tables:actual.length,version,allFingerprintsMatch:true}));}finally{await c.end();}
}
async function rehearse() {
 assert(read('restore-verified.json').allFingerprintsMatch);
 for(let i=0;i<pending.length;i++){
 const c=await open(clone);let before;try{before=await check(c,pending[i],'preflight','rehearsal');}finally{await c.end();}
 const started=Date.now();await prisma(clone,i,`rehearsal-${i+1}`);
 const post=await open(clone);try{const after=await check(post,pending[i],'postcheck','rehearsal');compare(before,after);const h=(await post.query('select checksum from public._prisma_migrations where migration_name=$1 and finished_at is not null and rolled_back_at is null',[pending[i]])).rows;assert.equal(h.length,1);assert.equal(h[0].checksum,hash(fs.readFileSync(`prisma/migrations/${pending[i]}/migration.sql`)));save(`rehearsal-${i+1}-result.json`,{name:pending[i],checksum:h[0].checksum,elapsedMs:Date.now()-started,fingerprintsUnchanged:true});console.log(JSON.stringify({rehearsed:pending[i],elapsedMs:Date.now()-started,checksum:h[0].checksum}));}finally{await post.end();}
 }
 await prisma(clone,2,'rehearsal-final','status');save('rehearsal-verified.json',{migrations:pending,allChecksPassed:true,createdAt:new Date().toISOString()});
}
const mode=process.argv[2];
if(process.argv[1]?.endsWith('.phase12-maintenance.mjs')){try{if(mode==='backup')await backup();else if(mode==='restore')await restore();else if(mode==='rehearse')await rehearse();else throw new Error('Unknown mode');}catch(e){console.error(JSON.stringify({stopped:true,mode,code:e.code,message:e.message}));process.exitCode=1;}}
