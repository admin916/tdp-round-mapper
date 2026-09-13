// Search selection is authoritative: never geocode its name a second time.
export function validateCandidate(c) {
  if (!c || c.provider !== 'osm' || !['node','way','relation'].includes(c.osmType) ||
      !Number.isSafeInteger(c.osmId) || c.osmId <= 0 || !Number.isFinite(c.lat) || !Number.isFinite(c.lon) ||
      Math.abs(c.lat)>90 || Math.abs(c.lon)>180 || typeof c.name !== 'string' || !c.name.trim() || c.name.length>300 ||
      (c.layout !== undefined && (typeof c.layout !== 'string' || !c.layout.trim() || c.layout.length>200)))
    throw new Error('Select a course location from the finder first.');
  return {...c, id:`osm-${c.osmType}-${c.osmId}`};
}
export function queryForCandidate(candidate) {
  const c=validateCandidate(candidate);
  // bbox, not around: around-filters on relations are slow on the public mirrors; a bbox of
  // this size answers in seconds (same query shape the batch pipeline and scout use)
  const d=0.025, dl=d/Math.cos(c.lat*Math.PI/180);
  const near=`(${c.lat-d},${c.lon-dl},${c.lat+d},${c.lon+dl})`;
  // ways/relations only for water & woodland: individual natural=tree nodes number in the
  // tens of thousands around a parkland course and were timing the public mirrors out.
  return `[out:json][timeout:50][maxsize:268435456];${c.osmType}(${c.osmId});out geom;(nwr${near}["golf"];way${near}["natural"~"^(water|wood)$"];relation${near}["natural"~"^(water|wood)$"];way${near}["landuse"="forest"];relation${near}["landuse"="forest"];);out geom;`;
}
function inside(p,ring) {
  let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a.lat>p.lat)!==(b.lat>p.lat) && p.lon<(b.lon-a.lon)*(p.lat-a.lat)/(b.lat-a.lat)+a.lon) hit=!hit;
  }
  return hit;
}
export function ringsFor(outline) {
  if(outline.polygons) return outline.polygons.flatMap(p=>p.map((points,i)=>({role:i?'inner':'outer',points})));
  if(outline.type==='way' && outline.geometry?.length>3) return [{role:'outer',points:outline.geometry}];
  const parts=(outline.members||[]).filter(m=>m.geometry?.length>1).map(m=>({role:m.role||'outer',points:[...m.geometry]}));
  const rings=[], eq=(a,b)=>a.lat===b.lat && a.lon===b.lon;
  while(parts.length) {
    const ring=parts.shift();
    while(!eq(ring.points[0],ring.points.at(-1))) {
      const end=ring.points.at(-1);
      const i=parts.findIndex(p=>p.role===ring.role && (eq(p.points[0],end)||eq(p.points.at(-1),end)));
      if(i<0) throw new Error('The course boundary is incomplete and needs mapping review.');
      const next=parts.splice(i,1)[0].points;
      if(!eq(next[0],end)) next.reverse();
      ring.points.push(...next.slice(1));
    }
    rings.push(ring);
  }
  return rings;
}
export function selectCourseElements(elements,candidate) {
  const c=validateCandidate(candidate);
  const outline=elements.find(e=>e.type===c.osmType && e.id===c.osmId && e.tags?.leisure==='golf_course');
  if(!outline) throw new Error('The selected course could not be verified in the map data. Try searching again.');
  const rings=ringsFor(outline);
  if(!rings.some(r=>r.role==='outer')) throw new Error('Course location found, but its boundary still needs mapping.');
  const contains=p=>rings.some(r=>r.role==='outer' && inside(p,r.points)) && !rings.some(r=>r.role==='inner' && inside(p,r.points));
  let selected=elements.filter(e=>e.tags?.golf || ['water','wood','tree'].includes(e.tags?.natural) || e.tags?.landuse==='forest')
    .map(e=>{
      if(e.type!=='relation') return e;
      const rs=ringsFor(e), outers=rs.filter(r=>r.role==='outer');
      const polygons=outers.map(o=>[o.points,...rs.filter(r=>r.role==='inner' && inside(r.points[0],o.points)).map(r=>r.points)]);
      return {...e,polygons,geometry:[...outers].sort((a,b)=>b.points.length-a.points.length)[0]?.points};
    }).filter(e=>{
      // majority of a feature's points inside the boundary: hole lines and fairways often
      // poke a few metres past the mapped outline, and "every point" dropped them wholesale
      if(!e.geometry?.length) return e.type==='node' && contains(e);
      const n=e.geometry.filter(contains).length;
      return n*2>=e.geometry.length;
    });
  const layoutOf=e=>(e.tags?.['golf:course:name']||e.tags?.['course:name']||e.tags?.['golf:course']||e.tags?.course||'').trim();
  const layouts=[...new Set(selected.filter(e=>e.tags.golf==='hole').map(layoutOf).filter(Boolean))];
  if(layouts.length>1 && !c.layout) {
    const error=new Error('Choose which layout you want to map.'); error.layouts=layouts; throw error;
  }
  if(c.layout && !layouts.includes(c.layout)) throw new Error('That layout is not present in this course. Search again.');
  if(c.layout) selected=selected.filter(e=>e.tags.golf!=='hole'||layoutOf(e)===c.layout);
  const expected=Number(outline.tags.holes);
  return {elements:selected,expectedHoles:!c.layout && [9,18].includes(expected)?expected:null,
    name:c.layout?`${outline.tags.name||c.name} — ${c.layout}`:(outline.tags.name||c.name),
    id:c.id+(c.layout?`-layout-${encodeURIComponent(c.layout)}`:'')};
}
