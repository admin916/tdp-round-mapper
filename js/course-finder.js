/* Shared, dependency-free finder helpers. Also loaded by Node regression tests. */
globalThis.TDPCourseFinder = (() => {
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
  return {escape, fromPhoton, search, mappingError, placeKey, requestMessage};
})();
