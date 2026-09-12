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
- Public flight, CCTV, and earthquake layers; Google photorealistic tiles when
  configured, with a satellite globe fallback.

## Run locally

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

The staff endpoint has not been deployed by this branch. Merge/release Core, then
deploy the browser and a same-origin proxy equivalent to `staffCoreProxy.js`.
Static hosting alone cannot serve the `/api/` provider routes. Vite is the local
development/preview server, not the intended public production gateway. Configure
staff authentication, rate limiting and provider-key protection on the hosting
gateway before exposing the remaining upstream provider middleware publicly.

Supply a referrer-restricted Google browser key with Map Tiles API enabled for
photorealistic buildings, or an appropriate Cesium ion setup. No Maps key is needed
for the fallback globe. Provider rights, costs, and camera availability remain
separate from this fork's MIT code license; in particular review the operational
terms for OpenSky and the upstream data-license exceptions before deployment.
See [Google tile policies](https://developers.google.com/maps/documentation/tile/policies)
and [OpenSky terms](https://opensky-network.org/about/terms-of-use).

## Verification

```sh
node --test src/operations/*.test.mjs
npm run check:boundaries
npm run build
# With the development server running:
node scripts/operations-smoke.mjs
# Full upstream suite (canonical TMPDIR avoids a macOS symlink assertion):
TMPDIR=/private/tmp npm test
```

The browser smoke test uses fictional records, checks the login gate, globe,
stale/battery detail, flight form, narrow layout, and clearing private scene data
on logout. It writes screenshots to ignored `output/operations/`.
