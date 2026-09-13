// Optional browser smoke test using the existing God's Eye Puppeteer installation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import puppeteer from '../gods-eye-view/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import {buildCourseData,qualityOf} from '../js/course-build.js';
import {selectCourseElements} from '../js/course-selection.js';
const root=resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://test').pathname.replace(/\/$/,'/index.html'));
  if(!path.startsWith(root+'/')) {res.writeHead(403);res.end();return;}
  try{const data=await readFile(path);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(data);}
  catch{res.writeHead(404);res.end();}
});
await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
let browser;
try {
  browser=await puppeteer.launch({headless:true});
  const page=await browser.newPage();await page.setViewport({width:390,height:844});
  let mapped = null, mappingRequest = null;
  const errors=[],builds=[],requests=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
  // Overpass-shaped source for club way 2: nine holes numbered 1-4 and 6-10 (5 is unmapped), each with a green, fairway and bunker.
  const ring=(lat,lon,d)=>[{lat:lat-d,lon:lon-d},{lat:lat+d,lon:lon-d},{lat:lat+d,lon:lon+d},{lat:lat-d,lon:lon+d},{lat:lat-d,lon:lon-d}];
  const osmSource=()=>{
    const out=[{type:'way',id:2,tags:{leisure:'golf_course',name:'Example Golf Club',holes:'9'},geometry:ring(51.3,-.62,.05)}];
    for(const n of [1,2,3,4,6,7,8,9,10]) {
      const lat=51.3+n*.003;
      out.push({type:'way',id:1000+n,tags:{golf:'hole',ref:String(n)},geometry:[{lat:lat-.002,lon:-.62},{lat,lon:-.62}]});
      out.push({type:'way',id:2000+n,tags:{golf:'green'},geometry:ring(lat,-.62,.00008)});
      out.push({type:'way',id:3000+n,tags:{golf:'fairway'},geometry:ring(lat-.001,-.62,.0003)});
      out.push({type:'way',id:4000+n,tags:{golf:'bunker'},geometry:ring(lat-.0005,-.6203,.00005)});
    }
    return out;
  };
  
  await page.setRequestInterception(true);
  const origin=`http://127.0.0.1:${server.address().port}`;
  page.on('request',req=>{
    const url=req.url();
    const respond=(data,status=200)=>req.respond({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},body:JSON.stringify(data)});
    if(req.method()==='OPTIONS') return respond({});
    if(url.startsWith(origin)) return req.continue();
    if(url.includes('photon.komoot.io')) return respond({features:[1,2].map(id=>({geometry:{coordinates:[-.6-id*.01,51.3]},properties:{name:'Example Golf Club',osm_type:'W',osm_id:id,city:id===1?'London':'Other town',countrycode:'gb'}}))});
    if(url.includes('overpass')) {builds.push(decodeURIComponent(req.postData()));return respond({elements:mapped?osmSource():[osmSource()[0]]});}
    if(url.endsWith('/course')) return respond({error:'The map service is busy.'},503);
    if(url.includes('/course_requests') && req.method()==='POST') {requests.push(JSON.parse(req.postData()));mappingRequest={id:1,status:'pending',attempts:0};return respond({});}
    if(url.includes('/course_requests')) return respond(mappingRequest ? [mappingRequest] : []);
    if(url.includes('/courses?') && new URL(url).searchParams.get('select')?.startsWith('geometry')) return respond({geometry:catalogueGeometry()});
    if(url.includes('supabase.co')) return respond([]);
    return req.abort();
  });
  const catalogueGeometry=()=>{const c={provider:'osm',osmType:'way',osmId:2,name:'Example Golf Club',lat:51.3,lon:-.62};const sel=selectCourseElements(osmSource(),c);
    const built=buildCourseData(sel.name,'',sel.elements,null,{expectedHoles:sel.expectedHoles,minHoles:1});built.course.id='osm-way-2';return {...built,quality:qualityOf(built.coverage),identity:c};};
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#authModal:not(.hidden)');await page.click('#btnGuest');
  await page.click('#btnCourses');
  assert.equal(await page.$('#courseFilters'),null,'unused finder controls are removed');
  await page.type('#courseSearch','Example');

  try {await page.waitForSelector('#discoverResults .remote-item',{timeout:18000});} catch(e) {console.error(await page.$eval('#courseList',el=>el.textContent));throw e;}
  assert.equal(await page.$$eval('#discoverResults .remote-item',els=>els.length),2);
  assert.equal(requests.length,0,'typing must not enqueue work');
  await page.click('#discoverResults [data-id="osm-way-2"]');
  await page.waitForSelector('#coursePreview .leaflet-marker-icon');
  assert.equal(await page.$eval('#courseModal .modal-card',el=>el.scrollWidth<=el.clientWidth),true,'course preview actions fit mobile width');
  assert.equal(await page.$('#savePlace'),null,'no misleading location-only save action');
  await page.click('#loadPlace');await page.waitForSelector('#placeStatus button');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tdp.course.places'))[0].osmId),2);
  assert.match(builds[0],/way\(2\)/,'geometry is downloaded for the exact selected club');
  await page.click('#placeStatus button');await page.waitForFunction(()=>document.querySelector('#placeStatus').textContent.includes('submitted'));
  assert.equal(requests[0].candidate.osmId,2);
  await page.waitForFunction(()=>document.querySelector('#requestProgress').textContent.includes('queued'));
  mappingRequest={id:1,status:'building',attempts:1};
  await page.click('#requestProgress button');
  await page.waitForFunction(()=>document.querySelector('#requestProgress').textContent.includes('Checking course geometry'));
  mappingRequest={id:1,status:'failed',attempts:1,error:'Missing greens'};
  await page.click('#requestProgress button');
  await page.waitForFunction(()=>document.querySelector('#requestProgress').textContent.includes('Missing greens'));
  await page.click('#requestProgress button');
  await page.waitForFunction(()=>document.querySelector('#requestProgress').textContent.includes('queued'));
  assert.equal(requests.length,2,'failed requests can be explicitly retried');
  await page.click('#btnCloseCourse');await page.click('#btnCourses');
  assert.ok(await page.$('[data-id="osm-way-2"]'),'unmapped saved course stays discoverable');
  // Load a partial layout and verify navigation uses original refs, not indexes.
  mapped=true;
  await page.click('[data-id="osm-way-2"]');
  try {await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#loadPlace')]);}
  catch(e) {console.error('LOAD FAILED:',await page.$eval('#placeStatus',el=>el.textContent).catch(()=>'(no status)'));throw e;}
  assert.equal(await page.evaluate(()=>window.TDPMap.courseId()),'osm-way-2');
  await page.click('.hole-chip:nth-child(4)');await page.keyboard.press('n');
  assert.equal(await page.evaluate(()=>window.TDPMap.hole().num),6);
  await page.keyboard.press('p');assert.equal(await page.evaluate(()=>window.TDPMap.hole().num),4);
  assert.equal(await page.$('#courseModal:not(.hidden)'),null,'opening a map exits the finder');
  assert.equal(await page.$$('.course-hole-marker').then(els=>els.length),9,'all mapped holes appear on the main map');
  assert.match(await page.$eval('#mapCoverage',el=>el.textContent),/fairways.*bunkers/);
  const savedGeometry=await page.evaluate(()=>JSON.parse(localStorage.getItem('tdp.course.data.osm-way-2')));
  assert.ok(savedGeometry.overlays.fairway.length && savedGeometry.overlays.bunker.length,'terrain is saved with the course');
  const renderedTerrain=await page.evaluate(()=>{const count={fairway:0,bunker:0};window.TDPMap.leaflet().eachLayer(l=>{if(l.options?.fillColor==='#3f9e5f')count.fairway++;if(l.options?.fillColor==='#e8d9a8')count.bunker++;});return count;});
  assert.equal(renderedTerrain.fairway,savedGeometry.overlays.fairway.length,'fairways are drawn on the main map');
  assert.equal(renderedTerrain.bunker,savedGeometry.overlays.bunker.length,'bunkers are drawn on the main map');
  await Promise.all([page.evaluate(()=>new Promise(r=>window.TDPMap.leaflet().once('moveend',()=>r(true)))),page.click('#btnCourse')]);
  assert.ok(await page.evaluate(()=>document.querySelector('#mapCoverage').getBoundingClientRect().bottom < document.querySelector('#panel').getBoundingClientRect().top),'course name and coverage sit above the mobile shot panel');
  if(process.argv.includes('--screenshots')){await mkdir(resolve(root,'build/course-finder-ui'),{recursive:true});await page.screenshot({path:resolve(root,'build/course-finder-ui/map.png')});}

  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(await page.evaluate(()=>window.TDPMap.courseId()),'osm-way-2','active map survives reopening');
  await page.click('#btnCourses');
  assert.equal(await page.$eval('#courseList .course-item',el=>el.dataset.id),'osm-way-2','saved maps appear first');
  assert.equal(await page.$eval('#courseModal .modal-card',el=>el.scrollWidth<=el.clientWidth),true,'finder fits the mobile screen');
  if(process.argv.includes('--screenshots'))await page.screenshot({path:resolve(root,'build/course-finder-ui/finder.png')});
  assert.equal(await page.$('.remote-item[data-id="osm-way-2"]'),null,'mapped courses are not duplicated as pending locations');
  await page.click('#courseList .course-item[data-id="osm-way-2"]');
  assert.equal(await page.$('#courseModal:not(.hidden)'),null);
  // A different saved location can load a completed request from the catalogue.
  await page.evaluate(()=>{const places=JSON.parse(localStorage.getItem('tdp.course.places'));places.push({...places[0],id:'osm-way-3',osmId:3});localStorage.setItem('tdp.course.places',JSON.stringify(places));});
  mappingRequest={id:1,status:'done',course_id:'osm-way-2',attempts:1};
  await page.click('#btnCourses');await page.click('.remote-item[data-id="osm-way-3"]');
  await page.waitForFunction(()=>document.querySelector('#requestProgress').textContent.includes('Save & open completed map'));
  const buildCount=builds.length;
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#requestProgress button')]);
  assert.equal(builds.length,buildCount,'completed maps load from the catalogue without another build');
  assert.deepEqual(errors,[]);
  console.log('PASS: persistent map geometry, saved map ordering, all-hole overview, removed filters, mobile finder, exact identity, saved courses, queued/building/failed/completed progress, explicit retry, catalogue completion, original hole navigation.');
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
