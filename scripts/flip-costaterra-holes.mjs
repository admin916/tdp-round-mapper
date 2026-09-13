// Flip tee<->green for holes whose OSM line was oriented backwards.
import { readFileSync, writeFileSync } from "node:fs";
const FLIP = new Set([1,2,4,9,10,11,15,16,17,18]);
const c = JSON.parse(readFileSync("data/course-costaterra.js","utf8").replace(/^[^=]*=\s*/,"").replace(/;\s*$/,""));
const rad=x=>x*Math.PI/180, deg=x=>x*180/Math.PI;
const bearing=(a,b)=>{const y=Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0]));const x=Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));return (deg(Math.atan2(y,x))+360)%360;};
const move=(pt,brg,dM)=>{const mLat=111320,mLon=111320*Math.cos(rad(pt[0]));return [ +(pt[0]+dM*Math.cos(rad(brg))/mLat).toFixed(6), +(pt[1]+dM*Math.sin(rad(brg))/mLon).toFixed(6) ];};
function ovalGreen(centre,appBrg,depth,width){const pts=[],n=26;for(let i=0;i<n;i++){const a=2*Math.PI*i/n;const ex=Math.cos(a)*width/2,ey=Math.sin(a)*depth/2;const rx=ex*Math.cos(rad(appBrg))-ey*Math.sin(rad(appBrg)),ry=ex*Math.sin(rad(appBrg))+ey*Math.cos(rad(appBrg));const mLat=111320,mLon=111320*Math.cos(rad(centre[0]));pts.push([+(centre[0]+ry/mLat).toFixed(6),+(centre[1]+rx/mLon).toFixed(6)]);}pts.push(pts[0]);return pts;}
function corridor(line,half){const left=[],right=[];for(let i=0;i<line.length;i++){const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)];const brg=bearing(a,b);left.push(move(line[i],(brg-90+360)%360,half));right.push(move(line[i],(brg+90)%360,half));}const poly=left.concat(right.reverse());poly.push(poly[0]);return poly;}
function teePad(pt,brg){return [move(pt,(brg-90+360)%360,4),move(pt,brg,7),move(pt,(brg+90)%360,4),move(pt,(brg+180)%360,3),move(pt,(brg-90+360)%360,4)];}

for(const h of c.holes){
  if(!FLIP.has(h.num)) continue;
  h.line = [...h.line].reverse();
  h.tee = h.line[0];
  const gc = h.line[h.line.length-1];
  const appBrg = +bearing(h.line[h.line.length-2]||h.tee, gc).toFixed(1);
  const depth = h.par===3?24:28, width=15;
  h.green.centre = gc;
  h.green.approach = appBrg;
  h.green.poly = ovalGreen(gc, appBrg, depth, width);
}
// regenerate overlays from all 18 (now-corrected) holes
const ov={rough:[],fairway:[],tee:[],water:[],bunker:[],green:[]};
for(const h of c.holes){ ov.green.push(h.green.poly); ov.tee.push(teePad(h.tee,bearing(h.tee,h.green.centre))); ov.fairway.push(corridor(h.line, h.par===3?11:16)); }
c.overlays=ov;
writeFileSync("data/course-costaterra.js","window.TDP_COURSE_COSTATERRA = "+JSON.stringify(c)+";\n");
console.log("Flipped holes:",[...FLIP].sort((a,b)=>a-b).join(","));
for(const h of c.holes){const f=FLIP.has(h.num)?" (flipped)":""; console.log(`H${String(h.num).padStart(2)} par${h.par} tee=${h.tee} grn=${h.green.centre}${f}`);}
