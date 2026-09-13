# Course search and mapping review

Reviewed 12 September 2026. Scope: local source, saved scout outputs, and a synthetic assembler reproduction. Production deployment, database contents, provider accounts, and mobile runtime were not verified. Existing application changes were left intact.

## Recommendation

Keep the existing Capacitor/Leaflet mobile app and Supabase catalogue. Use God's Eye as an optional desktop inspection interface and reuse its Overpass proxy where useful. Build a verified course-data pipeline behind both interfaces. Installing the globe does not supply complete worldwide golf geometry or turn imagery into labelled bunkers, trees, and greens.

The existing pieces already support much of this architecture:

| Component | Existing implementation | Role |
| --- | --- | --- |
| Mobile app | `js/app.js`, Capacitor configuration | Course selection, map, uploads, round editing |
| Catalogue | `js/sync.js`, Supabase migrations | Shared course geometry and round persistence |
| Course assembly | `supabase/functions/_shared/course-build.js` | OSM features converted into app geometry |
| Immediate build | `supabase/functions/course/index.ts` | Gemini coordinates followed by OSM extraction |
| Background build | `scripts/course-scout.mjs` | Request queue, geocoding, God's Eye Overpass proxy, catalogue save |
| Bulk import | `scripts/prebuild-world.mjs`, GitHub workflow | Offline OSM extract processing |
| Globe integration | `gods-eye-view/src/data/golfCourses.js` | Existing catalogue points and links into the app |

## Confirmed problems

1. **Selected search identity is discarded.** `discover()` keeps a Photon result's name and display location, but drops coordinates and OSM identity. Clicking sends only its name to `buildAndLoad()`. The edge function then asks Gemini for coordinates, explicitly requesting a guess even when uncertain. Selecting a real search result therefore does not guarantee building that result.
2. **Course isolation is approximate.** `isolateCourse()` uses the nearest nine holes and a 1.8 km radius. Adjacent courses can overlap this radius. The assembler sorts references and truncates to 18 before validating identity. The scout has additional course-name grouping, but the edge function does not share it.
3. **Saved outputs demonstrate invalid routing.** `build/scout/club-de-golf-valderrama.json` is marked `full` with refs `1,1,2,2,2,3,3,3,3,4,4,4,4,5,5,5,6,6`. Royal Birkdale and `new-course.json` also have repeated refs while labelled `full`. This establishes invalid hole numbering; the precise source/course membership of each feature still needs review. These are local artifacts, not a claim about live database contents.
4. **Missing holes are silently renumbered.** A synthetic ten-hole input with no green for hole 5 produced display hole 5 with `osmRef: 6`. Scorecards and pin sheets must remain attached to their original hole numbers.
5. **“Full” does not mean verified.** `qualityOf()` accepts nine or eighteen built holes matching its already truncated input count. It checks neither unique references, expected course length, nor hazard completeness. Defaults include par 4, slope 130, rating 72, and a pin 15 metres from the green front.
6. **Tree coverage is absent from the mapping pipeline.** The query collects golf ways and course outlines, not ordinary tree/woodland features. Water overlays only include `golf=water_hazard`, missing lateral water hazards and ordinary water geometry. Geometry relations are not assembled. Unmapped terrain defaults to rough in `detectLie()`.
7. **Missing course maps can leave another map visible.** The OCR path can apply imported card data while retaining the current course geometry. There is a card warning, but geometry-dependent analysis should be explicitly unavailable until the correct course is resolved.
8. **Operational gaps remain.** The globe defaults to `localhost:4173`, which means the phone itself on a mobile device. The queue worker requires a running host; a source file does not establish deployment. Requests are automatically enqueued from unsuccessful typing pauses. Queue claims are not atomic and abandoned `building` jobs have no recovery lease.
9. **Search fallback needs replacement.** Nominatim's public endpoint is called from a search-as-you-type path. Its policy forbids autocomplete and limits aggregate application traffic to one request per second. Use the own-catalogue index or an appropriately hosted search service instead: https://operations.osmfoundation.org/policies/nominatim/

## Implementation sequence

### 1. Preserve course identity and prevent incorrect analysis

Pass `{provider, providerId, lat, lon, name, country, clubId, layoutId}` from search selection through the queue and builder. Use a stable internal course UUID plus provider identity, rather than a name slug as the authoritative key. Ask the player to choose the layout at multi-course clubs. Treat language-model name interpretation as a search aid; do not accept model confidence as geographic verification.

Unify edge, scout, and batch selection/validation. Prefer explicit course membership and boundaries, with spatial proximity as a candidate-finding fallback. Reject ambiguous layouts and duplicate hole references. Preserve actual hole numbers, including gaps, throughout rendering, scoring, and storage. Store expected hole count separately from observed hole count. Quarantine suspect builds for review before publication.

Use explicit availability states: found, mapping needed, partially mapped, verified. Store provenance and completeness for each feature category. Do not silently substitute course ratings or today's pins into analytical inputs. Allow score-only analysis while location-based analysis is unavailable.

Acceptance checks: two clubs with the same name; two layouts sharing a clubhouse; duplicate hole refs; missing green on hole 5; a genuine nine-hole course; eighteen-hole course with only nine mapped; non-Latin names; scorecard course differing from loaded geometry.

### 2. Add the missing-map workflow

Build an operator editor on the existing Leaflet map first: select the layout, draw/correct greens, tees, fairways, bunkers, water, woodland and course boundaries, and attach original hole numbers. Use imagery expressly permitted for this use, or club-supplied georeferenced plans/surveys. Record source, imagery date, review date, and reviewer. Imagery visibility alone does not establish rights to extract and redistribute data.

Import mapped OSM features as editable candidates. Support multipolygon holes and distinguish physical water from official penalty-area boundaries. Trees visible in overhead imagery do not establish canopy clearance or individual trunk locations. Have a reviewer approve geometry before it feeds shot advice. Later, computer vision can suggest polygons from suitable imagery, with human correction; it should not be the initial dependency.

OSM documents golf feature tags, including lateral water hazards, here: https://wiki.openstreetmap.org/wiki/Key:golf

### 3. Publish reusable course packages

Save versioned geometry, stable hole identities, feature provenance, coverage, and tee-set metadata in Supabase. Keep daily pin positions separate, keyed by course/layout, date, and hole. Bind each round to its course revision so later map edits do not silently change historical results. Cache course geometry on the device; offline imagery requires a separately supported provider arrangement.

Make God's Eye display the same catalogue and review state. Its current layer only plots catalogue points; detailed golf overlays and editing would be additional work. A hosted HTTPS globe URL can replace the local development address when that interface is ready.

### 4. Operate and expand

Make builds explicit user actions, provide progress/failure states, claim queue jobs atomically, add retry leases and rate limits, and run the worker on an always-on backend. Start with a small representative set of verified courses, then broaden using the existing extract pipeline. Worldwide discovery and worldwide verified geometry are separate coverage targets. Evaluate licensed golf datasets against actual sample courses and redistribution/offline requirements if manual coverage becomes the bottleneck; no paid provider has been selected or assessed in this review.

## What uploads can establish

A scorecard can provide hole scores, pars, tee distances, and sometimes ratings. A pin sheet can provide daily pin offsets when its units, orientation, and green reference are known. Neither normally contains every shot's landing position. Detailed shot mapping and strokes-gained analysis need player-confirmed shot positions/distances or a tracking source. Reconstructed positions should remain labelled estimates. Satellite/3D background imagery is not evidence of today's movable cup position.

The first implementation priority is course identity and hole validation, followed by the correction editor. That makes the existing search, globe, and uploads useful without amplifying incorrect geometry across the catalogue.
