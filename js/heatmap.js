/* Expected-strokes heat map (Phase 5 — whiteboard: "Heat map").
   Every cell of the current hole gets "expected strokes to hole out from
   here" for the cell's LIE, from a Broadie-style scratch baseline table,
   shifted by the player's measured strokes-gained per lie when available
   (player_model.sg_by_lie). Rendered as a canvas image overlay. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const T = window.TDPMap;
  const M2YD = 1.09361, M2FT = 3.28084;

  /* baseline expected strokes to hole out — [distance yds, strokes] */
  const BASE = {
    fairway: [[10, 2.18], [20, 2.40], [40, 2.60], [60, 2.70], [80, 2.75], [100, 2.80], [120, 2.85], [140, 2.91], [160, 2.98], [180, 3.08], [200, 3.19], [220, 3.32], [240, 3.45], [260, 3.58], [280, 3.69], [320, 3.90], [360, 4.10]],
    rough:   [[10, 2.34], [20, 2.59], [40, 2.78], [60, 2.91], [80, 2.96], [100, 3.02], [120, 3.08], [140, 3.15], [160, 3.23], [180, 3.31], [200, 3.42], [240, 3.64], [280, 3.90], [320, 4.10], [360, 4.34]],
    sand:    [[10, 2.43], [20, 2.53], [40, 2.82], [60, 3.15], [80, 3.24], [100, 3.23], [120, 3.21], [140, 3.22], [160, 3.28], [180, 3.40], [200, 3.55], [240, 3.84], [280, 4.10], [320, 4.30]],
  };
  /* putting — [feet, strokes] */
  const PUTT = [[2, 1.01], [3, 1.04], [5, 1.23], [8, 1.50], [10, 1.61], [15, 1.78], [20, 1.87], [30, 2.06], [40, 2.14], [50, 2.29], [60, 2.40], [90, 2.60]];
  const LIE_CAT = { tee: "fairway", fairway: "fairway", firstcut: "rough", rough: "rough", bunker: "sand", fringe: "fairway", green: "green", penalty: "recovery" };

  function interp(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++)
      if (x <= table[i][0]) {
        const [x0, y0] = table[i - 1], [x1, y1] = table[i];
        return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
      }
    return table[table.length - 1][1];
  }

  function expectedStrokes(lie, distM, sgAdj) {
    const cat = LIE_CAT[lie] || "rough";
    let e;
    if (cat === "green") e = interp(PUTT, distM * M2FT);
    else if (cat === "recovery") e = interp(BASE.fairway, distM * M2YD) + 1.0;
    else e = interp(BASE[cat], distM * M2YD);
    /* personalisation: player's strokes gained vs baseline per lie (negative sg = worse) */
    const adj = sgAdj?.[cat === "green" ? "green" : cat];
    if (typeof adj === "number") e -= adj;
    return e;
  }

  /* colour: E≤2 emerald → 3 amber → ≥4.4 red */
  function colour(e) {
    const t = Math.min(1, Math.max(0, (e - 1.8) / 2.6));
    const hue = 145 * (1 - t);
    return `hsla(${hue}, 85%, 45%, 0.62)`;
  }

  let layer = null, on = false;

  function render() {
    clear();
    const hole = T.hole();
    const pin = T.pinLatLng(hole);
    const area = window.TDPHoleSpatial.forHole(T.geometry(), hole);
    const sg = window.TDPModel?.get()?.sg_by_lie || null;

    /* bbox: hole line + green, padded 55m */
    const pts = [...hole.line, ...hole.green.poly, pin];
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    pts.forEach(([la, ln]) => { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLng = Math.min(minLng, ln); maxLng = Math.max(maxLng, ln); });
    const padLat = 55 / 111132, padLng = 55 / (111320 * Math.cos((minLat * Math.PI) / 180));
    minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

    const wM = (maxLng - minLng) * 111320 * Math.cos((minLat * Math.PI) / 180);
    const hM = (maxLat - minLat) * 111132;
    const cell = Math.min(10, Math.max(4, Math.max(wM, hM) / 110)); // metres per cell
    const cols = Math.ceil(wM / cell), rows = Math.ceil(hM / cell);

    const cv = document.createElement("canvas");
    cv.width = cols; cv.height = rows;
    const ctx = cv.getContext("2d");

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lat = maxLat - ((r + 0.5) / rows) * (maxLat - minLat);
        const lng = minLng + ((c + 0.5) / cols) * (maxLng - minLng);
        const p = [lat, lng];
        if (!area.contains(p)) continue;
        let lie = area.lie(p);
        if (lie === 'woodland') lie = 'penalty';
        if (lie === "penalty") { ctx.fillStyle = "hsla(215, 70%, 45%, 0.55)"; ctx.fillRect(c, r, 1, 1); continue; }
        const e = expectedStrokes(lie, T.distM(p, pin), sg);
        ctx.fillStyle = colour(e);
        ctx.fillRect(c, r, 1, 1);
      }
    }

    layer = L.imageOverlay(cv.toDataURL(), [[minLat, minLng], [maxLat, maxLng]],
      { opacity: 0.85, interactive: false, className: "heat-overlay" });
    layer.addTo(T.leaflet());
  }

  function clear() { if (layer) { layer.remove(); layer = null; } }

  window.TDPHeat = { expectedStrokes, contains: p => window.TDPHoleSpatial.forHole(T.geometry(), T.hole()).contains(p) };

  $("btnHeat").onclick = () => {
    on = !on;
    $("btnHeat").classList.toggle("on", on);
    if (on) {
      T.focusHole();
      render();
      const m = window.TDPModel?.get();
      const personalised = m?.clubs && Object.keys(m.clubs).length;
      $("mapHint").style.opacity = "0.85";
      $("mapHint").textContent = personalised
        ? "Heat map: expected strokes to hole out, tuned to your game — green good, red trouble."
        : "Heat map: expected strokes to hole out (scratch baseline — play more rounds to personalise).";
      setTimeout(() => ($("mapHint").style.opacity = "0"), 6000);
    } else clear();
    $("btnHeat").setAttribute("aria-pressed", String(on));
  };
  window.addEventListener("tdp-hole", () => { if (on) render(); });
})();
