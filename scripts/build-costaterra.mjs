// Build CostaTerra (Melides, Portugal) from OSM hole-lines + the authoritative
// Black-tee scorecard (par + length sequence). Single course, so the routing is
// reconstructed by matching each OSM hole-line to its card hole via length +
// green->next-tee continuity, seeded/scored so the par-3/par-5 sequence lines up.
import { readFileSync, writeFileSync } from "node:fs";
const SD = process.argv[2];
const els = JSON.parse(readFileSync(`${SD}/ct3.json`,"utf8")).elements;
const R=6371000, rad=x=>x*Math.PI/180, deg=x=>x*180/Math.PI;
const hav=(a,b)=>{const dLat=rad(b[0]-a[0]),dLon=rad(b[1]-a[1]);const s=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s));};
const bearing=(a,b)=>{const y=Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0]));const x=Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));return (deg(Math.atan2(y,x))+360)%360;};
const move=(pt,brg,dM)=>{const mLat=111320,mLon=111320*Math.cos(rad(pt[0]));return [ +(pt[0]+dM*Math.cos(rad(brg))/mLat).toFixed(6), +(pt[1]+dM*Math.sin(rad(brg))/mLon).toFixed(6) ];};

// authoritative Black-tee card (metres)
const cardPar=[4,4,4,3,4,5,4,3,5, 4,4,5,4,4,3,5,3,4];
const cardLen=[351,477,441,163,443,530,304,192,507, 339,418,565,382,330,213,502,212,455];

const lines = els.filter(e=>e.tags&&e.tags.golf==="hole"&&e.geometry)
  .map((e,i)=>{const g=e.geometry.map(p=>[+p.lat.toFixed(6),+p.lon.toFixed(6)]);return {i, g, a:g[0], b:g[g.length-1], len:hav(g[0],g[g.length-1])};});

// measured type of a line (soft): 3 if short, 5 if long, else 4 — used to reject gross mismatches
const mtype = L => L.len<250?3 : L.len>470?5 : 4;
// a line may occupy a card position if the par types are "compatible" (allow long par4<->measured5)
function compatible(L, pos){ const cp=cardPar[pos]; const mt=mtype(L);
  if(cp===3) return L.len<260;             // par 3 card hole -> short line only
  if(cp===5) return L.len>430;             // par 5 card hole -> long line only
  return L.len<=490;                        // par 4 card hole -> up to ~490 (long par 4s exist)
}

// greedy walk from a seed line+orientation; score = continuity gap + 0.7*|len-cardLen|
function walk(startIdx, startRev){
  const used=new Set([startIdx]);
  let cur = startRev ? lines[startIdx].a : lines[startIdx].b;
  const order=[{idx:startIdx, rev:startRev}];
  let cost = 0.7*Math.abs(lines[startIdx].len - cardLen[0]);
  if(!compatible(lines[startIdx],0)) cost += 500;
  for(let pos=1; pos<18; pos++){
    let best=-1,bd=1e18,brev=false;
    for(const l of lines){ if(used.has(l.i)) continue;
      for(const [tee,green,rev] of [[l.a,l.b,false],[l.b,l.a,true]]){
        let c = hav(cur,tee) + 0.7*Math.abs(l.len - cardLen[pos]);
        if(!compatible(l,pos)) c += 500;
        if(c<bd){bd=c;best=l.i;brev=rev;}
      }
    }
    used.add(best); cost+=bd; order.push({idx:best, rev:brev});
    cur = brev ? lines[best].a : lines[best].b;
  }
  return {order, cost};
}
let bestChain=null;
for(let s=0;s<lines.length;s++) for(const rev of [false,true]){ const w=walk(s,rev); if(!bestChain||w.cost<bestChain.cost) bestChain=w; }

const ordered = bestChain.order.map((o,pos)=>{ const l=lines[o.idx]; const g=o.rev? [...l.g].reverse() : l.g; return {pos, line:g, tee:g[0], green:g[g.length-1], len:Math.round(hav(g[0],g[g.length-1]))}; });

function ovalGreen(centre,appBrg,depth,width){const pts=[],n=26;for(let i=0;i<n;i++){const a=2*Math.PI*i/n;const ex=Math.cos(a)*width/2,ey=Math.sin(a)*depth/2;const rx=ex*Math.cos(rad(appBrg))-ey*Math.sin(rad(appBrg)),ry=ex*Math.sin(rad(appBrg))+ey*Math.cos(rad(appBrg));const mLat=111320,mLon=111320*Math.cos(rad(centre[0]));pts.push([+(centre[0]+ry/mLat).toFixed(6),+(centre[1]+rx/mLon).toFixed(6)]);}pts.push(pts[0]);return pts;}
function corridor(line,half){const left=[],right=[];for(let i=0;i<line.length;i++){const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)];const brg=bearing(a,b);left.push(move(line[i],(brg-90+360)%360,half));right.push(move(line[i],(brg+90)%360,half));}const poly=left.concat(right.reverse());poly.push(poly[0]);return poly;}
function teePad(pt,brg){return [move(pt,(brg-90+360)%360,4),move(pt,brg,7),move(pt,(brg+90)%360,4),move(pt,(brg+180)%360,3),move(pt,(brg-90+360)%360,4)];}

// stroke index: provisional (rank par4/5 by length hardest first, par3s later) — refine from card if provided
const holes=[]; const ov={rough:[],fairway:[],tee:[],water:[],bunker:[],green:[]};
ordered.forEach(h=>{
  const num=h.pos+1, par=cardPar[h.pos], metres=cardLen[h.pos]; // display card metres (authoritative)
  const appBrg=+bearing(h.line[h.line.length-2]||h.tee, h.green).toFixed(1);
  const depth=par===3?24:28, width=15;
  const poly=ovalGreen(h.green, appBrg, depth, width);
  holes.push({num,par,si:num,metres,pin:{front:14,side:"C"},line:h.line,tee:h.tee,green:{poly,centre:h.green,approach:appBrg,depth,width,frontOffset:12}, _osmLen:h.len});
  ov.green.push(poly); ov.tee.push(teePad(h.tee,bearing(h.tee,h.green))); ov.fairway.push(corridor(h.line, par===3?11:16));
});
const rank=[...holes].sort((a,b)=>b.metres-a.metres); rank.forEach((h,i)=>{h.si=i+1;});
holes.forEach(h=>delete h._osmLen);

const course={course:{name:"CostaTerra Golf & Ocean Club",location:"Melides, Comporta, Portugal",lat:38.1905,lon:-8.7665,teeSet:"Black",units:"metres",par:72,totalMetres:6824,slope:140,rating:74.0},holes,overlays:ov};
writeFileSync("data/course-costaterra.js","window.TDP_COURSE_COSTATERRA = "+JSON.stringify(course)+";\n");
console.log("Built CostaTerra. par 72, 6824m card. reconstruction cost:",Math.round(bestChain.cost));
ordered.forEach(h=>console.log(`H${String(h.pos+1).padStart(2)} par${cardPar[h.pos]} card${cardLen[h.pos]}m osmLine${h.len}m`));
