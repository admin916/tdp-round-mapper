/* Course sessions — multi-day trips/blocks linked to the profile (Phase 5).
   An ACTIVE session (stored per device) tags every round finished while it's
   on: Day 1, Day 2, Day 3… relative to the session start date. */
(function () {
  "use strict";
  const supa = window.TDP_SUPA;
  const $ = (id) => document.getElementById(id);
  const ACTIVE_KEY = "tdp.session.active";

  let sessions = []; // cached list for the signed-in user

  const active = () => { try { return JSON.parse(localStorage.getItem(ACTIVE_KEY)); } catch { return null; } };
  const setActive = (s) => s ? localStorage.setItem(ACTIVE_KEY, JSON.stringify(s)) : localStorage.removeItem(ACTIVE_KEY);

  async function fetchSessions() {
    if (!window.TDPAuth?.signedIn()) { sessions = []; return sessions; }
    const { data } = await supa.from("course_sessions")
      .select("id,title,course_id,starts_on,ends_on")
      .order("starts_on", { ascending: false }).limit(20);
    sessions = data || [];
    // active session deleted elsewhere? drop the stale pointer
    if (active() && !sessions.find((s) => s.id === active().id)) setActive(null);
    return sessions;
  }

  async function createSession(title) {
    const user = window.TDPAuth?.profile()?.id;
    if (!user || !title.trim()) return null;
    const snap = window.TDPRound?.snapshot?.();
    const { data, error } = await supa.from("course_sessions").insert({
      user_id: user, title: title.trim(),
      course_id: snap?.courseId || null,
      starts_on: new Date().toISOString().slice(0, 10),
    }).select().single();
    if (error) { console.warn("session create failed", error.message); return null; }
    sessions.unshift(data);
    setActive({ id: data.id, title: data.title, starts_on: data.starts_on });
    return data;
  }

  function dayNumber(playedOn, session) {
    if (!session?.starts_on) return null;
    const d = Math.round((new Date(playedOn) - new Date(session.starts_on)) / 86400000) + 1;
    return d >= 1 ? d : null;
  }

  /* label for a round row in the history list */
  function roundTag(sessionId, playedOn) {
    const s = sessions.find((x) => x.id === sessionId);
    if (!s) return "";
    const day = dayNumber(playedOn, s);
    return `<span class="rnd-badge session">${s.title.toUpperCase()}${day ? " · DAY " + day : ""}</span>`;
  }

  /* sessions panel inside the Rounds modal */
  async function render() {
    const host = $("sessionsPanel");
    if (!window.TDPAuth?.signedIn()) {
      host.innerHTML = `<div class="sess-hint">Sign in to group rounds into a trip or training block (Day 1, 2, 3…).</div>`;
      return;
    }
    await fetchSessions();
    const act = active();
    const rows = sessions.slice(0, 6).map((s) => {
      const on = act?.id === s.id;
      return `<button class="sess-chip${on ? " on" : ""}" data-id="${s.id}">${s.title}${on ? " ✓" : ""}</button>`;
    }).join("");
    host.innerHTML = `
      <div class="sess-row">
        <span class="sess-label">SESSION</span>
        ${rows || `<span class="sess-hint">No sessions yet.</span>`}
        <input type="text" id="sessNew" class="sess-input" placeholder="New session… (e.g. Sotogrande trip)" />
        <button class="btn tiny primary" id="btnSessCreate">Start</button>
      </div>
      ${act ? `<div class="sess-hint">Rounds you finish now tag as <b>${act.title}</b> — tap it again to stop.</div>` : ""}`;
    host.querySelectorAll(".sess-chip").forEach((el) => (el.onclick = () => {
      const s = sessions.find((x) => x.id === el.dataset.id);
      setActive(act?.id === s.id ? null : { id: s.id, title: s.title, starts_on: s.starts_on });
      render();
    }));
    $("btnSessCreate").onclick = async () => {
      const v = $("sessNew").value;
      if (!v.trim()) return;
      $("btnSessCreate").disabled = true;
      await createSession(v);
      $("btnSessCreate").disabled = false;
      render();
    };
    $("sessNew").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnSessCreate").click(); });
  }

  window.TDPSessions = { render, roundTag, active };
})();
