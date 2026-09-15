# SafeTrekr World View

This fork adds an organization and staff operations console to God's Eye View. The default page
uses Supabase sign-in, scoped Core snapshots, and explicit trip messaging actions.
The original explorer modules remain available for
future upstream merges, but its voice, sharing, annotations, capture, and debug
bootstrap are not mounted by the operations entry point.

## Included

- Staff Supabase login, existing TOTP challenge support, session refresh, and
  server-authoritative staff/organization access.
- Travelers and chaperones on the globe, including the unlocated roster,
  capture-time freshness, accuracy, battery at capture, and follow mode.
- Lodging, venues, itinerary stops, approved/draft safety resources, static
  boundaries, and the shared chaperone containment model on trip drill-in.
- Morning muster status, roll-call present/absent/excused/unmarked counts, and
  trip alerts with acknowledgment counts. GPS is never treated as roll call.
- Send alert and Direct group for organization administrators and authorized
  platform staff. Choose a trip and audience, review the message, then send it
  through Core's existing traveler alert feed and push delivery workflow.
- Nearby-camera searches measured from the selected person/location, explicit
  radius and coverage limits, and the upstream camera viewer.
- Scheduled passenger flight watchlist. Staff can explicitly link a dated leg
  to an exact ICAO24 address already in the live feed. Linked aircraft are green;
  the selected aircraft uses the upstream cyan selection treatment. An optional
  filter hides unrelated aircraft. No AviationStack requests or dependency.
- Header and footer shortcuts to World controls: civilian/military flights,
  satellites, AIS ships, TomTom traffic, FIRMS fires, earthquakes, and public
  cameras, with provider status and missing-key guidance. All eight public layers
  start enabled after sign-in; one unavailable provider does not block the others.
- Nine visual modes including FLIR, night vision, CRT, and natural imagery;
  effect strength and basemap selection. Effects are labeled as visual filters.
- City camera directory with search, fly-to-city, and camera selection. Local
  operators can add a public HTTPS snapshot or import a JSON pack without code.
  Local camera configuration never changes Core or production participant data.
- Google photorealistic tiles when configured, with a satellite globe fallback.

## Run locally

For exact credential names, provider signup links, and camera coverage, see
[PROVIDER_SETUP.md](PROVIDER_SETUP.md).

Use Node 24.14+ (24.x) or 26.x, matching upstream's package engines.

```sh
npm ci
cp .env.operations.example .env.local
npm run dev -- --host 127.0.0.1 --port 4173
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the target Supabase
project's public configuration. Set the server-only `SAFETREKR_CORE_URL` to Core's
base URL (with or without `/v1`; the proxy resolves `/v1/staff/operations`). For the local GET-only Core runner it is
`http://127.0.0.1:8002`. The Vite middleware forwards the staff snapshot GET and
the two trip-action POST routes with the caller's bearer token to that fixed
origin. It cannot proxy arbitrary Core routes. The isolated local runner supports
reads only; actions require the normal Core application. `.env.local` is ignored.
Never put a service-role key or the
MCP personal access token in this checkout's browser configuration.

Core's companion branch contains `scripts/operations_readonly_server.py` and
`docs/staff-operations.md`. That runner loads the ignored Core
`.env.operations.local`, mounts only this route, and starts no production workers.
The normal production Core app mounts the same route through `src/main.py`.

A dedicated test account needs a matching active `public.users` profile.
Platform staff roles are `hq_admin`, `hq_supervisor`, `hq_security`, `hq_ops`, or
`analyst`, with `org_id IS NULL`. Organization administrators and security officers
can see only their own organization. Billing, participant, and unknown roles are
denied. Organization admins and authorized platform staff can send trip messages;
security officers have view-only access in this console. Core's response supplies
the action capabilities, and Core checks the current account and trip scope again
for every send.

Organization administrators use their existing SafeTrekr credentials on the same
login screen. The console labels their access **Organization view**; all trip
windows, pages, people, flights, itinerary, safety resources, and status records
come from that organization. Authorized platform staff see **All organizations**.
Scope comes from Core's trusted user profile, never a browser role or organization
selector. Public world layers remain available to both groups. No extra API key,
database migration, or separate login is required for existing linked accounts.
An organization profile without a linked Supabase Auth account must complete the
normal SafeTrekr account setup before it can sign in.

The browser rejects inconsistent snapshot scopes and clears private data when
access expires, a selected trip becomes inaccessible, or the account changes.
Run `node scripts/operations-access-smoke.mjs` against the development server to
exercise organization/platform sign-in and cleanup with synthetic accounts.

The development-only **Explore a sample trip** button (or `?demo=1`) loads
fictional Austin travelers with a conspicuous simulated-data label. It makes no
Core data requests. Production builds provide no sample-mode entry point.

## Alerts and activity

The header **Alerts** button opens the activity rail (open by default on desktop).
**Near trips** is the default; **Worldwide** shows public events globally without
expanding organization access. Category filters cover trip activity, geofences,
group directions, earthquakes, and fires. Cards expand for details and links to
the trip or recorded map location. Higher-priority items appear first; at most
100 matching cards render at once, with the full matching count shown.

Nearby earthquakes use a 250 km radius and fire areas about 25 km around fresh
participant fixes and loaded lodging, venues, or itinerary stops. Planned sites
are labeled as references, not proof that the group is there. This is a proximity
filter, not an impact forecast. NASA observations are grouped in 0.1° map cells
across the complete dataset, including weaker detections outside renderer caps.
They are not inferred wildfire incidents. Old active trip alerts remain visible;
world observations and recorded geofence transitions cover the last 24 hours.

The rail refreshes every 15 seconds while the page is visible, using existing
layer data. Disabled, delayed, or failed sources and missing trip references are
explicit. Turning a public layer off stops its activity coverage. Review badges
are memory-only and cleared on account/scope changes; **Mark shown reviewed**
does not acknowledge alerts for travelers or alter Core records.

The pending Core companion update supplies `geofence_events` from recorded
transitions and typed `operations_event` metadata for new group directions.
Without it, the live rail still shows existing trip alerts and public hazards,
and explicitly states that recorded geofence activity needs the Core update.
It never infers an exit from a single GPS point or identifies a direction by
matching free-form alert headlines. A later recorded re-entry downgrades the
earlier exit in the rail without declaring the participant safe.

## Trip actions

**Send alert** targets all participants, travelers, or chaperones on one authorized
trip. **Direct group** sends an urgent alert containing an approved destination,
its address/map link, an arrival deadline, and optional instructions. It uses
trip safety resources: rally points, safe houses, relocation points, and POIs
such as fire stations. Draft and organization-internal destinations are excluded;
chaperone-only destinations can only target chaperones. Core resolves the
destination from the authorized trip instead of trusting browser-supplied details.

Both actions require **Review message → Send now**. Existing Core trip-ended
checks, rate limits, audit, recipient targeting, push delivery ledger, and retries
apply. Results distinguish saved alerts from provider-accepted device pushes;
acceptance does not prove a traveler saw the message. The browser never retries
an uncertain send automatically. Check the trip's alerts before sending again
after an unknown result. Direct group creates a broadcast and deadline; it does
not change the itinerary or automatically navigate a participant's phone.

## Current limits

The map displays the currently loaded page of ten trips. Use trip windows,
pagination, or select a trip to narrow the view; the loaded scope is always
shown. Polling runs every 15 seconds while visible, never overlaps requests, and
retains an explicitly aging snapshot during temporary failures. Locations age
independently of connection health, including while requests fail. Source reads
are capped and failures/truncation are disclosed.

Aircraft links are manual, session-only, and expire after at most two hours.
They require assigned passengers, timezone-qualified departure/arrival timestamps,
a current loaded aircraft, and a matching tracking window. Changed callsigns,
conflicting known airports, changed schedules, stale telemetry, and expired links
remove the highlight. Links do not claim boarding or continuous global feed
coverage. Scheduled flight numbers alone are not sufficient identity. Automatic
commercial flight identity resolution and durable shared links remain follow-up
work; a suitable provider can be added without AviationStack.

Nearby cameras show their source kind/status. Catalog proximity does not establish
that a camera can see a person. There is no facial identification or private camera
ingestion. Historic scene replay, voice operations, and full GPS replay are deferred.
The latest-fix table is not a historical movement trail.

## Production deployment

The Vercel project is `safetrekr-gods-eye` in the `tarva` team. Its custom domain is
`https://safetrekr-eye.tarva.studio`. `vercel.json` builds the Vite frontend and
routes `/api/*` through `api/gateway.js`, a Node 24 function in `iad1`.

Production environment variables live in the project's Vercel settings; they are
independent of this computer's ignored `.env.local`. The production Core base URL is
`https://api.safetrekr.com/v1`. The deployed staff endpoint now responds with
authentication required (HTTP 401) to an anonymous request. Staff snapshots still
require a valid Supabase session and an authorized staff profile.

A successful staff snapshot issues a signed, Secure, HttpOnly, SameSite=Strict
five-minute cookie for public-provider access. Private snapshots and messaging always require
Core's full Supabase session and current staff-scope checks. Logout clears the
provider cookie. Responses bypass shared CDN caches. The deployed gateway mounts
only the providers used by this console; key editing, local camera mutations,
OpenAI/voice endpoints and arbitrary upstream proxies are excluded.

The only messaging paths are POST
`/api/safetrekr/operations/trips/{uuid}/broadcast` and
`/api/safetrekr/operations/trips/{uuid}/direct-group`. The public-provider cookie
cannot authorize either action. JSON request bodies are limited to 16 KB, and
cross-origin browser sends are rejected.

AIS on Vercel collects bounded 12-second samples and caches public vessel reports
across requests for one minute. It retains at most 3,000 observed vessels, for at
most 15 minutes. This is sampled coverage, not an always-on global receiver or
historical track store. AISStream permits one connection per key. A once-per-minute Vercel Cron is the
sole collector, authenticated by `CRON_SECRET`. Staff requests only read its
public-data cache. Local testing uses `AISSTREAM_SHARED_URL` and server-only
`AISSTREAM_SHARED_TOKEN` to read that same receiver without opening a second socket.

The account currently lacks a Vercel GitHub login connection. Deployment is from
the tested local checkout using `vercel deploy --prod --scope tarva --yes` with
`.vercel/project.json` linked to this project. Configure the Vercel GitHub
connection and link `Safetrekr/gods-eye-view` to enable Git-triggered builds. Until
then, pushing the branch alone does not update the website.

Use a referrer-restricted Google browser key with Map Tiles API enabled and add
`https://safetrekr-eye.tarva.studio/*` to its website restrictions. Optional preview
and localhost origins need their own allowed referrers. Server credentials stay
in Vercel; only the Google/Cesium browser configuration and Supabase public key
are included in browser assets.

## Camera playback

Click a globe camera icon/preview, a camera-directory result, or a nearby-camera
result to open the expanded player. It provides native playback controls,
fullscreen, reload, keyboard dismissal and resource cleanup when closed.
Caltrans HLS URLs and TfL MP4 clips are taken from their official camera catalogs.
HLS manifests and child assets are proxied within the registered camera's own
origin/directory. Hls.js enables playback in browsers without native HLS support.

TfL publishes recent clips, not continuous streams. Snapshot-only cameras refresh
every 15 seconds while the player is open; upstream capture cadence varies. When
video fails, the player shows an explicitly labeled snapshot fallback. Street View
and synthetic fallback frames are labeled as reference imagery, never live footage.
Local custom-camera editing remains available on localhost only.

## Verification

```sh
node --test src/operations/*.test.mjs
npm run check:boundaries
npm run build
# With the development server running:
node scripts/operations-smoke.mjs
node scripts/operations-world-smoke.mjs
node scripts/camera-player-smoke.mjs # ffmpeg required; synthetic MP4/HLS fixtures
# Full upstream suite (canonical TMPDIR avoids a macOS symlink assertion):
TMPDIR=/private/tmp npm test
```

The browser smoke test uses fictional records, checks the login gate, globe,
stale/battery detail, flight form, narrow layout, and clearing private scene data
on logout. It writes screenshots to ignored `output/operations/`.

The world-controls smoke uses synthetic provider responses to render the added
layers and all nine shaders, exercise the camera directory/form, check mobile
and keyboard access, and verify missing-key states and full scene cleanup.
Paid-provider authentication still requires real credentials for live testing.


### Traveler pins and trip boundaries

Near a trip, travelers and chaperones use large clickable pins with the same
profile photo as the mobile app when Core supplies it. Missing or inaccessible
photos use initials. A T/C badge preserves role while the colored ring shows
location freshness. At world scale, compact markers replace photo requests.
Selecting a pin opens the person's details and closes competing side panels.
The roster also supports keyboard selection and shows profile photos.

Active fixed circles/polygons and the shared chaperone group zone have a
translucent fill and a four-pixel outline clamped over terrain and Google 3D
buildings. Polygon holes are preserved. Click a boundary for its trip and
radius/model details. Opening a trip and “Fit trip view” include boundary
extents and participant positions. Locations are never moved to make someone
appear inside a fence, and only Core determines containment.

Moving boundaries become amber/dashed when the snapshot is over 45 seconds old
or an anchor expires sooner. Traveler containment then reads unknown. Missing
boundaries are disclosed, never synthesized from an arbitrary traveler pin.

The Core companion release adds roster-scoped `avatar_url` and computes group
zones for every current trip on the authorized page. Until that release, the
frontend displays initials and loads group zones on trip drill-in using the
existing production API. No new key or schema migration is needed.
