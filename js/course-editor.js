/* Leaflet course corrections, local drafts and authenticated review submissions. */
window.TDPCourseEditor=(()=>{
  const P=window.TDPCoursePackage, esc=window.TDPCourseFinder.escape;
  const colours={boundary:'#d1d5db',hole:'#fbbf24',green:'#42d392',tee:'#a7f3d0',fairway:'#34915b',bunker:'#e8d9a8',water:'#60a5fa',penalty:'#ef4444',woodland:'#166534',rough:'#84a98c'};
  const api='https://iiodbfcmybieytkrjqzf.supabase.co/functions/v1';
  let map=null,host=null;
  function close(){map?.remove();map=null;host?.remove();host=null;document.body.classList.remove("editing-course");}
  async function open({candidate,geometry,container,onClose,review}) {
    close();
    host=document.createElement('section');host.id='courseEditor';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','Course map editor');
    document.body.appendChild(host);document.body.classList.add('editing-course');container=host;
    const active=()=>host===container;
    let draft=geometry?P.fromMap(geometry):P.empty(candidate),selected=null,drawing=null,points=[],history=[],layer=L.layerGroup(),handles=L.layerGroup(),temporary=L.layerGroup();
    const key='tdp.map.draft.'+draft.course.id;
    let hasSavedDraft=false;
    if(!review)try {const saved=JSON.parse(localStorage.getItem(key));if(saved){draft=saved;hasSavedDraft=true;}}catch{}
    if(review)draft=JSON.parse(JSON.stringify(review.package));
    container.innerHTML=`<header class="ed-header"><button class="btn ghost" id="edClose">Back</button><div><h2>${review?'Review map':esc(draft.course.name)}</h2><span id="edSaved">Map editor · saved on this device</span></div><button class="btn primary" id="edUse">Save &amp; open</button></header>
      <div id="editorMap" aria-label="Course geometry editor"></div>
      <div class="ed-map-actions"><button class="btn" id="edFit">Fit course</button><button class="btn" id="edSettings">Details &amp; import</button></div>
      <aside id="edDrawer" class="hidden"><div class="editor-heading"><h3>Course details</h3><button class="btn ghost" id="edHideSettings">Close details</button></div>
      <div class="editor-fields"><label>Course name<input id="edName" value="${esc(draft.course.name)}"></label>
      <label>Layout length<select id="edCount"><option value="">Not confirmed</option><option value="9">9 holes</option><option value="18">18 holes</option></select></label>
      <label>Tee set<input id="edTees" value="${esc(draft.course.teeSet||'')}"></label>
      <label>Slope (if known)<input id="edSlope" type="number" min="55" max="155" value="${draft.course.slope||''}"></label>
      <label>Rating (if known)<input id="edRating" type="number" step="0.1" value="${draft.course.rating||''}"></label></div>
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
      <div class="editor-toolbar"><button class="btn" id="edSource">Import OSM features</button><label class="btn">Import package<input id="edImport" type="file" accept=".json,.geojson,application/json" hidden></label><button class="btn" id="edExport">Export package</button></div>
      <div class="editor-toolbar"><button class="btn" id="edSave">Save draft</button><button class="btn" id="edSubmit">${review?'Approve and publish':'Submit for shared library review'}</button>${review?'<button class="btn" id="edReject">Return for corrections</button>':''}</div></aside>
      <footer class="ed-controls"><p id="edStatus" role="status">Choose a feature to draw, or tap an existing shape to edit it.</p>
      <div class="ed-palette" aria-label="Draw map features">${['fairway','bunker','water','green','tee','hole','rough','woodland','boundary','penalty'].map(t=>`<button class="ed-tool" data-tool="${t}" style="--feature-colour:${colours[t]}"><i></i>${t==='hole'?'Hole route':t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div>
      <select id="edType" hidden>${P.types.map(t=>`<option>${t}</option>`).join('')}</select>
      <div class="editor-toolbar ed-selection"><select id="edFeatures" aria-label="Mapped features"></select><label>Hole <input id="edHole" type="number" min="1" max="18" aria-label="Original hole number"></label><label>Par <input id="edPar" type="number" min="3" max="6" aria-label="Hole par"></label><button class="btn" id="edAssign">Apply</button></div>
      <div class="editor-toolbar ed-drawing"><button class="btn" id="edDraw">Draw selected type</button><button class="btn ghost" id="edUndo">Undo</button><button class="btn ghost" id="edDelete">Delete shape</button><button class="btn ghost hidden" id="edCancel">Cancel</button><button class="btn primary" id="edFinish" disabled>Finish shape</button></div></footer>`;
    const $=id=>container.querySelector('#'+id),status=text=>{$('edStatus').textContent=text;};
    $('edCount').value=draft.course.expectedHoles||'';
    $('edHole').value=draft.features.find(f=>f.type==='hole')?.hole||1;
    container.querySelectorAll('[data-coverage]').forEach(el=>el.value=draft.featureReview?.[el.dataset.coverage]?.completeness||'unknown');
    map=L.map('editorMap',{doubleClickZoom:false,zoomControl:false}).setView([draft.course.lat,draft.course.lon],16);
    // Satellite imagery is what you trace fairways and bunkers from; the street map is there for orientation.
    const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics · Course data © OpenStreetMap contributors'}).addTo(map);
    const streets=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'});
    L.control.layers({Satellite:satellite,'Street map':streets},null,{position:'topright'}).addTo(map);
    L.control.zoom({position:'topright'}).addTo(map);
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
    function saveDraft() {
      try { fields();P.validate(draft);localStorage.setItem(key,JSON.stringify(draft));$('edSaved').textContent='Draft saved on this device';return true; }
      catch(e){$('edSaved').textContent='Not saved';status(e.message);return false;}
    }
    function drawState() {
      container.classList.toggle('is-drawing',!!drawing);
      container.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===drawing)));
      $('edCancel').classList.toggle('hidden',!drawing);
      $('edFinish').disabled=!drawing;
    }
    function fit() {
      const bounds=L.latLngBounds([]);
      for(const f of draft.features) {
        const l=L.geoJSON({type:'Feature',geometry:f.geometry});if(l.getBounds().isValid())bounds.extend(l.getBounds());
      }
      if(bounds.isValid())map.fitBounds(bounds,{paddingTopLeft:[30,95],paddingBottomRight:[30,240]});
    }
    function render() {
      layer.clearLayers();handles.clearLayers();
      for(const f of draft.features) {
        const l=L.geoJSON({type:'Feature',geometry:f.geometry,properties:{}},{style:{color:colours[f.type],weight:f.id===selected?4:2,fillOpacity:.22},pointToLayer:(_,p)=>L.circleMarker(p,{radius:6,color:colours[f.type]})});
        l.on('click',e=>{if(drawing)return;/* let the map add the point, even over an existing shape */L.DomEvent.stopPropagation(e);selected=f.id;render();status('Drag corner markers to adjust this '+f.type+'.');});l.addTo(layer);
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
              render();saveDraft();
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
      stash();fields();const perHole=['hole','green','tee'].includes(drawing);const f={id:crypto.randomUUID(),type:drawing,hole:perHole?Number($('edHole').value)||null:null,par:drawing==='hole'?Number($('edPar').value)||null:null,geometry,
        provenance:{...draft.provenance}};
      draft.features.push(f);selected=f.id;drawing=null;points=[];temporary.clearLayers();$('edFinish').disabled=true;render();drawState();saveDraft();status('Shape saved. Drag its corner markers to adjust, or choose another feature.');
    }
    $('edDraw').onclick=()=>{drawing=$('edType').value;selected=null;if(drawing==='hole'){const used=new Set(draft.features.filter(f=>f.type==='hole').map(f=>f.hole));$('edHole').value=Array.from({length:18},(_,i)=>i+1).find(n=>!used.has(n))||18;}points=[];temporary.clearLayers();handles.clearLayers();$('edFinish').disabled=false;drawState();status(drawing==='tee'?'Tap the tee position.':`Drawing ${drawing}. Tap around its edge${drawing==='hole'?' from tee to green':''}, then Finish shape. Drag the map to move around.`);};
    $('edFinish').onclick=finish;
    $('edFeatures').onchange=()=>{selected=$('edFeatures').value;render();};
    $('edAssign').onclick=()=>{const f=draft.features.find(f=>f.id===selected);if(!f)return;stash();f.hole=Number($('edHole').value)||null;f.par=Number($('edPar').value)||null;render();saveDraft();};
    $('edDelete').onclick=()=>{stash();draft.features=draft.features.filter(f=>f.id!==selected);selected=null;render();saveDraft();};
    $('edUndo').onclick=()=>{if(drawing){points.pop();temporary.clearLayers();if(points.length)L.polyline(points.map(p=>[p[1],p[0]]),{color:colours[drawing]}).addTo(temporary);return;}if(history.length){draft=JSON.parse(history.pop());selected=null;drawing=null;temporary.clearLayers();setFields();render();drawState();saveDraft();}};
    $('edSave').onclick=()=>{try{fields();P.validate(draft);localStorage.setItem(key,JSON.stringify(draft));status('Draft saved on this device.');}catch(e){status(e.message);}};
    $('edExport').onclick=()=>{try{fields();P.validate(draft);const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));a.href=url;a.download='course-map.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status(e.message);}};
    $('edImport').onchange=async e=>{try{const file=e.target.files[0];if(!file||file.size>5000000)throw new Error('Choose a package smaller than 5 MB.');const data=JSON.parse(await file.text());stash();
      if(data.type==='FeatureCollection')draft.features=data.features.map(f=>({id:f.id||crypto.randomUUID(),...f.properties,geometry:f.geometry}));
      else {if(data.course?.id!==draft.course.id)throw new Error('This package belongs to another course. Open that course before importing.');draft=data;}
      P.validate(draft);setFields();render();status('Package imported. Check source details and hole assignments.');}catch(e){status(e.message);}};
    $('edSource').disabled=review||candidate?.provider!=='osm';
    $('edSource').onclick=async()=>{const btn=$('edSource');btn.disabled=true;status('Loading selected course features…');try{
      const data=await window.TDPCourseFinder.source(candidate,window.TDPCourseMaps.apiBase());
      if(!active())return;stash();
      try {const built=await window.TDPCourseFinder.prepare(candidate,window.TDPCourseMaps.apiBase());draft=P.fromMap(built);const boundary=P.fromSource(data).features.filter(f=>f.type==='boundary');draft.features.push(...boundary);}
      catch{draft=P.fromSource(data);}
      if(!active())return;setFields();render();fit();saveDraft();status('Course features loaded. Tap a shape to adjust it, or Save & open to use the map.');
    }catch(e){
      status(e.message);
      if(Array.isArray(e.layouts)&&e.layouts.length&&active()) {
        status('This club has more than one course. Choose the layout to map:');
        for(const layout of e.layouts){const choice=document.createElement('button');choice.className='btn';choice.textContent=layout;choice.onclick=()=>{candidate={...candidate,layout};draft.course.name=`${candidate.name} — ${layout}`;$('edSource').click();};$('edStatus').appendChild(choice);}
      }
    }finally{if(active())btn.disabled=false;}};
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
    container.querySelectorAll('[data-tool]').forEach(btn=>btn.onclick=()=>{$('edType').value=btn.dataset.tool;$('edDraw').click();});
    $('edCancel').onclick=()=>{drawing=null;points=[];temporary.clearLayers();drawState();render();status('Drawing cancelled. Saved shapes are unchanged.');};
    $('edSettings').onclick=()=>$('edDrawer').classList.remove('hidden');
    $('edHideSettings').onclick=()=>$('edDrawer').classList.add('hidden');
    $('edFit').onclick=fit;
    $('edUse').hidden=!!review;
    $('edUse').onclick=()=>{try{if(drawing)throw new Error('Finish or cancel the shape you are drawing first.');fields();const geometry=P.assemble(draft,{publish:false});if(!saveDraft())return;window.TDPCourseMaps.openEdited(geometry);}catch(e){status(e.message);}};
    $('edClose').onclick=()=>{if(!review&&!saveDraft())return;close();onClose();};
    container.querySelectorAll('input,textarea,select[data-coverage]').forEach(el=>el.addEventListener('change',()=>{if(!review)saveDraft();}));
    render();fit();$('edClose').focus();
    if(!review&&!geometry&&!hasSavedDraft&&candidate?.provider==='osm')$('edSource').click();
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
