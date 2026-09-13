// Rebuild Wentworth West from BlueGolf's authoritative West-Course coordinates.
// Routing (tee/dogleg/green) = BlueGolf (West-specific, exact).
// Green shapes = nearest OSM green polygon (real outline), oval fallback.
// Par / stroke index / yardage = championship BMW PGA scorecard (par 72, 7,267y).
import { readFileSync, writeFileSync } from "node:fs";
const SD = process.argv[2];
const osm = JSON.parse(readFileSync(`${SD}/went_all.json`,"utf8")).elements;

// [n, teeLat,teeLng, dogLat,dogLng, greenLat,greenLng, frontLat,frontLng, backLat,backLng]
const BG = [
[1,51.399955,-0.590231,51.400349,-0.593878,51.400596,-0.596391,51.400587,-0.596215,51.400599,-0.596542],
[2,51.400601,-0.596786,51.39998,-0.596667,51.399346,-0.596566,51.399452,-0.596555,51.399239,-0.596641],
[3,51.399631,-0.597022,51.398394,-0.600345,51.397836,-0.602397,51.397906,-0.602211,51.3978,-0.602574],
[4,51.397459,-0.602741,51.395019,-0.604448,51.393202,-0.603714,51.393311,-0.603846,51.39306,-0.603709],
[5,51.393037,-0.6028,51.392306,-0.603501,51.391574,-0.604202,51.391755,-0.604079,51.391447,-0.604326],
[6,51.391213,-0.603679,51.391574,-0.606961,51.391936,-0.608236,51.391884,-0.608038,51.391999,-0.608411],
[7,51.392436,-0.608623,51.390411,-0.608914,51.389337,-0.609924,51.389421,-0.609748,51.389269,-0.610091],
[8,51.389224,-0.611042,51.388371,-0.608083,51.388141,-0.606105,51.38812,-0.606366,51.38818,-0.605843],
[9,51.387551,-0.60692,51.388038,-0.610072,51.388439,-0.612528,51.388432,-0.612303,51.388454,-0.612721],
[10,51.388644,-0.61377,51.388895,-0.612606,51.389147,-0.611442,51.389177,-0.611739,51.3891,-0.611257],
[11,51.389345,-0.610857,51.391,-0.609655,51.392233,-0.609881,51.392138,-0.609747,51.392276,-0.610063],
[12,51.392448,-0.610063,51.392992,-0.614529,51.392558,-0.616613,51.392603,-0.616436,51.392534,-0.61681],
[13,51.39254,-0.617305,51.394123,-0.61443,51.395398,-0.613369,51.395273,-0.613381,51.395512,-0.613364],
[14,51.395819,-0.613373,51.396265,-0.612441,51.396721,-0.611537,51.396659,-0.61171,51.396782,-0.611406],
[15,51.396711,-0.611135,51.398429,-0.608366,51.399324,-0.606144,51.399259,-0.60635,51.399411,-0.606033],
[16,51.399592,-0.607089,51.400352,-0.604724,51.40139,-0.603278,51.401324,-0.603433,51.401462,-0.603099],
[17,51.401428,-0.602856,51.401952,-0.598314,51.403628,-0.596121,51.403512,-0.59625,51.403739,-0.596067],
[18,51.404195,-0.594935,51.403371,-0.591274,51.401298,-0.590278,51.401431,-0.590419,51.401196,-0.590142],
];

// championship BMW PGA card
const cardPar=[4,3,4,5,3,4,4,4,4,3,4,5,4,3,4,4,5,5];
const cardYds=[473,154,459,552,203,418,396,400,449,184,408,520,470,174,491,383,610,523];
const cardSI =[5,17,7,11,15,9,13,3,1,18,10,8,2,16,4,14,6,12];

const R=6371000, rad=x=>x*Math.PI/180, deg=x=>x*180/Math.PI;
const hav=(a,b)=>{const dLat=rad(b[0]-a[0]),dLon=rad(b[1]-a[1]);const s=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s));};
const bearing=(a,b)=>{const y=Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0]));const x=Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));return (deg(Math.atan2(y,x))+360)%360;};
const move=(pt,brg,dM)=>{const mLat=111320,mLon=111320*Math.cos(rad(pt[0]));return [ +(pt[0]+dM*Math.cos(rad(brg))/mLat).toFixed(6), +(pt[1]+dM*Math.sin(rad(brg))/mLon).toFixed(6) ];};
const cen=g=>{let a=0,o=0;for(const p of g){a+=p[0];o+=p[1];}return[+(a/g.length).toFixed(6),+(o/g.length).toFixed(6)];};

const osmGreens = osm.filter(e=>e.tags&&e.tags.golf==="green"&&e.geometry).map(e=>{const poly=e.geometry.map(p=>[+p.lat.toFixed(6),+p.lon.toFixed(6)]);return {poly, c:cen(poly)};});
function greenFor(centre, front, back){
  // nearest OSM green polygon within 45m -> real shape
  let best=null,bd=1e9; for(const g of osmGreens){const d=hav(g.c,centre); if(d<bd){bd=d;best=g;}}
  if(best && bd<45) return {poly:best.poly, centre:best.c};
  // fallback: oval oriented along front->back
  const brg=bearing(front,back), depth=Math.max(20,hav(front,back)), width=depth*0.6;
  const pts=[]; const n=26; for(let i=0;i<n;i++){const a=2*Math.PI*i/n;const ex=Math.cos(a)*width/2,ey=Math.sin(a)*depth/2;const rx=ex*Math.cos(rad(brg))-ey*Math.sin(rad(brg)),ry=ex*Math.sin(rad(brg))+ey*Math.cos(rad(brg));const mLat=111320,mLon=111320*Math.cos(rad(centre[0]));pts.push([+(centre[0]+ry/mLat).toFixed(6),+(centre[1]+rx/mLon).toFixed(6)]);} pts.push(pts[0]);
  return {poly:pts, centre};
}
function corridor(line,half){const left=[],right=[];for(let i=0;i<line.length;i++){const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)];const brg=bearing(a,b);left.push(move(line[i],(brg-90+360)%360,half));right.push(move(line[i],(brg+90)%360,half));}const poly=left.concat(right.reverse());poly.push(poly[0]);return poly;}
function teePad(pt,brg){return [move(pt,(brg-90+360)%360,4),move(pt,brg,7),move(pt,(brg+90)%360,4),move(pt,(brg+180)%360,3),move(pt,(brg-90+360)%360,4)];}

const holes=[]; const ov={rough:[],fairway:[],tee:[],water:[],bunker:[],green:[]};
for(const r of BG){
  const n=r[0], tee=[r[1],r[2]], dog=[r[3],r[4]], green=[r[5],r[6]], front=[r[7],r[8]], back=[r[9],r[10]];
  const par=cardPar[n-1], yds=cardYds[n-1], si=cardSI[n-1], metres=Math.round(yds*0.9144);
  const g=greenFor(green, front, back);
  // line: tee -> dogleg -> green centre (drop dogleg if ~straight)
  const straight = Math.abs(((bearing(tee,dog)-bearing(dog,green.centre? green.centre:green)+540)%360)-180) < 12;
  const line = (par===3 || straight) ? [tee, g.centre] : [tee, dog, g.centre];
  const appBrg=+bearing(line[line.length-2], g.centre).toFixed(1);
  const green_out={poly:g.poly, centre:g.centre, approach:appBrg, depth:26, width:16, frontOffset:12};
  holes.push({num:n,par,si,metres,pin:{front:15,side:"C"},line,tee,green:green_out});
  ov.green.push(g.poly); ov.tee.push(teePad(tee,bearing(tee,g.centre))); ov.fairway.push(corridor(line, par===3?11:16));
}
const totalMetres=holes.reduce((a,h)=>a+h.metres,0);
const course={course:{name:"Wentworth Club — West Course",location:"Virginia Water, Surrey, England",lat:51.3958,lon:-0.6035,teeSet:"Championship",units:"metres",par:72,totalMetres,slope:155,rating:76.0},holes,overlays:ov};
writeFileSync("data/course-wentworth.js","window.TDP_COURSE_WENTWORTH = "+JSON.stringify(course)+";\n");
console.log("Rebuilt Wentworth from BlueGolf. par",course.course.par,"totalMetres",totalMetres,"(=",Math.round(totalMetres*1.09361),"yds)");
holes.forEach(h=>console.log(`H${String(h.num).padStart(2)} par${h.par} ${h.metres}m line-pts:${h.line.length} greenPts:${h.green.poly.length}`));
