// Minimal App Store Connect API client (ES256 JWT via node:crypto — no deps).
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_KEY_PATH;
if (!KEY_ID || !ISSUER || !KEY_PATH) { console.error("set ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH"); process.exit(2); }

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
  const payload = { iss: ISSUER, iat: now, exp: now + 600, aud: "appstoreconnect-v1" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  // ES256 needs a JOSE (r||s) signature, not DER — node supports dsaEncoding: 'ieee-p1363'
  const sig = signer.sign({ key: readFileSync(KEY_PATH), dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(sig)}`;
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function post(path, body) {
  return api(path, { method: "POST", body: JSON.stringify(body) });
}

const cmd = process.argv[2];
const arg = process.argv[3];

if (cmd === "whoami") {
  const r = await api("/v1/apps?limit=1");
  console.log("HTTP", r.status, r.status === 200 ? "— auth OK" : JSON.stringify(r.json).slice(0, 400));
} else if (cmd === "apps") {
  const r = await api("/v1/apps?limit=200&fields[apps]=name,bundleId");
  if (r.status !== 200) { console.error("HTTP", r.status, JSON.stringify(r.json)); process.exit(1); }
  for (const a of r.json.data) console.log(`${a.attributes.bundleId}\t${a.attributes.name}\t(${a.id})`);
} else if (cmd === "find") {
  const r = await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(arg)}&fields[apps]=name,bundleId`);
  if (r.status !== 200) { console.error("HTTP", r.status, JSON.stringify(r.json)); process.exit(1); }
  if (!r.json.data.length) { console.log("NOT_FOUND"); process.exit(0); }
  const a = r.json.data[0];
  console.log(`FOUND\t${a.attributes.bundleId}\t${a.attributes.name}\t${a.id}`);
} else if (cmd === "bundleid") {
  // find the registered bundleId resource (needed to create an app record)
  const r = await api(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(arg)}&fields[bundleIds]=identifier,name`);
  if (r.status !== 200) { console.error("HTTP", r.status, JSON.stringify(r.json)); process.exit(1); }
  if (!r.json.data.length) { console.log("NOT_FOUND"); process.exit(0); }
  const b = r.json.data[0];
  console.log(`FOUND\t${b.attributes.identifier}\t${b.id}`);
} else if (cmd === "register-bundleid") {
  // arg = identifier; argv[4] = name (alphanumeric + spaces)
  const identifier = arg, name = process.argv[4] || "TDP";
  const r = await post("/v1/bundleIds", {
    data: { type: "bundleIds", attributes: { identifier, name, platform: "IOS", seedId: process.env.ASC_TEAM_ID || undefined } },
  });
  if (r.status >= 300) { console.error("HTTP", r.status, JSON.stringify(r.json)); process.exit(1); }
  console.log("BUNDLEID_ID", r.json.data.id);
} else if (cmd === "create-cert") {
  // arg = path to CSR (PEM). Prints resource id + base64 DER cert content.
  const csr = readFileSync(arg, "utf8");
  const r = await post("/v1/certificates", {
    data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: csr } },
  });
  if (r.status >= 300) { console.error("HTTP", r.status, JSON.stringify(r.json)); process.exit(1); }
  console.log("CERT_ID", r.json.data.id);
  console.log("CERT_CONTENT", r.json.data.attributes.certificateContent);
} else if (cmd === "list-certs") {
  const r = await api("/v1/certificates?limit=200&fields[certificates]=name,certificateType,displayName");
  if (r.status !== 200) { console.error("HTTP", r.status, JSON.stringify(r.json)); process.exit(1); }
  for (const c of r.json.data) console.log(`${c.id}\t${c.attributes.certificateType}\t${c.attributes.displayName || c.attributes.name}`);
} else if (cmd === "create-profile") {
  // argv[3]=name argv[4]=bundleIdResourceId argv[5]=certResourceId
  const name = process.argv[3], bundleRid = process.argv[4], certRid = process.argv[5];
  const r = await post("/v1/profiles", {
    data: {
      type: "profiles",
      attributes: { name, profileType: "IOS_APP_STORE" },
      relationships: {
        bundleId: { data: { type: "bundleIds", id: bundleRid } },
        certificates: { data: [{ type: "certificates", id: certRid }] },
      },
    },
  });
  if (r.status >= 300) { console.error("HTTP", r.status, JSON.stringify(r.json)); process.exit(1); }
  console.log("PROFILE_ID", r.json.data.id);
  console.log("PROFILE_NAME", r.json.data.attributes.name);
  console.log("PROFILE_CONTENT", r.json.data.attributes.profileContent);
} else if (cmd === "create-app") {
  // argv[3]=name argv[4]=sku argv[5]=bundleIdResourceId
  const name = process.argv[3], sku = process.argv[4], bundleRid = process.argv[5];
  const r = await post("/v1/apps", {
    data: {
      type: "apps",
      attributes: { name, sku, primaryLocale: "en-US" },
      relationships: { bundleId: { data: { type: "bundleIds", id: bundleRid } } },
    },
  });
  if (r.status >= 300) { console.error("HTTP", r.status, JSON.stringify(r.json)); process.exit(1); }
  console.log("APP_ID", r.json.data.id);
} else {
  console.error("usage: asc-api.mjs whoami|apps|find <b>|bundleid <b>|register-bundleid <id> <name>|create-cert <csr>|list-certs|create-profile <name> <bundleRid> <certRid>|create-app <name> <sku> <bundleRid>");
  process.exit(2);
}
