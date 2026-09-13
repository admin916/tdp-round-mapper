/* TDP auth & profile (Phase 2).
   Email OTP sign-in via Supabase, guest mode, profile sheet.
   Exposes window.TDPAuth and fires "tdp-profile" on window whenever the
   active profile changes; app.js listens to update the round header.
   Signing in is optional — the app plays fully as a guest. */
(function () {
  "use strict";
  const supa = window.TDP_SUPA;
  const $ = (id) => document.getElementById(id);
  const GUEST_KEY = "tdp.guest.chosen";

  let profile = null; // row from public.profiles, null when guest

  /* ── public surface ─────────────────────────────────────────────── */
  window.TDPAuth = {
    profile: () => profile,
    playerName: () => profile?.display_name || "Guest",
    defaultTees: () => profile?.default_tees || "White",
    signedIn: () => !!profile,
  };
  const announce = () => window.dispatchEvent(new CustomEvent("tdp-profile", { detail: { profile } }));

  /* ── chip in the top bar ────────────────────────────────────────── */
  function renderChip() {
    const chip = $("btnProfile");
    if (profile) {
      const initials = (profile.display_name || "?")
        .split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      chip.textContent = initials;
      chip.classList.add("signed-in");
      chip.title = `${profile.display_name} — profile`;
    } else {
      chip.textContent = "Sign in";
      chip.classList.remove("signed-in");
      chip.title = "Sign in to save rounds to your profile";
    }
  }

  /* ── session lifecycle ──────────────────────────────────────────── */
  async function loadProfile(user) {
    const { data, error } = await supa.from("profiles").select("*").eq("id", user.id).single();
    if (error) { console.warn("profile load failed", error.message); return; }
    profile = data;
    renderChip();
    announce();
  }
  function clearProfile() {
    profile = null;
    renderChip();
    announce();
  }

  supa.auth.onAuthStateChange((event, session) => {
    if (session?.user) loadProfile(session.user);
    else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") clearProfile();
  });

  /* first launch: invite sign-in once; "continue as guest" remembers */
  supa.auth.getSession().then(({ data }) => {
    if (!data.session && !localStorage.getItem(GUEST_KEY)) openAuth();
  });

  /* ── auth modal (email → 6-digit code) ──────────────────────────── */
  let pendingEmail = null;
  function openAuth() {
    $("authModal").classList.remove("hidden");
    stepEmail();
  }
  function closeAuth() { $("authModal").classList.add("hidden"); }
  function stepEmail() {
    $("authStepEmail").classList.remove("hidden");
    $("authStepCode").classList.add("hidden");
    $("authError").textContent = "";
    setTimeout(() => $("authEmail").focus(), 50);
  }
  function stepCode() {
    $("authStepEmail").classList.add("hidden");
    $("authStepCode").classList.remove("hidden");
    $("authCodeHint").textContent = `We emailed a 6-digit code to ${pendingEmail}.`;
    $("authError").textContent = "";
    setTimeout(() => $("authCode").focus(), 50);
  }

  async function sendCode() {
    const email = $("authEmail").value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { $("authError").textContent = "That doesn't look like an email address."; return; }
    $("btnSendCode").disabled = true;
    $("btnSendCode").textContent = "Sending…";
    const { error } = await supa.auth.signInWithOtp({ email });
    $("btnSendCode").disabled = false;
    $("btnSendCode").textContent = "Email me a code";
    if (error) { $("authError").textContent = error.message; return; }
    pendingEmail = email;
    stepCode();
  }

  async function verifyCode() {
    const token = $("authCode").value.trim();
    if (!/^\d{6}$/.test(token)) { $("authError").textContent = "Enter the 6-digit code from the email."; return; }
    $("btnVerifyCode").disabled = true;
    $("btnVerifyCode").textContent = "Checking…";
    const { error } = await supa.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
    $("btnVerifyCode").disabled = false;
    $("btnVerifyCode").textContent = "Sign in";
    if (error) { $("authError").textContent = error.message; return; }
    localStorage.removeItem(GUEST_KEY);
    closeAuth(); // onAuthStateChange loads the profile
  }

  /* ── profile sheet ──────────────────────────────────────────────── */
  function openProfile() {
    if (!profile) { openAuth(); return; }
    $("pfName").value = profile.display_name || "";
    $("pfClub").value = profile.home_club || "";
    $("pfTees").value = profile.default_tees || "White";
    $("pfUnits").value = profile.units || "yd";
    $("pfWhs").value = profile.whs_id || "";
    $("pfHcp").textContent = profile.handicap_idx == null ? "— (play rounds to calculate)" : profile.handicap_idx.toFixed(1);
    $("profileError").textContent = "";
    $("profileModal").classList.remove("hidden");
  }
  function closeProfile() { $("profileModal").classList.add("hidden"); }

  async function saveProfile() {
    const patch = {
      display_name: $("pfName").value.trim() || null,
      home_club: $("pfClub").value.trim() || null,
      default_tees: $("pfTees").value,
      units: $("pfUnits").value,
      whs_id: $("pfWhs").value.trim() || null,
    };
    $("btnSaveProfile").disabled = true;
    const { data, error } = await supa.from("profiles")
      .update(patch).eq("id", profile.id).select().single();
    $("btnSaveProfile").disabled = false;
    if (error) { $("profileError").textContent = error.message; return; }
    profile = data;
    renderChip();
    announce();
    closeProfile();
  }

  async function signOut() {
    await supa.auth.signOut();
    localStorage.setItem(GUEST_KEY, "1"); // don't re-nag on next launch
    closeProfile();
  }

  /* ── Sign in with Apple (native iOS only) ───────────────────────── */
  const appleAvailable = () =>
    window.Capacitor?.isNativePlatform?.() &&
    window.Capacitor.getPlatform() === "ios" &&
    window.Capacitor.Plugins?.SignInWithApple;

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function signInWithApple() {
    $("authError").textContent = "";
    try {
      /* raw nonce goes to Supabase, its SHA-256 goes to Apple — Supabase
         verifies the token's hashed nonce against the raw one we send */
      const rawNonce = crypto.randomUUID() + crypto.randomUUID();
      const { response } = await window.Capacitor.Plugins.SignInWithApple.authorize({
        clientId: "com.v3tr4.tdp",
        scopes: "name email",
        nonce: await sha256Hex(rawNonce),
      });
      if (!response?.identityToken) throw new Error("Apple didn't return a token");
      const { error } = await supa.auth.signInWithIdToken({
        provider: "apple", token: response.identityToken, nonce: rawNonce,
      });
      if (error) throw error;
      /* Apple only reveals the name on the very first authorisation — keep it */
      const given = response.givenName, family = response.familyName;
      if (given || family) {
        const name = [given, family].filter(Boolean).join(" ");
        const { data: { user } } = await supa.auth.getUser();
        if (user) await supa.from("profiles").update({ display_name: name }).eq("id", user.id);
      }
      localStorage.removeItem(GUEST_KEY);
      closeAuth(); // onAuthStateChange picks up the session + profile
    } catch (e) {
      // user cancelling the native sheet is not an error worth showing
      if (!/cancel|1001/i.test(e.message || "")) $("authError").textContent = e.message || "Apple sign-in failed.";
    }
  }

  /* ── wiring ─────────────────────────────────────────────────────── */
  if (appleAvailable()) {
    $("btnApple").classList.remove("hidden");
    $("authDivider").classList.remove("hidden");
    $("btnApple").onclick = signInWithApple;
  }
  $("btnProfile").onclick = openProfile;
  $("btnCloseAuth").onclick = () => { localStorage.setItem(GUEST_KEY, "1"); closeAuth(); };
  $("btnGuest").onclick = () => { localStorage.setItem(GUEST_KEY, "1"); closeAuth(); };
  $("btnSendCode").onclick = sendCode;
  $("authEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") sendCode(); });
  $("btnVerifyCode").onclick = verifyCode;
  $("authCode").addEventListener("keydown", (e) => { if (e.key === "Enter") verifyCode(); });
  $("btnCodeBack").onclick = stepEmail;
  $("btnCloseProfile").onclick = closeProfile;
  $("btnSaveProfile").onclick = saveProfile;
  $("btnSignOut").onclick = signOut;

  renderChip();
})();
