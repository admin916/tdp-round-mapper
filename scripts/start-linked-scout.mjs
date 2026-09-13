// Local operator convenience: read linked-project credentials through the CLI,
// pass them only to the worker environment, and never write them to logs/files.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const ref=readFileSync(new URL('../supabase/.temp/project-ref',import.meta.url),'utf8').trim();
if (!/^[a-z]{20}$/.test(ref)) throw new Error('Link this repository to the Supabase project first.');
const gev=process.env.GEV_URL || 'http://localhost:4173';
await fetch(gev,{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw new Error('Start the map proxy before the scout.');});
const background=process.argv.includes('--background');
const pidPath=new URL('../build/course-scout.pid',import.meta.url);
if(background) {
  let pid; try {pid=Number(readFileSync(pidPath,'utf8'));} catch {}
  if(pid) {
    let running=false; try {process.kill(pid,0);running=true;} catch {}
    if(running) throw new Error(`A scout process is already recorded at PID ${pid}. Check it before starting another.`);
  }
}
let keys;
try { keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',ref,'--output','json'],
  {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']})); }
catch { throw new Error('Could not read the linked project credentials. Check supabase login.'); }
const key=keys.find(k=>k.name==='service_role')?.api_key;
if(!key) throw new Error('The linked project service-role key is unavailable.');
mkdirSync(new URL('../build/',import.meta.url),{recursive:true});
const log=background?openSync(new URL('../build/course-scout.log',import.meta.url),'a',0o600):null;
const child=spawn(process.execPath,['scripts/course-scout.mjs',...(process.argv.includes('--once')?['--once']:[])],{
  cwd:root,env:{...process.env,SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:key,GEV_URL:gev},
  detached:background,stdio:background?['ignore',log,log]:'inherit',
});
child.on('error',()=>{console.error('Could not start the scout.');process.exitCode=1;});
if(background) {
  closeSync(log);writeFileSync(pidPath,String(child.pid));child.unref();
  console.log(`Course scout started (PID ${child.pid}). Log: build/course-scout.log. Runs while this Mac is awake.`);
} else child.on('exit',code=>{process.exitCode=code ?? 1;});
