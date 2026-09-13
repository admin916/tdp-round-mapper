#!/usr/bin/env node
/* World course pre-build orchestrator: for each Geofabrik entry, download → filter with
   osmium → assemble → (optionally) push → delete the extract. Used by the GitHub Actions
   workflow (.github/workflows/prebuild-world.yml) and runnable locally for small countries.

   node scripts/prebuild-world.mjs --ids andorra,malta            # by Geofabrik id
   node scripts/prebuild-world.mjs --batch 3/40                   # batch 3 of 40 (for CI matrices)
   node scripts/prebuild-world.mjs --iso LU,MT --push             # by ISO code
   Env for --push: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */
import { execSync } from "node:child_process";
import { readFileSync, rmSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const all = JSON.parse(readFileSync(join(root, "data", "geofabrik-countries.json"), "utf8")).countries;
let list = all;
if (arg("--ids")) { const ids = new Set(arg("--ids").split(",")); list = all.filter((c) => ids.has(c.id)); }
else if (arg("--iso")) { const iso = new Set(arg("--iso").toUpperCase().split(",")); list = all.filter((c) => iso.has(c.iso)); }
else if (arg("--batch")) { const [n, of] = arg("--batch").split("/").map(Number); list = all.filter((_, i) => i % of === n - 1); }
if (has("--skip-gb")) list = list.filter((c) => c.iso !== "GB");
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
mkdirSync(join(root, "build"), { recursive: true });
const summary = join(root, "build", "prebuild-world-summary.tsv");
log(`${list.length} extracts: ${list.map((c) => c.id).join(", ")}`);
let ok = 0, failed = 0;
for (const c of list) {
  const t0 = Date.now();
  try {
    const dir = c.id.replace(/\//g, "-");
    execSync(`node scripts/extract-to-prebuild.mjs --country ${c.iso} --geofabrik ${c.path} --out-id ${dir}`, { cwd: root, stdio: "inherit" });
    execSync(`node scripts/prebuild-courses.mjs --country ${c.iso} --out build/prebuild/${dir} ${has("--push") ? "--push" : ""}`, { cwd: root, stdio: "inherit" });
    const rep = JSON.parse(readFileSync(join(root, "build", "prebuild", dir, "report.json"), "utf8"));
    appendFileSync(summary, `${c.iso}\t${c.id}\t${rep.built}\t${rep.byQuality.full}\t${rep.byQuality.partial}\t${rep.failed.length}\t${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    ok++;
  } catch (e) { failed++; appendFileSync(summary, `${c.iso}\t${c.id}\tERROR\t${String(e.message).slice(0, 80)}\n`); log(`✗ ${c.id}: ${e.message}`); }
  // free the runner's disk: the extract can be several GB
  const pbf = join(root, "build", "extracts", `${c.path.replace(/\//g, "-")}-latest.osm.pbf`);
  if (existsSync(pbf)) rmSync(pbf);
}
log(`done: ${ok} ok · ${failed} failed → ${summary}`);
process.exit(failed && !ok ? 1 : 0);
