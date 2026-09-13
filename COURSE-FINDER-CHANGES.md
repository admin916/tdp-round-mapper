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
