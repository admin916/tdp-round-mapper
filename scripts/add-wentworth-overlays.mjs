import { readFileSync, writeFileSync } from "node:fs";
const f = "data/course-wentworth.js";
const c = JSON.parse(readFileSync(f,"utf8").replace(/^[^=]*=\s*/,"").replace(/;\s*$/,""));
const rad=x=>x*Math.PI/180, deg=x=>x*180/Math.PI;
function bearing(a,b){const y=Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0]));const x=Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));return (deg(Math.atan2(y,x))+360)%360;}
function move(pt,brg,dM){const mLat=111320,mLon=111320*Math.cos(rad(pt[0]));const dy=dM*Math.cos(rad(brg)),dx=dM*Math.sin(rad(brg));return [ +(pt[0]+dy/mLat).toFixed(6), +(pt[1]+dx/mLon).toFixed(6) ];}
function corridor(line,half){
  if(!line||line.length<2) return null;
  const left=[],right=[];
  for(let i=0;i<line.length;i++){
    const a=line[Math.max(0,i-1)], b=line[Math.min(line.length-1,i+1)];
    const brg=bearing(a,b);
    left.push(move(line[i],(brg-90+360)%360,half));
    right.push(move(line[i],(brg+90)%360,half));
  }
  const poly=left.concat(right.reverse()); poly.push(poly[0]); return poly;
}
function teePad(pt,brg){ // small square ~7m
  return [move(pt,(brg-90+360)%360,4),move(pt,brg,7),move(pt,(brg+90)%360,4),move(pt,(brg+180)%360,3),move(pt,(brg-90+360)%360,4)];
}
const overlays={rough:[],fairway:[],tee:[],water:[],bunker:[],green:[]};
for(const h of c.holes){
  if(h.green&&h.green.poly) overlays.green.push(h.green.poly);
  const brg = bearing(h.tee, h.green.centre);
  overlays.tee.push(teePad(h.tee,brg));
  const half = h.par===3?11:15;
  const fc=corridor(h.line&&h.line.length>=2?h.line:[h.tee,h.green.centre], half);
  if(fc) overlays.fairway.push(fc);
}
c.overlays=overlays;
writeFileSync(f,"window.TDP_COURSE_WENTWORTH = "+JSON.stringify(c)+";\n");
console.log("added overlays — greens:",overlays.green.length,"fairways:",overlays.fairway.length,"tees:",overlays.tee.length);
