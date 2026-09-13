/* Supabase client for TDP.
   Loaded after vendor/supabase/supabase.js (UMD → window.supabase).
   The anon key is public by design — row-level security is the boundary.
   Session storage: Capacitor Preferences on iOS (survives WebKit storage
   eviction), localStorage on the web. */
(function () {
  "use strict";
  const SUPABASE_URL = "https://iiodbfcmybieytkrjqzf.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlpb2RiZmNteWJpZXl0a3JqcXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MTk3OTAsImV4cCI6MjA5ODk5NTc5MH0.umQ1vpu969C3NObJRgT-00M_jodIWi6bGv1VQHw6Axs";

  const prefs = window.Capacitor?.Plugins?.Preferences;
  const capacitorStorage = prefs && {
    getItem: async (k) => (await prefs.get({ key: k })).value,
    setItem: async (k, v) => { await prefs.set({ key: k, value: v }); },
    removeItem: async (k) => { await prefs.remove({ key: k }); },
  };

  window.TDP_SUPA = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: capacitorStorage || undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
})();
