import sharp from "sharp";
import { readFileSync } from "node:fs";
const SD = process.argv[2], Z = +(process.argv[3]||16);
const osm = JSON.parse(readFileSync(`${SD}/went_all.json`,"utf8")).elements;
const course = JSON.parse(readFileSync("data/course-wentworth.js","utf8").replace(/^[^=]*=\s*/,"").replace(/;\s*$/,""));
const W=256*2**Z, rad=x=>x*Math.PI/180;
const lon2px=l=>(l+180)/360*W, lat2px=l=>(1-Math.log(Math.tan(rad(l))+1/Math.cos(rad(l)))/Math.PI)/2*W;
// bbox: whole West area
const minLat=51.386,maxLat=51.407,minLon=-0.614,maxLon=-0.586;
const x0=Math.floor(lon2px(minLon)/256),x1=Math.floor(lon2px(maxLon)/256);
const y0=Math.floor(lat2px(maxLat)/256),y1=Math.floor(lat2px(minLat)/256);
const cols=x1-x0+1,rows=y1-y0+1,Wpx=cols*256,Hpx=rows*256,ox=x0*256,oy=y0*256;
const tiles=[];
for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){const r=await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`);if(r.ok)tiles.push({input:Buffer.from(await r.arrayBuffer()),left:(tx-x0)*256,top:(ty-y0)*256});}
const px=p=>[lon2px(p[1]?p[1]:p.lon)-ox, lat2px(p[0]?p[0]:p.lat)-oy];
const cen=g=>{let a=0,o=0;for(const p of g){a+=p.lat;o+=p.lon;}return[a/g.length,o/g.length];};
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${Wpx}" height="${Hpx}">`;
// all OSM fairways (yellow) + greens (bright green), so the full routing is visible
for(const e of osm){if(!e.geometry)continue;const t=e.tags&&e.tags.golf;
  const pts=e.geometry.map(px).map(q=>q.map(v=>v.toFixed(1)).join(",")).join(" ");
  if(t==="fairway")svg+=`<polygon points="${pts}" fill="#ffcc00" fill-opacity="0.16" stroke="#ffcc00" stroke-width="1" stroke-opacity="0.5"/>`;
  else if(t==="green")svg+=`<polygon points="${pts}" fill="#00e0ff" fill-opacity="0.5" stroke="#00e0ff" stroke-width="1.5"/>`;}
// my confident West holes 1-10,15-18 (emerald) with numbers ; 11-14 red
for(const h of course.holes){const todo=h.num>=11&&h.num<=14;const col=todo?"#ff2d2d":"#23c68b";
  if(h.line&&h.line.length>1){const pts=h.line.map(px).map(q=>q.map(v=>v.toFixed(1)).join(",")).join(" ");svg+=`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="3" stroke-dasharray="7 5"/>`;}
  const[tx,ty]=px(h.tee);svg+=`<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="7" fill="#fff" stroke="${col}" stroke-width="2.5"/>`;
  const[gx,gy]=px(h.green.centre);svg+=`<text x="${gx.toFixed(1)}" y="${(gy-9).toFixed(1)}" font-size="30" font-weight="bold" fill="${col}" stroke="#000" stroke-width="0.8" text-anchor="middle">${h.num}</text>`;}
svg+=`</svg>`;
const composed=await sharp({create:{width:Wpx,height:Hpx,channels:3,background:"#000"}}).composite([...tiles,{input:Buffer.from(svg),top:0,left:0}]).png().toBuffer();
let out=sharp(composed);const m=await sharp(composed).metadata();if(m.width>2400)out=out.resize(2400);
await out.png().toFile(`${SD}/went_routing.png`);
console.log("wrote went_routing.png",m.width,"x",m.height);
