#!/bin/sh
# Start the background course-finding service: God's Eye View (map engine + Overpass
# proxy/cache) and the Course Scout that watches the app's request queue.
#   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ./scripts/start-scout.sh
# Optional: GOOGLE_MAPS_API_KEY (uses God's Eye's geocoder), GEV_PORT (default 4173)
set -e
cd "$(dirname "$0")/.."
PORT="${GEV_PORT:-4173}"
[ -f "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" && nvm use 24 >/dev/null 2>&1 || true
mkdir -p build
if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  echo "starting God's Eye View on :$PORT"
  (cd gods-eye-view && nohup npx vite --port "$PORT" --strictPort > ../build/gev-dev.log 2>&1 &)
  for i in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 1; done
fi
echo "God's Eye View up on http://localhost:$PORT — starting Course Scout"
exec node scripts/course-scout.mjs --gev "http://localhost:$PORT" "$@"
