import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
const [,, courseFile, outPng, zoomArg] = process.argv;
const src = readFileSync(courseFile,"utf8");
const course = JSON.parse(src.replace(/^[^=]*=\s*/,"").replace(/;\s*$/,""));
const holes = course.holes;
const Z = +(zoomArg||17);
const W = 256*Math.pow(2,Z);
const rad=x=>x*Math.PI/180;
const lon2px=lon=>(lon+180)/360*W;
const lat2px=lat=>(1-Math.log(Math.tan(rad(lat))+1/Math.cos(rad(lat)))/Math.PI)/2*W;
// bbox from holes (+ margin)
let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
for(const h of holes){for(const p of [h.tee,h.green.centre,...(h.line||[])]){if(!p)continue;minLat=Math.min(minLat,p[0]);maxLat=Math.max(maxLat,p[0]);minLon=Math.min(minLon,p[1]);maxLon=Math.max(maxLon,p[1]);}}
minLat-=0.001;maxLat+=0.001;minLon-=0.001;maxLon+=0.001;
const x0=Math.floor(lon2px(minLon)/256), x1=Math.floor(lon2px(maxLon)/256);
const y0=Math.floor(lat2px(maxLat)/256), y1=Math.floor(lat2px(minLat)/256);
const cols=x1-x0+1, rows=y1-y0+1;
const Wpx=cols*256, Hpx=rows*256;
console.log(`zoom ${Z}, ${cols}x${rows}=${cols*rows} tiles, ${Wpx}x${Hpx}px`);
const originPx=x0*256, originPy=y0*256;
// fetch tiles
const tiles=[];
for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){
  const url=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`;
  const r=await fetch(url); if(!r.ok){console.log("tile fail",tx,ty,r.status);continue;}
  const buf=Buffer.from(await r.arrayBuffer());
  tiles.push({input:buf, left:(tx-x0)*256, top:(ty-y0)*256});
}
// SVG overlay
const px=p=>[lon2px(p[1])-originPx, lat2px(p[0])-originPy];
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${Wpx}" height="${Hpx}">`;
for(const h of holes){
  const isTodo=(h.num>=11&&h.num<=14);
  const col=isTodo?"#ff3b3b":"#23c68b";
  if(h.line&&h.line.length>1){const pts=h.line.map(px).map(q=>q.map(v=>v.toFixed(1)).join(",")).join(" ");svg+=`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="3" stroke-dasharray="6 6" opacity="0.9"/>`;}
  if(h.green&&h.green.poly){const pts=h.green.poly.map(px).map(q=>q.map(v=>v.toFixed(1)).join(",")).join(" ");svg+=`<polygon points="${pts}" fill="${col}" fill-opacity="0.35" stroke="${col}" stroke-width="2"/>`;}
  const [tx,ty]=px(h.tee); svg+=`<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="6" fill="#fff" stroke="${col}" stroke-width="2"/>`;
  const [gx,gy]=px(h.green.centre); svg+=`<text x="${gx.toFixed(1)}" y="${(gy-8).toFixed(1)}" font-size="26" font-weight="bold" fill="${col}" stroke="#000" stroke-width="0.6" text-anchor="middle">${h.num}</text>`;
}
svg+=`</svg>`;
const base=sharp({create:{width:Wpx,height:Hpx,channels:3,background:"#000"}});
const composed=await base.composite([...tiles,{input:Buffer.from(svg),top:0,left:0}]).png().toBuffer();
// downscale if huge
const meta=await sharp(composed).metadata();
let out=sharp(composed);
if(meta.width>2200) out=out.resize(2200);
await out.png().toFile(outPng);
console.log("wrote",outPng);
