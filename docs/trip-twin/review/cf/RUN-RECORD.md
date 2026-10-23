# Phase CF run record (QA-17)

One entry per gate attempt, newest last. No token, setup link, key or `.env.local` value is ever written here. Shots, logs and `results.json` stay in the session scratchpad; the paths are listed so the next session can find them while the scratchpad lives.

## K1 · test command, relay test kit, multi-view smoke, CF-2 reproduction

- **Date:** 23 Oct 2026, 14:45–15:40 CDT. **Machine:** MacBook (macOS 26.5), headless puppeteer 25.10.0 (Chrome for Testing, SwiftShader).
- **Commit under test:** `3431392` (the CF base; K1 changes no app code). The K1 scripts and tests are in the working tree of `cf/core`.
- **Gate verdict: FAIL, so K1 is not committed.** `npm test` fails on three non-Trip-Twin tests that also fail on the base. Jesse asked for a fully clean `npm test`. The fix is commit `d294a54` on `cf/shared-tests`, which still has to be cherry-picked onto `cf/core` (this session was not allowed to). Since K1, `node scripts/test-trip-twin.mjs` runs `npm test` itself and fails the gate on any failure there.
- **Node:** 22.21.1. `package.json` asks for Node 24; the shared runner skips its two allocation probes on 22 (warning recorded, not a Trip Twin test).
- **QA server:** `git archive 3431392` on `http://localhost:4181` (bound to 127.0.0.1), HMR off, no file watching, own `cacheDir`, `TMPDIR` in the QA folder. The live wall's session file was not touched (smoke step K1-S14).
- **Map keys:** the launcher passed **0 of 2**. The MacBook's `.env.local` holds neither `GOOGLE_MAPS_API_KEY` nor `CESIUM_ION_TOKEN` (it holds only the FIRMS key, which is never passed). Walls ran without Google 3D tiles; the smoke and repro steps do not depend on tiles. Add the two keys to that file (or run the gate on the Mac Studio) before any visual step.

### Gate

| Check | Command | Result |
|---|---|---|
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS for the Trip Twin part** (the command as a whole fails on the repo tests below). 153 tests in 22 files: 153 pass, 0 fail, 0 skip, 0 todo. Baseline before K1: 150 at `3431392` (same as `b0df270`; the shell commits added none). K1 adds 3 (below). |
| Wiring (warnings until K7) | same | 3 findings: `/api/route` at `twinCustomPaths.js:148` and `twinPaths.js:44` (RT-7 moves them to `/api/twin-route`); `Math.random` at `twinSessionHost.js:18` (S-7, K7). |
| Shared-file guard | same | Clean: no CF commit and no working-tree change touches the seven shared paths. |
| Repo tests | `npm test` (also run by `test-trip-twin.mjs`) | **FAIL. Exit 1, as on the base.** 3159 tests: 3155 pass, 3 fail, 1 skip. The same three fail on a clean `git archive 3431392` (3150 tests, 3 fail, 1 skip): `devCctv.test.mjs` "CCTV preset starts keyless…" (`/private` tmp path), `environmentProviders.test.mjs` "FIRMS retains a large successful source…", `viteBuild.test.mjs` "root config retains existing named exports…" (expects `safetrekr-read-only-core`, the code names `safetrekr-core-bridge`). None is a Trip Twin file; K1 does not touch them. The 9 relay tests now run inside `npm test`. |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/twin-dist` | **PASS** (exit 0; the usual chunk-size note). Nothing written to the repo. |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --dir <scratchpad>/qa-server` | **PASS.** 15 steps pass, 6 TODO (remote and All-in-one DOM, after shell step C), 0 pageerror, 0 console.error. |
| CF-2 repro | `node scripts/qa-twin-multiview.mjs repro-pairing --wait-expiry --dir …` | **Ran.** 8 RED (reproduced on the base), 2 GREEN, 5 by hand. Table below. |

### Test names added in K1

- `twinRelay.test.mjs` › `upgrade today: a same-origin page is accepted, another origin is refused`
- `twinRelay.test.mjs` › `upgrade today: no Origin header is accepted; other paths are left to Vite`
- `twinRelay.test.mjs` › `upgrade today: only a loopback peer can start a setup through the real handler`

Moved, not renamed: the six tests of `server/tripTwin/syncRelay.test.mjs` are now in `src/operations/tripTwin/twinRelay.test.mjs` under the same names (S-3, BE-12), on the kit (`twinTestKit.mjs`). `clockHost` moved from `twinSession.test.mjs` into the kit with the same seed, so those tests are unchanged. The relay tests now point `TMPDIR` at a temporary folder before the relay loads, so no test can read or write the live wall's session file.

### Smoke (before shell step C)

Socket level: launcher hello then setup for six; S1–S5 join by the launcher link; the remote pairs from the QR link and takes control; a headless wall page with no link shows the pair card (4-digit code, the right host); the remote pairs it by code into S6 and its chip reads "S6 · Remote: QA iPad"; one command (S2 role → day); one confirmed command (All → Advance, `needsConfirm` true; confirmation is still client-side, K10); undo restores every wall; kill and restart: the QA store held S1–S6, S1–S5 rejoined their slots with no pair codes, the remote got its lease back, the S6 page rejoined on its own; six walls online; live store untouched.

Finding for ET-3 R0.1 ("does Vite's dev client reload pages after a server restart?"): **yes, even with `hmr: false`.** The Vite client polls and reloads every open page when its server returns; the wall then rejoins from its `sessionStorage` id and `localStorage` token. `server.ws: false` would stop the reload but leaves the client's own socket hanging, and Chrome then queues the wall's socket behind it (the wall never connects), so the QA server keeps the Vite socket.

### CF-2 lost pairing identity: reproduction on `3431392`

Each step asserts what the product should do (06 AC-2.1–2.3). RED means reproduced on the base (expected; the fixes come in K4).

| Step | Hypothesis | Should | Observed on `3431392` | Verdict |
|---|---|---|---|---|
| R-1 | H4 · BE-7 cause 1 (fake clock) | A window reopened after the 10-min setup expiry rejoins S4 or says why | New id, so "pair-code"; the old device stays listed as S4, offline | RED |
| R-2 | H1 · BE-7 cause 2 (socket level) | One id hello'd for S3 then S4 keeps both | S4 paired; S3 gone from presence | RED |
| R-H2 | H2 · AC-2.3 (socket level) | One live socket per id; the survivor stays online | The second socket with the same id and token is accepted; both live; closing the first marks S2 offline while the copy is live | RED |
| R-H1 | H1 · BE-7 H-2 (headless) | A launcher tab that once was a wall opens S3 and S4 with distinct ids | Both windows carry the opener's id (`window.open` copies `sessionStorage`); S3 drops out of presence | RED |
| R-H1c | control for R-H1 | A fresh launcher tab opens S1 and S2 with distinct ids | Distinct ids; both online | GREEN |
| R-Hb | H2 · QA H-b (duplicate tab, headless) | The copy gets its own identity or is told; S5 stays online | Same id in both; closing the original marks S5 offline while the copy still draws | RED |
| R-Hd | H3 · QA H-d (headless) | A wall paired on `localhost` and reopened on `127.0.0.1` rejoins, or is sent to `localhost` (S-23) | New id, no token: the pair card | RED |
| R-H4 | H4 · BE-7 H-1 (live, 10.5 min) | Close S4, wait past the expiry, Open S4 again: it rejoins or says why | After 11 min the reopened S4 window (new id, expired link) shows a pair code | RED |
| R-He | QA H-e | After a server restart a wall rejoins with its token | Rejoined S1 | GREEN |
| R-3 | BE-7 cause 3 (store) | A half-written store is set aside and the last good copy restores the wall (K2) | Torn file ignored: the whole wall is lost; S1 gets a pair code | RED |

By hand on the Mac Studio (M4.1, not run here): Chrome quit and relaunch with "Continue where you left off"; a Mac Studio reboot with Vite started by hand; walls through the LAN IP or `.local` name versus `localhost` (the QA server is loopback-only, so the keys never leave the MacBook; the mechanism is the one R-Hd shows); Tab › Duplicate in real Chrome; a wall closed by accident and reopened from the launcher after 10 minutes in real time.

Two console errors in the repro run came from one headless popup that got no WebGL context ("open failed … webgl2"); they do not affect identity or pairing and are a SwiftShader-under-load artefact, not a product error.

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `qa-server/runs/smoke-2026-10-23T20-04-52/` (results.json, results.md, shots)
- `qa-server/runs/repro-pairing-2026-10-23T20-16-25/` (with `--wait-expiry`)
- `qa-server/server.log`, `npm-test.log`, `npm-test-base.log`, `twin-dist.log`

### Gate re-run after the shared test fixes (23 Oct 2026)

Shared test fixes cherry-picked as `1cb7e28` (from `d294a54`, Jesse's OK). `node scripts/test-trip-twin.mjs`: **PASS** in 55 s. Trip Twin 153/153 (0 skip, 0 todo, baseline 153); shared-file guard clean; `npm test` exit 0, 3159 tests, 3158 pass, 0 fail, 1 skip (Windows-only DACL test). Wiring warnings until K7: `/api/route` at `twinCustomPaths.js:148`, `twinPaths.js:44`; `Math.random` at `twinSessionHost.js:18`. Build and smoke results above are unchanged (the cherry-pick touched tests only). **K1 verdict: PASS.**

## K2 · store hardening, data folder, runbooks and checklists

- **Date:** 23 Oct 2026, 15:30–16:10 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (Chrome for Testing, SwiftShader).
- **Code under test:** the `cf/core` working tree on top of `ff8a953` (K1). The QA server now serves it with `--ref worktree` (tracked and new files, `.gitignore` respected; git state only read), so the gate runs before the commit. The revert drill restarts on `HEAD` (`ff8a953`, the K1 code) and then on the working tree again.
- **QA server:** `:4181` on 127.0.0.1, `TRIP_TWIN_DATA_DIR` and `TMPDIR` both in the QA folder. Map keys passed 0 of 2 (as K1). The live store paths were only ever `stat`ed.
- **Gate verdict: PASS.**

### What landed

- `server/tripTwin/sessionStore.js` (new). Data folder `TRIP_TWIN_DATA_DIR`, default `~/Library/Application Support/SafeTrekr/trip-twin/` (0700). A path inside the repo or Vite's root, or a relative path, is refused: the wall runs unsaved and logs `store.dir_refused`; it never falls back to another folder (so a QA server cannot land on the live wall). Files 0600: `session.json` (`v:1`, `savedAt`, `migratedAt`), `session.prev.json` (the store at the last good start; restored by hand only), `migrated.json` (marker, no tokens), `quarantine/`.
- Atomic write: `<file>.tmp` (0600), `fsync`, `rename`, folder `fsync`. A temp left by a crash is deleted unread at the next start. Saves stay debounced 300 ms; a save fails loudly (`store.saved_error`, once per new error) instead of being swallowed. Flush on server close and on process exit.
- Shape check on load (version, session, devices, slots, tokens, lease). A bad or unknown-version store goes to `quarantine/session-<UTC>.json` and the wall starts fresh (`store.quarantined`, `store.reset` with the backup path). Never half-loaded; quarantine and backup are never read back by code.
- Migration (S-14): the first start with no store and no marker reads the old `os.tmpdir()/trip-twin-soc-session.json` once, writes `session.json` with `migratedAt`, then the marker (store first, so a failed write retries next start). With the marker present the tmp file is never opened again, even when `session.json` is deleted. A tmp file that carries `migratedAt` (a copy written by K2 or later) is never taken as a store, even with the whole data folder gone.
- Dual write until K11: every save also writes the tmp path (same `v:1` document; older code ignores the extra fields), so a revert still loads. `forget(snapshot, ids)` rewrites the store, the tmp copy and the backup without those devices (an unreadable backup is deleted); the relay calls it from K11, when Forget lands.
- `syncRelay.js`: the store is opened through `openRelayStore` (fences: this checkout and Vite's root); log lines `[trip-twin] store.*` go to the Vite logger (counts, slots, paths and reasons only, never a token).
- Runbooks in `docs/trip-twin/runbooks/`: `deploy-mac-studio.md` (§6.2 checklist; copy the store; first-K2-deploy migration check with `TRIP_TWIN_STORE_FIXTURE=<copy>`; same shell type so `$TMPDIR` matches; rollback for reverts above and below K2; Forget again after a restore), `demo-day.md`, `re-pair.md` (hand restore of the backup; Safari may drop an iPad's token after a week unused), `break-glass.md` (allowed hosts first, then `report`, then Forget all, then delete every store file and the backup by path, with a token-file check), `unknown-device.md` (01 §6 steps 1–5).
- Harness: `qa-twin-server.mjs` sets `TRIP_TWIN_DATA_DIR`, serves `--ref worktree`, and `restart({ref})` swaps the code for revert drills. `qa-twin-multiview.mjs`: K1-S9 also checks modes 700/600 and the tmp copy; new K2-S1 (revert-and-restart) and K2-S2 (forward again, no second migration); K1-S14 stats both live paths and, on a change, names the file and any live :4173 server; restart quiet window is a counter; R-3 reworked (below), R-3q added.

### Gate

| Check | Command | Result |
|---|---|---|
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS** in 82 s. 166 tests in 23 files: 166 pass, 0 fail, 0 skip, 0 todo; baseline 166 (153 + 13). |
| Wiring (warnings until K7) | same | Unchanged from K1: `/api/route` at `twinCustomPaths.js:148`, `twinPaths.js:44`; `Math.random` at `twinSessionHost.js:18`. |
| Shared-file guard | same | Clean (1 CF commit checked, plus the working tree). |
| Repo tests | `npm test` (run by the gate) | **PASS.** Exit 0; 3172 tests, 3171 pass, 0 fail, 1 skip (Windows-only DACL test); allocation probes skipped on Node 22. |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/twin-dist` | **PASS** (exit 0; the usual chunk-size note). |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --ref worktree --dir <scratchpad>/qa-k2` | **PASS.** 17 pass, 6 TODO (after shell step C), 0 pageerror, 0 console.error on the final run (`smoke-2026-10-23T21-08-34`). Includes restart-and-reconnect (K1-S9 to S13) and revert-and-restart (K2-S1 on `ff8a953`, K2-S2 forward again: `store.loaded`, no `store.migrated`). |
| CF-2 repro | `node scripts/qa-twin-multiview.mjs repro-pairing --ref worktree --dir …` (no `--wait-expiry`) | **R-3 GREEN**, R-3q GREEN, R-He GREEN, R-H1c GREEN; R-1, R-2, R-H2, R-H1, R-Hb, R-Hd RED as expected until K4; R-H4 not run (needs `--wait-expiry`; R-1 covers it on a fake clock). |

One smoke attempt failed K1-S14 and was re-run: the live tmp store changed at 16:01:26 during the forward step. It was written by Jesse's own live server (`gods-eye-view`, pid 81005, :4173, base code), not by the QA run: the live file was 3018 B against the QA wall's 2854 B, the QA files were in the QA folder, and the default data folder still does not exist. That live wall saves every few seconds while it is in use (16:02:54, 16:03:09 between runs). The re-runs passed K1-S14. Expected restart refusals (`ERR_CONNECTION_REFUSED`/`RESET` from the Vite client's socket) are now quiet for 15 s after each restart.

### R-3 now

R-3 models what a crash in the middle of a save leaves behind. Before K2 the store was written in place, so a cut-off save tore the store itself (K1: RED, the whole wall lost). From K2 a save writes `<store>.tmp` and renames it, so a cut-off save tears only the temp file. The step writes half the store into `<store>.tmp`, restarts and says hello as S1: **S1 rejoins and the temp file is deleted unread (GREEN)**. On a pre-K2 build the step still tears the store in place, as before. A store damaged **outside** a save (disk fault, hand edit) is R-3q: it is quarantined, the server starts fresh, S1 gets a pair code and the backup waits for a hand restore. That is by design: S-14 does not allow an automatic restore from the backup. The K1 row's wording ("the last good copy restores the wall") is met by the atomic write, not by an automatic restore.

### Test names added in K2 (`twinStore.test.mjs`)

- `store: saves atomically into a 0700 folder as 0600 files with v:1; no temp file left`
- `store: a crash between write and rename leaves the old file readable`
- `store: a torn write (half the bytes, then a crash) leaves the old file readable`
- `store: a corrupt store is moved to quarantine/ and the server starts`
- `store: a store of an unknown version is quarantined, not half-loaded`
- `store: a redacted copy of a real pre-K2 store migrates once and its walls rejoin`
- `store: after migration, deleting the new store and restarting does not read the tmp file`
- `store: revert-and-restart: the pre-K2 loader still finds the wall in the tmp file (dual write)`
- `store: TRIP_TWIN_DATA_DIR inside the repo or Vite's root is refused and the wall runs unsaved`
- `store: the last change is flushed when the server closes`
- `store: Forget rewrites the store and the backup without that device`
- `store: a crash-left temp file of the store is deleted unread at start`
- `store: a migration whose store write fails is tried again at the next start`

The relay tests now point `TRIP_TWIN_DATA_DIR` and `TMPDIR` at a temporary folder; the fake Vite server moved into the kit (`fakeViteRelay`). A mutation check (marker branch removed; dual write removed) turned 2 and 6 of these tests red.

**The fixture.** `src/operations/tripTwin/fixtures/twinStore-pre-k2-redacted.json` is a pre-K2 store written by the base relay code (`host.snapshot()` as JSON) for a Mac Studio-shaped wall: S1–S5 from the launcher, S6 paired by code, the iPad in control, a stray screen that never paired, three commands. Its seven tokens are replaced by `rdct…` values. The real Mac Studio store was not available from here and was not copied. Before the first K2 deploy, run the same test on a copy of it (`deploy-mac-studio.md` step 4: `TRIP_TWIN_STORE_FIXTURE=<copy> node --test src/operations/tripTwin/twinStore.test.mjs`; the test prints no token).

### Deferred

- Health `store: {ok, lastError}` on `/api/twin-sync/health`: K6 (the store exposes `status()`).
- Forget wiring and the quarantine token scrub: K11 (store, backup and tmp copy are covered by `forget()` now). The tmp-file delete and the end of the dual write: K11.
- The migration on a copy of the real Mac Studio store: by hand before the K2 deploy (above).

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `k2/gate2.txt` (gate with names), `k2/build2.log`, `k2/smoke2.txt` (the K1-S14 attempt), `k2/smoke3.txt` to `k2/smoke5.txt`, `k2/repro1.txt`
- `qa-k2/runs/smoke-*`, `qa-k2/runs/repro-pairing-2026-10-23T20-55-08/`, `qa-k2/server.log` (store lines)

## K3 · Host/Origin report mode with today's floor

- **Date:** 23 Oct 2026, 16:00–16:45 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (Chrome for Testing, SwiftShader).
- **Code under test:** the `cf/core` working tree on top of `ff4333a` (K2), served with `--ref worktree`. The revert drill restarts on `HEAD` (`ff4333a`, the K2 code) and then on the working tree again.
- **QA server:** `:4181` on 127.0.0.1; `TRIP_TWIN_DATA_DIR`, `TRIP_TWIN_AUDIT_DIR` and `TMPDIR` all in the QA folder. Map keys passed 0 of 2 (as K1, K2). The live store paths and the live `~/Library/Logs/trip-twin/would-refuse.jsonl` were only ever `stat`ed (the latter does not exist; nothing created it).
- **Gate verdict: PASS.**

### What landed

- `server/tripTwin/twinHosts.js` (new, pure): `hostLists()` per request (C22: `localhost`, `127.0.0.1`, `[::1]`, the LAN IPv4 addresses, `os.hostname()` as given and as `<first label>.local`, the Bonjour `LocalHostName` as `.local`, `TRIP_TWIN_ALLOWED_HOSTS`), `allowedOrigins()` (`http://` and `https://`, SEC-14), `upgradeVerdict()` (QA-2; reasons `path`, `host`, `no-origin`, `null-origin`, `origin`), `todayVerdict()` (the `3431392` rule byte for byte: an Origin, when present, must equal Host), `twinHostGuard()`, `localOnly()` (§4.4: loopback peer, a loopback Host with the port, `Sec-Fetch-Site` same-origin or absent), the would-refuse record shape (header values clipped to 64 printable characters, no query strings).
- `server/tripTwin/twinHostCheck.js` (new): one check per dev server, shared by the relay and both proxies. Lists memo 1 s; Bonjour name from `scutil --get LocalHostName` (macOS), memo 60 s, refreshed in the background. `TRIP_TWIN_HOST_CHECK`: `report` is the only mode; `enforce` or any other value runs `report` and says so at boot (K12 adds `enforce`). `TRIP_TWIN_ALLOWED_HOSTS`: names or addresses with an optional port; `*`, a leading dot, a scheme or a path are refused and listed at boot. `TRIP_TWIN_AUDIT_DIR` (default `~/Library/Logs/trip-twin/`): absolute, not inside the repo or Vite's root, never swapped for the default; folder 0700, `would-refuse.jsonl` 0600, created on the first line only, at most 60 lines a minute (the rest counted on the next line), stops at 20 MB. K6 takes the file over. Boot line `[trip-twin] hosts.check {mode, asked, allowedHostsExtra, wouldRefuse}`.
- `syncRelay.js`: the upgrade listener is the exported `createTwinUpgrade({relay, check})` (SEC-15). **Report mode keeps today's rule as the decision** (S-11, sec B1): a foreign Origin is still refused exactly as today (socket closed, nothing written); the new verdict is only recorded. Each line says the new `reason`, `today` (today's verdict) and `effect` (what the server did). One thing is enforced already: only the exact path `/api/twin-sync` (query allowed) is the relay; a `/api/twin-sync…` look-alike is refused (no client uses one). Every connection records `secure` (`req.socket.encrypted`) in its connection record and socket meta; `relay.connections()` lists `{local, secure, kind}` with no ids. `/api/twin-sync/info` adds `hostAllowed`, `reason` and `hostCheck`; addresses are empty when the Host is refused (and come from the same check, so tests can inject them).
- `twinHostGuard()` mounted first on `/api/twin-sync` (relay), `/api/twin-place` and `/api/twin-path` (routing) and `/api/twin-weather` (weather). Always on: `Sec-Fetch-Site` other than `same-origin` or absent gets 403 JSON before the handler runs (sec S9, N7). Report mode: a Host the new list would refuse is served and recorded. No CORS headers anywhere.
- `sessionStore.js`: the K2 folder fence is now `resolveFencedDir()`, used by the data folder and the audit folder (same rules).
- Kit and harness: `fakeUpgrade` takes `encrypted` and `localPort`; `miniConnect()` (a connect-style stack: case-insensitive route, prefix cut from `req.url`); `liveTwinServer()` (Trip Twin plugins on a real loopback HTTP server, for real `ws` and HTTP tests); every kit server sets a throwaway `TRIP_TWIN_AUDIT_DIR` if none is set. `qa-twin-server.mjs` sets `TRIP_TWIN_AUDIT_DIR` into the QA folder. New smoke step K3-S1 (below).
- Runbooks: `break-glass.md` step 1 and `deploy-mac-studio.md` step 15 name the would-refuse file, the boot line and the `/info` fields.

### Gate

| Check | Command | Result |
|---|---|---|
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS** in 34 s. 190 tests in 25 files: 190 pass, 0 fail, 0 skip, 0 todo; baseline 190 (166 + 24). |
| Wiring (warnings until K7) | same | Unchanged: `/api/route` at `twinCustomPaths.js:148`, `twinPaths.js:44`; `Math.random` at `twinSessionHost.js:18`. |
| Shared-file guard | same | Clean (2 CF commits checked, plus the working tree). `build/vite.js` and `vite.twin.config.js` untouched (the `allowedHosts` override is K12). |
| Repo tests | `npm test` (run by the gate) | **PASS.** Exit 0; 3196 tests, 3195 pass, 0 fail, 1 skip (Windows-only DACL test); allocation probes skipped on Node 22. |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/twin-dist` | **PASS** (exit 0; the usual chunk-size note). |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --ref worktree --dir <scratchpad>/qa-k3-final` | **PASS** (twice: before and after formatting). Final run `smoke-2026-10-23T21-29-38`: 18 pass, 6 TODO (after shell step C), 0 pageerror, 0 console.error. Includes K3-S1 (below). |
| Restart and revert | same run | K1-S9 to S13 (restart-and-reconnect) and K2-S1/K2-S2 (revert to `ff4333a` and forward: `store.loaded`, no `store.migrated`) pass. |
| Mutation check | `report` made log-only (today's floor removed), by hand, then restored | T3.4b and K1's `upgrade today: … another origin is refused` turn red (2 fail); restored code green. |

### T3.4b and the would-refuse evidence

- **Unit, real `ws` against the relay's own upgrade handler** (`twinHostCheck.test.mjs`): `Origin: http://evil.example` with `Host: 192.168.1.3:4173`, with `Host: localhost:4173` and with `Host: localhost:<port>` → all **refused** in `report`; each is also recorded (`today: refused`, `effect: refused`). Same-origin upgrades through `localhost`, `127.0.0.1`, `[::1]`, `192.168.1.3`, `jesses-mac-studio.local` (from the hostname `Jesses-Mac-Studio.lan`) and `jesses-mac-studio-2.local` (the Bonjour name after a clash) → all open, **no line and no file**. `Host: evil.example:4173` with `Origin: http://evil.example:4173` → served (today's rule) and **a line in the file** (`reason: host`, `today: allowed`, `effect: allowed`). A cross-site, same-site or `none` GET to `/api/twin-weather/now`, `/api/twin-place` and `/api/twin-sync/info`, and a cross-site POST to `/api/twin-path`, → **403**, the fake upstream never called; same-origin and no header → 200.
- **Live, on the QA server (smoke K3-S1):** 0 would-refuse lines from the whole smoke's own traffic (launcher, six walls, remote, pages, two restarts, the revert drill). Then the probes wrote exactly 4 lines to `qa-k3/audit/would-refuse.jsonl` (folder 0700, file 0600):

  | kind | Host | Origin | reason | today | effect |
  |---|---|---|---|---|---|
  | upgrade | `evil.example:4181` | `http://evil.example:4181` | host | allowed | allowed |
  | upgrade | `localhost:4181` | `http://evil.example` | origin | refused | refused |
  | upgrade | `192.168.1.3:4181` | `http://evil.example` | host | refused | refused |
  | http | `evil.example:4181` | — | host | allowed | allowed (`/api/twin-sync/info`: `hostAllowed:false`, no addresses) |

  The cross-site weather GET got 403 with no CORS header. Peer was `127.0.0.1` for all (the QA server is loopback-only).

### Test names added in K3

`twinHosts.test.mjs` (pure tables):
- `hosts T3.1: the Host allowlist (loopback, LAN, .local, Bonjour, env; IPv6; port exact)`
- `hosts T3.2: the Origin allowlist, including an Origin equal to an evil Host (rebinding)`
- `hosts T3.3: a missing or null Origin is refused by the new rule, for every peer`
- `hosts: only the exact relay path is the relay (SEC-1); a query string is fine`
- `hosts T3.4: today’s rule, unchanged: same-origin and no Origin pass, a foreign Origin is refused`
- `hosts T3.4b (rule): today’s floor refuses Origin http://evil.example with Host 192.168.1.3:4173 and with Host localhost:4173`
- `hosts C22: machine names (hostname plain and .local, Bonjour .local); TRIP_TWIN_ALLOWED_HOSTS has no wildcards`
- `hosts: Host and Origin parsing (default ports, IPv6, case)`
- `hosts §4.4: localOnly() = loopback peer, a loopback Host with the port, same-origin or no Sec-Fetch-Site`
- `hosts: Sec-Fetch-Site gate (same-origin or absent only)`
- `hosts: a would-refuse record is clipped, printable and has no query string`

`twinHostCheck.test.mjs` (wiring, real `ws` and HTTP on loopback):
- `host check: TRIP_TWIN_HOST_CHECK has one mode in K3; enforce and unknown values run report and say so`
- `host check S-2: wildcards in TRIP_TWIN_ALLOWED_HOSTS are refused and logged at boot; real names are allowed`
- `host check S-1: TRIP_TWIN_AUDIT_DIR inside the repo or Vite’s root, or relative, is refused; nothing is written`
- `host check S14: would-refuse lines are JSONL in a 0700 folder and a 0600 file, at most 60 a minute`
- `host check C22: the lists are computed per request (memo 1 s): a new DHCP address is allowed a second later`
- `upgrade T3.4b (real ws, report): Origin http://evil.example with Host 192.168.1.3:4173 and with Host localhost:4173 is refused`
- `upgrade (real ws, report): no would-refuse for localhost, 127.0.0.1, [::1], the LAN IP, the .local name or the Bonjour name`
- `upgrade (real ws, report): Host evil.example:4173 is still served by today’s rule, and a would-refuse line is in the file`
- `upgrade (real ws): a look-alike path /api/twin-sync2 is refused; Vite’s own upgrades are left alone`
- `upgrade SEC-14: each connection records secure; an https Origin on TLS is on the new list`
- `HTTP guard (fetch-metadata): a cross-site GET to a proxy gets 403 and never reaches upstream; no CORS headers`
- `HTTP guard (report): a Host the new list would refuse is served and recorded; allowed Hosts are not recorded`
- `/api/twin-sync/info: hostAllowed and reason; no addresses for a refused Host`

K1's three `upgrade today:` tests are unchanged and still pass (the rebinding pair and the no-Origin upgrade are still accepted in `report`; they are now also recorded).

### Notes and deferred

- **Behaviour to know:** `Sec-Fetch-Site: none` (typing an `/api/twin-*` URL into a browser's address bar) now gets 403, per §4.4 ("same-origin or absent"). `curl` and the pages themselves are unaffected. The walls, the iPad and the launcher fetch same-origin.
- **K12:** `enforce` (refused upgrade → 403 + `upgrade.refused`, missing and `null` Origin refused, the HTTP guard refusing), the `vite.twin.config.js` `allowedHosts` override, "Host check relaxed" on the status strip, address-not-allowed copy, and the script that lists distinct (Host, Origin, peer, reason) values in `would-refuse.jsonl` for Jesse's sign-off.
- **K6:** the would-refuse file moves under the audit log (retention, health); `upgrade.refused` and `http.refused` become audit events with `peer` and `secure` (today they are rate-limited dev-log lines).
- **K11 / K6:** `localOnly()` is in place and tested; `/boot` and `/log` use it when they land.
- **On the Mac Studio (by hand, before deploy):** check that `scutil --get LocalHostName` gives the name the iPad uses, and after a day of normal use that `would-refuse.jsonl` holds no line from a real wall or the iPad.
- `useInstead` on `/info` (ET-3) was not added: §4.4 settles `{hostAllowed, reason}` only, and a suggested name would leak one to a refused Host.

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `k3/gate1.txt`, `k3/gate2.txt` (gate with names, before and after formatting), `k3/build.log`, `k3/smoke1.txt`, `k3/smoke2.txt`
- `qa-k3/runs/smoke-2026-10-23T21-27-33/`, `qa-k3/audit/would-refuse.jsonl`, `qa-k3/server.log` (`hosts.check` boot lines); `qa-k3-final/runs/smoke-2026-10-23T21-29-38/` and `qa-k3-final/audit/would-refuse.jsonl` (the run on the final bytes; the same 4 lines)

## K4 · lost pairing identity (server and client identity)

- **Date:** 23 Oct 2026, 16:45–17:55 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (Chrome for Testing, SwiftShader).
- **Code under test:** the `cf/core` working tree on top of `5441cae` (K3), served with `--ref worktree`. The revert drill restarts on `HEAD` (`5441cae`, the K3 code) and then on the working tree again.
- **QA server:** `:4181` on 127.0.0.1; data, audit and `TMPDIR` in the QA folder. Map keys passed 0 of 2 (as K1–K3). The live store paths were only ever `stat`ed; the live :4173 server was never contacted.
- **Gate verdict: PASS.**

### Root cause (CF-2), as the repro shows it

Two causes were live on the base, both fixed here; the third (the store) was K2.
1. **Identity tied to the window (H4, H-c):** the device id lived in `sessionStorage`, so a wall window opened again (closed by accident, a restart, "Open S4" after the 10-minute link) came back as a new device with no token and got a pair code (R-1, R-H4).
2. **One id in two windows (H1, H2, H-a, H-b):** `window.open` and a duplicated tab copy `sessionStorage`, so two windows shared one id and one token; the relay let both sockets live, moved the device between slots, marked the wall offline when either closed, and a later `unpaired` in one window deleted the token the other was using (R-2, R-H1, R-H2, R-Hb).
The origin switch (H3, H-d: `localhost` and `127.0.0.1` keep separate storage) is answered for loopback names by the S-23 redirect; the LAN IP and `.local` stay separate origins by nature (by hand below).

### What landed

- `src/operations/tripTwin/twinProtocol.js` (new, constants only; K5 completes it): hello deny codes (S-8), the terminal list (S-16: `FORGOTTEN`, `TOKEN_EXPIRED`, `ID_IN_USE`, `TICKET_USED`, `TICKET_EXPIRED`), unpaired reasons (`FORGOTTEN`, `SLOT_TAKEN`, `EXPIRED`), the `replaced` message, close codes 4002 and 4003.
- `src/operations/tripTwin/twinIdentity.js` (new): a wall window opened for slot N uses the slot record `localStorage['tripTwin.soc.slot.<N>'] = {id, token}` wherever `localStorage` exists (also on a plain-http LAN page with no Web Locks); the Web Lock `tt-slot-<N>` is an extra guard where locks exist (the newest window takes it with `steal`; the older one stops at once and never touches storage); other windows check `tt-id-<id>` and take a fresh id when it is held (a copied opener id). The remote keeps its id in `localStorage` too (`tripTwin.soc.remote`, F-0014 a). Ids are `kind-` and 32 hex from `crypto.getRandomValues` (S-7). Migration: a window holding a pre-K4 `sessionStorage` id with a token is copied into its record (unless another slot's record already holds that id); the old keys are still written, nothing is deleted until the core exit. A screen paired by code binds its record to the slot the relay gives it. Records are rewritten compare-and-set, so a newer window's token is never lost. `localhostUrl()` for S-23.
- `src/operations/tripTwin/twinSync.js`: identity from `twinIdentity.js`; the client takes an `env` (the page globals by default; the test kit passes a fake browser). Refusals with a code: `ID_COPIED` → a fresh id and a new hello on the same socket; a terminal code → drop that token (fresh id) or that link, then a wall asks again (pair card or a still-valid link), a remote or launcher shows its refusal and stops reconnecting. `{t:'replaced'}`, a 4003 close or a stolen slot lock → stop reconnecting, storage untouched. The setup link is dropped once a screen or remote has joined. On `127.0.0.1` or `[::1]` with no pairing on that origin, the page goes to `localhost` before it connects; a page that already holds a pairing there stays (migration).
- `src/operations/tripTwin/twinSessionHost.js`: every refusal is `{type:'denied', code, error}`; a token proves the device, not a change of kind; `live` from the relay: the same token for the same place is accepted (a reload, a restored window, a duplicated tab), another place is `ID_COPIED` with no side effects; an expired or unknown setup link says `TICKET_EXPIRED` (screen, remote, launcher) instead of falling silently to a pair code; a remote with a token the relay does not know is `FORGOTTEN`; with a valid QR it still pairs.
- `server/tripTwin/syncRelay.js`: one live socket per device id (launchers excluded): the older gets `{t:'replaced'}` and close 4003, never `unpaired` (sec S13); a device is offline only when its last socket closes (H2); `paired` goes only to the socket that showed the code (SEC-9 rule 2); a second hello on an accepted socket is refused `ALREADY_IDENTIFIED` and closed 4002; `unpaired` carries `reason: 'SLOT_TAKEN'`; refusals carry the code. Denied sockets are not closed by the server (K7 adds the hello deadline), so an old page cannot loop.
- `src/operations/tripTwin/twinScreen.js` (non-visual hunks only): a `replaced` handler (sets `data-tt-link="replaced"` on `body` for the harness; the chip shows today's "not connected" until K8's card); the slot stays in the URL after pairing, also by code, so a reload or a restored window finds its record.
- `src/operations/tripTwin/twinEntry.js`: the launcher goes to `localhost` before Start when opened on `127.0.0.1` or `[::1]` (S-23).
- Kit (`twinTestKit.mjs`): `fakeSocket.close(code)` records the code; `memStorage`, `fakeLocks` (`ifAvailable`, `steal` → `AbortError`), `fakeTimers`, `settle`, `fakeBrowser` (per-origin `localStorage` and locks, per-window `sessionStorage` copied by `window.open`, sockets bridged to a real relay). Gate script: baseline 213; the `Math.random` wiring check also covers `twinSync.js` and `twinIdentity.js`.
- Harness (`qa-twin-multiview.mjs`): R-2 answers `ID_COPIED` as the K4 client does; R-Hb's verdict follows AC-2.1/2.3 (with slot-scoped identity the copy is the same device by design: GREEN when the original is told and stops, S5 stays online and the survivor reloads still paired); new R-K4a (no Web Locks); R-Hd names where the page landed; the socket-level `device` drops its setup link once joined (as the K4 client); "joined" now means connected **and** holding a token (see "Notes"); two K4 rows in the by-hand list.
- Runbook: `deploy-mac-studio.md` per-slice row for K4 (rollback, browser keys, the after-deploy reopen check, S-23).

### Gate

| Check | Command | Result |
|---|---|---|
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS** (final run below). 213 tests in 26 files: 213 pass, 0 fail, 0 skip, 0 todo; baseline 213 (190 + 23). |
| Wiring (warnings until K7) | same | Unchanged: `/api/route` at `twinCustomPaths.js:148`, `twinPaths.js:44`; `Math.random` at `twinSessionHost.js:24` (the host's injectable `random`, K7). None in `twinSync.js` or `twinIdentity.js`. |
| Shared-file guard | same | Clean (3 CF commits checked, plus the working tree). |
| Repo tests | `npm test` (run by the gate) | **PASS.** Exit 0; 3219 tests, 3218 pass, 0 fail, 1 skip (Windows-only DACL test); allocation probes skipped on Node 22. |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/twin-dist` | **PASS** (exit 0; the usual chunk-size note). |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --ref worktree --dir <scratchpad>/qa-k4-final` | **PASS** on the final bytes (`smoke-2026-10-23T22-51-58`): 18 pass, 6 TODO (after shell step C), 0 pageerror, 0 console.error. First run on the K4 code before the harness edits (`qa-k4/runs/smoke-2026-10-23T21-55-32`): the same. |
| Restart and revert | same run | K1-S9 to S13 (restart-and-reconnect: S1–S5 rejoin with no codes, the remote gets its lease, the S6 page reloads and rejoins) and K2-S1/K2-S2 (revert to `5441cae`: every page reloads onto the K3 client and rejoins on the old keys; forward again: `store.loaded`, no `store.migrated`) pass. |
| Mutation check | relay sends `unpaired` to the replaced socket and marks offline on every close; then the slot record ignored | 4 and 6 of the K4 tests turn red; restored code green. |
| CF-2 repro | `node scripts/qa-twin-multiview.mjs repro-pairing --wait-expiry --ref worktree --dir <scratchpad>/qa-k4` | **All 12 automated steps GREEN** on the final run (`repro-pairing-2026-10-23T22-39-32`), R-H4 included. Table below. |

### CF-2 repro: before (K1, `3431392`) → after (K4)

| Step | Hypothesis | Before | After (final run) |
|---|---|---|---|
| R-1 | H4 (fake clock) | RED: a new id got a bare pair code | **GREEN**: a new id is told `TICKET_EXPIRED` (says why), then gets the pair card; the window itself now reuses its slot record (R-H4, R-K4a, unit R-1) |
| R-2 | H1 (socket) | RED: S3 dropped out of presence | **GREEN**: the copy is told `ID_COPIED`, takes a fresh id, S4 pairs; S3 and S4 both online |
| R-H2 | H2 (socket) | RED: both sockets live; closing one marked S2 offline | **GREEN**: the older socket is replaced (4003); S2 stays online |
| R-H1 | H1 (headless) | RED: S3 and S4 had the opener's id | **GREEN**: distinct ids; S3 and S4 online |
| R-H1c | control | GREEN | **GREEN** (one RED in the first run, not repeated: see Notes) |
| R-Hb | H2 (duplicate tab) | RED: one id; closing the original marked S5 offline | **GREEN**: one device by design; the original is told (`replaced`) and stops; S5 stays online; the copy reloads still S5 |
| R-K4a | sup S13 (new) | — | **GREEN**: with Web Locks removed, S5 closed and opened again with an expired link, then with none: S5 both times, no code |
| R-Hd | H3 | RED: pair card on 127.0.0.1 | **GREEN**: sent to `localhost` (S-23) and rejoined S6 |
| R-H4 | H4 (live, 10.5 min) | RED: the reopened S4 showed a pair code | **GREEN**: rejoined S4, online in presence |
| R-He | H-e | GREEN | **GREEN** |
| R-3 | store (K2) | RED at K1, GREEN from K2 | **GREEN** |
| R-3q | quarantine (K2) | GREEN from K2 | **GREEN** (pair code by design) |

Console errors in the repro runs (2 per run) are the known SwiftShader artefact: a headless popup gets no WebGL context ("open failed … webgl2"); identity and pairing are unaffected.

### Test names added in K4 (`twinIdentity.test.mjs`)

- `K4 R-1: a wall window opened again after its setup link expired rejoins S4 by its slot record; a new id is told why`
- `K4 R-2: one id said hello for S3, then for S4 while S3 is live: the copy is told ID_COPIED and S3 keeps its slot`
- `K4 R-3: a save cut off half-way leaves the last good store, and the wall rejoins through the relay`
- `K4 T4.2: two sockets with one id and token for one slot: the older gets {t:"replaced"} and 4003, and its close leaves the wall online`
- `K4: paired goes only to the socket that showed the code (SEC-9 rule 2)`
- `K4: a second hello on one socket is refused ALREADY_IDENTIFIED and the socket is closed (4002)`
- `K4 deny codes: every hello refusal carries a code from twinProtocol.js and readable text`
- `K4 T4.3: after a restore every device rejoins with its token; a stale token is refused ID_IN_USE with a code`
- `K4 ET S2: duplicate → old window replaced → winner reloads → still paired (no Web Locks, as on a LAN address)`
- `K4 ET S2: duplicate → old window replaced → winner reloads → still paired (Web Locks)`
- `K4 sec S13: an old page (base unpaired handler) that is replaced never wipes the winner’s token`
- `K4 sup S13: without Web Locks, S5 closed after its link expired and opened again comes back as S5 with no code`
- `K4 S-16: a remote with a forgotten token on loopback stops retrying after one terminal deny`
- `K4 S-16: a remote with a token the relay does not know is told FORGOTTEN and stops`
- `K4 S-16: a wall refused ID_IN_USE falls to a fresh id and the pair card (it used to freeze)`
- `K4 S-16: a wall with an expired link and no pairing drops the link and shows the pair card`
- `K4: a wall whose slot went to another device is told SLOT_TAKEN and clears its own record (only FORGOTTEN and SLOT_TAKEN do)`
- `K4 migration: a pre-K4 wall and remote keep their pairing; the old keys stay for a revert`
- `K4 R-H1 (unit): window.open copies the opener’s id; S3 and S4 opened from it get their own ids`
- `K4: the newest window for a slot on this computer takes its lock; the older stops at once without touching storage`
- `K4: a wall paired by code keeps a slot record and rejoins when opened again with that slot`
- `K4 S-7: device ids are kind- and 32 hex characters from getRandomValues; 1,000 are unique`
- `K4 S-23: 127.0.0.1 and [::1] go to localhost, unless this origin already holds the pairing`

### Notes

- **Harness fixes found on the way (not product bugs).** (1) R-H1c went RED once (S1 and S2 "not both online" 1.5 s after the popups loaded) and was GREEN on the immediate re-run and on both later runs, with both walls online at 1.5 s: a timing flake (S-5 rule). The step now waits up to 10 s and names each slot's state. (2) R-H4's first two K4 runs were wrong both ways: once GREEN on the chip "S4 · not connected" (every slot window shows that before its socket opens), once RED with a pair code. A scratch debug run showed why: the harness closed the first S4 window as soon as its chip read "S4 · Remote offline", which a wall shows the moment its socket opens, **before** the paired welcome lands, so its record had no token; the relay then rightly refused the bare id (`ID_IN_USE`: an id with a token cannot be claimed without it) and the window fell to the pair card. In the same debug run, with the token in place, the reopen with an expired link rejoined S4 with no code. Every repro step's "joined" now means connected **and** holding a token.
- **Known edge (by design):** a wall window closed within the instant between its socket opening and its token arriving comes back as a new device and gets the pair card; the old record stays listed as that slot, offline, until the slot is paired again. Accepting the bare id would break the R1 rule.
- **Old pages after the deploy:** a page still running pre-K4 code that is replaced ignores `{t:'replaced'}` and reconnects (with backoff), and two such pages would replace each other in turn. Vite reloads every open page when the server restarts (K1 finding), so this needs a page that was not reloaded; the deploy checklist already reloads every wall and the iPad.
- **Not in K4 (as planned):** the replaced, slot-taken and refusal cards and "Move it here" (K8); `TOKEN_EXPIRED` (L6) and `TICKET_USED` (single-use tickets, K11) are handled by the client but not yet sent; the server closing denied sockets and the hello deadline (K7); `device.hello` audit fields (K6).

### By hand on the Mac Studio, still owed (M4.1, before the K4 deploy)

1. Chrome quit and relaunch with "Continue where you left off": the four walls keep their slots (QA H-c, AC-2.1).
2. A Mac Studio reboot, Vite started by hand, Chrome restores the walls (E14).
3. Walls opened through the LAN IP or the `.local` name, then through `localhost`: separate origins, so a separate pairing per name (QA H-d); check which origin the Mac Studio launcher really uses (`location.origin`, BE-8 risk) and that walls opened from it rejoin after a reload.
4. Tab › Duplicate on a wall window in real Chrome: the original stops with "not connected", the copy is the wall (QA H-b).
5. A wall window closed by accident and reopened from the launcher after 10 minutes, in real time (H4).
6. On the iPad (plain http, no Web Locks): close the remote tab and open the remote page again after 10 minutes: it rejoins without a QR (F-0014 a).
7. Open the same wall from a second launcher tab: the older window stops with "not connected", the newer one is the wall (C16).
8. After the deploy reload: every wall rejoins its slot on the migrated keys; then the revert drill (`deploy-mac-studio.md`).

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `k4/gate1.txt`, `k4/gate2.txt` (gate with names), `k4/build.log`, `k4/smoke1.txt`, `k4/smoke2.txt`, `k4/repro1.txt` … `k4/repro5.txt`
- `qa-k4/runs/smoke-2026-10-23T21-55-32/`, `qa-k4/runs/repro-pairing-2026-10-23T21-56-49/`, `…T22-11-29/`, `…T22-24-46/` (the R-H4 shot with the pair code), `…T22-39-32/` (final, all GREEN); `qa-k4-final/runs/smoke-2026-10-23T22-51-58/`
- `k4dbg-src/h4.mjs` (the scratch R-H4 debug script; it prints no token or link)

## K5 · protocol versions and attribution data (server side; proto → 2)

- **Date:** 23 Oct 2026, 17:55–18:40 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (Chrome for Testing, SwiftShader).
- **Code under test:** the `cf/core` working tree on top of `9e8199f` (K4), served with `--ref worktree`. The revert drill restarts on `HEAD` (`9e8199f`, the K4 code) and then on the working tree again.
- **QA server:** `:4181` on 127.0.0.1; data, audit and `TMPDIR` in the QA folder. Map keys passed 0 of 2 (as K1–K4). The live store paths were only ever `stat`ed; the live :4173 server was never contacted.
- **Proto numbers:** `PROTO = 2`, `PROTO_MIN = 2` (S-15). Every page before K5 sends no `proto` and is told `RELOAD`.
- **Gate verdict: PASS.**

### What landed

- `src/operations/tripTwin/twinProtocol.js` (completed): `PROTO`, `PROTO_MIN`, `protoOk()`; `reloadText(kind)` (Appendix D rows 1, 1a, 1c, readable by an old page as it is); command codes (02 §3.3 plus `PENDING_BUSY` and `CMDID_REUSED`; 02's `IDEMPOTENCY_CONFLICT` is `CMDID_REUSED`, S-18); `CAUSE` (`cmd`, `undo`, `setup`, `pair`, `join`); `VIA` (`touch`, `system`); `HOST_REF = 'D0'`, `HOST_NAME = 'Trip Twin computer'`, `REMOTE_NAMES` (`iPad`, `Phone`, `Laptop`), `isRef()`; `ACTOR_FIELDS` (refused inside `cmd`); `shapeOf()`/`mergeShape()` for the schema hash; `reloadGuard()` for walls (a `sessionStorage` stamp; no working storage means no self-reload, so no loop).
- **Actor record (§4.4):** `{ref: 'D3', kind: 'remote'|'screen'|'host', name: 'iPad 2', slot: n|null, via: 'touch'|'system'}`. `ref` is sequential, persisted (`nextRef`) and never the device id. State holds only the ref (`meta[field].by`, `session.meta[field].by`, `lastUndo.by`). The host keeps a ref table `{D3: {kind, name, slot}}` for every ref it has issued (saved as `refs`); a ref's name never changes, so a label reads as it did when the change was made, also after the device is gone (F-0003). A screen's ref is named `S<slot>`; a screen moved to another slot gets a new ref.
- `src/operations/tripTwin/twinSessionHost.js`: refs and the ref table; names owned by the host (CF-D8): a remote whose socket is on this computer is "Trip Twin computer", otherwise the page's kind from the closed list (anything else is "Laptop", as `remote.js` itself decides), made unique per kind ("iPad", "iPad 2") among the devices on the wall, fixed at pairing (a later hello cannot rename it). Setup and pairing write as the host (`D0`). `actor(ref)`, `actorOf(id, via)`; presence gains `actors` (the host, devices on the wall, and every ref the state names, so a gone device still resolves), `screens[n].ref`, `remotes[].ref`, `remotes[].controlSince` (when the lease last changed hands; heartbeats do not move it), `handover.fromRef`. Command and undo refusals carry a code (`LEASE_NOT_CONTROLLER`, `UNKNOWN_COMMAND`, `UNDO_EXPIRED`, `VALIDATION_COMMAND`); pairing refusal by a viewer carries `LEASE_NOT_CONTROLLER`. **Restore migration**, before the first broadcast: refs for devices from a pre-K5 store; table entries rebuilt from the records' refs when a reverted build dropped the table; `meta.by`/`lastUndo.by`: a known ref stays, a device id becomes its ref, `'setup'` becomes `D0`, anything else (the old default `'remote'`, an unknown id) becomes `null`; a ref the state names but no record holds is never issued again.
- `src/operations/tripTwin/twinSession.js`: `by` is the actor's ref (default `null`, was `'remote'`); session fields get `session.meta[field] = {source: 'session', rev, by, at}` like screen fields (incl. the three `returnLive` clears); `lastUndo = {by, at, of}`.
- `server/tripTwin/syncRelay.js`: a hello below `PROTO_MIN` (or with none) is refused `{t:'welcome', type:'denied', code:'RELOAD', error, proto}` before the host sees it; a setup from a launcher page below `PROTO_MIN` gets `{t:'setup', ok:false, code:'RELOAD', error}` (the page's `proto` from its hello, or on the setup). Every welcome says `proto`. Command and undo broadcasts carry `by: Actor` (via `touch`, from the socket's device) and `cause`; setup, pairing and a wall joining carry `cause` only, so walls do not flash "Updated" for them (unchanged on screen); `undone: {of}`. `presenceFor()` passes refs, `actors`, `controlSince`, `fromRef`, never an id. **Fix found on the way:** a pair result spread the host's answer, so the remote received the paired screen's raw device id **and its token**; it now carries `{ok, slot}` (or `error`, `code`) only. Envelope `by`/`via`/`name` beside `cmd` are never read; inside `cmd` they are refused `VALIDATION_COMMAND` (S-18, F-0009).
- `server/tripTwin/sessionStore.js`: the document carries `refs` and `nextRef` when present (additive; K4 loads it, and ignores them); a light shape check (`refs` an object, `nextRef` an integer, `device.ref` a string).
- `src/operations/tripTwin/twinSync.js`: every hello says `proto: PROTO`. `RELOAD` is not terminal: the page keeps its id and token and its handler decides.
- `src/operations/tripTwin/twinScreen.js` (non-visual hunk only): on `RELOAD` the wall reloads itself at most once per 2 minutes (`tripTwin.soc.protoReloadAt` in `sessionStorage`); refused again within 2 minutes it waits them out and tries once more; until then it keeps what it shows (K8 adds the out-of-date card).
- Kit (`twinTestKit.mjs`): `asPage()`: a hello or setup said through the kit gets `proto: PROTO` unless the test sets the key (`proto: null` plays a pre-K5 page). Gate script: baseline 234.
- Harness (`qa-twin-multiview.mjs`): socket-level hellos say `proto`; the QA remote says `name: 'iPad'`; the S6 chip check accepts "Trip Twin computer" (K5: the QA remote is on loopback) or "iPad" (the K4 build in the revert drill); new steps K5-S1, K5-S2, K5-S3 (below).
- Runbook: `deploy-mac-studio.md` per-slice row for K5 (proto bump: reload every page by hand; store fields; rollback; "Trip Twin computer" for a remote opened on the Mac Studio).

### Gate

| Check | Command | Result |
|---|---|---|
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS** (final run, 21 s). 234 tests in 28 files: 234 pass, 0 fail, 0 skip, 0 todo; baseline 234 (213 + 21). |
| Wiring (warnings until K7) | same | Unchanged: `/api/route` at `twinCustomPaths.js:148`, `twinPaths.js:44`; `Math.random` at `twinSessionHost.js:99` (the host's injectable `random`, K7). |
| Shared-file guard | same | Clean (4 CF commits checked, plus the working tree). |
| Repo tests | `npm test` (run by the gate) | **PASS.** Exit 0; 3240 tests, 3239 pass, 0 fail, 1 skip (Windows-only DACL test); allocation probes skipped on Node 22. |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/twin-dist` | **PASS** (exit 0; the usual chunk-size note). |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --ref worktree --dir <scratchpad>/qa-k5-final2` | **PASS** on the final bytes (`smoke-2026-10-23T23-29-49`): 21 pass, 6 TODO (after shell step C), 0 pageerror, 0 console.error. K5-S1: by `D6` "Trip Twin computer" via touch; the real S6 page reads "S6 · Remote: Trip Twin computer · Updated"; 8 ids searched in 107 messages, 0 hits. K5-S2: the pre-K5 wall and remote are told RELOAD with Appendix D text, nothing joins. K5-S3 (after both restarts and the revert drill): 11 attributions, all refs or `null`; 0 id hits; the remote is `D8` "iPad" (was `D6`, see Notes). |
| Restart and revert | same run | K1-S9 to S13 (restart-and-reconnect: S1–S5 rejoin with no codes, the remote gets its lease, the S6 page reloads and rejoins) and K2-S1/K2-S2 (revert to `9e8199f`: every page reloads onto the K4 client and rejoins, the K4 relay loads the K5 store; forward again: `store.loaded`, no `store.migrated`) pass. |
| Earlier smoke attempts | same, `qa-k5`, `qa-k5-final` | Run 1 (`smoke-2026-10-23T23-14-00`) PASS with one `console.error` on the S6 wall ("Rendering has stopped": a Cesium worker fetch failed while the server restarted); not repeated in runs 2–4 (S-5 flake rule). Run 2 failed K3-S1 only because it reused run 1's QA folder, whose would-refuse file still held run 1's four probe lines; run 3 (fresh folder) passed; run 4 adds the "Updated" assertion to K5-S1. |
| Mutation check | `by: 'remote'` in the broadcast; raw id into `applyCommand`; the old pair-result spread; no proto check; no `proto` in the client hello; `via` inside `cmd` accepted; client names kept | 4, 5, 3, 2, 1, 1 and 1 of the K5 tests turn red (the two K5 files only; the K4 identity tests also go red for the client one); restored code green. |
| CF-2 repro | `node scripts/qa-twin-multiview.mjs repro-pairing --wait-expiry --ref worktree --dir <scratchpad>/qa-k5-repro` | **All 12 automated steps GREEN** (`repro-pairing-2026-10-23T23-17-15`), R-H4 (live, 11 min) included; 7 by hand on the Mac Studio, as K4. The 6 console errors are the known SwiftShader artefact (a headless popup gets no WebGL context: "open failed … webgl2"). |
| K5 gate cases | in the tests above | No hello id in any `state`, `presence` or other message, nor in state (T8.1: a unit walk across setup, pairing, commands, undo, handover, a duplicate window and a restart; smoke K5-S1, K5-S3); "iPad" and "iPad 2" (T8.3); a gone device's ref still resolves (F-0003); a stale page (no `proto`, or 1) gets RELOAD (unit for screen, remote, launcher and setup; smoke K5-S2); a shape change without a bump fails the schema test (sensitivity test); walls still show "Updated" (unit: `by` truthy after a command and an undo; smoke: the real S6 page). |

### Test names added in K5

`twinAttribution.test.mjs`:
- `K5 T8.1: after setup, pairing, commands, undo, a handover, a duplicate window and a restart, no device id appears in any message to any socket, nor anywhere in state`
- `K5 T8.2: two remotes, Laptop and iPad, hand over control; each broadcast names the device that acted (ref, kind, name, via touch)`
- `K5 T8.3, CF-D8: two iPads are "iPad" and "iPad 2"; a remote on this computer is "Trip Twin computer"; a name the page makes up is never shown`
- `K5 F-0003: a ref still names its device after the device is gone (a restart without it; a screen whose slot went to another)`
- `K5: a restart keeps refs, names and the ref table; a screen moved to another slot gets a new ref, so an old label never changes`
- `K5 restore migration: a pre-K5 store’s device ids in meta.by and lastUndo.by become refs; "setup" becomes the host; anything else becomes null`
- `K5 revert: a store written by the K4 build (refs on device records, no ref table) still names the same devices, and a remote paired meanwhile gets a new ref`
- `K5 S-18, F-0009: a by, via or name beside cmd is ignored; inside cmd it is refused VALIDATION_COMMAND and nothing changes`
- `K5: walls still see a truthy `by` after a command and after an undo; setup, pairing and a wall joining carry a cause and no `by``
- `K5: setup and pairing are written by the host (D0, Trip Twin computer, via system); session fields get session.meta like screen fields`
- `K5: presence carries actors (no ids) and the controller’s controlSince; a handover names fromRef`
- `K5 SEC-11: a pair result names the slot only, never the screen’s id or token`
- `K5 clockHost: the shared fake-clock host attributes setup to the host`

`twinProtocol.test.mjs`:
- `K5 S-15: a page with no proto, or proto 1, is refused RELOAD with text it can show; nothing reaches the host`
- `K5 S-15: a launcher page from before K5 cannot start a setup (RELOAD); this build’s can, after its refused hello`
- `K5 S-15: every welcome says PROTO; PROTO_MIN equals PROTO at this slice; protoOk takes integers from PROTO_MIN up`
- `K5 schema hash: the golden transcript’s message shapes match the row for this PROTO (a change of shape needs a bump)`
- `K5 schema hash: renaming one field, or adding one, changes the hash; a value change does not`
- `K5 wall reload guard: reloads once, waits out 2 minutes, then may reload again; never without working storage`
- `K5 client: every hello from twinSync.js says PROTO; RELOAD is not terminal (the page keeps its id and token and hears the refusal)`
- `K5 S-8: the protocol lists each code once; terminal codes and unpaired reasons are deny codes`

### Notes and deferred

- **Behaviour to know:** remotes are named by the host now. A remote opened on the Mac Studio itself reads "Trip Twin computer" on the wall chips ("S4 · Remote: Trip Twin computer · changed 2:14 ago" is 50 characters, 61 with " · hands-on", past the 56 K8 budgets; K8 owns the chip and its truncation). Two iPads read "iPad" and "iPad 2". The remote header still says "In control · this iPad" from the page's own guess until K8.
- **Revert edge (by design):** the K4 build rewrites a remote's record on its hello and drops the ref table, so after revert-and-forward that remote gets a new ref, named from what the page sent while K4 ran ("iPad" for the QA remote, which K5 itself would call "Trip Twin computer"); changes it made before the revert then read "by nobody" (`null`), never by the wrong device, and the old ref is never issued again (K5-S3: D6 before, D8 after).
- **Not in K5 (as planned):** the chip and card copy that renders `by` ("by iPad · 21:32", out-of-date card, "Last change … by …", the status strip control cell) is K8; `controlSince` is sent, not shown; `cmdId`, confirm and the full `validateCommand` are K10; the audit sink that maps refs to devices on disk is K6; Forget (which deletes a record but keeps its ref) is K11; initials stay CF-later L7 (CF-D8).
- **Schema hash:** one row per `PROTO` in `twinProtocol.test.mjs` (`2: 21bbf078…`), over the relay → page messages of a golden transcript on a fake clock (every message type, every refusal shape). Rows are never edited; a change of shape adds row `PROTO + 1` with the bump. `TRIP_TWIN_SHAPES=<file>` writes the shapes for a diff. Client → relay shapes are not hashed (the transcript writes them by hand).
- **Old pages after the deploy:** a pre-K5 page cannot reload itself (the guard ships with K5); Vite's client reloads open pages when the server comes back (K1 finding), and the deploy checklist reloads every page by hand.

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `k5/gate1.txt`, `k5/gate2.txt` (gate with names, before and after the last harness edit), `k5/build.log`, `k5/smoke1.txt` … `k5/smoke4.txt`, `k5/repro1.txt`, `k5-shapes.json` (the proto 2 shapes, from `TRIP_TWIN_SHAPES`)
- `qa-k5/runs/smoke-2026-10-23T23-14-00/`, `…T23-15-06/` (run 2, the reused folder); `qa-k5-final/runs/smoke-2026-10-23T23-16-15/`; `qa-k5-final2/runs/smoke-2026-10-23T23-29-49/` (final); `qa-k5-repro/runs/repro-pairing-2026-10-23T23-17-15/`
