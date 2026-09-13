/* Portable course editor/package model; shared by the app and review service. */
globalThis.TDPCoursePackage=(()=>{
  const types=['boundary','hole','green','tee','fairway','bunker','water','penalty','woodland','rough'];
  const clone=x=>JSON.parse(JSON.stringify(x));
  const latlng=p=>[p[1],p[0]], xy=p=>[p[1],p[0]];
  const polygon=coords=>({type:'Polygon',coordinates:[coords.map(xy)]});
  const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
  const dist=(a,b)=>Math.hypot((a[0]-b[0])*111132,(a[1]-b[1])*111320*Math.cos(a[0]*Math.PI/180));
  function pointOK(p){return Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;}
  function geometryError(g) {
    if(!g)return 'Missing geometry';
    if(g.type==='Point')return pointOK(g.coordinates)?null:'Invalid point';
    if(g.type==='LineString')return g.coordinates?.length>=2&&g.coordinates.every(pointOK)?null:'A hole needs at least two valid points';
    const ps=polygons(g);
    if(!ps.length)return 'Use a point, line, polygon or multipolygon';
    for(const p of ps)for(const r of p) {
      if(r.length<4||!r.every(pointOK)||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])return 'Polygons must have at least three vertices and a closed ring';
      const area=Math.abs(r.reduce((s,v,i)=>i?s+r[i-1][0]*v[1]-v[0]*r[i-1][1]:s,0));
      if(area<1e-12)return 'Polygon has no area';
    }
    return null;
  }
  function empty(c) {
    return {schemaVersion:1,course:{id:c.id+(c.layout?`-layout-${encodeURIComponent(c.layout)}`:''),name:c.name+(c.layout?' — '+c.layout:''),
      location:c.loc||'',lat:c.lat,lon:c.lon,expectedHoles:null,teeSet:'Unspecified',teeSets:[]},identity:clone(c),features:[],
      provenance:{source:'',sourceUrl:'',permission:'',imageryDate:'',notes:''},featureReview:{}};
  }
  function fromMap(data) {
    const draft=empty(data.identity||{id:data.course.id,name:data.course.name,lat:data.course.lat,lon:data.course.lon});
    draft.course={...clone(data.course),expectedHoles:data.coverage?.expectedHoles||null,teeSets:clone(data.course.teeSets||[])};
    draft.provenance={...draft.provenance,...clone(data.provenance||{})};
    for(const h of data.holes||[]) {
      draft.features.push({id:h.id||`hole-${h.num}`,type:'hole',hole:h.num,par:h.parSource==='estimate'?null:h.par,si:h.si,geometry:{type:'LineString',coordinates:h.line.map(xy)}});
      draft.features.push({id:`green-${h.num}`,type:'green',hole:h.num,geometry:h.green.polygons?{type:'MultiPolygon',coordinates:h.green.polygons.map(p=>p.map(r=>r.map(xy)))}:polygon(h.green.poly)});
      draft.features.push({id:`tee-${h.num}`,type:'tee',hole:h.num,geometry:{type:'Point',coordinates:xy(h.tee)}});
    }
    for(const [type,items] of Object.entries(data.overlays||{}))if(types.includes(type)&&!['green','tee'].includes(type)) {
      items.forEach((p,i)=>draft.features.push({id:`${type}-${i}`,type,geometry:Array.isArray(p[0][0])?{type:'Polygon',coordinates:p.map(r=>r.map(xy))}:polygon(p)}));
    }
    return draft;
  }
  function fromSource(source) {
    const draft=empty(source.candidate);draft.course.expectedHoles=source.expectedHoles;draft.course.name=source.name;
    draft.provenance={source:'OpenStreetMap',sourceUrl:'https://www.openstreetmap.org',permission:'ODbL-1.0',imageryDate:'',notes:''};
    const elements=[source.outline,...source.elements].filter(Boolean);
    for(const e of elements) {
      const tag=e.tags||{},type=tag.leisure==='golf_course'?'boundary':({water_hazard:'penalty',lateral_water_hazard:'penalty'})[tag.golf]||tag.golf||
        (tag.natural==='water'?'water':tag.natural==='wood'||tag.landuse==='forest'?'woodland':null);
      if(!types.includes(type))continue;
      let geometry;
      if(e.polygons)geometry={type:'MultiPolygon',coordinates:e.polygons.map(p=>p.map(r=>r.map(v=>[v.lon,v.lat])))};
      else if(e.geometry)geometry={type:type==='hole'?'LineString':'Polygon',coordinates:type==='hole'?e.geometry.map(v=>[v.lon,v.lat]):[e.geometry.map(v=>[v.lon,v.lat])]};
      else continue;
      if(geometryError(geometry))continue;
      draft.features.push({id:`osm-${e.type}-${e.id}`,type,hole:type==='hole'?Number(tag.ref)||null:null,par:Number(tag.par)||null,si:Number(tag.handicap)||null,geometry});
    }
    // Green membership requires an explicit operator choice when OSM did not tag it.
    for(const green of draft.features.filter(f=>f.type==='green'&&!f.hole)) {
      const p=polygons(green.geometry)[0]?.[0]?.[0];
      const near=draft.features.filter(f=>f.type==='hole').map(h=>({h,d:dist(latlng(h.geometry.coordinates.at(-1)),latlng(p))})).sort((a,b)=>a.d-b.d);
      if(near[0]?.d<80)green.hole=near[0].h.hole;
    }
    return draft;
  }
  function validate(d,{publish=false}={}) {
    if(d?.schemaVersion!==1||!d.course?.id||!d.course.name?.trim())throw new Error('A course name and identity are required.');
    if(!Number.isFinite(d.course.lat)||!Number.isFinite(d.course.lon)||Math.abs(d.course.lat)>90||Math.abs(d.course.lon)>180)throw new Error('Choose a valid course location.');
    if(!Array.isArray(d.features)||d.features.length>5000)throw new Error('Invalid feature list.');
    const seen=new Set(),holes=new Set();
    for(const f of d.features) {
      if(!f.id||seen.has(f.id)||!types.includes(f.type))throw new Error('Every feature needs a unique ID and a supported type.');seen.add(f.id);
      const error=geometryError(f.geometry);if(error)throw new Error(error);
      if(f.type==='hole') {
        if(f.geometry.type!=='LineString'||!Number.isInteger(f.hole)||f.hole<1||f.hole>18||holes.has(f.hole))throw new Error('Hole numbers must be unique, from 1 to 18.');holes.add(f.hole);
      }
      if(['green','tee'].includes(f.type)&&publish&&(!Number.isInteger(f.hole)||!holes.has(f.hole)&&!d.features.some(h=>h.type==='hole'&&h.hole===f.hole)))throw new Error('Assign each green and tee to its original hole number.');
    }
    if(publish) {
      if(![9,18].includes(Number(d.course.expectedHoles)))throw new Error('Confirm whether this layout has 9 or 18 holes.');
      if(!d.features.some(f=>f.type==='boundary'))throw new Error('Add the course boundary before review.');
      if(!d.provenance?.source?.trim()||!d.provenance?.permission?.trim())throw new Error('Record the source and permission to use this geometry.');
      if(!holes.size)throw new Error('Map at least one hole before submitting.');
      if([...holes].some(n=>n>d.course.expectedHoles))throw new Error('Hole numbering exceeds the expected layout length.');
    }
    return d;
  }
  function assemble(d) {
    validate(d,{publish:true});
    const overlays=Object.fromEntries(['fairway','green','bunker','water','penalty','woodland','rough','tee','boundary'].map(k=>[k,[]]));
    for(const f of d.features)if(overlays[f.type])for(const p of polygons(f.geometry))overlays[f.type].push(p.map(r=>r.map(latlng)));
    const holes=d.features.filter(f=>f.type==='hole').sort((a,b)=>a.hole-b.hole).map(f=>{
      const gs=d.features.filter(g=>g.type==='green'&&g.hole===f.hole);
      if(gs.length!==1)throw new Error(`Hole ${f.hole} needs exactly one assigned green feature (it may contain multiple polygons).`);
      const ps=polygons(gs[0].geometry).map(p=>p.map(r=>r.map(latlng))),poly=ps[0]?.[0];
      if(!poly)throw new Error(`Hole ${f.hole} needs a polygon green.`);
      const centre=poly.slice(0,-1).reduce((a,p)=>[a[0]+p[0]/(poly.length-1),a[1]+p[1]/(poly.length-1)],[0,0]);
      const line=f.geometry.coordinates.map(latlng),end=line.at(-2),dy=(centre[0]-end[0])*111132,dx=(centre[1]-end[1])*111320*Math.cos(centre[0]*Math.PI/180);
      const approach=(Math.atan2(dx,dy)*180/Math.PI+360)%360,r=approach*Math.PI/180;
      const projections=poly.map(p=>{const x=(p[1]-centre[1])*111320*Math.cos(centre[0]*Math.PI/180),y=(p[0]-centre[0])*111132;return [x*Math.sin(r)+y*Math.cos(r),x*Math.cos(r)-y*Math.sin(r)];});
      const min=Math.min(...projections.map(p=>p[0])),max=Math.max(...projections.map(p=>p[0]));
      const tee=d.features.find(g=>g.type==='tee'&&g.hole===f.hole&&g.geometry.type==='Point');
      return {id:f.id,num:f.hole,par:f.par||4,parSource:f.par?'reviewed':'estimate',si:f.si||f.hole,line,tee:tee?latlng(tee.geometry.coordinates):line[0],
        metres:Math.round(line.reduce((s,p,i)=>s+(i?dist(p,line[i-1]):0),0)),pin:{front:-min,side:'C',source:'green-centre'},
        green:{poly,polygons:ps,centre,approach,frontOffset:-min,depth:max-min,width:Math.max(...projections.map(p=>p[1]))-Math.min(...projections.map(p=>p[1]))}};
    });
    const refs=holes.map(h=>h.num),full=holes.length===Number(d.course.expectedHoles)&&refs.every((n,i)=>n===i+1);
    return {course:{...clone(d.course),par:holes.reduce((s,h)=>s+h.par,0),slope:d.course.slope||null,rating:d.course.rating||null},holes,overlays,
      identity:clone(d.identity),quality:full?'full':'partial',coverage:{validationVersion:2,expectedHoles:Number(d.course.expectedHoles),holesMapped:holes.length,holesBuilt:holes.length,holeRefs:refs,
        features:clone(d.featureReview||{}),ratingSource:d.course.slope&&d.course.rating?'reviewed':'unknown'},provenance:{...clone(d.provenance),reviewStatus:'pending'}};
  }
  return {types,empty,fromMap,fromSource,validate,assemble,geometryError};
})();
