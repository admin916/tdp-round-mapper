/* Leaflet course corrections, local drafts and authenticated review submissions. */
window.TDPCourseEditor=(()=>{
  const P=window.TDPCoursePackage, esc=window.TDPCourseFinder.escape;
  const colours={boundary:'#d1d5db',hole:'#fbbf24',green:'#42d392',tee:'#a7f3d0',fairway:'#34915b',bunker:'#e8d9a8',water:'#60a5fa',penalty:'#ef4444',woodland:'#166534',rough:'#84a98c'};
  const api='https://iiodbfcmybieytkrjqzf.supabase.co/functions/v1';
  let map=null;
  function close(){map?.remove();map=null;}
  async function open({candidate,geometry,container,onClose,review}) {
    close();
    let draft=geometry?P.fromMap(geometry):P.empty(candidate),selected=null,drawing=null,points=[],history=[],layer=L.layerGroup(),handles=L.layerGroup(),temporary=L.layerGroup();
    const key='tdp.map.draft.'+draft.course.id;
    if(!review)try {const saved=JSON.parse(localStorage.getItem(key));if(saved)draft=saved;}catch{}
    if(review)draft=JSON.parse(JSON.stringify(review.package));
    container.innerHTML=`<div class="editor-heading"><h2>${review?'Review course map':'Course map editor'}</h2><button class="btn ghost" id="edClose">Back</button></div>
      <p>Keep original hole numbers. Import existing map features or draw corrections, then submit for review.</p>
      <div class="editor-fields"><label>Course name<input id="edName" value="${esc(draft.course.name)}"></label>
      <label>Layout length<select id="edCount"><option value="">Not confirmed</option><option value="9">9 holes</option><option value="18">18 holes</option></select></label>
      <label>Tee set<input id="edTees" value="${esc(draft.course.teeSet||'')}"></label>
      <label>Slope (if known)<input id="edSlope" type="number" min="55" max="155" value="${draft.course.slope||''}"></label>
      <label>Rating (if known)<input id="edRating" type="number" step="0.1" value="${draft.course.rating||''}"></label></div>
      <div id="editorMap" aria-label="Course geometry editor"></div>
      <div class="editor-toolbar"><select id="edType" aria-label="Feature type">${P.types.map(t=>`<option>${t}</option>`).join('')}</select>
      <label>Hole <input id="edHole" type="number" min="1" max="18" aria-label="Original hole number"></label>
      <label>Par <input id="edPar" type="number" min="3" max="6" aria-label="Hole par"></label>
      <button class="btn" id="edDraw">Draw feature</button><button class="btn" id="edFinish" disabled>Finish drawing</button>
      <button class="btn ghost" id="edUndo">Undo</button><button class="btn ghost" id="edDelete">Delete selected</button></div>
      <div class="editor-toolbar"><select id="edFeatures" aria-label="Mapped features"></select><button class="btn" id="edAssign">Apply hole / par</button>
      <button class="btn" id="edSource">Import OSM features</button><label class="btn">Import package / GeoJSON<input id="edImport" type="file" accept=".json,.geojson,application/json" hidden></label></div>
      <details><summary>Source, imagery and coverage</summary><div class="editor-fields">
      <label>Geometry source<input id="edSourceName" value="${esc(draft.provenance.source||'')}"></label>
      <label>Source URL<input id="edSourceUrl" value="${esc(draft.provenance.sourceUrl||'')}"></label>
      <label>Permission / licence<input id="edPermission" value="${esc(draft.provenance.permission||'')}"></label>
      <label>Imagery or survey date<input id="edDate" type="date" value="${esc(draft.provenance.imageryDate||'')}"></label>
      <label>Notes<textarea id="edNotes">${esc(draft.provenance.notes||'')}</textarea></label>
      <label>Club plan / survey image<input id="edImage" type="file" accept="image/*"></label>
      <label>Image bounds: south, west, north, east<input id="edBounds" placeholder="51.1, -0.7, 51.2, -0.6"></label>
      <button class="btn" id="edOverlay">Add plan to map</button></div>
      <p>Use a plan or imagery you have permission to map. The date and source travel with the submitted package.</p>
      <div class="editor-fields">${['green','tee','fairway','bunker','water','penalty','woodland'].map(k=>`<label>${k} coverage<select data-coverage="${k}"><option value="unknown">Unknown</option><option value="partial">Partial</option><option value="complete">Checked complete</option></select></label>`).join('')}</div></details>
      <div class="editor-toolbar"><button class="btn" id="edSave">Save draft on device</button><button class="btn" id="edExport">Export package</button>
      <button class="btn primary" id="edSubmit">${review?'Approve and publish':'Submit map for review'}</button>${review?'<button class="btn" id="edReject">Return for corrections</button>':''}</div>
      <p id="edStatus" role="status"></p>`;
    const $=id=>container.querySelector('#'+id),status=text=>{$('edStatus').textContent=text;};
    $('edCount').value=draft.course.expectedHoles||'';
    container.querySelectorAll('[data-coverage]').forEach(el=>el.value=draft.featureReview?.[el.dataset.coverage]?.completeness||'unknown');
    map=L.map('editorMap',{doubleClickZoom:false}).setView([draft.course.lat,draft.course.lon],16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
    layer.addTo(map);handles.addTo(map);temporary.addTo(map);
    const stash=()=>{history.push(JSON.stringify(draft));history=history.slice(-40);};
    function fields() {
      draft.course.name=$('edName').value.trim();draft.course.expectedHoles=Number($('edCount').value)||null;
      draft.course.teeSet=$('edTees').value.trim();draft.course.slope=Number($('edSlope').value)||null;draft.course.rating=Number($('edRating').value)||null;
      draft.course.teeSets=[{name:draft.course.teeSet,slope:draft.course.slope,rating:draft.course.rating}];
      draft.provenance={source:$('edSourceName').value.trim(),sourceUrl:$('edSourceUrl').value.trim(),permission:$('edPermission').value.trim(),imageryDate:$('edDate').value,notes:$('edNotes').value.trim()};
      draft.featureReview=Object.fromEntries([...container.querySelectorAll('[data-coverage]')].map(el=>[el.dataset.coverage,{completeness:el.value,source:draft.provenance.source}]));
    }
    function setFields(){ $('edName').value=draft.course.name;$('edCount').value=draft.course.expectedHoles||'';
      $('edSourceName').value=draft.provenance.source||'';$('edSourceUrl').value=draft.provenance.sourceUrl||'';$('edPermission').value=draft.provenance.permission||'';}
    function render() {
      layer.clearLayers();handles.clearLayers();
      for(const f of draft.features) {
        const l=L.geoJSON({type:'Feature',geometry:f.geometry,properties:{}},{style:{color:colours[f.type],weight:f.id===selected?4:2,fillOpacity:.22},pointToLayer:(_,p)=>L.circleMarker(p,{radius:6,color:colours[f.type]})});
        l.on('click',e=>{L.DomEvent.stopPropagation(e);if(!drawing){selected=f.id;render();}});l.addTo(layer);
      }
      $('edFeatures').innerHTML='<option value="">Choose a feature</option>'+draft.features.map(f=>`<option value="${esc(f.id)}">${esc(f.type)}${f.hole?' · hole '+f.hole:''} · ${esc(f.id)}</option>`).join('');
      $('edFeatures').value=selected||'';
      const f=draft.features.find(f=>f.id===selected);
      if(f) {
        $('edHole').value=f.hole||'';$('edPar').value=f.par||'';
        function vertices(coords,path=[]) {
          if(typeof coords[0]==='number') {
            const marker=L.marker([coords[1],coords[0]],{draggable:true}).addTo(handles);
            marker.on('dragstart',stash);marker.on('dragend',()=>{
              let target=f.geometry.coordinates;for(const i of path.slice(0,-1))target=target[i];
              const p=marker.getLatLng(),value=[p.lng,p.lat];
              if(!path.length)f.geometry.coordinates=value;
              else {const i=path.at(-1),closed=f.geometry.type.includes('Polygon');target[i]=value;
                if(closed&&i===0)target[target.length-1]=[...value];if(closed&&i===target.length-1)target[0]=[...value];}
              render();
            });
          } else coords.forEach((c,i)=>vertices(c,[...path,i]));
        }
        vertices(f.geometry.coordinates);
      }
    }
    map.on('click',e=>{
      if(!drawing)return;points.push([e.latlng.lng,e.latlng.lat]);temporary.clearLayers();
      L.polyline(points.map(p=>[p[1],p[0]]),{color:'#fbbf24'}).addTo(temporary);
      points.forEach(p=>L.circleMarker([p[1],p[0]],{radius:4}).addTo(temporary));
      if(drawing==='tee')finish();
    });
    function finish() {
      if(!drawing)return;
      const geometry=drawing==='tee'?{type:'Point',coordinates:points[0]}:drawing==='hole'?{type:'LineString',coordinates:points}:{type:'Polygon',coordinates:[[...points,points[0]]]};
      const error=P.geometryError(geometry);if(error){status(error);return;}
      stash();fields();const f={id:crypto.randomUUID(),type:drawing,hole:Number($('edHole').value)||null,par:Number($('edPar').value)||null,geometry,
        provenance:{...draft.provenance}};
      draft.features.push(f);selected=f.id;drawing=null;points=[];temporary.clearLayers();$('edFinish').disabled=true;render();status('Feature saved in the draft. Drag a marker to correct a vertex.');
    }
    $('edDraw').onclick=()=>{drawing=$('edType').value;points=[];temporary.clearLayers();handles.clearLayers();$('edFinish').disabled=false;status(drawing==='tee'?'Tap the tee position.':'Tap points on the map, then finish drawing.');};
    $('edFinish').onclick=finish;
    $('edFeatures').onchange=()=>{selected=$('edFeatures').value;render();};
    $('edAssign').onclick=()=>{const f=draft.features.find(f=>f.id===selected);if(!f)return;stash();f.hole=Number($('edHole').value)||null;f.par=Number($('edPar').value)||null;render();};
    $('edDelete').onclick=()=>{stash();draft.features=draft.features.filter(f=>f.id!==selected);selected=null;render();};
    $('edUndo').onclick=()=>{if(history.length){draft=JSON.parse(history.pop());selected=null;drawing=null;temporary.clearLayers();setFields();render();}};
    $('edSave').onclick=()=>{try{fields();P.validate(draft);localStorage.setItem(key,JSON.stringify(draft));status('Draft saved on this device.');}catch(e){status(e.message);}};
    $('edExport').onclick=()=>{try{fields();P.validate(draft);const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));a.href=url;a.download='course-map.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status(e.message);}};
    $('edImport').onchange=async e=>{try{const file=e.target.files[0];if(!file||file.size>5000000)throw new Error('Choose a package smaller than 5 MB.');const data=JSON.parse(await file.text());stash();
      if(data.type==='FeatureCollection')draft.features=data.features.map(f=>({id:f.id||crypto.randomUUID(),...f.properties,geometry:f.geometry}));
      else {if(data.course?.id!==draft.course.id)throw new Error('This package belongs to another course. Open that course before importing.');draft=data;}
      P.validate(draft);setFields();render();status('Package imported. Check source details and hole assignments.');}catch(e){status(e.message);}};
    $('edSource').disabled=review||candidate?.provider!=='osm';
    $('edSource').onclick=async()=>{const btn=$('edSource');btn.disabled=true;status('Loading selected course features…');try{
      const r=await fetch(api+'/course',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candidate,action:'source'}),signal:AbortSignal.timeout(90000)});const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Map service unavailable');stash();draft=P.fromSource(data);setFields();render();status('OSM candidates imported. Assign greens and tees to their holes and check the map before submitting.');
    }catch(e){status(e.message);}finally{btn.disabled=false;}};
    $('edOverlay').onclick=()=>{const file=$('edImage').files[0],bounds=$('edBounds').value.split(',').map(Number);
      if(!file||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]){status('Choose an image and its south, west, north, east bounds.');return;}
      const reader=new FileReader();reader.onload=()=>L.imageOverlay(reader.result,[[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{opacity:.7}).addTo(map);reader.readAsDataURL(file);
    };
    async function submit(action) {
      const btn=$('edSubmit');btn.disabled=true;
      try {
        fields();
        if(review) {
          // Review the saved submission exactly; corrections are submitted as a new draft.
          if(JSON.stringify(draft.features)!==JSON.stringify(review.package.features))throw new Error('Save corrections as a new draft; approval applies to the submitted geometry.');
          const {data}=await window.TDP_SUPA.auth.getSession();
          const r=await fetch(api+'/course-review',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+data.session?.access_token},body:JSON.stringify({id:review.id,action,note:$('edNotes').value})});
          const result=await r.json();if(!r.ok)throw new Error(result.error);status(action==='publish'?'Reviewed course map published. It is now available in the course finder.':'Returned for corrections.');
        } else {
          P.assemble(draft);const {data}=await window.TDP_SUPA.auth.getUser();if(!data.user)throw new Error('Sign in to submit. You can save your draft on this device first.');
          const {error}=await window.TDP_SUPA.from('course_map_drafts').insert({created_by:data.user.id,course_id:draft.course.id,package:draft});if(error)throw new Error('Submission failed. Your local draft is still available.');
          localStorage.setItem(key,JSON.stringify(draft));status('Map submitted for review. You can check its status from Map drafts.');
        }
      }catch(e){status(e.message);}finally{btn.disabled=false;}
    }
    $('edSubmit').onclick=()=>submit('publish');if(review)$('edReject').onclick=()=>submit('reject');
    $('edClose').onclick=()=>{close();onClose();};render();
  }
  async function drafts({container,onClose}) {
    close();container.innerHTML='<h2>Map drafts</h2><p role="status">Loading submissions…</p>';
    const {data,error}=await window.TDP_SUPA.from('course_map_drafts').select('id,course_id,package,status,review_note,created_at').order('created_at',{ascending:false}).limit(100);
    const {data:members}=await window.TDP_SUPA.from('course_reviewers').select('user_id');
    container.innerHTML='<h2>Map drafts</h2><button class="btn ghost" id="draftBack">Back</button>'+ (error?'<p>Sign in to see your submitted maps.</p>':!data.length?'<p>No submitted maps yet.</p>':data.map(d=>`<div class="course-item"><div><b>${esc(d.package.course.name)}</b><p>${esc(d.status)}${d.review_note?' · '+esc(d.review_note):''}</p></div><button class="btn" data-draft="${d.id}">${members?.length&&d.status==='submitted'?'Review':'Open draft'}</button></div>`).join(''));
    container.querySelector('#draftBack').onclick=onClose;
    container.querySelectorAll('[data-draft]').forEach(btn=>btn.onclick=()=>{const d=data.find(d=>d.id===btn.dataset.draft);open({candidate:d.package.identity,container,onClose:()=>drafts({container,onClose}),review:members?.length&&d.status==='submitted'?d:null,geometry:P.assemble(d.package)});});
  }
  return {open,close,drafts};
})();
