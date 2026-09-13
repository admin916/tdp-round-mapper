/* TDP round persistence (Phase 3).
   Local-first: play never blocks on the network. Rounds queue in an
   outbox and flush to Supabase whenever we're online and signed in —
   on launch, on sign-in, on reconnect, after finishing, and every 60s.
   Guests keep everything locally; their finished rounds can be attached
   to a profile after first sign-in. */
(function () {
  "use strict";
  const supa = window.TDP_SUPA;
  const OUTBOX_KEY = "tdp.outbox.v1";        // { [roundId]: snapshot }
  const LOCAL_ROUNDS = "tdp.rounds.local.v1"; // finished-as-guest snapshots
  const CACHE_KEY = "tdp.rounds.cache.v1";   // last server list, for offline view

  const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  let deviceId = localStorage.getItem("tdp.device.id");
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("tdp.device.id", deviceId); }

  let flushing = false;
  const uid = () => window.TDPAuth?.profile()?.id || null;

  /* ── outbox ─────────────────────────────────────────────────────── */
  function markDirty(round) {
    const snap = window.TDPRound.snapshot();
    const box = read(OUTBOX_KEY, {});
    box[snap.id] = snap;
    write(OUTBOX_KEY, box);
    scheduleFlush();
  }

  function archiveFinished(snap) {
    const box = read(OUTBOX_KEY, {});
    box[snap.id] = snap;
    write(OUTBOX_KEY, box);
    if (!uid()) { // guests keep a local history so nothing is lost
      const local = read(LOCAL_ROUNDS, []);
      const i = local.findIndex((r) => r.id === snap.id);
      if (i >= 0) local[i] = snap; else local.push(snap);
      write(LOCAL_ROUNDS, local);
    }
    flush();
  }

  /* ── course must exist in the catalogue before a round can reference it ── */
  const knownCourses = new Set();
  async function ensureCourse(snap) {
    if (knownCourses.has(snap.courseId)) return true;
    const { data } = await supa.from("courses").select("id").eq("id", snap.courseId).maybeSingle();
    if (data) { knownCourses.add(snap.courseId); return true; }
    // device-built OSM course the catalogue hasn't seen — contribute it
    let geometry = null;
    try { geometry = JSON.parse(localStorage.getItem("tdp.course.data." + snap.courseId)); } catch {}
    if (!geometry) return false;
    const { error } = await supa.from("courses").upsert({
      id: snap.courseId, name: snap.courseMeta.name, location: snap.courseMeta.location,
      geometry, source: "osm", created_by: uid(),
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) { console.warn("course upsert failed", error.message); return false; }
    knownCourses.add(snap.courseId);
    return true;
  }

  /* ── flush ──────────────────────────────────────────────────────── */
  let flushTimer = null;
  function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 4000); }

  async function flush() {
    const user = uid();
    if (!user || flushing || !navigator.onLine) { renderStatus(); return; }
    flushing = true;
    try {
      const box = read(OUTBOX_KEY, {});
      for (const [id, snap] of Object.entries(box)) {
        if (!(await ensureCourse(snap))) continue; // retry next flush
        const { error } = await supa.from("rounds").upsert({
          id, user_id: user, course_id: snap.courseId, course_revision_id:snap.courseRevisionId||null,
          played_on: snap.date, tees: snap.tees, status: snap.status,
          data: snap.data, score: snap.score, putts: snap.putts,
          footage_ft: snap.footageFt, differential: snap.differential,
          session_id: snap.sessionId || null,
          device_id: deviceId,
        }, { onConflict: "id" });
        if (error) { console.warn("round sync failed", error.message); continue; }
        if (snap.status === "complete") {
          await publishConditions(snap, user);
          await pushShotSamples(snap, user);
        }
        const cur = read(OUTBOX_KEY, {});
        delete cur[id];
        write(OUTBOX_KEY, cur);
      }
    } finally {
      flushing = false;
      renderStatus();
    }
  }

  /* ── history ────────────────────────────────────────────────────── */
  async function fetchRounds() {
    const user = uid();
    if (user && navigator.onLine) {
      const { data, error } = await supa.from("rounds")
        .select("id,course_id,played_on,status,score,putts,footage_ft,differential,session_id")
        .order("played_on", { ascending: false }).limit(100);
      if (!error && data) {
        const names = await courseNames(data.map((r) => r.course_id));
        const list = data.map((r) => ({ ...r, course_name: names[r.course_id] || r.course_id }));
        write(CACHE_KEY, list);
        return { list, source: "server" };
      }
    }
    // offline or guest: server cache first, then guest-finished rounds
    const cached = read(CACHE_KEY, []);
    const local = read(LOCAL_ROUNDS, []).map((s) => ({
      id: s.id, course_id: s.courseId, course_name: s.courseMeta.name,
      played_on: s.date, status: s.status, score: s.score, putts: s.putts,
      footage_ft: s.footageFt, differential: s.differential, local: true,
    }));
    const merged = [...local.filter((l) => !cached.find((c) => c.id === l.id)), ...cached]
      .sort((a, b) => (a.played_on < b.played_on ? 1 : -1));
    return { list: merged, source: user ? "cache" : "guest" };
  }

  const courseNameCache = {};
  async function courseNames(ids) {
    const missing = [...new Set(ids)].filter((id) => !courseNameCache[id]);
    if (missing.length) {
      const { data } = await supa.from("courses").select("id,name").in("id", missing);
      (data || []).forEach((c) => (courseNameCache[c.id] = c.name));
    }
    return courseNameCache;
  }

  /* ── daily pin conditions (whiteboard: pin movement) ────────────── */
  async function publishConditions(snap, user) {
    if (!snap.pins) return;
    const { error } = await supa.from("course_conditions").upsert({
      course_id: snap.courseId, on_date: snap.date, user_id: user, pins: snap.pins,
    }, { onConflict: "course_id,on_date,user_id" });
    if (error) console.warn("conditions publish failed", error.message);
  }

  /* on launch: a fresh round can adopt today's community pin sheet */
  async function applyTodayConditions() {
    if (!navigator.onLine || !window.TDPRound?.isFresh?.()) return;
    const snap = window.TDPRound.snapshot();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supa.from("course_conditions")
      .select("pins,created_at").eq("course_id", snap.courseId).eq("on_date", today)
      .order("created_at", { ascending: false }).limit(1);
    if (data?.[0]?.pins) {
      const n = window.TDPRound.applyPins(data[0].pins);
      if (n) toast(`Today's pins applied — ${n} holes (community pin sheet)`);
    }
  }
  function toast(msg) {
    const el = document.createElement("div");
    el.className = "tdp-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 30);
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 500); }, 5200);
  }

  /* ── shot samples → player model (whiteboard: heat map / ACC profiles) ── */
  const LIE_START = { tee: "tee", fairway: "fairway", firstcut: "rough", rough: "rough", bunker: "sand", fringe: "fairway", green: "green", penalty: "recovery" };
  const LIE_RESULT = { fairway: "fairway", firstcut: "rough", rough: "rough", bunker: "sand", fringe: "rough", green: "green", penalty: "penalty", tee: "fairway" };

  function extractSamples(snap, user) {
    const rows = [];
    const holes = snap.data.holes || {};
    for (const [num, st] of Object.entries(holes)) {
      if (!st.touched || !Array.isArray(st.shots)) continue;
      st.shots.forEach((shot, i) => {
        if (!shot.club || shot.club === "Putt") return;
        const from = st.waypoints?.[i], to = st.waypoints?.[i + 1];
        if (!from || !to) return;
        const carry = Math.round(Math.hypot((to[0] - from[0]) * 111132,
          (to[1] - from[1]) * 111320 * Math.cos((from[0] * Math.PI) / 180)) * 10) / 10;
        if (carry < 10) return; // chips/adjustment noise
        /* lateral miss vs the line to the pin (only when the round is on the loaded course) */
        let offline_deg = null;
        const hg = window.TDPMap?.courseId?.() === snap.courseId ? window.TDPMap.holeGeom(+num) : null;
        if (hg) {
          const pin = window.TDPMap.pinLatLng(hg);
          const brg = (a, b) => Math.atan2(Math.sin((b[1] - a[1]) * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180),
            Math.cos(a[0] * Math.PI / 180) * Math.sin(b[0] * Math.PI / 180) - Math.sin(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.cos((b[1] - a[1]) * Math.PI / 180)) * 180 / Math.PI;
          offline_deg = Math.round((((brg(from, to) - brg(from, pin) + 540) % 360) - 180) * 10) / 10;
        }
        rows.push({
          offline_deg,
          user_id: user, round_id: snap.id, course_id: snap.courseId, hole: +num,
          club: shot.club, carry_m: carry,
          lat: to[0], lng: to[1],
          start_lie: LIE_START[shot.lie] || "rough",
          result: i + 1 < st.shots.length ? (LIE_RESULT[st.shots[i + 1].lie] || "rough") : "green",
        });
      });
    }
    return rows;
  }

  async function pushShotSamples(snap, user) {
    const rows = extractSamples(snap, user);
    if (!rows.length) return;
    // idempotent per round: replace any samples from an earlier push
    await supa.from("shot_samples").delete().eq("round_id", snap.id);
    const { error } = await supa.from("shot_samples").insert(rows);
    if (error) { console.warn("shot samples failed", error.message); return; }
    const { error: e2 } = await supa.rpc("recompute_player_model", { p_user: user });
    if (e2) console.warn("model recompute failed", e2.message);
    else refreshModel();
  }

  /* ── player model cache + caddie prompt block ───────────────────── */
  const MODEL_KEY = "tdp.player.model.v1";
  async function refreshModel() {
    const user = uid();
    if (!user || !navigator.onLine) return;
    const { data } = await supa.from("player_model").select("*").eq("user_id", user).maybeSingle();
    if (data) { write(MODEL_KEY, data); }
  }
  const M2YD_ = 1.09361;
  window.TDPModel = {
    get: () => read(MODEL_KEY, null),
    /* driver clubhead speed from p75 carry — standard smash-factor inversion */
    driverSpeedMph(clubs) {
      const d = clubs?.Dr;
      return d?.carry_p75 ? Math.round((d.carry_p75 * M2YD_) / 2.45) : null;
    },
    promptBlock() {
      const m = read(MODEL_KEY, null);
      if (!m || !m.clubs || !Object.keys(m.clubs).length) return "";
      const clubs = Object.entries(m.clubs)
        .filter(([, v]) => v.samples >= 3)
        .sort((a, b) => (b[1].carry_p75 || 0) - (a[1].carry_p75 || 0))
        .slice(0, 8)
        .map(([c, v]) => `${c} ${Math.round(v.carry_p75 * M2YD_)}yd (typical ${Math.round(v.carry_p50 * M2YD_)}yd, ${v.samples} shots)`)
        .join(", ");
      if (!clubs) return "";
      const speed = this.driverSpeedMph(m.clubs);
      return [
        `PLAYER PROFILE (measured from this player's own rounds — use these numbers, not tour averages):`,
        `Carries: ${clubs}.`,
        speed ? `Estimated driver clubhead speed ~${speed} mph.` : "",
        m.footage_avg != null ? `Average footage of holed putts per round: ${m.footage_avg} ft.` : "",
      ].filter(Boolean).join("\n");
    },
  };

  /* ── course catalogue API (Course Finder tier 1) ────────────────── */
  async function searchCatalogue(q, signal) {
    if (!navigator.onLine) return [];
    const { data, error } = await supa.from("courses")
      .select("id,name,location,source,country,quality,coverage,map_status").ilike("name", `%${q}%`).limit(20).abortSignal(signal || AbortSignal.timeout(12000));
    if (error) throw new Error('The course library is temporarily unavailable.');
    return data || [];
  }
  /* Course finder filters: free text + country + tour venues + fully mapped + near a point.
     "near" is a bbox pre-filter (PostgREST can't sort by distance), sorted client-side. */
  async function queryCatalogue({ q = "", country = "", tour = false, full = false, near = null } = {}) {
    if (!navigator.onLine) return [];
    let qb = supa.from("courses").select("id,name,location,country,quality,lat,lon,coverage,map_status").limit(near ? 300 : 80).order('name');
    if (q) qb = qb.ilike("name", `%${q}%`);
    if (country) qb = qb.eq("country", country);
    if (full) qb = qb.eq("quality", "full").eq("coverage->>validationVersion", "2");
    if (tour) qb = qb.not("coverage->tours", "is", null);
    if (near) qb = qb.gte("lat", near[0] - 0.7).lte("lat", near[0] + 0.7).gte("lon", near[1] - 1.1).lte("lon", near[1] + 1.1);
    const { data, error } = await qb;
    if (error) throw new Error('The course library is temporarily unavailable. Please try again.');
    let rows = data || [];
    if (near) {
      const kLon = 111.32 * Math.cos((near[0] * Math.PI) / 180);
      rows = rows.map((r) => ({ ...r, km: Math.hypot((r.lat - near[0]) * 111.13, (r.lon - near[1]) * kLon) })).sort((a, b) => a.km - b.km).slice(0, 40);
    }
    return rows;
  }
  let _countries = null;
  async function catalogueCountries() {
    if (_countries) return _countries;
    const { data } = await supa.from("courses").select("country").not("country", "is", null).limit(5000);
    const counts = {}; (data || []).forEach((r) => (counts[r.country] = (counts[r.country] || 0) + 1));
    let names; try { names = new Intl.DisplayNames([navigator.language || "en"], { type: "region" }); } catch { names = null; }
    _countries = Object.entries(counts).map(([cc, n]) => ({ cc, n, name: (names && names.of(cc)) || cc })).sort((a, b) => a.name.localeCompare(b.name));
    return _countries;
  }
  /* Explicit mapping requests retain the exact selected course and layout. */
  async function courseRequestStatus(candidate) {
    if (!navigator.onLine) throw new Error('Connect to check mapping progress.');
    let query = supa.from('course_requests').select('id,status,course_id,error,attempts,updated_at')
      .eq('candidate->>id', candidate.id);
    query = candidate.layout ? query.eq('candidate->>layout', candidate.layout) : query.is('candidate->>layout', null);
    const {data,error} = await query.order('created_at', {ascending:false}).order('id', {ascending:false})
      .limit(1).abortSignal(AbortSignal.timeout(12000));
    if (error) throw new Error('Mapping progress is unavailable. Please try again.');
    return data?.[0] || null;
  }
  async function requestCourse(name, place, candidate) {
    if (!navigator.onLine) throw new Error("You are offline. Try submitting the request when connected.");
    if (!candidate?.id) throw new Error("Select a course location first.");
    const { error } = await supa.from("course_requests").insert({name:candidate.name,place:place||null,
      candidate, requested_by:uid()||null});
    if (error && error.code !== '23505') throw new Error(error.code==='P0001'?error.message:"Mapping request could not be submitted. Please try again.");
  }
  async function getCatalogueCourse(id) {
    const { data, error } = await supa.from("courses").select("geometry,current_revision,course_uuid,map_status").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return {...data.geometry,mapStatus:data.map_status,course:{...data.geometry.course,id,revisionId:data.current_revision,uuid:data.course_uuid}};
  }
  /* a course built on this device enriches the shared catalogue (signed-in only — RLS) */
  async function contributeCourse(course) {
    const user = uid();
    if (!user || !navigator.onLine) return;
    const id = course.course.id || (course.course.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { error } = await supa.from("courses").upsert({
      id, name: course.course.name, location: course.course.location || null,
      geometry: course, source: "osm", created_by: user,
      quality: course.quality || "partial", coverage: course.coverage || null, country: course.identity?.country || null,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) console.warn("course contribute failed", error.message);
    else knownCourses.add(id);
  }

  /* ── guest-round migration ──────────────────────────────────────── */
  function pendingGuestRounds() { return read(LOCAL_ROUNDS, []); }
  async function attachGuestRounds() {
    const user = uid();
    if (!user) return 0;
    const local = read(LOCAL_ROUNDS, []);
    const box = read(OUTBOX_KEY, {});
    local.forEach((s) => (box[s.id] = s));
    write(OUTBOX_KEY, box);
    write(LOCAL_ROUNDS, []);
    await flush();
    return local.length;
  }

  /* ── status chip in the rounds modal ────────────────────────────── */
  function renderStatus() {
    const el = document.getElementById("syncStatus");
    if (!el) return;
    const waiting = Object.keys(read(OUTBOX_KEY, {})).length;
    if (!uid()) el.textContent = waiting ? `${waiting} round(s) on this device only — sign in to save them` : "Playing as guest — rounds stay on this device";
    else if (!navigator.onLine) el.textContent = `Offline — ${waiting} change(s) will sync when back online`;
    else el.textContent = waiting ? `Syncing ${waiting} change(s)…` : "All rounds saved to your profile ✓";
  }

  /* ── wiring ─────────────────────────────────────────────────────── */
  window.TDPSync = { markDirty, archiveFinished, flush, fetchRounds, pendingGuestRounds, attachGuestRounds, renderStatus,
    searchCatalogue, getCatalogueCourse, contributeCourse, queryCatalogue, catalogueCountries, requestCourse, courseRequestStatus };
  window.addEventListener("online", flush);
  window.addEventListener("tdp-profile", (e) => { if (e.detail.profile) { flush(); refreshModel(); applyTodayConditions(); } });
  setInterval(() => { if (Object.keys(read(OUTBOX_KEY, {})).length) flush(); }, 60000);
  flush();
})();
