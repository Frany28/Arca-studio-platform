import pg from 'pg';
import {open,environment,selectedUrl} from './.phase12-runtime.mjs';
import {resolveDatabaseConnection} from './src/config/databaseTls.js';
const c=await open('arca_phase12_public_20261120');
try{console.log(JSON.stringify({poolerSettings:(await c.query("select current_setting('lock_timeout') as lock_timeout,current_setting('statement_timeout') as statement_timeout")).rows[0],sessions:(await c.query("select datname,application_name,state,count(*)::int as count from pg_stat_activity where datname in ('postgres','arca_phase12_public_20261120') and usename=current_user group by 1,2,3 order by 1,2,3")).rows}));}finally{await c.end();}
const u=new URL(selectedUrl);const [role,ref]=decodeURIComponent(u.username).split('.');u.hostname=`db.${ref}.supabase.co`;u.username=role;u.port='5432';
const connection=resolveDatabaseConnection({...environment,DATABASE_URL:u.toString()},{local:false});const direct=new pg.Client({connectionString:connection.connectionString,ssl:connection.ssl,connectionTimeoutMillis:5000});
try{await direct.connect();console.log(JSON.stringify({directAvailable:true,identity:(await direct.query('select current_database() as database,pg_backend_pid() as pid')).rows[0]}));}catch(e){console.log(JSON.stringify({directAvailable:false,code:e.code,message:e.message?.replace(/postgresql:\/\/[^\s]+/g,'[redacted]')}));}finally{await direct.end().catch(()=>{});}
