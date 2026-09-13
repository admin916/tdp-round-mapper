// Assemble the shippable web bundle into www/ for Capacitor.
// The app is a static site; we copy an explicit allowlist so node_modules,
// the ios project, git, and tooling never end up in the app payload.
import { rm, mkdir, cp, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "www");

// Files/dirs that make up the actual web app (paths relative to repo root).
const ASSETS = [
  "index.html",
  "manifest.json",
  ".nojekyll",
  "css",
  "js",
  "data",
  "demo",
  "vendor",
];

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const rel of ASSETS) {
  const src = join(root, rel);
  if (!(await exists(src))) {
    console.warn(`build:www — skipping missing asset: ${rel}`);
    continue;
  }
  await cp(src, join(out, rel), { recursive: true });
}

console.log(`build:www — assembled www/ from ${ASSETS.length} asset entries`);
