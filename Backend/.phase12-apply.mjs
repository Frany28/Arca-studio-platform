import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {open,hash,inspect,vercel,projectId,suffix,deployment,environment,selectedUrl,target} from './.phase12-runtime.mjs';
import {root,save,run,pending,check,compare,prisma,configureScopedLimits,restoreScopedLimits,recycleIdleMigrationConnections} from './.phase12-maintenance.mjs';
import {assertStage,publicClone} from './.phase12-public.mjs';

const read=file=>JSON.parse(fs.readFileSync(path.join(root,file)));
const origin='https://arca-studio-platform.netlify.app';
function assertBackup(){assert.equal(hash(fs.readFileSync(path.join(root,'database.dump'))),read('backup.json').sha256);}
async function publicApi(cookie) {
 const results=[];
 for(const route of ['/api/health/database','/api/projects','/api/admin/files/metrics','/api/admin/files/items','/api/admin/files/tree']) {
  const response=await fetch(origin+route,{headers:{Cookie:cookie}});const body=await response.json();
  results.push({route,status:response.status,code:body.code,keys:Object.keys(body),body});
 }
 return results;
}
async function pause() {
 const project=await vercel(`/v9/projects/${projectId}${suffix}`);assert(!project.paused,'Project already paused outside this operation');
 await vercel(`/v1/projects/${projectId}/pause${suffix}`,'POST');save('maintenance-state.json',{paused:true,projectId,createdAt:new Date().toISOString()});
 const response=await fetch('https://sistema-web-arca-studio.vercel.app/api/health');const body=await response.text();assert.equal(response.status,503);assert(body.includes('DEPLOYMENT_PAUSED')||response.headers.get('x-vercel-error')==='DEPLOYMENT_PAUSED','Maintenance pause not verified');
 console.log(JSON.stringify({maintenancePaused:true,status:response.status}));
}
async function resume() {
 await vercel(`/v1/projects/${projectId}/unpause${suffix}`,'POST');save('maintenance-state.json',{paused:false,projectId,resumedAt:new Date().toISOString()});console.log(JSON.stringify({maintenancePaused:false}));
}
async function apply() {
 assertBackup();assert(read('public-rehearsal-verified.json').allChecksPassed);assert(read('public-restore-verified.json').allDataMatch);
 const {result,cookie}=await inspect();assert.deepEqual(result.pending,pending);assert.equal(result.unfinished.length,0);assert.equal(result.mismatches.length,0);save('target-revalidated.json',result);
 const before=await publicApi(cookie);save('http-before.json',before);console.log(JSON.stringify({before:before.map(({route,status,code})=>({route,status,code})),deployment:result.deployment,target,precedence:result.precedence}));
 await pause();
 await configureScopedLimits('postgres');
 await recycleIdleMigrationConnections('postgres');
 // La pausa detiene nuevas entradas; el preflight verifica que ya no haya transacciones abiertas.
 for(let i=0;i<pending.length;i++) {
  assertBackup();const alias=await vercel(`/v13/deployments/sistema-web-arca-studio.vercel.app${suffix}`);assert.equal(alias.id,deployment.id,'Deployment changed during maintenance');
  const c=await open();let previous;try{save(`staging-stage-${i+1}-history.json`,await assertStage(c,i));previous=await check(c,pending[i],'preflight','staging');}finally{await c.end();}
  const started=Date.now();await prisma('postgres',i,`staging-${i+1}`);
  const cpost=await open();try{const next=await check(cpost,pending[i],'postcheck','staging');compare(previous,next);const records=(await cpost.query('select checksum from public._prisma_migrations where migration_name=$1 and finished_at is not null and rolled_back_at is null',[pending[i]])).rows;assert.equal(records.length,1);assert.equal(records[0].checksum,hash(fs.readFileSync(`prisma/migrations/${pending[i]}/migration.sql`)));save(`staging-${i+1}-result.json`,{migration:pending[i],checksum:records[0].checksum,elapsedMs:Date.now()-started,allIndicatorsPassed:true,fingerprintsUnchanged:true});console.log(JSON.stringify(read(`staging-${i+1}-result.json`)));}finally{await cpost.end();}
 }
 await prisma('postgres',2,'staging-final','status');save('staging-applied.json',{migrations:pending,checksPassed:true,createdAt:new Date().toISOString()});
 await restoreScopedLimits('postgres');
 await recycleIdleMigrationConnections('postgres');
 await resume();assertBackup();
}
async function after() {
 const {result,cookie}=await inspect();assert.equal(result.pending.length,0);assert.equal(result.unfinished.length,0);assert.equal(result.mismatches.length,0);
 const results=await publicApi(cookie);save('http-after.json',results);save('target-after.json',result);
 console.log(JSON.stringify({target:result.target,historyCount:result.historyCount,pending:result.pending,routes:results.map(({route,status,code,keys,body})=>({route,status,code,keys,counts:Array.isArray(body.items)?body.items.length:Array.isArray(body.projects)?body.projects.length:undefined,metrics:route.endsWith('/metrics')?body:undefined}))}));
 assert(results.every(r=>r.status===200),'HTTP postchecks failed');
}
async function plan() {
 assert(read('staging-applied.json').checksPassed);assertBackup();
 const client=await open();try{const sql=fs.readFileSync('scripts/project-file-compatibility/preflight.sql','utf8').replace(/^\\.*$/gm,'');const rows=(await client.query(sql)).flatMap(r=>r.rows);save('b9-preflight.json',rows);assert(rows.flatMap(Object.entries).filter(([k])=>k.startsWith('ok_')).every(([,v])=>v===true));}finally{await client.end();}
 const envFile=path.join(root,'b9-private.env');fs.writeFileSync(envFile,`DATABASE_URL=${JSON.stringify(selectedUrl.toString())}\nDATABASE_SSL_REJECT_UNAUTHORIZED=true\nDATABASE_SSL_CA_CERT=${JSON.stringify(environment.DATABASE_SSL_CA_CERT)}\n`,{mode:0o600});
 const common=['scripts/project-file-compatibility.mjs','--env-file',envFile];await run('b9-describe',process.execPath,[...common,'--describe-target']);
 const out=await run('b9-plan-command',process.execPath,[...common,'--confirm-database',target,'--plan','--out',path.join(root,'b9-plan.json'),'--report',path.join(root,'b9-report.json')]);
 console.log(out.trim());const report=read('b9-report.json');console.log(JSON.stringify(report));assertBackup();
}
if(process.argv[1]?.endsWith('.phase12-apply.mjs')){try{const mode=process.argv[2];if(mode==='apply')await apply();else if(mode==='after')await after();else if(mode==='plan')await plan();else if(mode==='resume')await resume();else throw new Error('Unknown mode');}catch(e){console.error(JSON.stringify({stopped:true,code:e.code,message:e.message,maintenanceState:fs.existsSync(path.join(root,'maintenance-state.json'))?read('maintenance-state.json'):null}));process.exitCode=1;}}
