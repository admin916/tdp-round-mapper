#!/usr/bin/env node
/* Offline feed for scripts/prebuild-courses.mjs — no Overpass, no rate limits.

   node scripts/extract-to-prebuild.mjs --country ES --pbf /path/spain-latest.osm.pbf
   node scripts/extract-to-prebuild.mjs --country ES --geofabrik europe/spain   # downloads it

   Uses osmium (brew install osmium-tool) to filter the golf tags out of a
   Geofabrik extract, exports them as GeoJSON, and writes the four cache files
   the prebuild script reads (courses.json, holes.json, golfways.json, places.json)
   into build/prebuild/<CC>/. Then run:
       node scripts/prebuild-courses.mjs --country ES [--push]
   and it assembles straight from cache. Same assembler, same output, same catalogue. */

import { execSync, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CC = (arg("--country", "") || "").toUpperCase();
if (!CC) { console.error("--country ISO2 is required"); process.exit(1); }
const OUT = join(root, "build", "prebuild", arg("--out-id", CC)); mkdirSync(join(OUT, "raw"), { recursive: true });
const WORK = arg("--work", join(root, "build", "extracts")); mkdirSync(WORK, { recursive: true });
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

if (spawnSync("osmium", ["--version"]).status !== 0) { console.error("osmium not found — brew install osmium-tool"); process.exit(1); }

/* 1 · get the extract */
let pbf = arg("--pbf", null);
if (!pbf) {
  const region = arg("--geofabrik", null);
  if (!region) { console.error("--pbf <file> or --geofabrik <region/country> is required"); process.exit(1); }
  pbf = join(WORK, `${region.replace(/\//g, "-")}-latest.osm.pbf`);
  if (!existsSync(pbf)) {
    log(`downloading https://download.geofabrik.de/${region}-latest.osm.pbf`);
    execSync(`curl -fL --retry 3 -o "${pbf}" "https://download.geofabrik.de/${region}-latest.osm.pbf"`, { stdio: "inherit" });
  }
}
log(`extract: ${pbf} (${(statSync(pbf).size / 1e6).toFixed(0)} MB)`);

/* 2 · filter golf + towns (tiny), export as GeoJSON lines */
const golfPbf = join(WORK, `${CC}-golf.osm.pbf`), seq = join(WORK, `${CC}-golf.geojsonseq`);
log("osmium tags-filter");
execSync(`osmium tags-filter --overwrite -o "${golfPbf}" "${pbf}" w/golf r/golf w/leisure=golf_course r/leisure=golf_course w/natural=water,wood r/natural=water,wood w/landuse=forest r/landuse=forest n/place=city,town`, { stdio: "inherit" });
log("osmium export");
execSync(`osmium export --overwrite -f geojsonseq --add-unique-id=type_id --geometry-types=point,linestring,polygon -o "${seq}" "${golfPbf}"`, { stdio: "inherit" });

/* 3 · convert to the Overpass-shaped elements the prebuild expects */
const courses = [], holes = [], golfways = [], places = [];
const ring = (coords) => coords.map(([lon, lat]) => ({ lat, lon }));
const boundsOf = (pts) => pts.reduce((b, p) => ({ minlat: Math.min(b.minlat, p.lat), maxlat: Math.max(b.maxlat, p.lat), minlon: Math.min(b.minlon, p.lon), maxlon: Math.max(b.maxlon, p.lon) }), { minlat: 90, maxlat: -90, minlon: 180, maxlon: -180 });
const biggestRing = (g) => {
  if (g.type === "LineString") return ring(g.coordinates);
  if (g.type === "Polygon") return ring(g.coordinates[0]);
  if (g.type === "MultiPolygon") return ring(g.coordinates.map((p) => p[0]).sort((a, b) => b.length - a.length)[0]);
  return null;
};
const rl = createInterface({ input: createReadStream(seq) });
let n = 0;
for await (const line of rl) {
  const s = line.replace(/^\x1e/, "").trim(); if (!s) continue;   // RS-delimited
  const f = JSON.parse(s); n++;
  const tags = f.properties || {}; const uid = String(tags["@id"] || f.id || ""); delete tags["@id"];
  const type = uid[0] === "w" ? "way" : uid[0] === "r" ? "relation" : "node", id = +uid.slice(1);
  if (f.geometry.type === "Point") {
    if (tags.place === "city" || tags.place === "town") places.push({ name: tags.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: tags.place, pop: +tags.population || 0 });
    continue;
  }
  const geometry = biggestRing(f.geometry); if (!geometry || geometry.length < 2) continue;
  if (tags.leisure === "golf_course") { courses.push({ type, id, tags, geometry, polygons: f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map(p => p.map(ring)) : f.geometry.type === "Polygon" ? [f.geometry.coordinates.map(ring)] : undefined, bounds: boundsOf(geometry) }); if (!tags.golf) continue; }
  if (tags.golf === "hole") holes.push({ type: "way", id, tags, geometry });
  else if (tags.golf || tags.natural || tags.landuse) golfways.push({ type, id, tags, geometry, polygons: f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map(p => p.map(ring)) : f.geometry.type === "Polygon" ? [f.geometry.coordinates.map(ring)] : undefined });
}
writeFileSync(join(OUT, "courses.json"), JSON.stringify(courses));
writeFileSync(join(OUT, "holes.json"), JSON.stringify(holes));
writeFileSync(join(OUT, "golfways.json"), JSON.stringify(golfways));
writeFileSync(join(OUT, "places.json"), JSON.stringify(places.filter((p) => p.name)));
log(`${n} features → ${courses.length} courses · ${holes.length} holes · ${golfways.length} other golf ways · ${places.length} towns → ${OUT}`);
log(`next: node scripts/prebuild-courses.mjs --country ${CC} --out ${OUT} [--push]`);
