import sharp from "sharp";
const Z=16, W=256*2**Z, rad=x=>x*Math.PI/180;
const lon2px=l=>(l+180)/360*W, lat2px=l=>(1-Math.log(Math.tan(rad(l))+1/Math.cos(rad(l)))/Math.PI)/2*W;
const cLat=38.1923,cLon=-8.7655; // CostaTerra
const minLat=cLat-0.012,maxLat=cLat+0.012,minLon=cLon-0.016,maxLon=cLon+0.016;
const x0=Math.floor(lon2px(minLon)/256),x1=Math.floor(lon2px(maxLon)/256);
const y0=Math.floor(lat2px(maxLat)/256),y1=Math.floor(lat2px(minLat)/256);
const cols=x1-x0+1,rows=y1-y0+1,Wpx=cols*256,Hpx=rows*256;
const tiles=[];
for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){const r=await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`);if(r.ok)tiles.push({input:Buffer.from(await r.arrayBuffer()),left:(tx-x0)*256,top:(ty-y0)*256});}
const buf=await sharp({create:{width:Wpx,height:Hpx,channels:3,background:"#000"}}).composite(tiles).png().toBuffer();
let out=sharp(buf);const m=await sharp(buf).metadata();if(m.width>1600)out=out.resize(1600);
await out.png().toFile(process.argv[2]);
console.log("wrote",m.width,"x",m.height);
