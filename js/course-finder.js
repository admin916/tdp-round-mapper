/* Shared, dependency-free finder helpers. Also loaded by Node regression tests. */
globalThis.TDPCourseFinder = (() => {
  const MODULE_BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || null;
  const mod = (name) => import(MODULE_BASE ? new URL(name, MODULE_BASE).href : name);
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function fromPhoton(feature) {
    const p = feature?.properties || {}, [lon, lat] = feature?.geometry?.coordinates || [];
    const type = {N:'node',W:'way',R:'relation'}[p.osm_type] || p.osm_type;
    if (!p.name || !['node','way','relation'].includes(type) || !Number.isSafeInteger(Number(p.osm_id)) ||
        !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return null;
    return { id: `osm-${type}-${p.osm_id}`, provider: 'osm', osmType: type, osmId: Number(p.osm_id),
      name: p.name, lat, lon, country: (p.countrycode || '').toUpperCase(),
      loc: [...new Set([p.city || p.county, p.state, p.country].filter(Boolean))].join(', ') };
  }
  async function search(q, {signal, fetcher = fetch} = {}) {
    const response = await fetcher(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&osm_tag=leisure:golf_course&limit=20`,
      {signal, headers:{accept:'application/json'}});
    if (!response.ok) throw new Error(`Course search is unavailable (${response.status}). Try again shortly.`);
    const data = await response.json();
    if (!Array.isArray(data.features)) throw new Error('Course search returned an invalid response. Try again.');
    return [...new Map(data.features.map(fromPhoton).filter(Boolean).map(c => [c.id,c])).values()];
  }
  function mappingError(data) {
    const holes = data?.holes;
    if (!Array.isArray(holes) || !holes.length) return 'This course has been found, but its holes still need mapping.';
    const nums = holes.map(h => h.num), refs = holes.map(h => h.osmRef ?? h.num);
    if (nums.some(n => !Number.isInteger(n) || n < 1 || n > 18) || new Set(nums).size !== nums.length ||
        new Set(refs).size !== refs.length || holes.some(h => h.osmRef != null && h.osmRef !== h.num))
      return 'This map has inconsistent hole numbers and needs review before loading.';
    if (holes.some(h => !h.tee || !h.line?.length || !h.green?.poly?.length)) return 'This course map is incomplete.';
    return null;
  }
  const placeKey = c => JSON.stringify([c.id, c.layout || '']);
  function requestMessage(r) {
    if (!r) return 'No mapping request yet.';
    if (r.status === 'done') return r.course_id ? 'Course map ready to load.' : 'The completed map is no longer available. Please request mapping again.';
    if (r.status === 'building') return 'Checking course geometry…';
    if (r.status === 'failed') return `Mapping needs attention. ${r.error || 'The available geometry could not be mapped.'}`;
    return r.attempts ? 'Mapping service interrupted. A retry is queued.' : 'Mapping request queued. It will be checked when the mapping worker is available.';
  }
  const sources = new Map(), rawSources = new Map();
  /* Course geometry comes straight from OpenStreetMap on the device: the public Overpass
     mirrors answer a course-sized query in a few seconds and allow browser requests, whereas
     routing the same query through the course service added a slow, timeout-prone hop.
     Mirrors are started a few seconds apart and the first good answer wins; the course
     service is only the last resort when every mirror fails. */
  const STAGGER_MS = 5000, MIRROR_TIMEOUT_MS = 45000;
  const mirrorName = (url) => url.replace(/^https?:\/\//, '').split('/')[0];
  /** Run one Overpass QL query against the public mirrors (staggered race). Resolves with the
      elements; rejects with an Error whose .details lists what every mirror said. */
  async function overpassQuery(ql, {fetcher=fetch}={}) {
    const {OVERPASS_MIRRORS} = await mod('./course-build.js');
    const body = 'data=' + encodeURIComponent(ql);
    const controllers = [], timers = [], details = [];
    const attempt = async (url, delay) => {
      if (delay) await new Promise(r => timers.push(setTimeout(r, delay)));
      const controller = new AbortController(); controllers.push(controller);
      const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
      try {
        const response = await fetcher(url, {method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body, signal: controller.signal});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.elements) || data.remark) throw new Error(data.remark || 'no elements');
        return data.elements;
      } catch (e) { details.push(`${mirrorName(url)}: ${e.name === 'AbortError' ? 'timed out' : e.message}`); throw e; }
      finally { clearTimeout(timer); }
    };
    try { return await Promise.any(OVERPASS_MIRRORS.map((url, i) => attempt(url, i * STAGGER_MS))); }
    catch { throw Object.assign(new Error('Map mirrors unavailable'), {details}); }
    finally { timers.forEach(clearTimeout); controllers.forEach(c => c.abort()); }
  }
  async function overpassElements(candidate, {fetcher=fetch}={}) {
    const {queryForCandidate} = await mod('./course-selection.js');
    return overpassQuery(queryForCandidate(candidate), {fetcher});
  }
  async function serviceSource(candidate, base, {fetcher=fetch}={}) {
    const response=await fetcher(base+'/course',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candidate,action:'source'}),signal:AbortSignal.timeout(75000)});
    const data=await response.json();
    if(data.rawElements?.length) rawSources.set(candidate.id,data.rawElements);
    if(!response.ok||data.error) {const error=new Error(data.error||'The map service could not load this course. Try again.');error.layouts=data.layouts;throw error;}
    if(data.candidate?.osmType!==candidate.osmType||data.candidate?.osmId!==candidate.osmId||(data.candidate?.layout||'')!==(candidate.layout||''))throw new Error('The returned map does not match the selected course.');
    if(!Array.isArray(data.elements)||!data.outline)throw new Error('The course service returned incomplete source data.');
    return data;
  }
  async function source(candidate, base, {fetcher=fetch}={}) {
    const key=placeKey(candidate);
    if(sources.has(key)) return sources.get(key);
    const {selectCourseElements}=await mod('./course-selection.js');
    const select=raw=>{
      let selected;
      try { selected=selectCourseElements(raw,candidate); }
      catch(e) { if(e.layouts) rawSources.set(candidate.id,raw); throw e; }   // keep the download for the layout choice
      const result={...selected,candidate,outline:raw.find(e=>e.type===candidate.osmType&&e.id===candidate.osmId)};
      sources.set(key,result);return result;
    };
    if(rawSources.has(candidate.id)) return select(rawSources.get(candidate.id));
    let raw=null, direct=null;
    try { raw=await overpassElements(candidate,{fetcher}); }
    catch(e) { direct=(e.details||[e.message]).join('; '); console.warn('Direct OpenStreetMap download failed, using the course service', direct); }
    if(raw) return select(raw);
    try { const data=await serviceSource(candidate,base,{fetcher}); sources.set(key,data); return data; }
    catch(e) {
      if(e.layouts) throw e;
      throw Object.assign(new Error(`The course map could not be downloaded. Map mirrors: ${direct}. Course service: ${e.message}`), {retryable:true});
    }
  }
  async function prepare(candidate, base) {
    const selected=await source(candidate,base);
    const {buildCourseData,qualityOf}=await mod('./course-build.js');
    let built;
    try { built=buildCourseData(selected.name,candidate.loc||'',selected.elements,null,{expectedHoles:selected.expectedHoles,minHoles:1}); }
    catch(e) { sources.delete(placeKey(candidate)); throw e; }   // a map that cannot be built is fetched again next time
    built.course.id=selected.id;
    return {...built,quality:qualityOf(built.coverage),identity:candidate};
  }
  return {escape, fromPhoton, search, mappingError, placeKey, requestMessage, source, prepare, overpassQuery};
})();
