// Shared course assembler — used by BOTH the /course Edge Function (Deno) and
// scripts/prebuild-courses.mjs (Node). Plain JS so both runtimes import it as-is.
// Input: OpenStreetMap elements (Overpass `out geom` shape). Output: the
// window.TDP_COURSE-shaped object the app renders.

const R = 6371000;
const toR = (x) => (x * Math.PI) / 180;
export const HAV = (a, b) => {
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
export const CEN = (p) => ({ lat: p.reduce((s, q) => s + q.lat, 0) / p.length, lon: p.reduce((s, q) => s + q.lon, 0) / p.length });
const brg = (a, b) => {
  const y = Math.sin(toR(b.lon - a.lon)) * Math.cos(toR(b.lat));
  const x = Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) - Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(toR(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
const len = (g) => g.reduce((s, _, i) => (i ? s + HAV(g[i - 1], g[i]) : 0), 0);
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const ring = (g) => g.map((p) => [r6(p.lat), r6(p.lon)]);

export const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// isolate ONE course: centre on the centroid of the 9 holes nearest the geocoded
// point (a robust course centre), then keep features within ~1.8km. Neighbouring
// courses in golf-dense areas sit farther out and are excluded.
export function isolateCourse(els, lat, lon) {
  const withGeom = els.filter((e) => e.geometry?.length);
  const holes = withGeom.filter((e) => e.tags?.golf === "hole" && e.geometry.length >= 2);
  if (!holes.length) return withGeom;
  const near = holes.map((h) => ({ h, d: HAV({ lat, lon }, CEN(h.geometry)) })).sort((a, b) => a.d - b.d).slice(0, 9);
  const centre = CEN(near.flatMap((x) => x.h.geometry));
  return withGeom.filter((e) => HAV(centre, CEN(e.geometry)) < 1800);
}

// Overpass query for everything golf-tagged inside a bbox. Shared so the batch
// script and the Edge Function fetch identical data.
// Mirror order borrowed from God's Eye View's proxy (gods-eye-view/server/providers/local.js):
// lz4 is the same operator as overpass-api.de on separate hardware; private.coffee is a
// community full-planet instance that stayed up when the big three rate-banned dev traffic.
export const OVERPASS_MIRRORS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
// relations carry club names/outlines for big clubs (Sunningdale, Wentworth); `out tags center`
// keeps them light — the assembler only needs their names, never their geometry.
export const overpassQueryForBbox = (s, w, n, e) =>
  `[out:json][timeout:50];(way["golf"](${s},${w},${n},${e});way["leisure"="golf_course"](${s},${w},${n},${e}););out geom;relation["leisure"="golf_course"](${s},${w},${n},${e});out tags center;`;

/**
 * Assemble a course from OSM elements.
 * @param name course name
 * @param location human location string
 * @param els OSM elements with `geometry` (Overpass `out geom`)
 * @param card optional scorecard (from OCR) — {holes:[{num,par,si,pinFront,pinSide,pinSideLetter}]}
 * @param opts { minHoles = 9 } — throw below this many built holes
 * Returns { course, holes, overlays, coverage } — coverage describes how much
 * came from real map/card data versus defaults, so the UI can be honest about it.
 */
export function buildCourseData(name, location, els, card, opts = {}) {
  const minHoles = opts.minHoles ?? 9;
  const geo = els.filter((e) => e.geometry?.length);
  const kind = (k) => geo.filter((e) => e.tags?.golf === k && e.geometry.length > 2);
  const holesRaw = geo.filter((e) => e.tags?.golf === "hole" && e.tags?.ref && e.geometry.length >= 2)
    .sort((a, b) => +a.tags.ref - +b.tags.ref);
  const refs = holesRaw.map(h => +h.tags.ref);
  if (refs.some(n => !Number.isInteger(n) || n < 1 || n > 18) || new Set(refs).size !== refs.length)
    throw new Error("Ambiguous hole numbering: this course needs layout selection or mapping review.");
  const expectedHoles = opts.expectedHoles ?? (card?.holes?.length === 18 ? 18 : null);
  if (holesRaw.length < minHoles) throw new Error(`only ${holesRaw.length} holes mapped in OpenStreetMap yet`);
  const greens = kind("green");
  const cardBy = {}; (card?.holes || []).forEach((h) => (cardBy[h.num] = h));
  // global matching: pair the closest hole-endpoint ↔ green first, so no hole steals another's green
  const pairs = [];
  holesRaw.forEach((h, hi) => { const end = h.geometry[h.geometry.length - 1]; greens.forEach((g, gi) => pairs.push([HAV(CEN(g.geometry), end), hi, gi])); });
  pairs.sort((a, b) => a[0] - b[0]);
  const holeGreen = new Array(holesRaw.length).fill(-1); const gUsed = new Set();
  for (const [dd, hi, gi] of pairs) { if (holeGreen[hi] >= 0 || gUsed.has(gi) || dd > 220) continue; holeGreen[hi] = gi; gUsed.add(gi); }
  let parFromMap = 0, siFromMap = 0, parFromCard = 0;
  const holes = holesRaw.map((h, i) => {
    if (holeGreen[i] < 0) return null;   // no green mapped near this hole — skip it
    const best = greens[holeGreen[i]];
    const line = h.geometry;
    const gC = CEN(best.geometry), b = brg(line[line.length - 2], gC), rad = toR(b);
    const kLat = 111132, kLon = 111320 * Math.cos(toR(gC.lat));
    const ux = Math.sin(rad), uy = Math.cos(rad), vx = Math.cos(rad), vy = -Math.sin(rad);
    let mA = 1e9, xA = -1e9, mB = 1e9, xB = -1e9;
    for (const p of best.geometry) { const X = (p.lon - gC.lon) * kLon, Y = (p.lat - gC.lat) * kLat; const A = X * ux + Y * uy, B = X * vx + Y * vy; if (A < mA) mA = A; if (A > xA) xA = A; if (B < mB) mB = B; if (B > xB) xB = B; }
    const c = cardBy[+h.tags.ref] || {};
    const side = !c.pinSideLetter || c.pinSideLetter === "C" ? "C" : `${c.pinSide ?? 4}${c.pinSideLetter}`;
    const mapPar = (+h.tags.par >= 3 && +h.tags.par <= 6) ? +h.tags.par : 0, mapSi = (+h.tags.handicap >= 1 && +h.tags.handicap <= 18) ? +h.tags.handicap : 0;   // OSM golf=hole par=* / handicap=* (stroke index) — ignore junk values
    if (c.par != null) parFromCard++; else if (mapPar) parFromMap++;
    if (c.si == null && mapSi) siFromMap++;
    return { num: +h.tags.ref, osmRef: +h.tags.ref, par: c.par ?? (mapPar || 4), si: c.si ?? (mapSi || i + 1), metres: Math.round(len(line)),
      id: `osm-${h.type||'way'}-${h.id}`, parSource:c.par!=null?'card':mapPar?'osm':'estimate',
      pin: { front: c.pinFront ?? Math.round(-mA), side, source:c.pinFront!=null?'card':'green-centre' }, line: ring(line), tee: [r6(line[0].lat), r6(line[0].lon)],
      green: { poly: ring(best.geometry), polygons:best.polygons?.map(p=>p.map(ring)), centre: [r6(gC.lat), r6(gC.lon)], approach: Math.round(b * 10) / 10, depth: Math.round(xA - mA), width: Math.round(xB - mB), frontOffset: Math.round(-mA) } };
  }).filter(Boolean);
  if (holes.length < minHoles) throw new Error(`only ${holes.length} holes fully mapped in OpenStreetMap yet`);
  const tc = CEN(holes.map((h) => ({ lat: h.tee[0], lon: h.tee[1] })));
  const polygons=e=>e.polygons?e.polygons.map(p=>p.map(ring)):[ring(e.geometry)];
  const ov = (k) => kind(k).flatMap(polygons);
  const overlays = { fairway: ov("fairway"), green: ov("green"), bunker: ov("bunker"),
    water: [...ov("water_hazard"), ...ov("lateral_water_hazard"),...geo.filter(e=>e.tags?.natural==='water').flatMap(polygons)],
    penalty:[...ov("water_hazard"),...ov("lateral_water_hazard")],
    woodland:geo.filter(e=>e.tags?.natural==='wood'||e.tags?.landuse==='forest').flatMap(polygons), rough: ov("rough"), tee: ov("tee") };
  const coverage = {
    holesMapped: holesRaw.length, holesBuilt: holes.length,
    expectedHoles, holeRefs: holes.map(h => h.num),
    missingGreens: refs.filter(n => !holes.some(h => h.num === n)),
    validationVersion: 2,
    parFromMap, parFromCard, siFromMap, siFromCard: Object.keys(cardBy).length,
    overlays: Object.fromEntries(Object.entries(overlays).map(([k, v]) => [k, v.length])),
    ratingSource: card?.slope && card?.rating ? "card" : "unknown",
    features:Object.fromEntries(Object.entries(overlays).map(([k,v])=>[k,{source:'OpenStreetMap',observed:v.length,completeness:'unknown'}])),
  };
  return {
    course: { name, location, lat: r6(tc.lat), lon: r6(tc.lon), teeSet: "White", units: "metres",
      par: holes.reduce((s, h) => s + h.par, 0), totalMetres: holes.reduce((s, h) => s + h.metres, 0),
      slope: card?.slope ?? null, rating: card?.rating ?? null },
    holes, overlays, coverage, trees:els.filter(e=>e.tags?.natural==='tree' && Number.isFinite(e.lat)).map(e=>[e.lat,e.lon]),
    provenance:{source:'OpenStreetMap',license:'ODbL-1.0',retrievedAt:new Date().toISOString(),reviewStatus:'unreviewed'},
  };
}

/** Full hole geometry requires a known expected count and unique original references. */
export function qualityOf(coverage) {
  const b = coverage.holesBuilt, m = coverage.holesMapped;
  const refs = coverage.holeRefs || [];
  const unique = refs.length === b && new Set(refs).size === b;
  const sequential = unique && [...refs].sort((a,b)=>a-b).every((n,i)=>n===i+1);
  if (coverage.validationVersion === 2 && sequential && b === m && b === coverage.expectedHoles && (b === 9 || b === 18)) return "full";
  if (b > 0) return "partial";
  return "outline";
}
