## Continuation — 13 September 2026 (aim, Augusta download, full-screen editor)

Reported problems and what was found:

- **Aim/Heat left the selected hole.** The planner now works inside the selected hole's corridor (`js/hole-spatial.js`): every candidate landing point must belong to this hole (own green, within 45 m of its routing, nearer to it than to any neighbouring hole, and inside the course boundary when one exists) and must advance along the routing, which also follows doglegs instead of aiming at the pin bearing only. Landing targets prefer short grass; forward tee boxes are never a target; where a fairway only starts beyond driver range (Augusta 11) the planner falls back to playable ground on the hole rather than suggesting a 9-iron lay-up to a tee box. Holes with no fairway polygons treat unmapped ground as playable and say so in the status text. A sweep of every hole on Augusta National, Valderrama, Sotogrande, Wentworth West and CostaTerra puts each Aim target on this hole's fairway or green (Augusta 11 lands on unmapped ground short of the mapped fairway).
- **Augusta National would not download.** Two causes. (1) The shared library still held a legacy bulk-import row for Augusta whose holes were numbered 1,1,2,2,2,3,3,3,… (three hole sets merged), which the finder offered first as "TDP LIBRARY" and which then failed validation on load. The finder now only offers library rows that passed hole validation (`validationVersion` 2), were reviewed, or were contributed by people; every row in a 400-row sample of the live catalogue predates validation, so the legacy import is no longer offered. (2) Course geometry was fetched through the `/course` Edge Function, which timed out (90 s) while the same Overpass query answers in about 2 s from a device. Geometry is now downloaded straight from the public Overpass mirrors on the device (mirrors started a few seconds apart, first good answer wins; the Edge Function remains the fallback) and assembled locally with the shared assembler. Augusta has two OSM layouts (Augusta National and the Par 3 Course); the finder and the editor both ask which one to map. Measured: 1.4 s to the layout question, 2.6 s to a loaded 18/18-hole map with 27 fairways and 69 bunkers.
- **Editor UI.** The course map editor owns the whole screen: satellite imagery (Esri World Imagery, with the street map as a toggle), a colour-coded feature palette (fairway, bunker, water, green, tee, hole route, rough, woodland, boundary, penalty), tap-to-draw with Undo/Cancel/Finish, a details drawer for name, layout length, tees, ratings, provenance and coverage, and a single Save & open action. Fixes in this continuation: the drawer and aim status were always visible because no `.hidden` rule existed for them; taps over an existing shape were swallowed while drawing (you could not draw a bunker inside a fairway); hole numbers are only attached to hole routes, greens and tees.
- **Live database.** Migration `20260912220000_course_packages.sql` (map_status, course_uuid, course revisions, map drafts, reviewer publication, request rate limits) had been committed and tested in PGlite but never applied, so every library search and catalogue load was failing with HTTP 400 (`column courses.map_status does not exist`). It was applied to the linked project on 13 September 2026 and recorded in `schema_migrations`; 1,311 courses now each have a version-1 revision. The client also retries catalogue queries without the package columns if it ever meets an older schema.
- Eighteen unique, consecutive hole lines now establish an 18-hole layout even when the course outline has no `holes=*` tag (named layouts rarely carry one), so such maps are labelled full; nine alone remain "not confirmed".

Validation: `npm test` 23 regressions; `node tests/course-database.mjs` all eight migrations in PGlite; `node tests/course-finder.browser.mjs` (mocked Overpass, layout-free club, missing hole 5, catalogue completion) passes; live headless runs of the Augusta search → layout choice → download → Aim/Heat, and of the editor flow (layout choice → OSM import → draw a bunker → Save & open, 70 bunkers on the main map). Not verified on a physical iPhone in this run.

## iOS course finder update — 13 September 2026, build 12

Version 1.0.0 (12) includes the simplified course finder, a single Save & open course map action, saved maps first, a whole-course overview with tappable hole numbers, and the course name plus available fairway/bunker coverage on the main map. Saved maps retain their geometry on this device. Missing source mapping remains explicitly labelled.

Validation: 22 unit regressions and the mobile browser workflow passed. The signed archive and exported IPA both contain byte-identical copies of the updated HTML, app JavaScript and styles. Xcode archive/export and App Store Connect upload succeeded. Upload ID: `c73d35c5-d7f1-42e6-9cff-47a673f8db63`. Apple processing completed with status VALID. Build 12 is assigned to the existing V3tr4 Team internal TestFlight group and confirmed IN_BETA_TESTING; testers can install it from TestFlight.

Artifacts: `build/TDP-12.xcarchive`, `build/export-12/App.ipa`, and `build/ios-{archive,export,upload}-12.log`. The release uses the existing TDP App Store v2 profile and its matching distribution certificate. Earlier archives and releases are retained.

# Course finder and mapping changes

## Continuation — 12 September 2026

The linked Supabase project was rechecked before continuing. The five previous migrations were recorded remotely, the course function was active, the public catalogue and request columns responded correctly, and the original 13 regressions passed. A schema export could not run because Docker Desktop was stopped; live function linting and API contract checks were used alongside isolated PostgreSQL migration tests.

This continuation adds:

- Mapping progress in each location preview: queued, building, failed and completed. Players can refresh status, explicitly retry failed requests, and load completed geometry from the catalogue without rebuilding it.
- Separate saved locations for each selected layout at the same club.
- Restricted request permissions: guests and signed-in players can submit valid course identities, but cannot supply worker state, attempts, result IDs, leases or timestamps. Requester account IDs are no longer publicly selectable. Existing request records remain intact.
- Database-owned claims using row locks, ten-minute leases and three-attempt recovery. Publication and completion are one transaction; an expired worker cannot publish stale geometry. Temporary failures wait before retrying, and geometry requiring review is not automatically retried.
- An updated scout that uses those RPCs and rejects unplayable output before publication. Curated `built-in` and `user` catalogue maps remain protected.

Migrations `20260912210000_course_request_worker.sql` and `20260912210500_course_candidate_volatility.sql` are applied. The second corrects the policy helper's volatility declaration identified by the live linter. The `course` edge function was redeployed with bounded layout validation and its existing public access retained. The static bundle was synced to the native iOS project; this continuation does not create a signed archive or distribute a new app build.

The local scout is now running against the existing map proxy. Its PID is recorded in `build/course-scout.pid` and its log is `build/course-scout.log`; startup confirmed a successful queue connection. It runs while this Mac is awake. To restart after stopping the previous process, use `node scripts/start-linked-scout.mjs --background`. The launcher reads the linked-project service credential through the saved Supabase CLI login and passes it only in the worker environment. For a managed host, continue using `scripts/start-scout.sh` with server-side environment variables. An always-on hosted worker is still outstanding.

Validation for this continuation:

- `npm test`: 19 passing regressions.
- `node tests/course-database.mjs`: all seven migrations run in isolated PostgreSQL (PGlite), including actual guest permission failures, identity deduplication, independent layouts, lease recovery, stale publication rejection, retry backoff/limits, generated coordinates and curated map protection. Install its optional engine with `npm install --prefix build/db-test --no-save --package-lock=false @electric-sql/pglite`.
- `node tests/course-finder.browser.mjs`: mobile browser coverage includes request states, explicit retry, completed catalogue loading, same-name identity and missing-hole navigation.
- `node scripts/check-course-backend.mjs --worker`: live public API contracts, rejected invalid selections, restricted worker RPC and private requester IDs passed.
- `supabase db lint --linked --schema public --fail-on error`: checked live SQL functions; the volatility warning was corrected in the follow-up migration.
- `npm run sync`: web build and CocoaPods sync passed; the three changed JavaScript assets match the native bundle byte for byte.

The live catalogue sample still contains 753 of 1,000 rows marked `full` without validation version 2. This is a sample, not a complete catalogue audit or proof that every sampled map is invalid. These records were not deleted or repaired. The finder retains the earlier validation and unreviewed-map labeling. Remaining larger work is the course correction editor, versioned/reviewed packages, legacy bulk-import identity migration, catalogue review and an always-on worker deployment.

Database implementation references: [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security), and [PostgreSQL queue row locking](https://www.postgresql.org/docs/current/sql-select.html).

## Earlier implementation

The finder now treats a course location separately from a playable hole map. Players can search the worldwide OSM/Photon index, distinguish same-name clubs by place, preview a location on satellite imagery, and save it on their device before any holes are mapped. Search is available without a running God's Eye server. Search results retain OSM object type, ID and coordinates; name-only geocoding no longer builds a map.

Selecting “Check and load course map” verifies the exact OSM course boundary. Named layouts require selection. Courses with insufficient geometry remain saved, and the player can explicitly request mapping. A request does not promise automatic completion: missing source geometry still needs review/mapping work. The updated scout consumes the selected identity through God's Eye's Overpass proxy.

The shared assembler rejects duplicate hole references before truncation, preserves original numbers when greens are missing, and only labels hole coverage full when the expected count is known. The mobile app navigates original hole numbers, validates legacy cached/catalogue maps before loading, and preserves stable course IDs in round analysis. It retains unmatched OCR data instead of applying it to a guessed course. Nine observed holes alone are not proof that a layout has only nine holes. Hazard completeness remains separate from hole coverage.

Country options now come from the bundled country list, rather than only countries already represented in the mapped catalogue. Live search errors are distinguished from no results. Public Nominatim autocomplete and automatic background requests while typing were removed.

## Validation

- `npm test`: 13 regression tests covering discovery identity, failed providers, course boundaries, layout choice, duplicate numbering, missing greens, coverage and the course endpoint. Requires Node with built-in TypeScript stripping (tested with Node 25).
- `node tests/course-finder.browser.mjs`: mobile Chrome smoke test. Uses the existing God's Eye Puppeteer install and mocks external requests. Exercises search, preview, saving an unmapped course, explicit mapping request, map loading and navigation across a missing hole.
- `npm run build:www`: generates the Capacitor web bundle.
- Read-only live Photon searches returned distinct Sunningdale clubs in the UK, Canada and US, plus Royal Birkdale and Valderrama with OSM IDs.

## Rollout status

The updated web bundle has now been synced into the native iOS project as version 1.0.0 build 10. Native Release compilation passed with signing disabled. Production deployment and device distribution remain pending access below.

1. Migration `20260912180000_course_request_identity.sql` is applied to the linked database.
2. `supabase/functions/course/index.ts` and its shared dependencies are deployed to the existing `course` function, retaining public access. A live name-only request returns the expected selection-required error.
3. The static frontend has been synced into the native iOS project. The local scout has since been restarted with the leased queue implementation described above; an always-on host remains pending.

Existing bad course rows are blocked from loading when their numbering is inconsistent; they have not been deleted or repaired in the live catalogue. The old name-based bulk venue discovery path still needs a separate migration to stable provider identities; the shared assembler now rejects duplicate numbering in its output too. This change does not supply missing worldwide geometry or deploy an imagery extraction/editor service.

## Mobile application status — 12 September 2026

- `npm run sync` passed, including CocoaPods installation. Native `public` files match the updated finder, app, sync code and HTML.
- `xcodebuild ... CODE_SIGNING_ALLOWED=NO build` passed for generic iOS Release. Output: `build/DerivedData-course-finder/Build/Products/Release-iphoneos/App.app`. This is an unsigned build, not an installable TestFlight release.
- Signed archive creation failed because Xcode could not find an iOS distribution certificate with its private key for team `3Z67YXHV3Z`. The earlier build-9 archive and IPA were left intact.
- Supabase deployment is complete. The iOS distribution method was not confirmed during this run.
