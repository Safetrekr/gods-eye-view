# SafeTrekr World View

This fork adds a staff operations console to God's Eye View. The default page
uses Supabase sign-in and the Core `GET /v1/staff/operations` endpoint. It is a
read-only first release; the original explorer modules remain available for
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
- Nearby-camera searches measured from the selected person/location, explicit
  radius and coverage limits, and the upstream camera viewer.
- Scheduled passenger flight watchlist. Staff can explicitly link a dated leg
  to an exact ICAO24 address already in the live feed. Linked aircraft are green;
  the selected aircraft uses the upstream cyan selection treatment. An optional
  filter hides unrelated aircraft. No AviationStack requests or dependency.
- Header and footer shortcuts to World controls: civilian/military flights,
  satellites, AIS ships, TomTom traffic, FIRMS fires, earthquakes, and public
  cameras, with provider status and missing-key guidance.
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
origin, without `/v1`. For the local GET-only Core runner it is
`http://127.0.0.1:8002`. The Vite middleware forwards only the staff GET request and
the caller's bearer token to that fixed origin; it cannot proxy arbitrary Core
routes or writes. `.env.local` is ignored. Never put a service-role key or the
MCP personal access token in this checkout's browser configuration.

Core's companion branch contains `scripts/operations_readonly_server.py` and
`docs/staff-operations.md`. That runner loads the ignored Core
`.env.operations.local`, mounts only this route, and starts no production workers.
The normal production Core app mounts the same route through `src/main.py`.

A dedicated test account needs a matching active `public.users` profile.
Platform staff roles are `hq_admin`, `hq_supervisor`, `hq_security`, `hq_ops`, or
`analyst`, with `org_id IS NULL`. Organization administrators and security officers
can see only their own organization. Billing, participant, and unknown roles are
denied. The console has no writes; this does not remove permissions that the
account might have in other SafeTrekr applications.

The development-only **Explore a sample trip** button (or `?demo=1`) loads
fictional Austin travelers with a conspicuous simulated-data label. It makes no
Core data requests. Production builds provide no sample-mode entry point.

## First-release limits

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
independent of this computer's ignored `.env.local`. The production Core origin is
`https://api.safetrekr.com`, never localhost. The Core companion branch must be
released there before staff can enter the deployed globe. Do not point production
at the local test server or bypass its authorization to work around a missing route.

A successful staff snapshot issues a signed, Secure, HttpOnly, SameSite=Strict
five-minute cookie for public-provider access. Private snapshots always require
Core's full Supabase session and current staff-scope checks. Logout clears the
provider cookie. Responses bypass shared CDN caches. The deployed gateway mounts
only the providers used by this console; key editing, local camera mutations,
OpenAI/voice endpoints and arbitrary upstream proxies are excluded.

AIS on Vercel collects bounded 12-second samples and caches public vessel reports
across requests for one minute. It retains at most 3,000 observed vessels, for at
most 15 minutes. This is sampled coverage, not an always-on global receiver or
historical track store. AISStream permits one connection per key; a continuously
running local receiver using the same key can interfere with deployed sampling.
Use a separate key for simultaneous local testing or stop the local receiver.

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
