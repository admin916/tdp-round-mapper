// Shared Gemini helper for the TDP Edge Functions.
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

// OCR option 3: fast flash (low thinking) primary → accurate pro (low thinking) escalation.
export const FLASH = "gemini-3.5-flash";
export const PRO = "gemini-3.1-pro-preview";
export const CHAT_MODEL = "gemini-3.5-flash";

function key() {
  const k = Deno.env.get("GEMINI_API_KEY");
  if (!k) throw new Error("GEMINI_API_KEY not set (supabase secrets set GEMINI_API_KEY=…)");
  return k;
}

export async function gemini(model: string, parts: unknown[], jsonOut: boolean, systemText?: string, maxTokens = 8192, thinkingLevel?: string): Promise<string> {
  const gc: Record<string, unknown> = { maxOutputTokens: maxTokens, temperature: jsonOut ? 0 : 0.6 };
  if (jsonOut) gc.responseMimeType = "application/json";
  if (thinkingLevel) gc.thinkingConfig = { thinkingLevel };
  const body: Record<string, unknown> = { contents: [{ parts }], generationConfig: gc };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { method: "POST", headers: { "x-goog-api-key": key(), "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || "gemini " + r.status);
  return (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
}

// streaming call → onText(fullTextSoFar) as tokens arrive
export async function streamGemini(model: string, parts: unknown[], thinkingLevel: string, onText: (t: string) => void): Promise<string> {
  const body = { contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 32000, thinkingConfig: { thinkingLevel } } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    { method: "POST", headers: { "x-goog-api-key": key(), "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) throw new Error("gemini " + r.status + " " + (await r.text()).slice(0, 140));
  const reader = r.body.getReader(), dec = new TextDecoder();
  let full = "", buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const js = line.slice(5).trim();
      if (!js || js === "[DONE]") continue;
      try { const o = JSON.parse(js); const t = (o.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join(""); if (t) { full += t; onText(full); } } catch { /* ignore */ }
    }
  }
  return full;
}

export function parseOcr(txt: string) {
  try { const d = JSON.parse(txt); return Array.isArray(d) ? { holes: d } : d; } catch { /* salvage */ }
  const course = txt.match(/"course"\s*:\s*"([^"]*)"/)?.[1] ?? null;
  const date = txt.match(/"date"\s*:\s*"([^"]*)"/)?.[1] ?? null;
  const holes: Record<string, unknown>[] = [];
  for (const m of txt.matchAll(/\{[^{}]*"num"[^{}]*\}/g)) { try { holes.push(JSON.parse(m[0])); } catch { /* skip */ } }
  return { course, date, holes };
}

// deno-lint-ignore no-explicit-any
export function needsEscalation(holes: Record<number, any>): boolean {
  const arr = Object.values(holes);
  if (arr.length < 15) return true;
  return arr.some((h) => h.score == null || h.par == null || h.score < 1 || h.score > 15 || (h.putts != null && h.score != null && h.putts > h.score));
}

export const OCR_PROMPT = `You are reading a golf scorecard and pin-position sheet(s) from one round.
Return ONLY JSON:
{"course":"full course name from header","date":"YYYY-MM-DD","holes":[
 {"num":1,"par":4,"si":7,"whiteYards":368,"score":4,"putts":2,"fir":true,"missSide":"L","teeClub":"Dr","teeDist":270,
  "gir":false,"apprFrom":140,"apprClub":"GW","firstPuttFt":25,"lastPuttFt":7,"pinFront":20,"pinSide":9,"pinSideLetter":"L"}]}
- par, si (stroke index / HANDICAP) and whiteYards come from the printed grid (WHITE tee row for whiteYards).
- The handwritten player row(s): score; fairway hit (fir true/false + missSide "L"/"R"; par 3s fir null); tee club + tee distance (yards);
  GIR (gir true/false); approach distance to pin (apprFrom yards) + approach club; putts; first/last putt lengths in FEET.
- Distances are YARDS as written; putts are FEET.
- Pin sheets: front distance (pinFront) + side number (pinSide) + letter, mapping Spanish I=Left, D=Right, C=Centre (pinSideLetter).
- Read all 18 holes. null for anything illegible. Never invent values.`;

// tolerant geocode-field extraction — survives truncated / missing-brace JSON
export function pickGeo(txt: string) {
  try { const d = JSON.parse(txt); if (isFinite(parseFloat(d.lat))) return { name: d.name, lat: parseFloat(d.lat), lon: parseFloat(d.lon), country: d.country, confidence: d.confidence }; } catch { /* salvage */ }
  const numF = (k: string) => { const m = txt.match(new RegExp('"' + k + '"\\s*:\\s*(-?[0-9.]+)')); return m ? parseFloat(m[1]) : NaN; };
  const strF = (k: string) => { const m = txt.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')); return m ? m[1] : null; };
  return { name: strF("name"), lat: numF("lat"), lon: numF("lon"), country: strF("country"), confidence: strF("confidence") };
}

export function imgParts(images: string[]) {
  const parts: unknown[] = [{ text: OCR_PROMPT }];
  for (const d of images) { const m = String(d).match(/^data:(.*?);base64,(.*)$/); if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } }); }
  return parts;
}
