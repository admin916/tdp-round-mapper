// Install the hosted worker schedule using Vault; no secrets in migration files.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {linkedDb} from './linked-db.mjs';
const ref=readFileSync(new URL('../supabase/.temp/project-ref',import.meta.url),'utf8').trim();
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',ref,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const key=keys.find(k=>k.name==='service_role')?.api_key;
if(!key)throw new Error('Worker credentials unavailable');
const db=await linkedDb();
try {
  await db.query('begin');
  await db.query('create extension if not exists pg_cron');
  await db.query('create extension if not exists pg_net with schema extensions');
  for(const [name,value] of [['tdp_course_worker_key',key],['tdp_course_project_url',`https://${ref}.supabase.co`]]) {
    const {rows}=await db.query('select id from vault.secrets where name=$1',[name]);
    if(rows.length)await db.query('select vault.update_secret($1,$2)',[rows[0].id,value]);
    else await db.query('select vault.create_secret($1,$2)',[value,name]);
  }
  await db.query(`create or replace function public.dispatch_course_worker() returns bigint language plpgsql security definer set search_path=public as $$
    declare request_id bigint;
    begin
      if not exists(select 1 from public.course_requests where (status='pending' and next_attempt_at<=now()) or
        (status='building' and coalesce(lease_expires_at,updated_at+interval '10 minutes')<now())) then return null;end if;
      select net.http_post(url:=(select decrypted_secret from vault.decrypted_secrets where name='tdp_course_project_url')||'/functions/v1/course-worker',
        headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='tdp_course_worker_key')),
        body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
      return request_id;
    end $$`);
  await db.query('revoke all on function public.dispatch_course_worker() from public,anon,authenticated');
  await db.query("select cron.schedule('tdp-course-worker','* * * * *','select public.dispatch_course_worker();')");
  await db.query('commit');
  const r=await fetch(`https://${ref}.supabase.co/functions/v1/course-worker`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(130000)});
  if(!r.ok)throw new Error(`Hosted worker check failed (${r.status})`);
  console.log('Hosted worker installed: once per minute, only when jobs are available. Check:',await r.json());
  console.log((await db.query("select jobname,schedule,active from cron.job where jobname='tdp-course-worker'")).rows);
} catch(e){await db.query('rollback');throw e;}finally{await db.end();}
