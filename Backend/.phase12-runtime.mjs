import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { resolveDatabaseConnection } from './src/config/databaseTls.js';

export const projectId='prj_loIeWV8vtCWm7ytaUKHflV8Z7xzA';
const authPath=path.join(process.env.APPDATA,'com.vercel.cli/Data/auth.json');
const configPath=path.join(process.env.APPDATA,'com.vercel.cli/Data/config.json');
export const team=JSON.parse(fs.readFileSync(configPath)).currentTeam;
export const headers={Authorization:`Bearer ${JSON.parse(fs.readFileSync(authPath)).token}`,'Content-Type':'application/json'};
export const suffix=`?teamId=${encodeURIComponent(team)}`;
export async function vercel(url,method='GET') { const r=await fetch(`https://api.vercel.com${url}`,{method,headers});const body=await r.text();let value={};try{value=body?JSON.parse(body):{};}catch{}if(!r.ok) throw new Error(`Vercel HTTP ${r.status}: ${value.error?.code||'request_failed'}`);return value; }
export const deployment=await vercel(`/v13/deployments/sistema-web-arca-studio.vercel.app${suffix}`);
if(deployment.projectId!==projectId)throw new Error('Deployment project mismatch');
export const remote=await vercel(`/v3/env/pull/${projectId}/${deployment.target}${suffix}`);
export const environment={...dotenv.parse(fs.readFileSync('.env')),...process.env,DATABASE_SSL_CA_CERT:remote.env.DATABASE_SSL_CA_CERT};
for(const key of ['DATABASE_URL','DIRECT_URL']) if(environment[key])environment[key]=environment[key].trim().replace(/^"|"$/g,'');
export const runtimeUrl=new URL(environment.DATABASE_URL);
export const selectedUrl=new URL(environment.DIRECT_URL||environment.DATABASE_URL);
if(runtimeUrl.host!==selectedUrl.host||runtimeUrl.pathname!==selectedUrl.pathname||runtimeUrl.username!==selectedUrl.username)throw new Error('Runtime and migration target identity mismatch');
export const target=`${selectedUrl.pathname.slice(1)}@${selectedUrl.host}`;
export const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
export async function open(database=selectedUrl.pathname.slice(1)) {
 const url=new URL(selectedUrl);url.pathname=`/${database}`;
 const options=resolveDatabaseConnection({...environment,DATABASE_URL:url.toString()},{local:false});
 const c=new pg.Client({connectionString:options.connectionString,ssl:options.ssl,connectionTimeoutMillis:10000,statement_timeout:30000,application_name:'arca-phase12-maintenance'});await c.connect();const actual=(await c.query('select current_database() as name')).rows[0].name;if(actual!==database){await c.end();throw new Error(`Database routing mismatch: expected ${database}, got ${actual}`);}return c;
}
export async function inspect() {
 const c=await open();try{
 const origin='https://arca-studio-platform.netlify.app';const source=fs.readFileSync('../Frontend/src/pages/auth/Login.jsx','utf8');
 const login=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:source.match(/const DEMO_EMAIL = "([^"]+)"/)[1],password:source.match(/const DEMO_PASSWORD = "([^"]+)"/)[1]})});
 if(login.status!==200)throw new Error(`Runtime login ${login.status}`);
 const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const token=cookie.match(/=([^;]+)/)[1];const payload=JSON.parse(Buffer.from(decodeURIComponent(token).split('.')[1],'base64url'));
 await c.query('begin isolation level repeatable read read only');
 const matched=(await c.query('select exists(select 1 from public.user_sessions where id=$1 and user_id=$2) as matched',[payload.sid,payload.sub])).rows[0].matched;
 if(!matched)throw new Error('Runtime database not proven');
 const history=(await c.query('select migration_name,checksum,finished_at,rolled_back_at from public._prisma_migrations order by migration_name')).rows;
 const names=fs.readdirSync('prisma/migrations').filter(n=>/^\d{14}_/.test(n)).sort();
 const applied=history.filter(h=>h.finished_at&&!h.rolled_back_at),mismatches=[];
 for(const entry of applied){const f=`prisma/migrations/${entry.migration_name}/migration.sql`;if(!fs.existsSync(f)){mismatches.push(entry.migration_name);continue;}const b=fs.readFileSync(f),s=b.toString();if(![b,Buffer.from(s.replace(/\r\n/g,'\n')),Buffer.from(s.replace(/\r?\n/g,'\r\n'))].map(hash).includes(entry.checksum))mismatches.push(entry.migration_name);}
 const result={target,precedence:environment.DIRECT_URL?'DIRECT_URL':'DATABASE_URL',runtimeDatabaseProven:matched,deployment:{id:deployment.id,gitSha:deployment.meta?.githubCommitSha,target:deployment.target},requested:remote.env.PROJECT_FILE_REVIEW_ENABLED==='true',identity:(await c.query("select current_database() as database,current_setting('server_version') as version,(select rolcreatedb from pg_roles where rolname=current_user) as can_create_database")).rows[0],historyCount:history.length,pending:names.filter(n=>!applied.some(h=>h.migration_name===n)),unfinished:history.filter(h=>!h.finished_at&&!h.rolled_back_at),mismatches,columns:(await c.query("select table_name,column_name from information_schema.columns where table_schema='public' and ((table_name='files' and column_name='access_policy') or (table_name='file_versions' and column_name in ('content_type','review_status','reviewed_by','reviewed_at','review_reason','restored_from_version_id')) or (table_name='project_folders' and column_name='system_key'))")).rows,relations:(await c.query("select relname,relkind from pg_class where relnamespace='public'::regnamespace and relname in ('project_file_audience_grants','project_warranty_documents','uq_project_folders_system_key','idx_file_versions_review_queue','project_comments_panorama_point_unique_idx','project_comments_panorama_version_point_unique_idx')")).rows,extensions:(await c.query('select name,default_version,installed_version from pg_available_extensions where name in (\'supabase_vault\',\'pgcrypto\',\'uuid-ossp\',\'pg_stat_statements\')')).rows};
 await c.query('rollback');return {result,cookie};
 }finally{await c.end();}
}
if(process.argv[1]?.endsWith('.phase12-runtime.mjs')){try{console.log(JSON.stringify((await inspect()).result,null,2));}catch(e){console.error(JSON.stringify({stopped:true,message:e.message,code:e.code}));process.exitCode=1;}}
