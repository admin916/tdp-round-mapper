import { readFileSync, writeFileSync } from "node:fs";
const SD = process.argv[2];
const osm = JSON.parse(readFileSync(`${SD}/went_all.json`,"utf8")).elements;
const c = JSON.parse(readFileSync("data/course-wentworth.js","utf8").replace(/^[^=]*=\s*/,"").replace(/;\s*$/,""));
const R=6371000,rad=x=>x*Math.PI/180,deg=x=>x*180/Math.PI;
const hav=(a,b)=>{const dLat=rad(b[0]-a[0]),dLon=rad(b[1]-a[1]);const s=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s));};
const cen=g=>{let a=0,o=0;for(const p of g){a+=p.lat;o+=p.lon;}return[+(a/g.length).toFixed(6),+(o/g.length).toFixed(6)];};
const bearing=(a,b)=>{const y=Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0]));const x=Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));return (deg(Math.atan2(y,x))+360)%360;};
const move=(pt,brg,dM)=>{const mLat=111320,mLon=111320*Math.cos(rad(pt[0]));return [ +(pt[0]+dM*Math.cos(rad(brg))/mLat).toFixed(6), +(pt[1]+dM*Math.sin(rad(brg))/mLon).toFixed(6) ];};
const greens = osm.filter(e=>e.tags&&e.tags.golf==="green"&&e.geometry).map(e=>({c:cen(e.geometry),poly:e.geometry.map(p=>[+p.lat.toFixed(6),+p.lon.toFixed(6)])}));
const pickGreen = t => greens.reduce((b,g)=>hav(g.c,t)<hav(b.c,t)?g:b);
// chosen real greens forming a path 10 -> 15 (NW), with card lengths
const plan = {
  11:{green:[51.392371,-0.601475]},
  12:{green:[51.392215,-0.609895]},
  13:{green:[51.395387,-0.613353]},
  14:{green:[51.396713,-0.611555]},
};
const prevGreen = { 11: c.holes[9].green.centre };  // 10th green
for (const n of [11,12,13,14]) {
  const h = c.holes[n-1];
  const g = pickGreen(plan[n].green);
  const pg = prevGreen[n];
  const brgToPrev = bearing(g.c, pg);           // point tee back toward previous green
  const tee = move(g.c, brgToPrev, h.metres);   // exact card length
  h.tee = tee;
  h.green = { poly: g.poly, centre: g.c, approach: +bearing(tee,g.c).toFixed(1), depth: 26, width: 15, frontOffset: 12 };
  h.line = [tee, g.c];
  prevGreen[n+1] = g.c;
}
// regenerate overlays with the new 11-14
function corridor(line,half){const left=[],right=[];for(let i=0;i<line.length;i++){const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)];const brg=bearing(a,b);left.push(move(line[i],(brg-90+360)%360,half));right.push(move(line[i],(brg+90)%360,half));}const poly=left.concat(right.reverse());poly.push(poly[0]);return poly;}
function teePad(pt,brg){return [move(pt,(brg-90+360)%360,4),move(pt,brg,7),move(pt,(brg+90)%360,4),move(pt,(brg+180)%360,3),move(pt,(brg-90+360)%360,4)];}
const ov={rough:[],fairway:[],tee:[],water:[],bunker:[],green:[]};
for(const h of c.holes){ov.green.push(h.green.poly);const brg=bearing(h.tee,h.green.centre);ov.tee.push(teePad(h.tee,brg));ov.fairway.push(corridor(h.line,h.par===3?11:15));}
c.overlays=ov;
writeFileSync("data/course-wentworth.js","window.TDP_COURSE_WENTWORTH = "+JSON.stringify(c)+";\n");
for(const n of [11,12,13,14]){const h=c.holes[n-1];console.log(`H${n} par${h.par} ${h.metres}m tee=${h.tee} grn=${h.green.centre}`);}
