/* Rounds history modal + finish-round flow (Phase 3). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  function fmtDate(d) {
    try { return new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
    catch { return d; }
  }

  function roundRow(r) {
    const bits = [
      r.score != null ? `<b>${r.score}</b>` : `<span class="dim">—</span>`,
      r.putts != null ? `${r.putts} putts` : null,
      r.footage_ft != null ? `${r.footage_ft} ft holed` : null,
      r.differential != null ? `diff ${r.differential.toFixed(1)}` : null,
    ].filter(Boolean).join(" · ");
    const badge = r.status === "complete"
      ? `<span class="rnd-badge done">SAVED</span>`
      : `<span class="rnd-badge live">IN PLAY</span>`;
    const localTag = r.local ? `<span class="rnd-badge local">THIS DEVICE</span>` : "";
    const sessTag = r.session_id ? (window.TDPSessions?.roundTag(r.session_id, r.played_on) || "") : "";
    return `<div class="round-item">
      <div class="ri-main">
        <div class="ri-name">${r.course_name} ${badge}${sessTag}${localTag}</div>
        <div class="ri-loc">${fmtDate(r.played_on)} · ${bits}</div>
      </div>
    </div>`;
  }

  async function openRounds() {
    $("roundsModal").classList.remove("hidden");
    window.TDPSync.renderStatus();
    await window.TDPSessions?.render();
    const pending = window.TDPSync.pendingGuestRounds();
    const signedIn = window.TDPAuth?.signedIn();
    const banner = $("attachBanner");
    if (signedIn && pending.length) {
      $("attachMsg").textContent = `${pending.length} round${pending.length > 1 ? "s" : ""} finished on this device before you signed in.`;
      banner.classList.remove("hidden");
    } else banner.classList.add("hidden");

    const { list } = await window.TDPSync.fetchRounds();
    $("roundsList").innerHTML = list.length
      ? list.map(roundRow).join("")
      : `<div class="course-empty">No rounds yet — play one and hit “Finish &amp; Save Round” in the Round Report.</div>`;
  }

  $("btnRounds").onclick = openRounds;
  $("btnCloseRounds").onclick = () => $("roundsModal").classList.add("hidden");
  $("btnAttachRounds").onclick = async () => {
    $("btnAttachRounds").disabled = true;
    await window.TDPSync.attachGuestRounds();
    $("btnAttachRounds").disabled = false;
    openRounds();
  };

  $("btnFinishRound").onclick = () => {
    if (!confirm("Finish this round? It moves to your round history and the mapper starts fresh.")) return;
    window.TDPRound.finish();
    location.reload();
  };
})();
