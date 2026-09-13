// Administrative scripts only. Uses the CLI's temporary database login; never
// stores or logs a password. Optional dependency: pg in build/db-test.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import pg from '../build/db-test/node_modules/pg/lib/index.js';
export async function linkedDb() {
  const script=execFileSync('supabase',['db','dump','--linked','--dry-run'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const vars={};
  for(const [,name,value] of script.matchAll(/^export (PG[A-Z]+)="([^"]*)"/gm)) vars[name]=value;
  if(!vars.PGPASSWORD) throw new Error('Supabase did not supply a temporary database login.');
  const client=new pg.Client({host:vars.PGHOST,port:Number(vars.PGPORT),user:vars.PGUSER,password:vars.PGPASSWORD,
    database:vars.PGDATABASE,ssl:{rejectUnauthorized:true,ca:readFileSync(new URL('../build/db-test/supabase-ca.crt',import.meta.url),'utf8')},connectionTimeoutMillis:15000});
  await client.connect();await client.query('set role postgres');return client;
}
