import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/course-finder.js';
import {buildCourseData,qualityOf} from '../supabase/functions/_shared/course-build.js';
import {validateCandidate,queryForCandidate,selectCourseElements} from '../supabase/functions/_shared/course-selection.js';
const CF=globalThis.TDPCourseFinder;
const candidate={provider:'osm',osmType:'way',osmId:123,name:'Same Name',lat:51,lon:0};
const ring=(lat,lon,d)=>[{lat:lat-d,lon:lon-d},{lat:lat+d,lon:lon-d},{lat:lat+d,lon:lon+d},{lat:lat-d,lon:lon+d},{lat:lat-d,lon:lon-d}];
function fixture(count=9,missing=0) {
  const out=[{type:'way',id:123,tags:{leisure:'golf_course',name:'Same Name',holes:String(count)},geometry:ring(51,0,.1)}];
  for(let n=1;n<=count;n++) {
    const lat=51+n*.003;
    out.push({type:'way',id:1000+n,tags:{golf:'hole',ref:String(n)},geometry:[{lat:lat-.001,lon:0},{lat,lon:0}]});
    if(n!==missing) out.push({type:'way',id:2000+n,tags:{golf:'green'},geometry:ring(lat,0,.00004)});
  }
  return out;
}
test('search preserves separate same-name clubs and OSM identity', async()=>{
  const features=[1,2].map(id=>({geometry:{coordinates:[id,51]},properties:{name:'Same Name',osm_type:'W',osm_id:id,countrycode:'gb'}}));
  const rows=await CF.search('Same Name',{fetcher:async()=>({ok:true,json:async()=>({features})})});
  assert.equal(rows.length,2);assert.equal(rows[1].id,'osm-way-2');assert.equal(rows[1].lon,2);
});
test('provider failure is not misreported as zero results',async()=>{
  await assert.rejects(CF.search('golf',{fetcher:async()=>({ok:false,status:503})}),/unavailable/);
});
test('invalid coordinates and injected OSM types cannot enter a query',()=>{
  assert.throws(()=>validateCandidate({...candidate,lat:null}));
  assert.throws(()=>queryForCandidate({...candidate,osmType:'way;out;'}));
  assert.match(queryForCandidate(candidate),/way\(123\)/);
});
test('course boundary excludes neighbouring holes',()=>{
  const data=fixture();data.push({tags:{golf:'hole',ref:'1'},geometry:ring(52,0,.001)});
  assert.equal(selectCourseElements(data,candidate).elements.filter(e=>e.tags.golf==='hole').length,9);
});
test('multi-layout club requires explicit choice',()=>{
  const data=fixture();data[1].tags['golf:course:name']='Old';data[3].tags['golf:course:name']='New';
  assert.throws(()=>selectCourseElements(data,candidate),e=>e.layouts.length===2);
  const selected=selectCourseElements(data,{...candidate,layout:'Old'});
  assert.equal(selected.elements.filter(e=>e.tags.golf==='hole').length,1);
  assert.match(selected.id,/layout-Old/);
});
test('duplicate refs are rejected before truncation',()=>{
  const data=fixture(18);data.push({...data[1],id:999});
  assert.throws(()=>buildCourseData('Test','',data,null),/Ambiguous/);
});
test('missing green preserves original hole and scorecard association',()=>{
  const b=buildCourseData('Test','',fixture(10,5),{holes:[{num:6,par:5}]});
  assert.equal(b.holes[4].num,6);assert.equal(b.holes[4].par,5);
  assert.deepEqual(b.coverage.missingGreens,[5]);assert.equal(CF.mappingError(b),null);
});
test('nine observed holes alone are not full coverage',()=>{
  const b=buildCourseData('Test','',fixture(),null);
  assert.equal(qualityOf(b.coverage),'partial');
  assert.equal(qualityOf({...b.coverage,expectedHoles:9}),'full');
  assert.equal(qualityOf({...b.coverage,expectedHoles:18}),'partial');
});
test('eighteen consecutive mapped holes establish an 18-hole layout without an outline tag',()=>{
  const data=fixture(18);delete data[0].tags.holes;
  const b=buildCourseData('Test','',data,null,{expectedHoles:null,minHoles:1});
  assert.equal(b.coverage.expectedHoles,18);assert.equal(qualityOf(b.coverage),'full');
  const nine=fixture();delete nine[0].tags.holes;
  assert.equal(buildCourseData('Test','',nine,null,{expectedHoles:null,minHoles:1}).coverage.expectedHoles,null);
});
test('holes start from the furthest-back mapped tee until a card picks a set',()=>{
  const data=fixture();
  for(let n=1;n<=9;n++) {
    const lat=51+n*.003;   // hole n runs from lat-.001 (line start) north to lat
    data.push({type:'way',id:5000+n,tags:{golf:'tee',name:'White'},geometry:ring(lat-.001,0,.00003)});           // at the line start
    data.push({type:'way',id:6000+n,tags:{golf:'tee',name:'Championship'},geometry:ring(lat-.0013,0,.00003)});   // ~33 m further back
  }
  const b=buildCourseData('Test','',data,null,{expectedHoles:9,minHoles:1});
  const h=b.holes[0];
  assert.equal(h.teeSource,'osm-back-tee');assert.equal(h.teeName,'Championship');
  assert.ok(Math.abs(h.tee[0]-(51.003-.0013))<2e-5,'tee moved to the back box');
  assert.ok(h.metres>=140&&h.metres<=150,`playing length measured from the back tee (${h.metres})`);
  assert.equal(h.tees.length,2);assert.equal(h.tees[0].name,'Championship');assert.equal(h.tees[1].name,'White');
  assert.equal(b.course.teeSet,'Back');assert.equal(b.coverage.holesWithBackTee,9);assert.equal(b.coverage.teeSelection,'back');
});
test('legacy catalogue corruption is rejected on load',()=>{
  const b=buildCourseData('Test','',fixture(),null);
  b.holes[1].osmRef=1;
  assert.match(CF.mappingError(b),/inconsistent/);
});
test('relation boundary joins reversed fragments and respects inner rings',()=>{
  const outer=ring(51,0,.1),hole=ring(51.003,0,.0005);
  const data=fixture();data[0]={...data[0],type:'relation',members:[
    {role:'outer',geometry:outer.slice(0,3)}, {role:'outer',geometry:[...outer.slice(2)].reverse()},
    {role:'inner',geometry:hole}],geometry:undefined};
  const selected=selectCourseElements(data,{...candidate,osmType:'relation'});
  assert.equal(selected.elements.some(e=>e.id===2001),false);
});
test('names are escaped for finder rendering',()=>{
  assert.equal(CF.escape('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});

let handler;
globalThis.Deno={serve:fn=>{handler=fn;}};
await import('../supabase/functions/course/index.ts');
test('course endpoint rejects name-only guessing',async()=>{
  const response=await handler(new Request('http://test/course',{method:'POST',body:JSON.stringify({name:'Same Name'})}));
  assert.equal(response.status,400);
});
test('course endpoint builds exact selected ID without a model call',async()=>{
  const original=globalThis.fetch;const requests=[];
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return Response.json({elements:fixture()});};
  try {
    const response=await handler(new Request('http://test/course',{method:'POST',body:JSON.stringify({candidate})}));
    const data=await response.json();assert.equal(response.status,200);assert.equal(data.course.id,'osm-way-123');
    assert.equal(data.holes.length,9);assert.equal(requests.length,1);assert.match(requests[0].url,/overpass/);
  } finally {globalThis.fetch=original;}
});
