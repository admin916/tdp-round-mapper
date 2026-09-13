/* Aim / landing-zone model (Phase 5 — "where should I hit it?").
   From where the ball lies on the current hole, every club the player carries
   is tried across a fan of aim directions. Each (club, direction) option is
   scored as 1 + E[expected strokes from where the ball actually finishes],
   integrating over the player's shot dispersion (bivariate normal in carry ×
   lateral, from player_model when there are enough samples, sensible defaults
   otherwise). The best option and a "safe" alternative are drawn as landing
   ellipses on the map. Uses the same expected-strokes engine as the heat map
   (js/heatmap.js) so the two layers always agree.

   Terrain hook: if window.TDPTerrain.elev(latlng) exists (LiDAR / DEM provider),
   carries are corrected for the rise or fall to the landing area. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const T = window.TDPMap;
  const M2YD = 1.09361;
  const unitStr = (m) => (localStorage.getItem("tdp.units") || "yd") === "yd" ? `${Math.round(m * M2YD)}yd` : `${Math.round(m)}m`;

  /* default p50 carries (metres) when the player model has no data for a club —
     a mid-handicap set; measured carries from player_model override these */
  const DEFAULT_CARRY = { Dr: 215, "3W": 200, "5W": 188, "7W": 178, Hy: 172, "3i": 168, "4i": 160, "5i": 152, "6i": 143, "7i": 133, "8i": 123, "9i": 112, PW: 100, GW: 85, SW: 70, LW: 55 };
  const DEFAULT_LAT_DEG = 5.5;   // lateral 1σ (deg) ≈ 20yd either side at 200yd
  const LONG_SD_FRAC = 0.055;    // longitudinal 1σ as a fraction of carry
  const MIN_SAMPLES = 6;         // below this, defaults are blended in
  /* lie the ball sits in now → carry factor, dispersion factor */
  const LIE_FX = { tee: [1, 1], fairway: [1, 1], firstcut: [0.95, 1.15], fringe: [0.95, 1.1], rough: [0.85, 1.45], bunker: [0.7, 1.7], penalty: [0.85, 1.45], green: [1, 1] };
  /* 7-point quadrature of a standard normal along each axis */
  const Q = [-2.5, -1.5, -0.75, 0, 0.75, 1.5, 2.5].map((z) => [z, Math.exp(-z * z / 2)]);
  const QW = Q.reduce((s, [, w]) => s + w, 0);

  const toR = (d) => (d * Math.PI) / 180;
  const bearing = (a, b) => {
    const y = Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0]));
    const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) - Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1]));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };
  /* move `d` metres from p on bearing `b` (flat-earth: holes are < 1 km) */
  const project = (p, b, d) => [p[0] + (d * Math.cos(toR(b))) / 111132, p[1] + (d * Math.sin(toR(b))) / (111320 * Math.cos(toR(p[0])))];

  /* per-club shot model for the player: {carry, sdLong, sdLat(m at carry)} */
  function clubModel(club, lie) {
    const m = window.TDPModel?.get()?.clubs?.[club];
    const n = m?.samples || 0, w = Math.min(1, n / MIN_SAMPLES);
    const base = DEFAULT_CARRY[club];
    const carry = m?.carry_p50 ? w * m.carry_p50 + (1 - w) * base : base;
    let sdLong = carry * LONG_SD_FRAC;
    if (m?.carry_p75 && m?.carry_p50 && n >= MIN_SAMPLES) sdLong = Math.max(sdLong, (m.carry_p75 - m.carry_p50) / 0.674);
    let latDeg = DEFAULT_LAT_DEG;
    if (m?.lat_sd_deg && n >= MIN_SAMPLES) latDeg = w * m.lat_sd_deg + (1 - w) * DEFAULT_LAT_DEG;
    const [cf, df] = LIE_FX[lie] || LIE_FX.rough;
    const c = carry * cf;
    return { club, carry: c, sdLong: sdLong * df, sdLat: c * Math.tan(toR(latDeg)) * df, personal: n >= MIN_SAMPLES };
  }

  /* expected strokes from a landing point — memoised lie lookups on a 3 m grid */
  let lieCache = new Map(), greenCentre = null;
  /* a green that isn't THIS hole's green is somebody else's putting surface —
     you can't putt from there, so treat it as short grass (fairway) */
  function lieAt(p) {
    const k = ((p[0] * 37000) | 0) + "," + ((p[1] * 37000) | 0);
    let v = lieCache.get(k);
    if (!v) { v = T.detectLie(p); if (v === "green" && greenCentre && T.distM(p, greenCentre) > 45) v = "fairway"; lieCache.set(k, v); }
    return v;
  }
  const BAD = new Set(["penalty", "bunker", "rough"]);

  function scoreOption(origin, b, cm, pin, sg) {
    const terr = window.TDPTerrain;
    let carry = cm.carry;
    if (terr?.elev) {   // one-step elevation correction: uphill plays longer, downhill shorter
      const dz = terr.elev(project(origin, b, carry)) - terr.elev(origin);
      if (isFinite(dz)) carry -= dz * 0.9;
    }
    let e = 0, risk = 0, fair = 0;
    const ux = b, side = (b + 90) % 360;
    for (const [zl, wl] of Q) for (const [zs, ws] of Q) {
      const w = (wl * ws) / (QW * QW);
      const p = project(project(origin, ux, carry + zl * cm.sdLong), side, zs * cm.sdLat);
      const lie = lieAt(p);
      e += w * window.TDPHeat.expectedStrokes(lie, T.distM(p, pin), sg);
      if (BAD.has(lie)) risk += w;
      if (lie === "fairway" || lie === "green" || lie === "fringe" || lie === "tee") fair += w;
    }
    return { club: cm.club, bearing: b, carry, sdLong: cm.sdLong, sdLat: cm.sdLat, expected: 1 + e, risk, fair, personal: cm.personal, aim: project(origin, b, carry) };
  }

  function plan() {
    const hole = T.hole(), st = T.state(), pin = T.pinLatLng(hole);
    const wps = st.waypoints || [];
    if (!wps.length) return null;
    /* ball position: the last plotted point once the hole is being played, else the tee */
    const origin = st.touched ? wps[wps.length - 1] : wps[0];
    const lie = origin === wps[0] ? "tee" : T.detectLie(origin);
    const toPin = T.distM(origin, pin);
    if (lie === "green" || toPin < 25) return { onGreen: true, origin, toPin };
    const sg = window.TDPModel?.get()?.sg_by_lie || null;
    const b0 = bearing(origin, pin);
    const clubs = Object.keys(DEFAULT_CARRY).filter((c) => lie !== "bunker" || !["Dr", "3W", "5W", "7W"].includes(c));
    const opts = [];
    lieCache = new Map(); greenCentre = hole.green.centre;
    for (const club of clubs) {
      const cm = clubModel(club, lie);
      if (cm.carry > toPin + 20) continue;             // through the green
      if (cm.carry < 45 && toPin > 120) continue;      // pointless chips from range
      for (let d = -40; d <= 40; d += 2.5) opts.push(scoreOption(origin, (b0 + d + 360) % 360, cm, pin, sg));
    }
    if (!opts.length) return null;
    opts.sort((a, b) => a.expected - b.expected);
    const best = opts[0];
    const near = opts.filter((o) => o.expected - best.expected < 0.15 && o.club !== best.club || (o.club === best.club && Math.abs(o.bearing - best.bearing) > 6) && o.expected - best.expected < 0.15);
    const safe = near.sort((a, b) => a.risk - b.risk)[0];
    return { origin, lie, toPin, pinBearing: b0, best, safe: safe && safe.risk < best.risk - 0.08 ? safe : null, options: opts.length };
  }

  /* ── drawing ──────────────────────────────────────────────────────── */
  let objs = [], on = false;
  const clear = () => { objs.forEach((o) => o.remove()); objs = []; };
  function ellipse(o, k) {
    const pts = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      pts.push(project(project(o.aim, o.bearing, k * o.sdLong * Math.cos(a)), (o.bearing + 90) % 360, k * o.sdLat * Math.sin(a)));
    }
    return pts;
  }
  function draw(o, colour, tag) {
    const map = T.leaflet();
    objs.push(L.polygon(ellipse(o, 2), { color: colour, weight: 1, opacity: 0.55, fillOpacity: 0.08, dashArray: "3 5", interactive: false }).addTo(map));
    objs.push(L.polygon(ellipse(o, 1), { color: colour, weight: 2, opacity: 0.9, fillOpacity: 0.22, interactive: false }).addTo(map));
    objs.push(L.marker(o.aim, { interactive: false, icon: L.divIcon({ className: "aim-label", html: `<div class="aim-pill ${tag === "Safe" ? "above" : ""}" style="--c:${colour}"><b>${tag} ${o.club}</b> ${unitStr(o.carry)} · E ${o.expected.toFixed(2)} · ${Math.round(o.fair * 100)}% fairway · ${Math.round(o.risk * 100)}% trouble</div>`, iconSize: [0, 0] }) }).addTo(map));
  }
  function render() {
    clear();
    const p = plan();
    const hint = $("mapHint");
    if (!p) return;
    if (p.onGreen) { hint.textContent = "Aim: you're on the green — putt."; hint.style.opacity = "0.85"; return; }
    objs.push(L.polyline([p.origin, p.best.aim], { color: "#23c68b", weight: 2, opacity: 0.8, dashArray: "2 6", interactive: false }).addTo(T.leaflet()));
    if (p.safe) draw(p.safe, "#f5b942", "Safe");
    draw(p.best, "#23c68b", "Aim");
    const off = ((p.best.bearing - p.pinBearing + 540) % 360) - 180;
    const dir = Math.abs(off) < 2 ? "at the pin" : `${Math.abs(off).toFixed(0)}° ${off < 0 ? "left" : "right"} of the pin`;
    hint.innerHTML = `<b>Aim:</b> ${p.best.club} ${unitStr(p.best.carry)} ${dir} · expected ${p.best.expected.toFixed(2)} from here` +
      (p.safe ? ` · <span style="color:#f5b942">safe: ${p.safe.club} ${unitStr(p.safe.carry)} (+${(p.safe.expected - p.best.expected).toFixed(2)}, ${Math.round(p.safe.risk * 100)}% trouble)</span>` : "") +
      (p.best.personal ? "" : " · <i>scratch-ish defaults — play more rounds to personalise</i>");
    hint.style.opacity = "0.9";
  }

  $("btnTarget").onclick = () => {
    on = !on;
    $("btnTarget").classList.toggle("on", on);
    if (on) render(); else { clear(); $("mapHint").style.opacity = "0"; }
  };
  window.addEventListener("tdp-hole", () => { if (on) render(); });
  window.TDPTarget = { plan, refresh: () => { if (on) render(); }, onChange: () => { if (on) render(); }, isOn: () => on };
})();
