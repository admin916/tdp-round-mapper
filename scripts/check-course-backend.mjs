// Read-only production contract check. Uses only the application's public key.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../js/supa.js',import.meta.url),'utf8');
const url=source.match(/const SUPABASE_URL = "([^"]+)"/)[1];
const key=source.match(/const SUPABASE_ANON_KEY =\s*"([^"]+)"/)[1];
const headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'};
async function get(path) {
  const r=await fetch(url+'/rest/v1/'+path,{headers,signal:AbortSignal.timeout(20000)});
  assert.equal(r.status,200,`Read contract: ${path}`); return r.json();
}
const courses=await get('courses?select=id,quality,coverage,lat,lon&limit=1000');
assert.ok(courses.length,'Catalogue is readable');
const requests=await get('course_requests?select=id,status,candidate,course_id,error,attempts,updated_at&limit=1000');
const totals={}; for (const r of requests) totals[r.status]=(totals[r.status]||0)+1;
console.log(JSON.stringify({catalogueSample:courses.length,legacyFull:courses.filter(c=>c.quality==='full' && c.coverage?.validationVersion!==2).length,
  missingCoordinates:courses.filter(c=>c.lat==null||c.lon==null).length,requestStatuses:totals},null,2));
for (const body of [{name:'Contract check'},null,{candidate:{provider:'osm'}}]) {
  const r=await fetch(url+'/functions/v1/course',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  assert.equal(r.status,400,'Invalid selection must be rejected without authentication or geocoding');
  assert.ok((await r.json()).error);
}
if (process.argv.includes('--worker')) {
  const r=await fetch(url+'/rest/v1/rpc/claim_course_request',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(20000)});
  assert.ok([401,403].includes(r.status),'Guest cannot claim worker jobs');
  const privateRead=await fetch(url+'/rest/v1/course_requests?select=requested_by&limit=0',{headers,signal:AbortSignal.timeout(20000)});
  assert.ok([401,403].includes(privateRead.status),'Requester account IDs are private');
}
console.log('PASS: live catalogue, request schema and public course function contract'+(process.argv.includes('--worker')?', worker permission boundary.':'.'));
