/* Live course terrain — the same painting God's Eye does, on the app's Leaflet maps.
   Below a minimum zoom it downloads the OpenStreetMap golf polygons for the tiles in view
   (tees, greens, fairways, bunkers, water) straight from the public Overpass mirrors and
   draws them underneath the app's own layers. Works for any course OSM has mapped, before
   a course is downloaded, in the finder preview and while tracing in the editor. */
globalThis.TDPTerrainOverlay = (() => {
  const TILE = 0.05, MIN_ZOOM = 14, MAX_TILES_PER_MOVE = 12, MAX_TILES_KEPT = 80;
  const STYLE = {
    fairway: {color:'#0b6b3a', weight:1.5, fillColor:'#3ddc84', fillOpacity:.35, opacity:.8},
    green:   {color:'#1f7a3a', weight:1,   fillColor:'#8cf5a8', fillOpacity:.55, opacity:.9},
    tee:     {color:'#7a5c00', weight:1,   fillColor:'#ffd400', fillOpacity:.85, opacity:.9},
    bunker:  {color:'#8a7340', weight:1,   fillColor:'#f2dfae', fillOpacity:.8,  opacity:.9},
    water_hazard: {color:'#1d6fd1', weight:1, fillColor:'#3aa0ff', fillOpacity:.55, opacity:.9},
    lateral_water_hazard: {color:'#1d6fd1', weight:1, fillColor:'#3aa0ff', fillOpacity:.55, opacity:.9},
  };
  const ORDER = {fairway:0, water_hazard:1, lateral_water_hazard:1, bunker:2, green:3, tee:4};
  const TYPES = Object.keys(STYLE);
  /* one download cache for every map on the page */
  const tiles = new Map();      // key -> {elements, centre}
  const pending = new Map();
  const query = ([s,w,n,e]) => { const bb=`(${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)})`;
    return `[out:json][timeout:20];(way["golf"~"^(tee|green|fairway|bunker|water_hazard|lateral_water_hazard)$"]${bb};relation["golf"~"^(green|fairway|bunker|water_hazard|lateral_water_hazard)$"]${bb};);out geom;`; };
  function rings(el) {
    if (el.type === 'way') return el.geometry?.length > 3 ? [el.geometry] : [];
    const parts = (el.members||[]).filter(m => (m.role||'outer') === 'outer' && m.geometry?.length > 1).map(m => [...m.geometry]);
    const out = [], eq = (a,b) => a.lat === b.lat && a.lon === b.lon;
    while (parts.length) {
      const ring = parts.shift(); let guard = 0;
      while (!eq(ring[0], ring[ring.length-1]) && guard++ < 200) {
        const end = ring[ring.length-1], i = parts.findIndex(p => eq(p[0],end) || eq(p[p.length-1],end));
        if (i < 0) break; const next = parts.splice(i,1)[0]; if (!eq(next[0],end)) next.reverse(); ring.push(...next.slice(1));
      }
      if (ring.length > 3) out.push(ring);
    }
    return out;
  }
  async function fetchTile(key, bbox) {
    if (tiles.has(key)) return tiles.get(key);
    if (!pending.has(key)) pending.set(key, globalThis.TDPCourseFinder.overpassQuery(query(bbox))
      .then(elements => { const t = {elements, centre:[(bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2]}; tiles.set(key, t); return t; })
      .finally(() => pending.delete(key)));
    return pending.get(key);
  }
  function evict(centre) {
    if (tiles.size <= MAX_TILES_KEPT) return;
    const far = [...tiles.entries()].sort((a,b) => dist(b[1].centre, centre) - dist(a[1].centre, centre));
    for (const [key] of far.slice(0, tiles.size - MAX_TILES_KEPT)) tiles.delete(key);
  }
  const dist = (a,b) => (a[0]-b[0])**2 + ((a[1]-b[1])*Math.cos(b[0]*Math.PI/180))**2;

  /** Attach to a Leaflet map. Returns {setEnabled, enabled, refresh, detach, status}. */
  function attach(map, {enabled=true, minZoom=MIN_ZOOM, onStatus=null}={}) {
    if (!map.getPane('terrainPane')) { map.createPane('terrainPane'); map.getPane('terrainPane').style.zIndex = 350; map.getPane('terrainPane').style.pointerEvents = 'none'; }
    const renderer = L.canvas({pane:'terrainPane'});   // canvas: a dense area is a thousand shapes
    const layer = L.layerGroup().addTo(map), drawn = new Set();
    let on = enabled, seq = 0, loading = 0, shapes = 0, lastError = null;
    const status = () => onStatus?.({shapes, loading, tiles: tiles.size, error: lastError, zoomedOut: map.getZoom() < minZoom});
    function draw(t) {
      for (const el of t.elements) {
        const type = el.tags?.golf; if (!TYPES.includes(type)) continue;
        const id = `${el.type}/${el.id}`; if (drawn.has(id)) continue; drawn.add(id);
        for (const ring of rings(el)) {
          const latlngs = ring.map(p => [p.lat, p.lon]);
          L.polygon(latlngs, {...STYLE[type], pane:'terrainPane', renderer, interactive:false}).addTo(layer); shapes++;
          if (type === 'tee') { const c = latlngs.reduce((a,p) => [a[0]+p[0]/latlngs.length, a[1]+p[1]/latlngs.length], [0,0]);
            L.circleMarker(c, {pane:'terrainPane', renderer, radius:4, color:'#000', weight:1, fillColor:'#ffd400', fillOpacity:1, interactive:false}).addTo(layer); }
        }
      }
    }
    async function refresh() {
      if (!on) return;
      if (map.getZoom() < minZoom) { status(); return; }
      const b = map.getBounds(), c = map.getCenter(), centre = [c.lat, c.lng], my = ++seq, wanted = [];
      for (let row = Math.floor(b.getSouth()/TILE); row <= Math.floor(b.getNorth()/TILE); row++)
        for (let col = Math.floor(b.getWest()/TILE); col <= Math.floor(b.getEast()/TILE); col++) {
          const key = `${row}:${col}`, bbox = [row*TILE, col*TILE, (row+1)*TILE, (col+1)*TILE];
          wanted.push({key, bbox, d: dist([(bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2], centre)});
        }
      wanted.sort((a,b) => a.d - b.d);
      evict(centre);
      for (const {key, bbox} of wanted.slice(0, MAX_TILES_PER_MOVE)) {
        if (tiles.has(key)) { draw(tiles.get(key)); continue; }
        loading++; status();
        fetchTile(key, bbox).then(t => { if (my === seq || on) draw(t); lastError = null; })
          .catch(e => { lastError = e.details?.join('; ') || e.message; })
          .finally(() => { loading--; status(); });
      }
      status();
    }
    function setEnabled(v) { on = !!v; if (on) { layer.addTo(map); refresh(); } else { layer.remove(); } status(); }
    map.on('moveend zoomend', refresh);
    refresh();
    return {setEnabled, enabled: () => on, refresh, status, detach: () => { map.off('moveend zoomend', refresh); layer.remove(); }};
  }
  return {attach, STYLE, cacheSize: () => tiles.size};
})();
