#!/usr/bin/env node
// Map explicitly selected course locations through God's Eye's cached proxy.
// Legacy name-only requests are resolved only when the course index has one exact hit.
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import '../js/course-finder.js';
import {buildCourseData,qualityOf} from '../supabase/functions/_shared/course-build.js';
import {validateCandidate,queryForCandidate,selectCourseElements} from '../supabase/functions/_shared/course-selection.js';
import {processRequests} from './course-queue.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
const has=k=>process.argv.includes(k);
const GEV=(arg('--gev',process.env.GEV_URL||'http://localhost:4173')).replace(/\/$/,'');
const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,''), KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers={apikey:KEY,authorization:`Bearer ${KEY}`,'content-type':'application/json'};
const out=join(root,'build','scout'); mkdirSync(out,{recursive:true});
const log=(...a)=>console.error('[scout]',...a);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rest(path,options={}) {
  const r=await fetch(`${URL}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(20000)});
  if(!r.ok) throw new Error(`Catalogue request failed (${r.status})`);
  const t=await r.text();return t?JSON.parse(t):null;
}
export async function scout(name,place,opts={}) {
  let candidate=opts.candidate;
  if(!candidate) {
    const hits=await globalThis.TDPCourseFinder.search([name,place].filter(Boolean).join(', '),{signal:AbortSignal.timeout(12000)});
    const exact=hits.filter(c=>c.name.toLowerCase()===name.toLowerCase());
    if(exact.length!==1) throw new Error('Select the exact course and layout in the course finder.');
    candidate=exact[0];
  }
  candidate=validateCandidate(candidate);
  const r=await fetch(`${GEV}/api/overpass`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:'data='+encodeURIComponent(queryForCandidate(candidate)),signal:AbortSignal.timeout(90000)});
  if(!r.ok) throw new Error(`Map service unavailable (${r.status})`);
  const data=await r.json();
  if(!Array.isArray(data.elements)||data.remark) throw new Error('Incomplete map service response; try again.');
  let selected, built;
  try {
    selected=selectCourseElements(data.elements,candidate);
    built=buildCourseData(selected.name,candidate.loc||place||'',selected.elements,null,{expectedHoles:selected.expectedHoles});
    const invalid=globalThis.TDPCourseFinder.mappingError(built);
    if(invalid) throw new Error(invalid);
  } catch(e) { e.retryable=false; throw e; }
  built.course.id=selected.id;
  const row={id:selected.id,name:selected.name,location:built.course.location,geometry:{...built,identity:candidate},
    source:'osm',quality:qualityOf(built.coverage),coverage:built.coverage,country:candidate.country||null,osm_id:candidate.osmId};
  writeFileSync(join(out,`${encodeURIComponent(row.id)}.json`),JSON.stringify(row));
  return row;
}
async function save(row) {
  const existing=await rest(`courses?select=id,source&id=eq.${encodeURIComponent(row.id)}`);
  if(existing?.some(c=>['built-in','user'].includes(c.source))) return;
  await rest('courses?on_conflict=id',{method:'POST',headers:{prefer:'resolution=merge-duplicates'},body:JSON.stringify([row])});
}
async function pollOnce() {
  await processRequests({rest,scout,log});
}
if(arg('--name')) {
  const row=await scout(arg('--name'),arg('--place',''));
  if(has('--save')) {if(!KEY||!URL) throw new Error('Saving requires Supabase worker credentials');await save(row);}
  log(row.name,row.quality,row.geometry.holes.length);
} else {
  if(!KEY||!URL) throw new Error('Queue mode requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  let ready=false;
  do {try {await pollOnce();if(!ready){log('Queue connected; waiting for mapping requests.');ready=true;}} catch(e) {log(e.message);if(has('--once'))process.exitCode=1;}
    if(has('--once'))break;await sleep(Number(arg('--interval',15))*1000);} while(true);
}
