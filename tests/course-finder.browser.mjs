// Optional browser smoke test using the existing God's Eye Puppeteer installation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import puppeteer from '../gods-eye-view/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
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
  
  await page.setRequestInterception(true);
  const origin=`http://127.0.0.1:${server.address().port}`;
  page.on('request',req=>{
    const url=req.url();
    const respond=(data,status=200)=>req.respond({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},body:JSON.stringify(data)});
    if(req.method()==='OPTIONS') return respond({});
    if(url.startsWith(origin)) return req.continue();
    if(url.includes('photon.komoot.io')) return respond({features:[1,2].map(id=>({geometry:{coordinates:[-.6-id*.01,51.3]},properties:{name:'Example Golf Club',osm_type:'W',osm_id:id,city:id===1?'London':'Other town',countrycode:'gb'}}))});
    if(url.endsWith('/course')) {builds.push(JSON.parse(req.postData()));if(mapped)return respond({...mapped,identity:builds.at(-1).candidate});return respond({error:'Only 2 holes mapped; course needs mapping review.'},422);}
    if(url.includes('/course_requests') && req.method()==='POST') {requests.push(JSON.parse(req.postData()));mappingRequest={id:1,status:'pending',attempts:0};return respond({});}
    if(url.includes('/course_requests')) return respond(mappingRequest ? [mappingRequest] : []);
    if(url.includes('/courses?') && new URL(url).searchParams.get('select')==='geometry') return respond({geometry:mapped});
    if(url.includes('supabase.co')) return respond([]);
    return req.abort();
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#authModal:not(.hidden)');await page.click('#btnGuest');
  await page.click('#btnCourses');await page.type('#courseSearch','Example');

  try {await page.waitForSelector('#discoverResults .remote-item',{timeout:18000});} catch(e) {console.error(await page.$eval('#courseList',el=>el.textContent));throw e;}
  assert.equal(await page.$$eval('#discoverResults .remote-item',els=>els.length),2);
  assert.equal(requests.length,0,'typing must not enqueue work');
  await page.click('#discoverResults [data-id="osm-way-2"]');
  await page.waitForSelector('#coursePreview .leaflet-marker-icon');
  await page.click('#savePlace');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tdp.course.places'))[0].osmId),2);
  await page.click('#loadPlace');await page.waitForSelector('#placeStatus button');
  assert.equal(builds[0].candidate.osmId,2);assert.equal(builds[0].candidate.lon,-.62);
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
  mapped=await page.evaluate(()=>{
    const data=JSON.parse(JSON.stringify(window.TDP_COURSE));
    data.course.id='osm-way-2';data.course.name='Example Golf Club';
    data.holes=data.holes.filter(h=>[1,2,3,4,6,7,8,9,10].includes(h.num));
    return data;
  });
  await page.click('[data-id="osm-way-2"]');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#loadPlace')]);
  assert.equal(await page.evaluate(()=>window.TDPMap.courseId()),'osm-way-2');
  await page.click('.hole-chip:nth-child(4)');await page.keyboard.press('n');
  assert.equal(await page.evaluate(()=>window.TDPMap.hole().num),6);
  await page.keyboard.press('p');assert.equal(await page.evaluate(()=>window.TDPMap.hole().num),4);
  mappingRequest={id:1,status:'done',course_id:'osm-way-2',attempts:1};
  await page.click('#btnCourses');await page.click('.remote-item[data-id="osm-way-2"]');
  await page.waitForFunction(()=>document.querySelector('#requestProgress').textContent.includes('Load completed map'));
  const buildCount=builds.length;
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#requestProgress button')]);
  assert.equal(builds.length,buildCount,'completed maps load from the catalogue without another build');
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile finder, exact identity, saved courses, queued/building/failed/completed progress, explicit retry, catalogue completion, original hole navigation.');
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
