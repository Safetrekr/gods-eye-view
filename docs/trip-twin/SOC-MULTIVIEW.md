# SOC multi-view — 1–6 wall screens + a remote (phase 10 design)

## Context
Trip Twin (benchmark tag `poc_v1_stable`, d3984e1) puts everything on one screen. Jesse wants it to work in a Security Operations Center (SOC).
- **Entering Trip Twin:** the operator chooses **All in one** (today's view) or **Multi-view**, then **1–6 display screens** plus a **remote** (an iPad or laptop on the network).
- **Screens:** they stay up all the time, coordinated, and each has a suggested role the operator can reassign. The remote targets **Screen 1–6 or All**.
- **Remote look:** it copies the Serras portal (podium): a right-hand STATIONS rail. Picking a station opens a sub-menu if one is needed, and the work itself sits on the left with the controls plus a live preview of the targeted screen. The model is the Rolls-Royce SOC screens.
- **Remote Trip section:** in planning (Advance) it shows every day of the trip. Picking a day opens its plan, paths and locations, which can be pushed to the screens.

**Jesse's answers:**
- Screens can be monitors on one machine *and* devices on the network.
- The remote shows controls plus a live preview, and has a target picker.
- Screen roles are suggested and can be reassigned.
- Walls are private to the SOC and show names (first name + initial), with a one-tap **Visitor mode** that reduces them to initials and counts.
- **2–3 mock trips** feed a multi-trip screen.
- Previews are **real snapshots**.
- First build: the **foundation plus 3 stations**.

**Inputs:**
- Protective-ops, travel-risk and supervision agents (role order, privacy, state model, control safety).
- Exploration of the podium rail (`serras/podium/.../serras-portal/index.html` lines 697–823 and 2385–2830; tarva.network `tarva-website-2026/site-src/partials/main-guide.html` + `assets/js/guide.js` for the two-level menu).
- Exploration of the Trip Twin seams.

Same rules as before: new or Trip Twin files only, Justin's files untouched, mock data only, prototype (no factory pipeline), and the full SafeTrekr wording and colour rules.

## 1. The six screen roles (defaults, reassignable)
| # | Role | What it shows | In an incident |
|---|---|---|---|
| S1 | **Site** | 3D twin of the focus site: buildings, people pins (accuracy circles), safety places, hazards near the site | Reported floor and cutaway shown; **the camera never moves by itself** (the remote offers "Frame reported floor on S1") |
| S2 | **Travelers** | Where everyone is now: a top-down live map of people across all of the trip's sites, plus big headcount numbers (Inside · Outside nearby · Away · Not current · Not located) with the age of each fix | Becomes accountability: "May still be inside", counted / not yet, time since the report |
| S3 | **Incident & attention** | Idle: "No incident open", Needs attention, next schedule items. Open: reported floor ("not verified"), who may be inside, move / shelter, decision log | The incident screen; its content updates, it never moves a camera |
| S4 | **Weather & alerts** | Three bands in this order: **official** (NWS / MeteoAlarm, verbatim, issuer, expiry) · **sensed** (lightning, radar, FIRMS heat) · distance notes. Radar and clouds over the area, the weather timeline, source and age on everything ("NWS checked 2 m ago: no active alerts returned for this point"; never "all clear") | Filters to the affected site; the next 3 hours only |
| S5 | **The day** | Today's (or the selected Advance day's) plan: a schedule timeline, the sites and safety places of the day, saved and suggested paths with their checks, sunset, and the forecast against outdoor items | Shows which later events are affected |
| S6 | **Trips on watch** | One tile per active trip (3 mock trips): local time, phase, not-current count, official alerts, next item. Sorted by need, never by name; a tile with no data is grey ("no data since 09:12") | The affected trip is pinned and outlined; the others stay live |

**Layout for each screen count** (first N roles; merges for small counts):
- 1 screen: Site plus today's panels (≈ All in one, in wall mode).
- 2: Site · Travelers with an incident/attention column.
- 3: + Incident & attention.
- 4: + Weather & alerts.
- 5: + The day.
- 6: + Trips on watch.

**Every wall screen** has:
- a corner chip: `S2 · TRAVELERS · Remote: EV · 12 s ago` (expands ~3 s on a change);
- a large `LIVE` / `ADVANCE · DAY 2` badge;
- the `SAMPLE` mark;
- a wall text scale (default ×2; the remote can set it per screen).

**Never on a wall:** medical info, guardians and contacts, responder copy text, per-person trails. Floor estimates per person appear only when an incident is open. Visitor mode drops names to initials and counts.

## 2. Architecture
- **One page, many roles.** A screen is `twin.html?view=screen` (role and slot come from the session). It boots the full page and applies a role profile: `body[data-role]` CSS (hide or enlarge regions, wall scale) plus role defaults for scale, layers and panels. Roles without 3D (Trips on watch, Incident & attention) stop the Cesium render loop and hide the canvas.
- **Remote:** a new `twin-remote.html`, with no Cesium.
- **State: three tiers** (supervision spec). The remote is the only writer; screens render.
  - *Session* (one value): trip, site, Live/Advance, Advance day, weather time, incident focus, spotlight (one person or place), visitor mode, scenario epoch.
  - *Per screen:* role, scale/camera intent, layers, cutaway floor, text scale, pinned. Each field is stored as `{value, source: default|override|all, rev, by, at}`.
  - *Rules:*
    - The relay sequences writes with a monotonic `rev`.
    - "All" writes only the fields it names and skips pinned screens ("Applied to 5 · S3 pinned").
    - "All" for a camera means *frame this subject by each screen's role*, never copying one camera everywhere.
    - "Reset to role defaults".
- **Pure reducer** `twinSession.js`: `apply(state, command) → {state, changed, skipped}` plus `undoSnapshot`. Fully unit-tested.
- **Shared clock.** Every screen computes the mock snapshot from the session's scenario epoch, so all screens show the same moment. `demoTripTwin.js` gains a `startMs` option in place of the module-load `scenarioStart`.
- **Transport** `twinSync.js`:
  - a WebSocket to a dev-server relay (works on one machine and across the LAN);
  - BroadcastChannel as the same-machine fallback when the relay is unreachable;
  - the relay holds the latest session and screen state, so a reconnecting screen restores at once;
  - screens also restore their last state from localStorage (never blank).
- **Relay** `server/tripTwin/syncRelay.js` (Vite plugin, `ws` already a dependency):
  - `server.httpServer` upgrade on `/api/twin-sync` with a `WebSocketServer({noServer})`;
  - rooms per session;
  - message types: `hello`, `state`, `command`, `ack`, `heartbeat`, `thumb`;
  - pairing codes;
  - controller lease (one controller, heartbeat 5 s, lease 30 s; a second remote joins as a viewer and can request hand-over);
  - thumbnails forwarded to remotes only.
  - Registered in `vite.twin.config.js` with the existing proxies.
  - The dev server must listen on the LAN for the iPad: `HOST=0.0.0.0 npx vite --config vite.twin.config.js` (documented; the default stays localhost).
- **Command dispatcher** in `page.js`:
  - lift the actions out of the keydown handler (4772–4932) into `command(name, args)`: site, scale 1/2/3, layer, ways out, live/advance, day, weather time, select person or place, frame, floor, path;
  - the keyboard and remote both call it;
  - screen mode maps session and screen state to commands.
- **Snapshots:** each screen captures its canvas (inside Cesium `postRender`) plus the DOM role badge as a 320 px JPEG every ~3 s and sends a `thumb`. Roles without a canvas send a small rendered summary card.
- **Multi-monitor placement:** on one machine, Chrome's Window Management API (`getScreenDetails`) opens each screen window full-screen on a chosen monitor. Where that isn't available, the windows open and the operator drags them.

## 3. Entry, pairing, connection safety
**Entry chooser** (first open of `twin.html` with no `view`): **All in one** | **Multi-view**. Multi-view asks for the number of screens (1–6), then offers:
- "Open screens on this computer", with monitor placement when allowed;
- "Pair a screen on another device", which shows the URL;
- "Open the remote here" or "Pair a remote", with the URL and code (shown as a QR code if a QR library is already installed, otherwise the URL and code).

The choice is remembered, and "Switch layout" stays in the Display popover.

**Pairing:**
- An unpaired screen shows a large 4-digit code; the remote enters it and assigns the slot number.
- Codes are single-use and expire after 5 min; 5 wrong tries lock pairing.
- A device token is kept in localStorage so a reload rejoins automatically.
- "Identify" flashes the slot numbers on every screen.
- Prototype only (stated in the UI and docs): plain `ws`, LAN only, no login. Production needs TLS, device enrolment, SSO, signed commands and an audit log (recorded in `07-production-delta.md`).

**Safety:**
- "All" pushes that change role, Live/Advance or camera intent ask for confirmation and show what changes ("Layers +paths → S1, S2, S4, S5 (S3 pinned)").
- Every push has a 10 s **Undo**.
- "Return all to Live + defaults" stays pinned on the remote.
- **Remote gone:** screens keep their state, and the chip turns amber: `Remote offline · 0:45`.
- **Screen link gone:** the last frame stays with a hatched band `STALE · last update 14:02:31 · 0:42 ago`, and the remote tile shows the problem.
- **Feed age** is shown separately from **link age**.
- **Incident banner:** every screen subscribes to alerts directly, so the banner shows even with no remote. It is the same banner in the same place on each screen. Once the remote acknowledges, it shrinks to a chip. Nothing pulses faster than 3 Hz.

## 4. The remote (Serras rail, SafeTrekr tokens)
**Layout:**
- Top bar: tenant plate (trip org) and operator seal.
- **Right rail `STATIONS`**:
  - the active-station card (name, subtitle, link status);
  - the two-level menu from tarva.network (tile grid → context list, with a "Main menu" return);
  - tiles numbered `01…`, 96 px tall, 2 columns, pinned to the bottom of the rail for the thumb;
  - pressing a tile moves it down (`translateY(1px)`), never up;
  - "fog" opacity + blur transitions, never slides; reduced motion respected.
- **Left:**
  - a persistent **target picker** `S1 · S2 · S3 · S4 · S5 · S6 · All` (radiogroup, arrow keys; Alt+1–6 / Alt+A on a laptop);
  - the **live preview** of the target with a text summary;
  - the station content.
- Docked at ≥1024 px, an overlay below that. Touch targets ≥44 px.

**Brand decision:** Serras uses amber for "active". In SafeTrekr, amber means *attention*. The active tile and current station therefore use the twin's selection white (`#eff7f3`) with a steel glow, and amber is kept for attention badges (e.g. an open incident on the Incident tile). Fonts stay SafeTrekr's (Inter, Intel One Mono); the rest of the Serras structure, depth and motion is copied.

**Stations in this phase (01–03 live; 04–06 shown as "Next phase"):**
1. **Screens**
   - one card per screen: thumbnail, role, status (`S2 · TRAVELERS · Austin · ✓ 2 s`), pinned;
   - picking a card sets the target;
   - sub-menu: change role, pin/unpin, text scale, identify, reset to defaults;
   - also: pair a screen, **Visitor mode**, "Return all to Live + defaults".
2. **Trip**
   - trip picker (3 trips) and Live / Advance;
   - in **Advance**, every day of the trip as a list (date, cities, number of events, flags such as an outdoor item after dark or an official alert);
   - picking a day opens the **day plan**: schedule items, the day's sites and safety places, saved and suggested paths with their checks, sunset and forecast;
   - actions: "Show this day on [target]" (the target screen becomes The day for that day), pick an event to send its site to S1, pick a path to show it on the target;
   - in Live, the same view shows today.
3. **Incident**
   - idle: report a floor (as today);
   - open: reported floor, who may still be inside (full names, remote only), move or shelter, "Frame reported floor on S1", "Make S3 the incident screen", "Copy for responders" (remote only), acknowledge the banner.

**Next phase:** 04 People (roster, spotlight a person), 05 Layers & time (layers, weather scrub with "viewing 15:00 forecast" on affected screens), 06 Alerts & feeds (acknowledge official alerts, feed health, log).

## 5. Mock trips (Trips on watch)
New `demoTrips.js` with three trips running at once, each built on an existing city fixture and scenario:
- **Spring choir tour** (Austin, today's sample);
- **Jazz band trip** (DC);
- **Youth choir** (London).

Each has an id, name, org, days and its own scenario. Tiles come from the same pure `tripTwinDemoSnapshot` + `assessSnapshot` path, with no Cesium. The focus trip drives S1–S5; S6 shows all three.

## 6. Files
**New:**
- `twin-remote.html`
- `src/operations/tripTwin/remote/` (`remote.js`, `rail.js`, `stations/screens.js`, `stations/trip.js`, `stations/incident.js`, `remote.css`)
- `src/operations/tripTwin/twinSession.js` (+ `.test.mjs`)
- `twinSync.js`, `twinScreen.js` (role profiles, chip, stale band, pairing view, thumbnails)
- `twinScreenRoles.js` (+ test: roles, merges for 1–6, privacy rules)
- `twinEntry.js` (chooser)
- `demoTrips.js` (+ test)
- `server/tripTwin/syncRelay.js` (+ test: pairing, lease, rev ordering, pinned skip)

**Changed (Trip Twin files only):**
- `page.js`: `command()` dispatcher, screen mode, entry
- `tripTwin.css`: role profiles, wall scale, chip, stale band
- `twin.html`: chooser and chip markup
- `vite.twin.config.js`: relay plugin, remote entry
- `demoTripTwin.js`: shared `startMs`
- `tripTwin.js`: render-loop pause, thumbnail capture

**Docs:** `plans/trip-twin/SOC-MULTIVIEW.md` (this design), a §18 vocabulary in `06-layer-taxonomy.md`, and production items in `07-production-delta.md`.

**Reuse:** `tripTwinDemoSnapshot`, `assessSnapshot`, `hud.render`, `card`, `twinAdvance` (days, events, `sunTimes`, `legWindow`), `pathChecks`/`checksFor`, `routeCards`, the existing popover, toast and `pref`/`save` helpers, and the existing proxy-plugin pattern (`server/tripTwin/routingProxy.js`).

## 7. Verification
- **Unit tests:**
  - reducer: All writes only named fields, pinned screens are skipped, undo, rev ordering;
  - roles and merges for 1–6 and Visitor-mode privacy (no full names, no medical);
  - pairing codes: expiry, single use, lockout;
  - lease hand-over;
  - mock trips.
  - Plus the existing 103 tests, the full `npm test` (only the 3 known failures), the build, boundaries, and QA on all 9 sites (All-in-one unchanged).
- **Browser run (puppeteer):**
  1. Start the relay and dev server.
  2. Open the remote and 6 screen windows, then pair them.
  3. Assign roles and check each screen's role, badge and chip.
  4. Push "Show Day 2" to All: every screen shows ADVANCE · DAY 2 and S5 shows the day plan; Undo restores.
  5. Pin S3: an All push skips it.
  6. Report a floor: the banner shows on all screens and no camera moves.
  7. Close the remote: chips show "Remote offline".
  8. Kill the relay: screens show STALE with the last frame.
  9. Reload a screen: it restores.
  10. Turn on Visitor mode: no names on any wall.
  - Screenshots at 1920×1080 for the walls and iPad 1180×820 / laptop 1440×900 for the remote; zero console errors.
- **LAN check (Jesse):** start with `HOST=0.0.0.0`, then open the remote URL on the iPad and pair it.
- **Standing rule:** after the build, the four design agents (UX, UI, supervision, IA) review the screenshots at both sizes, then fix list → fixes → after-shots → status → commit and push.

## Changes during the build (Jesse, 16 Oct 2026)
- **Walls are display only.** Every setting (layers, scale, text size, Ways out, display) moved to the remote; a wall shows only its role's content. A **04 Layers** station was added to this phase for that.
  - *Amended 23 Oct 2026 (Jesse, D5):* a keyboard at a wall opens that screen's own full-screen sheets: **L** Layers, **D** Display (scale, text size, motion, reset to role defaults), **K** Keys. They write through the session (`screen-cmd`; the host accepts only the screen's own slot and those fields, no lease needed), so the remote shows the change at once ("S4 · Rain map off · set at the screen") and stays the one truth. Role, Live/Advance, pin and wall-wide settings stay on the remote. Code: `twinWallSheet.js`, `twinSessionHost.screenCommand`.
  - *Amended 25 Oct 2026 (Jesse: "each screen should have its own right hand nav … collapsed on load"):* every wall gets the All-in-one's frame (top bar, left cards, full-screen map, map bar with the compass at the top right) and its own menu, closed on load behind the SafeTrekr toggle at the far right (M opens, Esc closes, closes itself after 30 s). It holds **Layout** (cards or map only, column width; a new screen field `layout`, PROTO 5), the role's **options** (S1: Ways out view), six **view moves** that are never saved, and **Settings** (the L / D / K sheets). Everything saved goes through `screen-cmd` as before, attributed "by S1 at the wall", with a 10 s Undo; refused (never queued) when not connected, pinned, in visitor mode, or when the remote has set **Wall controls: view only** (session field `wallControls`); safety layers stay on at a wall while a report is open. Scale picked at a wall is saved for that screen. Role, Live/Advance, pin and wall-wide settings stay on the remote. Screens convert one at a time (S1 Site first). Plans and reviews: `plans/trip-twin/review/screens/`. Code: `twinWallRail.js`, `twinWallPages.js`, `tripTwin.walls.css`, `twinScreen.js`.
- **One screen at a time.** The target picker (S1–S6 · All) applies every control to the chosen screen or to all of them.
- **QR pairing.** Two libraries were added: `qrcode` for the remote's QR on the Trip Twin computer and `html-to-image` for the true-picture previews. Pairing:
  - The computer that chooses Multi-view starts a setup. Only this computer (localhost) can start one.
  - Screen windows it opens join their slot directly.
  - The iPad scans the QR and opens the remote already paired, in control.
  - Screens on other devices show a 4-digit code that the remote enters.
- **Same-machine fallback (BroadcastChannel)** is not built; the relay works on one machine too. Recorded as deferred.

## How to run
- One computer only: `npx vite --config vite.twin.config.js`.
- With an iPad or other devices: `npx vite --config vite.twin.config.js --host 0.0.0.0`. The dev server is then reachable on the local network, so use it on a trusted network only.
- Then open `twin.html` → **Multi-view** → choose the number of screens → open the screens → scan the QR.
