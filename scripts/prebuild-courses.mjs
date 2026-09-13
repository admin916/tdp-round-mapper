#!/usr/bin/env node
// Exact-identity batch assembly. Extract caches must include real boundaries;
// old bbox-only caches are rejected instead of assigning nearby holes by name.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import '../js/course-finder.js';
import {validateCandidate,selectCourseElements} from '../supabase/functions/_shared/course-selection.js';
import {buildCourseData,qualityOf} from '../supabase/functions/_shared/course-build.js';
import {courseSource} from '../supabase/functions/_shared/course-service.js';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];},has=k=>process.argv.includes(k);
const country=arg('--country','GB').toUpperCase(),out=resolve(arg('--out',`build/prebuild/${country}`));
mkdirSync(out,{recursive:true});
const rows=[],failed=[],limit=Number(arg('--limit',0));
function build(source) {
  const selected=selectCourseElements(source.elements,source.candidate);
  const geometry=buildCourseData(selected.name,source.candidate.loc||'',selected.elements,null,{expectedHoles:selected.expectedHoles,minHoles:1});
  geometry.course.id=selected.id;geometry.identity=source.candidate;geometry.quality=qualityOf(geometry.coverage);
  if(source.tours)geometry.coverage={...geometry.coverage,tours:source.tours,event:source.event};
  return {id:selected.id,name:selected.name,location:geometry.course.location,geometry,source:'osm',quality:geometry.quality,
    coverage:geometry.coverage,osm_id:source.candidate.osmId,country:source.candidate.country||country};
}
if(has('--push-only')) rows.push(...JSON.parse(readFileSync(join(out,'courses-built.json'),'utf8')));
else if(arg('--venues')) {
  for(const venue of JSON.parse(readFileSync(arg('--venues'),'utf8')).venues.slice(0,limit||undefined)) {
    try {
      if(!venue.identity)throw new Error('Select and record an exact OSM identity and layout for this venue. Name-only venue builds are disabled.');
      const candidate=validateCandidate({...venue.identity,name:venue.name,loc:venue.place});
      const source=await courseSource(candidate);
      rows.push(build({candidate,elements:[source.outline,...source.elements],tours:venue.tours,event:venue.event}));
    } catch(e){failed.push({name:venue.name,error:e.message});}
  }
} else {
  const read=name=>{const path=join(out,name+'.json');if(!existsSync(path))throw new Error(`Missing ${path}. Run extract-to-prebuild.mjs for this country first.`);return JSON.parse(readFileSync(path,'utf8'));};
  const courses=read('courses'),elements=[...read('holes'),...read('golfways')];
  for(const outline of courses.slice(0,limit||undefined)) {
    try {
      if(!outline.geometry&&!outline.polygons&&!outline.members)throw new Error('Boundary geometry missing. Re-extract this country; bounding boxes are not course boundaries.');
      if(!outline.tags?.name)continue;
      const b=outline.bounds;
      const candidate=validateCandidate({provider:'osm',osmType:outline.type,osmId:outline.id,name:outline.tags.name,country,
        lat:(b.minlat+b.maxlat)/2,lon:(b.minlon+b.maxlon)/2,loc:country});
      const nearby=elements.filter(e=>e.geometry?.some(p=>p.lat>=b.minlat&&p.lat<=b.maxlat&&p.lon>=b.minlon&&p.lon<=b.maxlon));
      const all=[outline,...nearby];
      try {rows.push(build({candidate,elements:all}));}
      catch(e){if(!e.layouts)throw e;for(const layout of e.layouts)try{rows.push(build({candidate:{...candidate,layout},elements:all}));}catch(err){failed.push({name:candidate.name,layout,error:err.message});}}
    } catch(e){failed.push({name:outline.tags?.name,id:outline.id,error:e.message});}
  }
}
writeFileSync(join(out,'courses-built.json'),JSON.stringify(rows));
writeFileSync(join(out,'report.json'),JSON.stringify({country,built:rows.length,failed,byQuality:rows.reduce((a,r)=>(a[r.quality]=(a[r.quality]||0)+1,a),{})},null,2));
console.log(`${rows.length} exact-identity courses built; ${failed.length} require source refresh or review.`);
if(has('--push')||has('--push-only')) {
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Supabase worker credentials required to publish.');
  for(const row of rows) {
    const c=validateCandidate(row.geometry.identity);
    const expected=c.id+(c.layout?`-layout-${encodeURIComponent(c.layout)}`:'');
    if(row.id!==expected||globalThis.TDPCourseFinder.mappingError(row.geometry))throw new Error(`Refusing an invalid or legacy identity: ${row.id}`);
    const r=await fetch(url+'/rest/v1/rpc/publish_osm_course',{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({p_course:row}),signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error(`Publication failed (${r.status})`);
  }
  console.log(`Published ${rows.length} course packages.`);
}
