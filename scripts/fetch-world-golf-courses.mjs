#!/usr/bin/env node
/* Every golf course OpenStreetMap knows about — name + centre point + country hints —
   fetched in continent-sized tiles with `out center` (no geometry, so the whole world is
   a few MB). Writes gods-eye-view/public/data/golf-courses-world.json for the globe layer.
   Uses God's Eye's Overpass proxy when it's running (cached), else the public mirrors. */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
const OUT = new URL("../gods-eye-view/public/data/golf-courses-world.json", import.meta.url).pathname;
const CACHE = new URL("../build/world-golf/", import.meta.url).pathname; mkdirSync(CACHE, { recursive: true });
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const PROXY = process.env.OVERPASS_PROXY || "http://localhost:4173/api/overpass";
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
/* tiles: [name, s, w, n, e] — split the dense continents so no single query is huge */
const TILES = [
  ["europe-nw", 48, -25, 72, 15], ["europe-se", 34, 15, 72, 45], ["europe-sw", 34, -25, 48, 15],
  ["asia-w", -10, 45, 80, 100], ["asia-e", -10, 100, 80, 180],
  ["africa", -35, -20, 34, 52],
  ["na-w", 7, -170, 84, -100], ["na-e", 7, -100, 84, -50],
  ["sa", -56, -82, 13, -34], ["oceania", -50, 110, 0, 180],
];
async function overpass(q) {
  const urls = [PROXY, ...MIRRORS];
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "TDP-world-golf/1.0 (admin@v3tr4.com)" }, body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(400000) });
      const t = await r.text();
      if (t.trim().startsWith("{")) { const j = JSON.parse(t); if (j.elements) return j; }
      log(`  ${url} → ${r.status} ${t.slice(0, 60).replace(/\s+/g, " ")}`);
    } catch (e) { log(`  ${url} failed: ${e.message}`); }
  }
  throw new Error("all endpoints failed");
}
const all = new Map();
for (const [name, s, w, n, e] of TILES) {
  const f = `${CACHE}${name}.json`;
  let els;
  if (existsSync(f)) els = JSON.parse(readFileSync(f, "utf8"));
  else {
    log(`${name}: fetching`);
    els = (await overpass(`[out:json][timeout:300][maxsize:536870912];nwr["leisure"="golf_course"](${s},${w},${n},${e});out center tags;`)).elements;
    writeFileSync(f, JSON.stringify(els));
  }
  for (const el of els) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon; if (lat == null) continue;
    const t = el.tags || {};
    all.set(`${el.type[0]}${el.id}`, { id: `${el.type[0]}${el.id}`, n: t.name || t["name:en"] || "", lat: +lat.toFixed(5), lon: +lon.toFixed(5), h: +t.holes || (+t["golf:holes"] || 0) || undefined, c: t["addr:country"] || t["is_in:country_code"] || undefined, w: t.website || undefined });
  }
  log(`${name}: ${els.length} (total ${all.size})`);
}
const rows = [...all.values()];
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), source: "OpenStreetMap leisure=golf_course (ODbL)", count: rows.length, courses: rows }));
log(`wrote ${rows.length} courses (${rows.filter((r) => r.n).length} named) → ${OUT}`);
