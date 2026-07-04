/* ═══════════════ TDP · Train Don't Play — Round Mapper ═══════════════ */
/* Valderrama PoC · James Slate · White tees · 03/07/2026                */
(() => {
"use strict";

const COURSE = window.TDP_COURSE;
const STORE_KEY = "tdp.round.valderrama.v6";
const ROUND_DATE = "2026-07-03";

/* ── domain constants ─────────────────────────────────────────────── */
const CLUBS = ["Dr", "3W", "5W", "7W", "Hy", "3i", "4i", "5i", "6i", "7i", "8i", "9i", "PW", "GW", "SW", "LW", "Putt"];
const SHAPES = ["Draw", "Straight", "Fade"];
const HEIGHTS = ["Low", "Normal", "High"];
const LIES = {
  tee:      { label: "Tee",         conds: [] },
  fairway:  { label: "Fairway",     conds: ["Normal", "In Divot"] },
  firstcut: { label: "First Cut",   conds: ["Normal", "Covered"] },
  rough:    { label: "Heavy Rough", conds: ["Normal", "Covered"] },
  bunker:   { label: "Bunker",      conds: ["On Top", "Plugged"] },
  fringe:   { label: "Fringe",      conds: [] },
  green:    { label: "Green",       conds: [] },
  penalty:  { label: "Penalty",     conds: ["Drop Taken"] },
};
const QUADS = { FL: "Front Left", FR: "Front Right", BL: "Back Left", BR: "Back Right", FC: "Front Centre", BC: "Back Centre" };

/* ── geo helpers ──────────────────────────────────────────────────── */
const toRad = (d) => (d * Math.PI) / 180;
function distM(a, b) { // [lat,lng] pairs
  const R = 6371000, dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearingDeg(a, b) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
            Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function destPoint(p, brg, d) {
  const dy = d * Math.cos(toRad(brg)), dx = d * Math.sin(toRad(brg));
  return [p[0] + dy / 111132, p[1] + dx / (111320 * Math.cos(toRad(p[0])))];
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointAlongLine(line, dist) {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const seg = distM(line[i], line[i + 1]);
    if (acc + seg >= dist) {
      const f = (dist - acc) / seg;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f];
    }
    acc += seg;
  }
  return line[line.length - 1].slice();
}

/* ── per-hole derived geometry (pin position, green frame) ────────── */
function greenFrame(hole) {
  const g = hole.green, c = g.centre, rad = toRad(g.approach);
  const u = [Math.sin(rad), Math.cos(rad)];   // metres-east/north unit along approach (toward back)
  const v = [Math.cos(rad), -Math.sin(rad)];  // right of approach
  const kLat = 111132, kLon = 111320 * Math.cos(toRad(c[0]));
  const pts = g.poly.map((p) => {
    const x = (p[1] - c[1]) * kLon, y = (p[0] - c[0]) * kLat;
    return { a: x * u[0] + y * u[1], b: x * v[0] + y * v[1] };
  });
  const minA = Math.min(...pts.map((p) => p.a)), maxA = Math.max(...pts.map((p) => p.a));
  const minB = Math.min(...pts.map((p) => p.b)), maxB = Math.max(...pts.map((p) => p.b));
  return { pts, minA, maxA, minB, maxB, midA: (minA + maxA) / 2, midB: (minB + maxB) / 2 };
}
function parseSide(side) {
  if (!side || side === "C") return { d: 0, s: "C" };
  return { d: parseFloat(side), s: side.slice(-1) };
}
function pinLocal(hole, frame) { // pin in green frame coords {a,b}
  const side = parseSide(hole.pin.side);
  const a = frame.minA + hole.pin.front;
  const b = side.s === "C" ? frame.midB : frame.midB + (side.s === "R" ? side.d : -side.d);
  return { a: Math.min(a, frame.maxA - 1), b };
}
function pinLatLng(hole) {
  const frame = greenFrame(hole), p = pinLocal(hole, frame);
  return destPoint(destPoint(hole.green.centre, hole.green.approach, p.a), hole.green.approach + 90, p.b);
}
function autoQuadrant(hole) {
  const frame = greenFrame(hole), p = pinLocal(hole, frame);
  const fb = p.a < frame.midA ? "F" : "B";
  const s = parseSide(hole.pin.side).s;
  return fb + (s === "C" ? "C" : s);
}

/* ── lie detection against OSM polygons ───────────────────────────── */
const HIT_ORDER = [
  ["green", "green"], ["tee", "tee"], ["bunker", "bunker"],
  ["water", "penalty"], ["fairway", "fairway"], ["rough", "firstcut"],
];
function detectLie(pt) {
  for (const [layer, lie] of HIT_ORDER) {
    for (const poly of COURSE.overlays[layer]) if (pointInPoly(pt, poly)) return lie;
  }
  return "rough"; // outside all mapped areas → heavy rough
}

/* ── club suggestion by segment distance (metres, low-hcp) ────────── */
function suggestClub(dist, fromLie) {
  if (fromLie === "green") return "Putt";
  const t = [[215, "3W"], [200, "Hy"], [185, "4i"], [172, "5i"], [158, "6i"], [144, "7i"], [130, "8i"], [116, "9i"], [100, "PW"], [82, "GW"], [55, "SW"], [0, "LW"]];
  if (dist >= 230) return "Dr";
  for (const [d, c] of t) if (dist >= d) return c;
  return "LW";
}

/* ── extended card: field model, OCR draft + user corrections ────────
   One entry per hole. `review` lists fields the OCR read with low
   confidence — highlighted in the card screen until the user confirms.
   Front nine transcribed from Sources/ScoreCard - Finished.jpeg,
   cross-checked against Sources/First_Nine_Holes_Performance_Report.pdf.
   IMPORTANT: the player writes distances in YARDS (per the PDF
   interpretation); the course card and all map plotting are metres. */
const FT = 0.3048;
const YD = 0.9144;
const CARD_SEED = {
  1: { score: 5, fir: false, missSide: "L", teeClub: "5W", teeDist: 255, apprFrom: 140, apprClub: "GW", gir: false, putts: 1, lastPuttFt: 7, review: [] },
  2: { score: 5, fir: true, teeClub: "5i", teeDist: 220, apprFrom: 144, apprClub: "PW", gir: false, putts: 2, lastPuttFt: 2, review: ["teeClub"] },
  3: { score: 3, teeClub: "8i", notedDist: 105, gir: true, firstPuttFt: 25, putts: 2, lastPuttFt: 2, review: ["notedDist"] },
  4: { score: 4, fir: true, teeClub: "Dr", teeDist: 315, apprFrom: 240, apprClub: null, gir: true, firstPuttFt: 25, putts: 2, lastPuttFt: 4, review: ["apprClub"] },
  5: { score: 4, fir: true, teeClub: "3W", teeDist: 260, apprFrom: 105, apprClub: null, gir: false, putts: 1, lastPuttFt: 4, review: ["apprClub"] },
  6: { score: 4, teeClub: "8i", notedDist: 160, gir: true, firstPuttFt: 48, putts: 3, lastPuttFt: 1, review: [] },
  7: { score: 4, fir: true, teeClub: "Dr", teeDist: 315, apprFrom: 151, apprClub: null, gir: false, putts: 1, lastPuttFt: 1, review: ["fir", "apprClub"] },
  8: { score: 3, fir: false, missSide: "R", teeClub: "Dr", teeDist: 290, apprFrom: 35, apprClub: "LW", gir: true, firstPuttFt: 6, putts: 1, lastPuttFt: 6, review: ["apprClub"] },
  9: { score: 5, fir: true, teeClub: "Dr", teeDist: 282, apprFrom: 153, apprClub: null, gir: false, putts: 2, lastPuttFt: 2, review: ["apprClub"] },
  // back nine from Sources/ScoreCard - Finished-18Holes.jpeg
  // card tallies used as checksums: fairways 6/14, GIR 8/18, putts 15+15=30, In 38, total 75
  10: { score: 5, fir: false, teeClub: "7W", teeDist: 230, apprFrom: 142, apprClub: null, gir: false, putts: 2, lastPuttFt: 2, review: ["teeClub", "apprClub"] },
  11: { score: 5, fir: false, teeClub: "Dr", teeDist: 307, apprFrom: 32, apprClub: null, gir: true, firstPuttFt: 30, putts: 2, lastPuttFt: 2, review: ["apprClub"] },
  12: { score: 3, teeClub: "5i", notedDist: 205, gir: true, firstPuttFt: 30, putts: 2, lastPuttFt: 3, review: ["notedDist"] },
  13: { score: 4, fir: false, teeClub: "3W", teeDist: 260, apprFrom: 108, apprClub: null, gir: false, putts: 1, lastPuttFt: 18, review: ["apprFrom", "apprClub"] },
  14: { score: 4, fir: false, teeClub: "5W", teeDist: 245, apprFrom: 97, apprClub: null, gir: false, putts: 1, lastPuttFt: 6, review: ["apprClub"] },
  15: { score: 3, teeClub: null, notedDist: 220, gir: true, firstPuttFt: 18, putts: 2, lastPuttFt: 7, review: ["teeClub"] },
  16: { score: 5, fir: false, teeClub: "7W", teeDist: 240, apprFrom: 127, apprClub: null, gir: false, putts: 2, lastPuttFt: 5, review: ["teeClub", "apprClub"] },
  17: { score: 4, fir: true, teeClub: "Dr", teeDist: 345, apprFrom: 92, apprClub: null, gir: true, firstPuttFt: 4, putts: 1, lastPuttFt: 4, review: ["teeDist", "apprClub"] },
  18: { score: 5, fir: false, teeClub: "Dr", teeDist: 296, apprFrom: 161, apprClub: null, gir: false, putts: 2, lastPuttFt: 7, review: ["apprClub"] },
};

/* card entry → shot script. Strokes = score − putts, distributed as:
   tee, [recoveries/layups], approach, [chips]. Drive positions are solved
   by circle-circle intersection (tee dist × approach-from dist) when the
   drive is immediately followed by the approach. */
function compileCard(hole, c) {
  const putts = c.putts ?? 2;
  const score = c.score ?? hole.par;
  const strokes = Math.max(1, score - putts);
  const firstPuttFt = c.firstPuttFt ?? (putts <= 1 ? (c.lastPuttFt ?? 4) : 13);
  const shots = [];

  if (hole.par === 3) {
    if (c.gir) shots.push({ kind: "tee3", club: c.teeClub || suggestClub(hole.metres, "tee"), gir: true });
    else {
      shots.push({ kind: "tee3miss", club: c.teeClub || suggestClub(hole.metres, "tee") });
      for (let i = 0; i < Math.max(1, strokes - 1); i++) shots.push({ kind: "chip", club: "LW", lie: "fringe" });
    }
  } else {
    const chips = c.gir ? 0 : 1;
    const recoveries = Math.max(0, strokes - 2 - chips);
    // card distances are in yards (as the player writes them) → metres for plotting
    const teeM = Math.round((c.teeDist || 270) * YD);
    const apprM = c.apprFrom ? Math.round(c.apprFrom * YD) : null;
    const tee = {
      kind: "tee", club: c.teeClub || "Dr", dist: teeM,
      shape: c.missSide === "L" ? "Draw" : c.missSide === "R" ? "Fade" : "Straight",
    };
    if (recoveries === 0 && apprM) { tee.toPin = apprM; tee.missSide = c.missSide || null; }
    else tee.offside = c.fir === false ? (c.missSide === "R" ? 1 : -1) : 0;
    shots.push(tee);
    for (let i = 0; i < recoveries; i++) shots.push({
      kind: "layto", toPin: apprM || Math.round(hole.metres * 0.3),
      club: c.fir === false ? "4i" : "3i",
      lie: c.fir === false ? "rough" : "fairway", cond: "Normal",
      height: c.fir === false ? "Low" : "Normal",
    });
    shots.push({
      kind: "approach", club: c.apprClub || null, gir: !!c.gir,
      lie: recoveries > 0 ? "fairway" : c.fir === false ? "firstcut" : "fairway",
    });
    for (let i = 0; i < chips; i++) shots.push({ kind: "chip", club: "LW", lie: "fringe" });
  }
  return { putts, firstPuttFt, shots };
}

function lineLength(line) {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) acc += distM(line[i], line[i + 1]);
  return acc;
}
/* OSM hole lines start at the back (black) tees. Shift each hole's start
   forward along the centerline so the playing length matches the White-tee
   card distance — all plotting then measures from the correct box. */
function adjustToWhiteTees() {
  COURSE.holes.forEach((h) => {
    const line = h.line.map((p) => p.slice());
    if (distM(line[line.length - 1], h.green.centre) > 8) line.push(h.green.centre.slice());
    const offset = lineLength(line) - h.metres;
    if (offset <= 5) return;
    const out = [];
    let acc = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const seg = distM(line[i], line[i + 1]);
      if (!out.length && acc + seg >= offset) {
        const f = (offset - acc) / seg;
        out.push([line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f]);
      }
      if (out.length) out.push(line[i + 1]);
      acc += seg;
    }
    if (out.length > 1) { h.line = out; h.tee = out[0].slice(); }
  });
}
adjustToWhiteTees();
function distToCenterline(pt, line) {
  const total = lineLength(line);
  let best = Infinity;
  for (let d = 0; d <= total; d += 20) best = Math.min(best, distM(pt, pointAlongLine(line, d)));
  return best;
}
function plotRecorded(hole, rec) {
  const pin = pinLatLng(hole);
  const tee = hole.tee.slice();
  const kLat = 111132, kLon = 111320 * Math.cos(toRad(pin[0]));
  const fromPin = (p) => [(p[1] - pin[1]) * kLon, (p[0] - pin[0]) * kLat]; // metric vector pin→p
  const atPin = (v) => [pin[0] + v[1] / kLat, pin[1] + v[0] / kLon];
  const scaled = (v, len) => { const m = Math.hypot(v[0], v[1]) || 1; return [v[0] * len / m, v[1] * len / m]; };
  const fpm = Math.round(rec.firstPuttFt * FT * 10) / 10;

  const wps = [tee], shots = [];
  let cur = tee;
  rec.shots.forEach((sp, idx) => {
    let next;
    if (sp.kind === "tee" && sp.toPin != null) {
      const D = distM(tee, pin), b = bearingDeg(tee, pin);
      const cosA = Math.max(-1, Math.min(1, (sp.dist ** 2 + D ** 2 - sp.toPin ** 2) / (2 * sp.dist * D)));
      const alpha = (Math.acos(cosA) * 180) / Math.PI;
      const cands = [destPoint(tee, b - alpha, sp.dist), destPoint(tee, b + alpha, sp.dist)]; // [left, right]
      if (sp.missSide === "L") next = cands[0];
      else if (sp.missSide === "R") next = cands[1];
      else next = distToCenterline(cands[0], hole.line) <= distToCenterline(cands[1], hole.line) ? cands[0] : cands[1];
    } else if (sp.kind === "tee") { // no approach-from constraint: land on the centerline, offset if missed
      const d = Math.min(sp.dist, lineLength(hole.line) - 5);
      let base = pointAlongLine(hole.line, d);
      if (sp.offside) {
        const dir = bearingDeg(pointAlongLine(hole.line, Math.max(0, d - 15)), pointAlongLine(hole.line, d + 15));
        base = destPoint(base, dir + 90 * sp.offside, 18); // just past the fairway edge
      }
      next = base;
    } else if (sp.kind === "tee3") {
      next = atPin(scaled(fromPin(tee), fpm)); // on green, short side, at first-putt distance
    } else if (sp.kind === "tee3miss") {
      next = atPin(scaled(fromPin(tee), hole.pin.front + 4)); // greenside, short of the front edge
    } else if (sp.kind === "layto") { // recovery/layup to a known distance from the pin, back toward the fairway
      const linePt = pointAlongLine(hole.line, Math.max(0, lineLength(hole.line) - sp.toPin));
      const vc = scaled(fromPin(cur), 1), vl = scaled(fromPin(linePt), 1);
      next = atPin(scaled([vc[0] * 0.35 + vl[0] * 0.65, vc[1] * 0.35 + vl[1] * 0.65], sp.toPin));
    } else if (sp.kind === "approach") {
      next = sp.gir
        ? atPin(scaled(fromPin(cur), fpm))                       // finished on green at first-putt distance
        : atPin(scaled(fromPin(cur), hole.pin.front + 3));       // just short of the front edge
    } else { // chip: last one finishes at first-putt distance, intermediates stay greenside
      const isLast = !rec.shots.slice(idx + 1).some((s) => s.kind === "chip");
      next = atPin(scaled(fromPin(cur), isLast ? fpm : Math.max(fpm + 4, 6)));
    }
    const lie = sp.kind.startsWith("tee") ? "tee" : sp.lie;
    shots.push({
      club: sp.club || suggestClub(distM(cur, pin), lie), shape: sp.shape || "Straight", height: sp.height || "Normal",
      lie, cond: sp.cond ?? (LIES[lie].conds[0] || null), lieAuto: false,
    });
    wps.push(next); cur = next;
  });
  return {
    waypoints: wps, shots, putts: rec.putts, penalties: 0,
    firstPuttDist: fpm, quadrant: autoQuadrant(hole), touched: true,
  };
}
function plotFromCard(hole, entry) { return plotRecorded(hole, compileCard(hole, entry)); }

/* ── state ────────────────────────────────────────────────────────── */
let round = null;
let curHole = 1;
let selShot = 0;
let saveTimer = null;

function newShot(fromPt, dist, isTee) {
  const lie = isTee ? "tee" : detectLie(fromPt);
  return {
    club: isTee && dist >= 230 ? "Dr" : suggestClub(dist, lie),
    shape: "Straight", height: "Normal",
    lie, cond: LIES[lie].conds[0] || null, lieAuto: true,
  };
}
function seedHole(hole) {
  const pin = pinLatLng(hole);
  const finish = destPoint(pin, hole.green.approach, -2.5); // default finish just short of pin
  const line = hole.line.concat([finish]);
  const wps = [hole.tee.slice()];
  if (hole.par === 4) wps.push(pointAlongLine(line, Math.min(245, hole.metres * 0.68)));
  if (hole.par === 5) {
    wps.push(pointAlongLine(line, 245));
    wps.push(pointAlongLine(line, Math.max(300, hole.metres - 95)));
  }
  wps.push(finish);
  const shots = wps.slice(0, -1).map((p, i) => newShot(p, distM(p, wps[i + 1]), i === 0));
  return {
    waypoints: wps, shots, putts: 2, penalties: 0,
    firstPuttDist: null, quadrant: autoQuadrant(hole), touched: false,
  };
}
function defaultRound() {
  // starts blank: card data arrives via Import → Run OCR draft (or manual entry)
  const holes = {};
  COURSE.holes.forEach((h) => (holes[h.num] = seedHole(h)));
  return {
    app: "TDP — Train Don't Play", version: 3,
    player: { name: "James Slate", tees: "White" },
    course: COURSE.course, date: ROUND_DATE,
    weather: null, card: {}, ocrApplied: false, holes,
  };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { round = JSON.parse(raw); return; }
  } catch (e) { console.warn("state load failed", e); }
  round = defaultRound();
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(STORE_KEY, JSON.stringify(round)), 250);
}
const H = () => COURSE.holes[curHole - 1];      // course hole
const S = () => round.holes[curHole];            // state hole
function touch() { S().touched = true; save(); }

/* ── scoring helpers ──────────────────────────────────────────────── */
function holeScore(n) {
  const s = round.holes[n];
  return s.shots.length + s.putts + s.penalties;
}
function scoreClass(score, par) {
  const d = score - par;
  if (d <= -2) return "sc-eagle";
  if (d === -1) return "sc-birdie";
  if (d === 0) return "sc-par";
  if (d === 1) return "sc-bogey";
  return "sc-double";
}
function toParStr(d) { return d === 0 ? "E" : d > 0 ? "+" + d : "" + d; }

/* ═══════════════ MAP ═══════════════ */
const map = L.map("map", {
  zoomControl: false, attributionControl: true,
  zoomSnap: 0.25, zoomAnimation: true, maxZoom: 22,
});
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Imagery © Esri, Maxar, Earthstar Geographics · Course data © OpenStreetMap contributors",
  maxNativeZoom: 19, maxZoom: 22,
}).addTo(map);

map.setView([COURSE.course.lat, COURSE.course.lon], 15);

const canvas = L.canvas({ padding: 0.4 });
const OVERLAY_STYLE = {
  rough:   { color: "#3f7a4d", weight: 0,   fillColor: "#2c6e42", fillOpacity: 0.13 },
  fairway: { color: "#58c47c", weight: 1,   fillColor: "#3f9e5f", fillOpacity: 0.22, opacity: 0.35 },
  tee:     { color: "#7ee0a8", weight: 1,   fillColor: "#57b981", fillOpacity: 0.3,  opacity: 0.5 },
  water:   { color: "#5aa7e8", weight: 1,   fillColor: "#3a7bd5", fillOpacity: 0.4,  opacity: 0.6 },
  bunker:  { color: "#efe2b0", weight: 1,   fillColor: "#e8d9a8", fillOpacity: 0.5,  opacity: 0.7 },
  green:   { color: "#9ff0c3", weight: 1.4, fillColor: "#6fdc9f", fillOpacity: 0.3,  opacity: 0.85 },
};
["rough", "fairway", "tee", "water", "bunker", "green"].forEach((k) => {
  COURSE.overlays[k].forEach((poly) =>
    L.polygon(poly, { ...OVERLAY_STYLE[k], renderer: canvas, interactive: false }).addTo(map));
});

let mapObjs = []; // per-hole leaflet objects
function clearHoleLayer() { mapObjs.forEach((o) => map.removeLayer(o)); mapObjs = []; }

function drawHole(fit) {
  clearHoleLayer();
  const hole = H(), st = S();
  const wps = st.waypoints, pin = pinLatLng(hole);
  const path = wps.concat([]);

  // route glow + line
  mapObjs.push(L.polyline(path, { color: "#23c68b", weight: 7, opacity: 0.22, renderer: canvas, interactive: false }).addTo(map));
  mapObjs.push(L.polyline(path, { color: "#ffffff", weight: 2.2, opacity: 0.92, dashArray: "1 7", lineCap: "round", renderer: canvas, interactive: false }).addTo(map));

  // segment distance labels
  for (let i = 0; i < wps.length - 1; i++) {
    const mid = [(wps[i][0] + wps[i + 1][0]) / 2, (wps[i][1] + wps[i + 1][1]) / 2];
    const d = Math.round(distM(wps[i], wps[i + 1]));
    const lbl = L.marker(mid, {
      interactive: false,
      icon: L.divIcon({ className: "seg-anchor", html: `<div class="seg-label">${d}m<small>${st.shots[i]?.club || ""}</small></div>`, iconSize: [0, 0] }),
    }).addTo(map);
    mapObjs.push(lbl);
  }

  // waypoint markers
  wps.forEach((p, i) => {
    const cls = "wp-dot" + (i === 0 ? " tee" : "") + (i === selShot ? " selected" : "");
    const mk = L.marker(p, {
      draggable: true, autoPan: true,
      icon: L.divIcon({ className: "wp-anchor", html: `<div class="${cls}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
    }).addTo(map);
    mk.on("dragend", () => {
      const ll = mk.getLatLng();
      st.waypoints[i] = [ll.lat, ll.lng];
      if (i < st.shots.length && st.shots[i].lieAuto) {
        const lie = i === 0 ? "tee" : detectLie(st.waypoints[i]);
        st.shots[i].lie = lie; st.shots[i].cond = LIES[lie].conds[0] || null;
      }
      touch(); drawHole(false); renderPanel();
    });
    mk.on("click", () => { selShot = Math.min(i, st.shots.length - 1); drawHole(false); renderPanel(); });
    mapObjs.push(mk);
  });

  // pin flag
  mapObjs.push(L.marker(pin, {
    interactive: false,
    icon: L.divIcon({ className: "wp-anchor", html: `<div class="wp-pin">⛳</div>`, iconSize: [26, 26], iconAnchor: [13, 22] }),
  }).addTo(map));

  if (fit) {
    const b = L.latLngBounds(hole.line.concat(hole.green.poly));
    map.flyToBounds(b, { paddingTopLeft: [90, 100], paddingBottomRight: [90, 70], duration: 0.8 });
  }
}

map.on("click", (e) => {
  const st = S();
  const pt = [e.latlng.lat, e.latlng.lng];
  const from = st.waypoints[st.waypoints.length - 1];
  st.waypoints.push(pt);
  st.shots.push(newShot(from, distM(from, pt), st.waypoints.length === 2));
  selShot = st.shots.length - 1;
  touch(); drawHole(false); renderPanel();
});

/* ═══════════════ WEATHER ═══════════════ */
const WX_URL = `https://api.open-meteo.com/v1/forecast?latitude=${COURSE.course.lat}&longitude=${COURSE.course.lon}` +
  `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl` +
  `&timezone=Europe%2FMadrid&wind_speed_unit=kmh`;

async function loadWeather() {
  const bar = document.getElementById("weatherBar");
  try {
    const r = await fetch(WX_URL);
    const j = await r.json();
    const c = j.current;
    round.weather = { fetched: c.time, ...c }; save();
    bar.innerHTML = `
      <span class="wx-item">🌡 <b>${Math.round(c.temperature_2m)}°C</b> <span style="color:var(--txt-3)">feels ${Math.round(c.apparent_temperature)}°</span></span>
      <span class="wx-item"><span class="wx-arrow" style="transform:rotate(${(c.wind_direction_10m + 180) % 360}deg)">↑</span>
        <b>${Math.round(c.wind_speed_10m)}</b> km/h <span style="color:var(--txt-3)">g${Math.round(c.wind_gusts_10m)}</span></span>
      <span class="wx-item">💧 <b>${c.relative_humidity_2m}%</b></span>
      <span class="wx-item">⏱ <b>${Math.round(c.pressure_msl)}</b> hPa</span>`;
    renderHudWind();
  } catch (e) {
    bar.innerHTML = `<span class="wx-loading">weather unavailable ${round.weather ? "· using saved snapshot" : ""}</span>`;
    if (round.weather) renderHudWind();
  }
}
function renderHudWind() {
  const el = document.getElementById("hudWind");
  const w = round.weather;
  if (!w) { el.innerHTML = ""; return; }
  const hole = H();
  const holeBrg = bearingDeg(hole.tee, hole.green.centre);
  const rel = (w.wind_direction_10m - holeBrg + 360) % 360;
  let tag;
  if (rel >= 315 || rel < 45) tag = "INTO";
  else if (rel >= 135 && rel < 225) tag = "HELPING";
  else if (rel < 135) tag = "CROSS R→L";
  else tag = "CROSS L→R";
  el.innerHTML = `<span class="wx-arrow" style="transform:rotate(${(rel + 180) % 360}deg)">↑</span>
    <span><b style="color:var(--txt)">${tag}</b> · ${Math.round(w.wind_speed_10m)} km/h</span>`;
}

/* ═══════════════ PANEL RENDERING ═══════════════ */
const $ = (id) => document.getElementById(id);

function renderRail() {
  const rail = $("holerail");
  rail.innerHTML = "";
  COURSE.holes.forEach((h) => {
    const st = round.holes[h.num];
    const btn = document.createElement("button");
    btn.className = "hole-chip" + (h.num === curHole ? " active" : "");
    const sc = st.touched ? `<span class="hc-score ${scoreClass(holeScore(h.num), h.par)}">${holeScore(h.num)}</span>` : "";
    btn.innerHTML = `${sc}<span class="hc-num">${h.num}</span><span class="hc-par">P${h.par}</span>`;
    btn.onclick = () => gotoHole(h.num);
    rail.appendChild(btn);
  });
}

function renderHud() {
  const h = H();
  $("hudNum").textContent = h.num;
  $("hudFacts").innerHTML = `PAR ${h.par} · ${h.metres}m · SI ${h.si}` +
    (round.card[h.num] ? ` · <span style="color:var(--gold)">FROM CARD</span>` : "");
  renderHudWind();
}

function segBtns(el, options, current, onPick, warnVal) {
  el.innerHTML = "";
  options.forEach((o) => {
    const b = document.createElement("button");
    b.textContent = o;
    b.className = o === current ? "on" + (o === warnVal ? " warn" : "") : "";
    b.onclick = () => onPick(o);
    el.appendChild(b);
  });
}

function renderShotList() {
  const st = S(), hole = H(), pin = pinLatLng(hole);
  const list = $("shotList");
  list.innerHTML = "";
  st.shots.forEach((sh, i) => {
    const from = st.waypoints[i], to = st.waypoints[i + 1];
    const d = Math.round(distM(from, to));
    const toPin = Math.round(distM(to, pin));
    const li = document.createElement("li");
    li.className = "shot-row" + (i === selShot ? " selected" : "");
    li.innerHTML = `
      <span class="sr-num">${i + 1}</span>
      <span class="sr-main">
        <div class="sr-club">${sh.club}<span style="color:var(--txt-3);font-weight:500"> · ${sh.shape} · ${sh.height}</span></div>
        <div class="sr-detail">${LIES[sh.lie].label}${sh.cond ? " (" + sh.cond + ")" : ""} → ${toPin <= 3 ? "at the pin" : toPin + "m to pin"}</div>
      </span>
      <span class="sr-dist">${d}m<small>${sh.club === "Putt" ? "putt" : "shot"}</small></span>`;
    li.onclick = () => { selShot = i; drawHole(false); renderPanel(); };
    list.appendChild(li);
  });
  const score = holeScore(curHole), d = score - hole.par;
  $("holeScorePill").textContent = `${score} (${toParStr(d)}) · ${st.shots.length} shots + ${st.putts} putts${st.penalties ? " + " + st.penalties + " pen" : ""}`;
  const lbl = $("sheetLabel");
  if (lbl) lbl.innerHTML = `Hole ${curHole} · <b>${score} (${toParStr(d)})</b> · ${st.shots.length} shots + ${st.putts} putts · tap to edit`;
}

function renderEditor() {
  const st = S(), sh = st.shots[selShot];
  if (!sh) { $("editorBlock").style.display = "none"; return; }
  $("editorBlock").style.display = "";
  const from = st.waypoints[selShot], to = st.waypoints[selShot + 1];
  $("editorTitle").textContent = `Shot ${selShot + 1}`;
  $("editorDist").textContent = Math.round(distM(from, to)) + "m";

  const grid = $("clubGrid");
  grid.innerHTML = "";
  CLUBS.forEach((c) => {
    const b = document.createElement("button");
    b.className = "club-btn" + (sh.club === c ? " on" : "");
    b.textContent = c;
    b.onclick = () => { sh.club = c; touch(); drawHole(false); renderPanel(); };
    grid.appendChild(b);
  });

  segBtns($("segShape"), SHAPES, sh.shape, (v) => { sh.shape = v; touch(); renderPanel(); });
  segBtns($("segHeight"), HEIGHTS, sh.height, (v) => { sh.height = v; touch(); renderPanel(); });
  segBtns($("segLie"), Object.keys(LIES).map((k) => LIES[k].label), LIES[sh.lie].label, (label) => {
    const key = Object.keys(LIES).find((k) => LIES[k].label === label);
    sh.lie = key; sh.cond = LIES[key].conds[0] || null; sh.lieAuto = false;
    touch(); renderPanel();
  }, "Penalty");
  $("lieAutoTag").style.display = sh.lieAuto ? "" : "none";
  const conds = LIES[sh.lie].conds;
  $("segCond").style.display = conds.length ? "" : "none";
  segBtns($("segCond"), conds, sh.cond, (v) => { sh.cond = v; touch(); renderPanel(); });
}

/* green quadrant SVG */
function renderGreen() {
  const hole = H(), st = S();
  const frame = greenFrame(hole), p = pinLocal(hole, frame);
  const pad = 3;
  const w = frame.maxB - frame.minB + pad * 2, hgt = frame.maxA - frame.minA + pad * 2;
  const X = (b) => b - frame.minB + pad;
  const Y = (a) => frame.maxA - a + pad; // front (minA) at bottom
  const path = frame.pts.map((q, i) => `${i ? "L" : "M"}${X(q.b).toFixed(1)},${Y(q.a).toFixed(1)}`).join("") + "Z";

  const quads = [
    ["BL", 0, 0, X(frame.midB), Y(frame.midA)],
    ["BR", X(frame.midB), 0, w - X(frame.midB), Y(frame.midA)],
    ["FL", 0, Y(frame.midA), X(frame.midB), hgt - Y(frame.midA)],
    ["FR", X(frame.midB), Y(frame.midA), w - X(frame.midB), hgt - Y(frame.midA)],
  ];
  const active = st.quadrant;
  const quadSvg = quads.map(([q, x, y, qw, qh]) => `
    <clipPath id="clip${q}"><rect x="${x}" y="${y}" width="${qw}" height="${qh}"/></clipPath>
    <path d="${path}" class="quad-path${active === q || (active[1] === "C" && active[0] === q[0]) ? " on" : ""}"
          clip-path="url(#clip${q})" data-q="${q}"/>`).join("");

  $("greenSvgWrap").innerHTML = `
    <svg viewBox="0 0 ${w.toFixed(1)} ${hgt.toFixed(1)}">
      ${quadSvg}
      <path d="${path}" class="green-outline"/>
      <line x1="${X(frame.midB)}" y1="0" x2="${X(frame.midB)}" y2="${hgt}" stroke="rgba(255,255,255,0.13)" stroke-width="0.5" stroke-dasharray="2 2"/>
      <line x1="0" y1="${Y(frame.midA)}" x2="${w}" y2="${Y(frame.midA)}" stroke="rgba(255,255,255,0.13)" stroke-width="0.5" stroke-dasharray="2 2"/>
      <circle class="pin-dot" cx="${X(p.b).toFixed(1)}" cy="${Y(p.a).toFixed(1)}" r="1.8"/>
    </svg>`;
  $("greenSvgWrap").insertAdjacentHTML("beforeend",
    `<div class="green-caption">FRONT · ${hole.green.depth}m deep × ${hole.green.width}m wide</div>`);
  $("greenSvgWrap").querySelectorAll(".quad-path").forEach((el) => {
    el.addEventListener("click", () => { st.quadrant = el.dataset.q; touch(); renderGreen(); });
  });

  $("pinInfo").textContent = `${hole.pin.front}m on · ${hole.pin.side === "C" ? "centre" : hole.pin.side}`;
  $("quadLabels").innerHTML = `PIN&nbsp;SECTOR&nbsp;→&nbsp;<b>${(QUADS[st.quadrant] || st.quadrant).toUpperCase()}</b>`;
  $("puttVal").textContent = st.putts;
  $("penVal").textContent = st.penalties;
  $("firstPutt").value = st.firstPuttDist ?? "";
}

function renderPanel() { renderShotList(); renderEditor(); renderGreen(); renderRail(); }

function gotoHole(n) {
  curHole = n;
  selShot = 0;
  renderHud(); renderPanel();
  drawHole(true);
}

/* ═══════════════ REPORT ═══════════════ */
function computeStats() {
  const per = COURSE.holes.map((h) => {
    const st = round.holes[h.num];
    const score = holeScore(h.num);
    // GIR: waypoint index i on green ⇒ i shots to reach green
    let onIdx = -1;
    st.waypoints.forEach((w, i) => { if (onIdx < 0 && i > 0 && detectLie(w) === "green") onIdx = i; });
    const gir = onIdx > 0 ? onIdx <= h.par - 2 : st.shots.length <= h.par - 2;
    const teeResultLie = st.shots.length > 1 ? st.shots[1].lie : (st.waypoints[1] ? detectLie(st.waypoints[1]) : null);
    const fir = h.par >= 4 ? ["fairway", "green"].includes(teeResultLie) : null;
    const drive = h.par >= 4 && st.waypoints.length > 1 ? distM(st.waypoints[0], st.waypoints[1]) : null;
    return { h, st, score, gir, fir, drive, touched: st.touched, scramble: !gir && score <= h.par ? 1 : !gir ? 0 : null };
  });
  // stats count only holes actually recorded (touched) — seeds don't inflate numbers
  const played = per.filter((p) => p.touched);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const score = sum(played.map((p) => p.score));
  const firEl = played.filter((p) => p.fir !== null);
  const scrEl = played.filter((p) => p.scramble !== null);
  const drives = played.filter((p) => p.drive);
  const halfSum = (from) => {
    const seg = played.filter((p) => (from ? p.h.num > 9 : p.h.num <= 9));
    return seg.length ? sum(seg.map((p) => p.score)) : null;
  };
  return {
    per, score, thru: played.length,
    toPar: score - sum(played.map((p) => p.h.par)),
    out: halfSum(0), inn: halfSum(9),
    putts: sum(played.map((p) => p.st.putts)),
    pens: sum(played.map((p) => p.st.penalties)),
    fir: firEl.length ? Math.round((100 * firEl.filter((p) => p.fir).length) / firEl.length) : 0,
    gir: played.length ? Math.round((100 * played.filter((p) => p.gir).length) / played.length) : 0,
    scramble: scrEl.length ? Math.round((100 * sum(scrEl.map((p) => p.scramble))) / scrEl.length) : 0,
    longest: drives.length ? Math.round(Math.max(...drives.map((p) => p.drive))) : 0,
    avgDrive: drives.length ? Math.round(sum(drives.map((p) => p.drive)) / drives.length) : 0,
  };
}
function barChart(counts, total) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return `<div class="bars">` + entries.map(([k, v]) => `
    <div class="bar-row"><span class="lbl">${k}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(100 * v) / total}%"></span></span>
      <span class="n">${v}</span></div>`).join("") + `</div>`;
}
function renderReport() {
  const s = computeStats();
  const w = round.weather;
  $("reportSub").textContent =
    `${round.player.name} · ${COURSE.course.name} · ${round.player.tees} tees (${COURSE.course.totalMetres}m, par ${COURSE.course.par}) · ${round.date}` +
    (w ? ` · ${Math.round(w.temperature_2m)}°C, wind ${Math.round(w.wind_speed_10m)} km/h` : "");

  const cards = [
    [s.score, `Score (${toParStr(s.toPar)}) · thru ${s.thru}`],
    [`${s.out ?? "–"} / ${s.inn ?? "–"}`, "Out / In"],
    [s.putts, "Putts"],
    [s.fir + "<small>%</small>", "Fairways Hit"],
    [s.gir + "<small>%</small>", "Greens in Reg"],
    [s.scramble + "<small>%</small>", "Scrambling"],
    [s.pens, "Penalties"],
    [s.longest + "<small>m</small> <small style='font-size:11px'>avg " + s.avgDrive + "m</small>", "Longest Drive"],
  ].map(([v, k]) => `<div class="stat-card"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");

  const row = (label, cells, cls = "") =>
    `<tr class="${cls}"><td>${label}</td>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
  const half = (from) => {
    const seg = s.per.slice(from, from + 9);
    const th = `<tr><th>Hole</th>${seg.map((p) => `<th>${p.h.num}</th>`).join("")}<th>${from ? "In" : "Out"}</th></tr>`;
    const sum = (f) => seg.reduce((a, p) => a + f(p), 0);
    const played = seg.filter((p) => p.touched);
    const sumPlayed = (f) => (played.length ? played.reduce((a, p) => a + f(p), 0) : "–");
    return `<table class="scoretable">${th}
      ${row("Par", seg.map((p) => p.h.par).concat(sum((p) => p.h.par)))}
      ${row("Metres", seg.map((p) => p.h.metres).concat(sum((p) => p.h.metres)))}
      ${row("SI", seg.map((p) => p.h.si).concat(""))}
      ${row("Score", seg.map((p) => p.touched ? `<span class="score-chip ${scoreClass(p.score, p.h.par)}">${p.score}</span>` : "–").concat(`<b>${sumPlayed((p) => p.score)}</b>`), "tot")}
      ${row("Putts", seg.map((p) => (p.touched ? p.st.putts : "–")).concat(sumPlayed((p) => p.st.putts)))}
      ${row("Pin", seg.map((p) => p.st.quadrant).concat(""))}
    </table>`;
  };

  const clubs = {}, shapes = {}, lies = {};
  let shotCount = 0;
  s.per.filter((p) => p.touched).forEach((p) => p.st.shots.forEach((sh) => {
    clubs[sh.club] = (clubs[sh.club] || 0) + 1;
    shapes[sh.shape] = (shapes[sh.shape] || 0) + 1;
    lies[LIES[sh.lie].label] = (lies[LIES[sh.lie].label] || 0) + 1;
    shotCount++;
  }));

  $("reportBody").innerHTML = `
    <div class="report-grid">${cards}</div>
    ${half(0)}<br/>${half(9)}
    <div class="report-cols">
      <div><h3>Club Usage</h3>${barChart(clubs, Math.max(...Object.values(clubs)))}</div>
      <div>
        <h3>Shot Shape</h3>${barChart(shapes, shotCount)}
        <h3 style="margin-top:14px">Lies Played From</h3>${barChart(lies, shotCount)}
      </div>
    </div>`;
}

/* ═══════════════ PHOTO IMPORT + SIMULATED OCR ═══════════════ */
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("tdp-golf", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("images", { keyPath: "id", autoIncrement: true });
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  store(mode) { return this.db.transaction("images", mode).objectStore("images"); },
  add(rec) { return new Promise((res, rej) => { const q = this.store("readwrite").add(rec); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  all() { return new Promise((res, rej) => { const q = this.store("readonly").getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  del(id) { return new Promise((res, rej) => { const q = this.store("readwrite").delete(id); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); },
};
let IMAGES = [];
async function refreshImages() { try { IMAGES = await idb.all(); } catch { IMAGES = []; } }

function downscale(file, max = 1800) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      res(cv.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = rej;
    img.src = url;
  });
}
async function ingestFiles(bucket, files) {
  for (const f of files) {
    try { await idb.add({ bucket, dataUrl: await downscale(f), name: f.name, ts: Date.now() }); }
    catch (e) { console.warn("image import failed", f.name, e); }
  }
  await refreshImages();
  renderImport();
}
function thumbTile(rec) {
  return `<div class="thumb" data-id="${rec.id}">
    <img src="${rec.dataUrl}" alt="${rec.name}" />
    <button class="thumb-del" title="Remove">×</button></div>`;
}
function renderImport() {
  ["pins", "card"].forEach((bucket) => {
    const imgs = IMAGES.filter((r) => r.bucket === bucket);
    const row = $(bucket === "pins" ? "thumbsPins" : "thumbsCard");
    row.querySelectorAll(".thumb").forEach((t) => t.remove());
    row.insertAdjacentHTML("afterbegin", imgs.map(thumbTile).join(""));
    $(bucket === "pins" ? "countPins" : "countCard").textContent =
      imgs.length ? `${imgs.length} photo${imgs.length > 1 ? "s" : ""}` : "none yet";
  });
  const haveCard = IMAGES.some((r) => r.bucket === "card");
  $("btnRunOcr").disabled = !haveCard;
  $("ocrStatus").textContent = round.ocrApplied
    ? "OCR draft applied — review it on the Extended Card."
    : haveCard ? "Ready to read." : "Add at least one scorecard photo to run OCR.";
}
function openLightbox(src) {
  $("lightboxImg").src = src;
  $("lightboxImg").classList.remove("zoomed");
  $("lightbox").classList.remove("hidden");
}
function applyOcrDraft() {
  round.card = JSON.parse(JSON.stringify(CARD_SEED));
  Object.keys(round.card).forEach((n) => {
    round.holes[n] = plotFromCard(COURSE.holes[n - 1], round.card[n]);
  });
  round.ocrApplied = true;
  save(); renderRail(); renderHud(); drawHole(false); renderPanel();
}
$("filePins").addEventListener("change", (e) => ingestFiles("pins", [...e.target.files]));
$("fileCard").addEventListener("change", (e) => ingestFiles("card", [...e.target.files]));
["thumbsPins", "thumbsCard"].forEach((id) =>
  $(id).addEventListener("click", async (e) => {
    const tile = e.target.closest(".thumb");
    if (!tile) return;
    if (e.target.classList.contains("thumb-del")) { await idb.del(+tile.dataset.id); await refreshImages(); renderImport(); }
    else openLightbox(tile.querySelector("img").src);
  }));
$("btnRunOcr").onclick = () => {
  const btn = $("btnRunOcr"), st = $("ocrStatus");
  btn.disabled = true;
  st.textContent = "Reading handwriting…";
  setTimeout(() => {
    applyOcrDraft();
    const flagged = Object.values(round.card).reduce((a, c) => a + (c.review?.length || 0), 0);
    const holesRead = Object.keys(round.card).length;
    st.textContent = `Done — ${holesRead} holes drafted, ${flagged} fields flagged for review.`;
    btn.disabled = false;
    setTimeout(() => { $("importModal").classList.add("hidden"); renderCard(); $("cardModal").classList.remove("hidden"); }, 900);
  }, 1400);
};
$("btnImport").onclick = () => { renderImport(); $("importModal").classList.remove("hidden"); };
$("btnCloseImport").onclick = () => $("importModal").classList.add("hidden");
$("lightbox").addEventListener("click", (e) => {
  const img = $("lightboxImg");
  if (e.target === img && !img.classList.contains("zoomed")) {
    const r = img.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    img.classList.add("zoomed");
  } else if (e.target === img) img.classList.remove("zoomed");
  else $("lightbox").classList.add("hidden");
});

/* ═══════════════ EXTENDED CARD SCREEN ═══════════════ */
function ensureEntry(n) {
  if (!round.card[n]) {
    const hole = COURSE.holes[n - 1];
    round.card[n] = hole.par === 3
      ? { score: hole.par, teeClub: suggestClub(hole.metres, "tee"), gir: false, putts: 2, review: [] }
      : { score: hole.par, fir: true, teeClub: "Dr", teeDist: 270, apprFrom: null, apprClub: null, gir: false, putts: 2, review: [] };
  }
  return round.card[n];
}
function afterCardEdit(n) {
  round.holes[n] = plotFromCard(COURSE.holes[n - 1], round.card[n]);
  save(); renderCard(); renderRail();
  if (n === curHole) { selShot = 0; drawHole(false); renderPanel(); renderHud(); }
}
function cardRow(h) {
  const e = round.card[h.num];
  const par3 = h.par === 3;
  const rv = (f) => (e?.review?.includes(f) ? " low-conf" : "");
  const num = (f, min, max) =>
    `<input type="number" class="cnum${rv(f)}" data-h="${h.num}" data-f="${f}" min="${min}" max="${max}" value="${e?.[f] ?? ""}" placeholder="–">`;
  const clubSel = (f) =>
    `<select class="cclub${rv(f)}" data-h="${h.num}" data-f="${f}"><option value="">–</option>` +
    CLUBS.filter((c) => c !== "Putt").map((c) => `<option${e?.[f] === c ? " selected" : ""}>${c}</option>`).join("") + `</select>`;
  const seg = (f, opts) =>
    `<div class="mini-seg${rv(f)}" data-h="${h.num}" data-f="${f}">` +
    opts.map(([v, l, on]) => `<button data-v="${v}" class="${on ? "on" : ""}">${l}</button>`).join("") + `</div>`;
  const firSeg = par3 ? `<span class="dim">—</span>` : seg("fir", [
    ["hit", "✓", e?.fir === true], ["L", "L", e?.fir === false && e?.missSide === "L"], ["R", "R", e?.fir === false && e?.missSide === "R"]]);
  const girSeg = seg("gir", [["1", "✓", e?.gir === true], ["0", "×", !!e && e.gir === false]]);
  const mismatch = e && compileCard(h, e).shots.length + (e.putts ?? 2) !== (e.score ?? h.par);
  return `<tr class="${mismatch ? "mismatch" : ""}${e ? "" : " empty-row"}">
    <td><b>${h.num}</b><span class="dim"> P${h.par} · ${h.metres}m</span></td>
    <td>${num("score", 1, 12)}</td>
    <td>${firSeg}</td>
    <td>${clubSel("teeClub")}</td>
    <td>${par3 ? num("notedDist", 50, 260) : num("teeDist", 100, 360)}</td>
    <td>${girSeg}</td>
    <td>${par3 ? `<span class="dim">—</span>` : num("apprFrom", 5, 300)}</td>
    <td>${par3 ? `<span class="dim">—</span>` : clubSel("apprClub")}</td>
    <td>${num("firstPuttFt", 0, 99)}</td>
    <td>${num("putts", 0, 6)}</td>
    <td>${num("lastPuttFt", 0, 99)}</td>
    <td><button class="btn tiny ghost jump" data-h="${h.num}">map ›</button></td></tr>`;
}
function renderCardSources() {
  const imgs = [...IMAGES.filter((r) => r.bucket === "card"), ...IMAGES.filter((r) => r.bucket === "pins")];
  $("cardSources").innerHTML = imgs.length
    ? `<div class="src-strip">${imgs.map((r) =>
        `<img class="src-thumb" src="${r.dataUrl}" alt="${r.bucket === "pins" ? "pin sheet" : "scorecard"} photo" title="${r.bucket === "pins" ? "Pin sheet" : "Scorecard"} — click to zoom"/>`).join("")}
       <span class="src-hint">click a photo to zoom while you check the grid</span></div>`
    : `<div class="src-strip empty">No source photos attached — use 📷 Import to add the card and pin sheet.</div>`;
  $("cardSources").querySelectorAll("img").forEach((im) => (im.onclick = () => openLightbox(im.src)));
}
function renderCard() {
  renderCardSources();
  const sumHalf = (from) => {
    const vals = COURSE.holes.slice(from, from + 9).map((h) => round.card[h.num]?.score).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const out = sumHalf(0), inn = sumHalf(9);
  $("cardBody").innerHTML = `
    <div class="card-scroll"><table class="scoretable card-table">
      <tr><th>Hole</th><th>Score</th><th>Fairway</th><th>Tee club</th><th>Tee yd</th><th>GIR</th><th>From yd</th><th>Club</th><th>1st putt ft</th><th>Putts</th><th>Last ft</th><th></th></tr>
      ${COURSE.holes.map(cardRow).join("")}
    </table></div>
    <div class="card-totals">OUT <b>${out ?? "–"}</b> · IN <b>${inn ?? "–"}</b> · TOTAL <b>${out != null || inn != null ? (out ?? 0) + (inn ?? 0) : "–"}</b>
      <span class="dim">· red rows: score doesn't reconcile with shots + putts</span></div>`;
}
$("cardBody").addEventListener("change", (e) => {
  const t = e.target;
  if (!t.dataset.f) return;
  const v = t.tagName === "SELECT" ? t.value || null : t.value === "" ? null : +t.value;
  const entry = ensureEntry(+t.dataset.h);
  entry[t.dataset.f] = v;
  entry.review = (entry.review || []).filter((x) => x !== t.dataset.f);
  afterCardEdit(+t.dataset.h);
});
$("cardBody").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("jump")) { $("cardModal").classList.add("hidden"); gotoHole(+b.dataset.h); return; }
  const segEl = b.closest(".mini-seg");
  if (!segEl) return;
  const entry = ensureEntry(+segEl.dataset.h), f = segEl.dataset.f, v = b.dataset.v;
  if (f === "fir") {
    if (v === "hit") { entry.fir = true; entry.missSide = null; }
    else { entry.fir = false; entry.missSide = v; }
  } else entry.gir = v === "1";
  entry.review = (entry.review || []).filter((x) => x !== f && x !== "missSide");
  afterCardEdit(+segEl.dataset.h);
});
$("btnCard").onclick = () => { renderCard(); $("cardModal").classList.remove("hidden"); };
$("btnCloseCard").onclick = () => $("cardModal").classList.add("hidden");

/* ═══════════════ WHOLE-COURSE VIEW ═══════════════ */
function fitCourse() {
  const b = L.latLngBounds([]);
  COURSE.holes.forEach((h) => {
    h.line.forEach((p) => b.extend(p));
    h.green.poly.forEach((p) => b.extend(p));
    b.extend(h.tee);
  });
  map.flyToBounds(b, { padding: [36, 36], duration: 0.7 });
}

/* ═══════════════ EVENTS ═══════════════ */
const gotoNext = () => gotoHole(curHole === 18 ? 1 : curHole + 1);
const gotoPrev = () => gotoHole(curHole === 1 ? 18 : curHole - 1);
$("btnCourse").onclick = fitCourse;
$("btnHole").onclick = () => drawHole(true);
$("sheetHandle").onclick = () => document.body.classList.toggle("sheet-open");
$("btnUndoShot").onclick = () => {
  const st = S();
  if (st.shots.length <= 1) return;
  st.waypoints.pop(); st.shots.pop();
  selShot = Math.min(selShot, st.shots.length - 1);
  touch(); drawHole(false); renderPanel();
};
$("btnReseed").onclick = () => {
  round.holes[curHole] = round.card[curHole] ? plotFromCard(H(), round.card[curHole]) : seedHole(H());
  selShot = 0; save(); drawHole(false); renderPanel();
};
$("puttStepper").onclick = (e) => {
  const d = +e.target.dataset?.d; if (!d) return;
  S().putts = Math.max(0, S().putts + d); touch(); renderPanel();
};
$("penStepper").onclick = (e) => {
  const d = +e.target.dataset?.d; if (!d) return;
  S().penalties = Math.max(0, S().penalties + d); touch(); renderPanel();
};
$("firstPutt").onchange = (e) => { S().firstPuttDist = e.target.value === "" ? null : +e.target.value; touch(); };
$("btnSummary").onclick = () => { renderReport(); $("summaryModal").classList.remove("hidden"); };
$("btnCloseSummary").onclick = () => $("summaryModal").classList.add("hidden");
$("btnPrint").onclick = () => window.print();
$("btnExport").onclick = () => {
  const stats = computeStats();
  const data = { ...round, report: { score: stats.score, toPar: stats.toPar, putts: stats.putts, firPct: stats.fir, girPct: stats.gir, scramblePct: stats.scramble, penalties: stats.pens, longestDrive: stats.longest } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `TDP-Valderrama-${round.player.name.replace(/\s/g, "")}-${round.date}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$("btnReset").onclick = () => {
  if (!confirm("Clear all round data and start fresh?")) return;
  localStorage.removeItem(STORE_KEY);
  round = defaultRound();
  gotoHole(1);
  loadWeather();
};
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "ArrowRight" || e.key === "n") gotoNext();
  if (e.key === "ArrowLeft" || e.key === "p") gotoPrev();
  if (e.key === "Escape") ["summaryModal", "cardModal", "importModal", "lightbox", "courseModal"].forEach((id) => $(id).classList.add("hidden"));
});
setTimeout(() => { const h = $("mapHint"); h.style.transition = "opacity 1s"; h.style.opacity = "0"; }, 8000);

/* ═══════════════ COURSE SELECTION ═══════════════ */
/* Valderrama is fully mapped; the others are placeholders for the course library.
   Adding real geometry for a new course = run the Overpass pipeline (tools/build-course-data.mjs)
   for that course, or fetch it from the TDP course API — then register it here with its data. */
const COURSES = [
  { id: "valderrama", name: "Real Club Valderrama", loc: "Sotogrande, Spain", meta: "White · par 71 · 5,921m", live: true },
  { id: "guadalmina", name: "Guadalmina Golf (South)", loc: "Marbella, Spain", meta: "", live: false },
  { id: "sotogrande", name: "Real Club de Golf Sotogrande", loc: "Sotogrande, Spain", meta: "", live: false },
  { id: "costaterra", name: "Costa Terra Golf", loc: "Comporta, Portugal", meta: "", live: false },
];
function renderCourseList(q) {
  q = (q || "").toLowerCase();
  const list = $("courseList");
  list.innerHTML = "";
  const hits = COURSES.filter((c) => c.name.toLowerCase().includes(q) || c.loc.toLowerCase().includes(q));
  hits.forEach((c) => {
    const div = document.createElement("div");
    div.className = "course-item" + (c.live ? "" : " soon");
    const tag = c.live ? `<span class="ci-live">DEMO · LIVE</span>` : `<span class="ci-soon">COMING SOON</span>`;
    div.innerHTML =
      `<div class="ci-main"><div class="ci-name">${c.name} ${tag}</div>
         <div class="ci-loc">${c.loc}${c.meta ? " · " + c.meta : ""}</div></div>
       <div class="ci-go">${c.live ? "›" : ""}</div>`;
    if (c.live) div.onclick = () => selectCourse(c.id);
    list.appendChild(div);
  });
  if (!hits.length) list.innerHTML = `<div class="course-empty">No match for “${q}”. In production this searches TDP's 25,000-course library and pulls the geometry on demand.</div>`;
}
function openCourseModal() { renderCourseList(""); $("courseSearch").value = ""; $("courseModal").classList.remove("hidden"); }
function selectCourse(id) {
  $("courseModal").classList.add("hidden");
  if (id === "valderrama") { gotoHole(1); fitCourse(); }
}
$("btnCourses").onclick = openCourseModal;
$("btnCloseCourse").onclick = () => $("courseModal").classList.add("hidden");
$("courseSearch").oninput = (e) => renderCourseList(e.target.value);

/* ═══════════════ BOOT ═══════════════ */
load();
gotoHole(1);
loadWeather();
idb.open().then(refreshImages).catch((e) => console.warn("image store unavailable", e));
})();
