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

## K6 · audit log (lean), health endpoint, fail open (server side)

- **Date:** 23 Oct 2026, 18:40–19:25 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (Chrome for Testing, SwiftShader).
- **Code under test:** the `cf/core` working tree on top of `ba255f0` (K5), served with `--ref worktree`. The revert drill restarts on `HEAD` (`ba255f0`, the K5 code, which writes no audit) and then on the working tree again.
- **QA server:** `:4181` on 127.0.0.1; data, audit and `TMPDIR` in the QA folder. Map keys passed 0 of 2 (as K1–K5). The live `~/Library/Logs/trip-twin/` was only ever `stat`ed: it did not exist before or after the gate, the tests, the smoke and the repro (nothing created it). The live :4173 server was never contacted.
- **Proto:** unchanged (`PROTO = 2`). No relay → page message changed shape (the schema hash row 2 still matches); the wall's `local` message gains two fields (page → relay, not hashed; old walls still work).
- **Gate verdict: PASS.**

### What landed

- `server/tripTwin/auditLog.js` (new): envelope v1 `{v, seq, boot, at, type, actor, rev, corr, data}` (no `prev`: the chain is L8), plus `peer` and `secure` on refusal and security events only (C38). `seq` continues across restarts and files (read from the last whole line on disk; a torn last line is skipped). Daily files `audit-YYYY-MM-DD.jsonl` (UTC day, as `at`), `.2.jsonl` past 20 MB, in `TRIP_TWIN_AUDIT_DIR` (default `~/Library/Logs/trip-twin/`, fenced off the repo and Vite's root as in K3; folder 0700, files 0600). Retention (S-19): 30 days (`TRIP_TWIN_AUDIT_DAYS`), 200 MB in all, oldest first, never today's file; pruned at start and every 6 h, `log.pruned` when something goes. **Takes over `would-refuse.jsonl`:** K3's writer and format stay (Appendix D row 2c and K12's sign-off script name the file), but the audit's retention trims its lines past 30 days, it counts in the 200 MB, and health reports it. Async queue capped at 10,000 (`emit()` is synchronous and cheap; batches of 500 appended between event-loop turns); past the cap events are counted and written as one `audit.dropped` line. **Fail open (CF-D9):** a write error (full disk, unwritable folder) never reaches the relay; health flips (`ok:false`, `lastError`, `downSince`), the queue is kept, the folder is tried again every 30 s, and on reopen the kept events are written followed by a `log.gap` row (since, downMs, lost, error). Exit flushes the queue synchronously as a last resort. Safety net: under `node --test` the default folder is refused unless `TRIP_TWIN_AUDIT_DIR` is set.
- **Allowlist serialisers:** every type in the exported catalogue names its fields and each field's kind (ref, slot, int, bool, a closed list, a protocol code, an id with at least two parts and no part of 20+ characters and not a raw device id's shape, the session's own field names, layer keys shorter than a token). Values a field does not allow are dropped (or `'?'`/`'other'`); each value's JSON is capped at 256 characters. So no token, setup link, ticket URL, boot secret, pairing code, confirm id, raw device id, user agent, page-made name, thumbnail, wall text, full state, env value or audio can be written. Actors keep `{ref, kind, name, slot, via}` with host-owned names only. A spotlight logs `{kind, id}`, a report `{id, floor, kind}`, a framing `'set'`. `confirm.*` (emitted from K10) keep question parts (ids and closed-list words), never the rendered text (F-0004). The only free values written are what a refused peer sent (its Host, Sec-Fetch-Site, path without query, clipped to 64) and its address, on security events.
- **Event catalogue (30 types):** `relay.boot`, `relay.stop`, `store.error`, `log.opened`, `log.gap`, `log.pruned`, `audit.dropped`, `upgrade.refused`, `http.refused`, `device.hello`, `device.offline`, `session.setup`, `device.paired`, `pair.failed`, `lease.granted`, `handover.requested`, `handover.answered`, `cmd.applied`, `cmd.refused`, `undo.applied`, `undo.refused`, `confirm.asked`, `confirm.answered`, `confirm.expired`, `confirm.stale`, `confirm.superseded`, `confirm.cancelled`, `wall.hands`, `wall.drift`, `wall.identify`. `device.hello` carries the CF-D11 fields (`outcome`, `code`, `kind`, `slotAsked`, `slotGiven`, `viaSetup`, `viaToken`, `token: issued|kept|none`, `replaces`, `unpairedRefs`, `controller`): token issue and slot takeovers are fields of the one hello or pairing line, so **each message writes exactly one line**. Heartbeats, thumbnails, unparsable messages and unchanged `local` messages write none (counted in health).
- `src/operations/tripTwin/twinSessionHost.js`: the host emits synchronously inside each operation (`emit` option and `onEvent()`; a listener that throws never stops the operation): hello (wrapper), setup, pair (ok or failed with `lease|locked|code|slot`), command (applied with field diffs from `commandDiffs()`, or refused with its code), undo, request-control, handover. No I/O in the host.
- `server/tripTwin/syncRelay.js`: the relay adds the socket's peer and reqId to each event, writes its own (RELOAD and second-hello refusals, LAN and old-page setup refusals, identify, a device's last socket closing → `device.offline`, `relay.boot`/`relay.stop`, store problems as `store.error` without paths), and keeps per-wall hands-on/drift so a `local` message logs only a change (hands-on wins when both change; the drift it stopped is in the same line; the text is never read). Counters and timings for health (apply and apply-to-broadcast p95 over 200 samples, S-25). `GET /api/twin-sync/health` and `GET /api/twin-sync/log?since&limit` behind `twinLocalOnly()` (K3's `localOnly()`; every mode): health = `{ok, boot, startedAt, uptimeS, proto, rev, devices, sockets, counters {cmdApplied, cmdRefused, undoApplied, undoRefused, helloDenied, pairFailed, setupRefused, confirmBypass: 0, thumbs, msgDropped}, timings, store, audit, hostCheck, confirm: 'remote'}`; `/log` = written events of this boot from a 1,000-row ring, public form (no peer), paged by `next`. Also fixed on the way: a socket message that is JSON but not an object (`null`, a number) threw inside the message handler; it is now dropped and counted.
- `server/tripTwin/twinHostCheck.js` / `twinHosts.js`: the audit folder rules move to `auditLog.js` (re-exported); the host check gets the server's audit log; real refusals (`upgrade.refused` with the clipped Host, `http.refused` with the path) are audit events with the peer, under K3's 60-a-minute limit (the next line says how many were left out). `twinLocalOnly()` refusals are `http.refused` with `local-peer|local-host|local-fetch-site`.
- `src/operations/tripTwin/twinScreen.js` (non-visual hunk only): `{t:'local', on, text, drift, driftReason}`; the drift conditions are the same, in the same order, named (`driftState()` and `DRIFT_REASONS` in `twinProtocol.js`: `idle`, `input`, `camera`, `incident`, `link`, `role`, `tier`, `command`); `stopDrift()` records whether input or a pushed change reset the idle clock. The message is sent when the text or the drift changes. Remotes still get `{t:'local', slot, on, text}` (unchanged).
- Gate script: baseline 251; **the audit canary is required from K6 on** (§6.2 rule 8): the two canary tests must be found and pass, or the gate fails. Harness: smoke steps K6-S1, K6-S2 (below). Runbooks: deploy step 13 (routing health is L1, not K6), step 14 (how to read health on the Mac Studio) and the K6 per-slice row; demo-day item 3; break-glass note on refusal lines.

### Gate

| Check | Command | Result |
|---|---|---|
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS** (final run, 22 s). 251 tests in 29 files: 251 pass, 0 fail, 0 skip, 0 todo; baseline 251 (234 + 17). |
| Audit canary (from K6, every gate) | same | **PASS**: `K6 canary (catalogue)` and `K6 canary (relay run)` found and passing. |
| Wiring (warnings until K7) | same | Unchanged: `/api/route` at `twinCustomPaths.js:148`, `twinPaths.js:44`; `Math.random` at `twinSessionHost.js:148` (the host's injectable `random`, K7). |
| Shared-file guard | same | Clean (5 CF commits checked, plus the working tree). |
| Repo tests | `npm test` (run by the gate) | **PASS.** Exit 0; 3257 tests, 3256 pass, 0 fail, 1 skip (Windows-only DACL test); allocation probes skipped on Node 22. |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/twin-dist` | **PASS** (exit 0; the usual chunk-size note; no `ncFixture`). |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --ref worktree --dir <scratchpad>/qa-k6` | **PASS** (`smoke-2026-10-24T00-03-43`): 23 pass, 6 TODO (after shell step C), 0 pageerror, 0 console.error. K6-S1: 1 file, 42 lines, seq 1…42 rising across 3 boots (start, restart, forward after the revert drill), files 0600 in a 0700 folder; `relay.boot` 3, `device.hello` 25, `session.setup` 1, `device.paired` 1, `cmd.applied` 4, `undo.applied` 1, `device.offline` 1, `upgrade.refused` 2 and `http.refused` 1 (K3-S1's probes, with peer); 19 secrets (setup token, every token and id the run held, the S6 page's own id and token, its pairing code, thumbnail prefix, wall text): 0 hits. K6-S2: health 200 (audit ok, store ok, host check report, confirmBypass 0, apply→broadcast p95 2.2 ms); `/log` 13 events, none with a peer; health and log with Host `192.168.1.3:4181` → 403; `/@fs/<audit file>` → 403; live log folder still absent. |
| Restart and revert | same run | K1-S9 to S13 (restart-and-reconnect) and K2-S1/K2-S2 (revert to `ba255f0` and forward: `store.loaded`, no `store.migrated`) pass; K5-S3 passes after them. |
| CF-2 repro | `node scripts/qa-twin-multiview.mjs repro-pairing --wait-expiry --ref worktree --dir <scratchpad>/qa-k6-repro` | **All 12 automated steps GREEN** (`repro-pairing-2026-10-24T00-05-02`), R-H4 (live, 11 min) included; 7 by hand on the Mac Studio, as K4/K5. The 2 console errors are the known SwiftShader artefact (a headless popup gets no WebGL context). |
| Mutation check | raw `data` spread; peer on every line; queue dropped on a write error; health not local-only; no line for a second hello; host hello silent | 5, 2, 2, 1, 1 and 4 of the K6 tests turn red; restored code green. |
| K6 gate cases | in the tests above | golden event sequence (T7.1); catalogue canary with a planted name in a spotlight, a confirm question, a wall's text and a page's name (0 hits); retention at 29 and 31 days and the 200 MB cap; a throwing sink (ENOSPC) and a 0500 folder leave commands working with the flag set, then a gap row; mode 0600 and not served (smoke); `/log` and `/health` refused for a LAN Host, a non-loopback peer (also `::ffff:` mapped) and a cross-site page in report mode; 10,000 events delay a heartbeat ≤ 50 ms (measured ≤ 2 ms on an idle MacBook). |

### Test names added in K6 (`twinAudit.test.mjs`)

- `K6 T7.1 golden: a scripted relay session writes exactly the golden event sequence, with refs, revs and reqIds`
- `K6 ET-5: each message type writes exactly one line; heartbeats, thumbnails and an unchanged local write none`
- `K6 canary (catalogue): every event type has a fixture; with generated poison in every field, no secret, id, code, thumbnail, user agent or planted name reaches the folder`
- `K6 canary (relay run): after a full relay session, the folder holds no token, setup token, pairing code, device id, thumbnail or planted name`
- `K6 T7.3: seq continues across a restart (a new log on the same folder) and is never reused`
- `K6 T7.4 retention: a 29-day file stays and a 31-day file goes; the 200 MB cap goes oldest first; would-refuse lines past 30 days are trimmed`
- `K6 T7.7: the folder is 0700 and every file 0600; the default folder is ~/Library/Logs/trip-twin and is never used by tests`
- `K6 T7.5 fail open: a sink that throws (ENOSPC) leaves commands working, flips health, and a gap row is written when it reopens`
- `K6 fail open: an unwritable folder (0500) does not stop commands; health says EACCES until it is writable again`
- `K6 SEC-12: 10,000 events in a burst delay a heartbeat by at most 50 ms; past the queue cap they are counted and written as audit.dropped`
- `K6 BE-6: drift and hands-on come from fields, one line per change; the text is never logged; a wall from before K6 logs hands-on only`
- `K6 health (BE-10): GET /api/twin-sync/health on this computer says store, audit, host check, counters, timings and confirmBypass 0; no token, code or id in it`
- `K6 §4.4: /health and /log are refused for a LAN Host, a non-loopback peer and a cross-site page, in report mode; each refusal is an audit event with the peer`
- `K6 /log (BE-11, lean): written events after `since`, in seq order, in the public form (no peer), paged by `next``
- `K6 C38: the peer is written for refusals and security events only; an accepted hello has none`
- `K6 host check: a refused upgrade and a cross-site GET are audit events with the peer and the Host clipped; past 60 a minute the next line counts the rest`
- `K6 relay boot and stop: relay.boot then relay.stop through the Vite plugin; a store problem at start is a store.error line without paths`

### Notes and deferred

- **Presence `health` flag → K7.** The plan puts `health: {audit, store}` in presence for K8's "Log not writing" line, but adding a field to presence changes a relay → page shape, and S-15 / the schema hash say a shape change needs a bump. K6 has none in the plan (K7 → 3), so the flag is left for K7's bump (one line in `presenceFor()` from `audit.health().ok` and `store.status().ok`); K8 reads it. Until then the flag is in `/api/twin-sync/health` only.
- **Health is this computer only** (`localOnly()`), as `/log`; §4.4 lists `/health` under the Host guard alone. The remote's "Log not writing" will come through presence (above), so nothing on the LAN needs the endpoint; the deploy and demo-day checks curl it on the Mac Studio.
- **Not in K6 (as planned):** the hash chain, the outside anchor, the verifier, detection signals and the Log view (L8); `/log` reading older files and `log-tail` over the socket (L8); `confirm.*` lines are defined and canary-tested but first emitted by K10, which also asserts `confirmBypass` after every apply (today the remote asks, `confirm: 'remote'` in health); voice is refused while the log is down from V1 (`audit.health().ok` is the switch). `device.online`/`offline` are not debounced (an offline line per last-socket close); BE-6's `{t:'local', motion}` is not sent (tier changes are logged as `cmd.applied` with `fields: ['motion']`). Routing health is L1.
- **Behaviour to know:** `relay.stop` is written when Vite closes its server (Ctrl-C, SIGTERM); a killed process (the QA server's restarts) leaves no stop line, and the next `relay.boot` (a new `boot`) shows it. File days are UTC, so an evening in Austin writes into the next day's file after 19:00 CDT.
- **On the Mac Studio (by hand, at deploy):** after step 11, `curl -s http://localhost:4173/api/twin-sync/health` shows `audit.ok: true` and a growing `seq`; `ls -l ~/Library/Logs/trip-twin/` shows today's file 0600.

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `k6/gate1.txt` (first run: the burst test then asserted a one-tick loop, red under parallel load; reworked to arrive across event-loop turns as socket messages do), `k6/gate2.txt` (final), `k6/build.log`, `k6/smoke1.txt`, `k6/repro1.txt`, `k6/burst.mjs` (the heartbeat measurement), `k6/mutate.py`
- `qa-k6/runs/smoke-2026-10-24T00-03-43/`, `qa-k6/audit/` (the QA audit folder); `qa-k6-repro/runs/repro-pairing-2026-10-24T00-05-02/`

## K7 · crypto ids, no state before pairing, loopback-aware limits (server side; proto → 3)

- **Date:** 23 Oct 2026, 19:30–20:15 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (Chrome for Testing, SwiftShader).
- **Code under test:** the `cf/core` working tree on top of `5c14942` (K6), served with `--ref worktree`. The revert drill restarts on `HEAD` (`5c14942`, the K6 code, `PROTO = 2`) and then on the working tree again.
- **QA server:** `:4181` on 127.0.0.1; data, audit and `TMPDIR` in the QA folder. Map keys passed 0 of 2 (as K1–K6). The live store paths and `~/Library/Logs/trip-twin/` were only ever `stat`ed (absent before and after); the live :4173 server was never contacted.
- **Proto numbers:** `PROTO = 3`, `PROTO_MIN = 3` (S-15). Schema row 3 added (`c89e2144…cd51`); row 2 untouched. A K5/K6 page (proto 2) is told `RELOAD`.
- **Gate verdict: PASS.**

### What landed

- `server/tripTwin/twinLimits.js` (new, pure, S-6/S-16): one `LIMITS` table, token buckets, a socket budget, keyed buckets and window counters (bounded at 4,096 keys), `createLimiter()` (upgrades per IP, commands per device, thumbnails per screen, the wrong-token signal per (IP, device id)), `thumbOk()` (JPEG data URL only).
- **Limits as implemented:** `maxPayload` 1 MiB (`ws` closes 1009; the `error` is caught). Per socket 40 messages burst / 20 a second, the rest dropped and counted; over budget for 10 s without a 1 s break → closed 1008. Per device id: commands and undos 20 burst / 10 a second → ack `RATE_LIMITED` with `retryAfterMs`. Upgrades per IP: loopback 120 a minute (its own bucket), any other address 30 a minute → HTTP 429 with `Retry-After` before the handshake. Sockets: 64 in all, 24 per IP → 503; **16 without a pairing** (`new` + `pending`): when full, the oldest from another computer gives way, else the oldest that has said nothing, else the oldest waiting for a code (closed 1013), so a wall rejoining by token always gets in. **Hello deadline 5 s** (closed 4004; covers refused sockets such as RELOAD). At most 5 hellos per socket before one is accepted (`RATE_LIMITED`, closed). Pair codes: 20 outstanding in all, 6 per LAN address, **loopback exempt**, at most 50 draws then `BUSY` with `retryAfterMs` (never a spin); a waiting socket that closes takes its code with it. **No wrong-token lockout:** `ID_IN_USE`/`FORGOTTEN` hellos are counted by (IP, device id); 10 in 5 min raises one `limit.hit wrong-token` line; nobody is refused for it. Pair tries: today's global 5-then-60 s lock kept; a good code given with a wrong slot is kept for 3 slips, then burnt (our reading of "3 per code": a wrong code cannot be tied to a code). Thumbnails: JPEG data URL ≤ 400,000 characters, one per screen per 2 s, forwarded whole (no longer cut). `local.text`: control characters stripped, 120 characters.
- `src/operations/tripTwin/twinSessionHost.js`: tokens 256 bits base64url (43 characters), codes uniform 0000–9999, undo ids 128-bit hex, **from `crypto.getRandomValues`** (the platform CSPRNG, the same source as `randomBytes`/`randomInt`; no `node:crypto` import because `src/` is also browser-built and `browserModuleBoundary.test.mjs` forbids it). `random` stays injectable for seeded tests; **no `Math.random` default**. **Existing tokens stay valid** (nobody re-pairs). A screen waiting for a code is no longer a device record: its code lives in the code map only, never saved (a screen the host already knew keeps its record as before). Codes purged on every hello and by the relay's sweep; `purgeCodes`, `reissueCode`, `hasCode`, `dropCode`, `codesOut`, `tokensIssued`.
- `server/tripTwin/syncRelay.js`: socket states `new`/`pending`/`paired`; pending screens live in their own map, so `each()` never reaches them: a pending screen gets only `welcome {type:'pair-code', code, ttlMs, proto}` (sent again with a new code when the old one expires: the sweep runs with the 5 s presence tick), then `paired` and `unpaired`; no `state`, `presence`, `identify` or thumbnails; everything it sends except a second hello is dropped. Launchers get presence only (welcome without `state`; state broadcasts reach them as `presence`). Pre-hello messages dropped and counted. `try/catch` around dispatch: `msg.error` with the message type only. **A newly issued token writes the store at once** (`save(snap, {flush:true})` → `store.flush()`; a new remote's token is now saved at all before the next broadcast). Presence carries **`health {audit, store}`** (K6's deferred flag; K8 reads it). Health adds `screensWaiting`, `socketsUnpaired`, `codes` and counters (`preHelloDropped`, `pendingDropped`, `budgetDropped`, `thumbDropped`, `msgError`, `wsError`, `wrongToken`, `limits`). `relay.admit()` before the upgrade.
- `server/tripTwin/auditLog.js`: two catalogue types, `limit.hit` (`limit` from a closed list, `kind`, `retryAfterMs`, `count`, `dropped`; with the peer; one line per limit per 10 s) and `msg.error` (`type` only); canary fixtures added (32 types).
- `src/operations/tripTwin/twinProtocol.js`: `PROTO`/`PROTO_MIN` 3; close codes 1008, 1013, 4004; `MSG_TYPES`.
- `src/operations/tripTwin/twinSync.js` (non-visual): `retryAfterMs` respected before the next connection; the back-off resets on an accepted welcome, not on an open socket (a refused page backs off to 32 s instead of reconnecting every second). Terminal deny codes already stop reconnects (K4). `twinScreen.js` (non-visual hunk): the welcome handler keeps its presence when a welcome has none. `twinEntry.js`: no change needed (the launcher reads `m.presence` only).
- Gate script: **the `Math.random` rule is a failure from K7 on** (relay, limits, host, twinSync, twinIdentity: clean); `/api/route` stays a warning until L1. Baseline 274. Harness: smoke K7-S1 … K7-S7; R-H4 runs a stuck remote through the whole 10.5-minute wait; the QA audit folder is cleared at start (a second run in one QA folder read the first run's probes in K3-S1). Runbook: deploy K7 row.
- Existing tests changed for the new shapes only: setup token format (twinRelay), the launcher hears presence (twinAttribution, twinStore), `PROTO` literals (twinAudit, twinProtocol); the golden transcript gains a LAN BUSY, a `RATE_LIMITED` ack and a re-issued code.

### Gate

| Check | Command | Result |
|---|---|---|
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS** (22 s). 274 tests in 30 files: 274 pass, 0 fail, 0 skip, 0 todo; baseline 274 (251 + 23). |
| Audit canary (every gate) | same | **PASS**: both canary tests found and passing, with fixtures for `limit.hit` and `msg.error`. |
| Wiring | same | `Math.random`: **enforced, clean**. `/api/route` warnings unchanged (`twinCustomPaths.js:148`, `twinPaths.js:44`; L1). |
| Shared-file guard | same | Clean (6 CF commits checked, plus the working tree). |
| Repo tests | `npm test` (run by the gate) | **PASS.** Exit 0; 3280 tests, 3279 pass, 0 fail, 1 skip (Windows-only DACL test); allocation probes skipped on Node 22. A first run caught `node:crypto` in `twinSessionHost.js` (browser-module boundary); fixed with `getRandomValues`. |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/twin-dist` | **PASS** (exit 0; the usual chunk-size note). |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --ref worktree --dir <scratchpad>/qa-k7` | **PASS** (`smoke-2026-10-24T01-12-24`): 30 pass, 6 TODO (after shell step C), 0 pageerror, 0 console.error. K7-S1: a waiting screen heard `[welcome]` only across a command, an identify and a presence tick; the launcher 14 presence, 0 state; presence health `{audit: true, store: true}`. K7-S2: setup link and all tokens 43-character base64url; a token issued by pairing was in the QA store after 52 ms (debounce 300). K7-S3: proto 2 → RELOAD, closed 4004 after 5.0 s. K7-S4: 64 silent sockets, then S1–S5 and the remote rejoined in 12 ms; idle closed 1013/4004. K7-S5: 2 MiB frame closed 1009, everyone else still open. K7-S6: S6 at 5K (2560×1440 @2x): largest thumbnail 16.5 KiB (limit 1 MiB), JPEG only, gaps ≥ 2 s. K7-S7: health counts codes, waiting sockets and limits; msgError 0; `limit.hit` lines carry the peer. K6-S1 canary over the whole folder (now with `limit.hit`): 22 secrets, 0 hits. |
| Restart and revert | same run | K1-S9 to S13 (restart-and-reconnect), K2-S1 (revert to `5c14942`: walls with K7's 43-character tokens rejoin the K6 code) and K2-S2 (forward: `store.loaded`, no `store.migrated`) pass; K5-S3 passes after them. |
| CF-2 repro | `node scripts/qa-twin-multiview.mjs repro-pairing --wait-expiry --ref worktree --dir <scratchpad>/qa-k7-repro` | **All 12 automated steps GREEN** (`repro-pairing-2026-10-24T00-57-24`). **R-H4 is the live B4 gate:** for the 10.5-minute wait a stuck remote opened a new loopback socket every second with a forgotten token (627 hellos, all told FORGOTTEN, none refused or limited), then S4 was opened again and rejoined (presence S4 online). 4 console errors: the known SwiftShader artefact (a headless popup gets no WebGL context), two popups this run. Run before the last two edits (control-character strip in `local.text`, the harness audit-folder reset); both are covered by the final gate and smoke. |
| Mutation check | pending gets state; wrong-token lockout; no try/catch; no hello deadline; no eviction; pending saved; per-IP cap on loopback; no flush; launcher gets state; no re-issue | 2, 1, 1, 3, 3, 12, 1, 1, 1 and 1 of the K7 tests turn red; restored code green. |
| K7 gate cases | in the tests above | 10,001 hellos (half loopback, half 50 LAN addresses): every one answered at once, codes ≤ 20, nothing saved, command acked < 100 ms, the wrong-code lock still works; **one stuck remote retrying on loopback for 10 minutes, then a wall reloads and rejoins** (fake clock, plus R-H4 live); **six walls fall back to codes at once and all six get a code** (loopback and one LAN address); **64 silent sockets, then six walls reconnect**; a 2 MiB frame closes only its socket (real `ws`); 10,000 seeded fuzz frames throw nothing and change nothing; a pending socket receives only its code across a command, a thumbnail and an identify; the largest real thumb on a 5K wall 16.5 KiB. |

### Test names added in K7 (`twinLimits.test.mjs`)

- `K7 T3.7 SEC-4: tokens are 256-bit base64url, codes 4 digits, undo ids 128-bit hex, all from the CSPRNG (getRandomValues); a constant Math.random changes none of them (T3.16)`
- `K7 R6c: tokens issued before K7 (24 characters) stay valid: a wall and a remote from an old store rejoin with them and keep them (nobody re-pairs)`
- `K7 SEC-7 T3.10: a pending screen hears only its code, then `paired`, then the state: nothing across a command, a thumbnail, an identify, a presence tick or another pairing; it is not saved`
- `K7 SEC-7: a launcher gets presence only: no state in its welcome or after a command, a pairing or a setup`
- `K7 T3.11 SEC-8: 10,001 screen hellos (the LAN and this computer) leave a command acked in under 100 ms; codes stay at 20 or fewer; nothing is saved for them; the wrong-code lock still works`
- `K7 T3.15 SUP-5: an expired code is purged and the waiting wall is sent a new one by the sweep; the old code no longer pairs, the new one does`
- `K7 S-16 B4: codes cap at 20 in all and 6 per LAN address, this computer exempt from the per-address cap; the next is BUSY with retryAfterMs; a code that cannot be drawn is BUSY too, never a spin`
- `K7 sec S5: six walls fall back to codes at once (their store was lost) and all six get a code, on this computer and from one LAN address`
- `K7 B4 gate: one stuck remote retrying on loopback with a forgotten token for 10 minutes locks nobody out; then a wall reloads and rejoins by its token`
- `K7 sec S6: 64 sockets that never say hello, then six walls reconnect: all six rejoin at once; the idle ones are closed at the 5 s hello deadline (4004)`
- `K7 sec S6: a socket with no accepted hello is closed after 5 s; one refused (an old page, RELOAD) is closed too; an accepted one is not`
- `K7 S-15 stale page: a page from K5 or K6 (proto 2) is told RELOAD with text it can show; this build says proto 3; nothing reaches the host`
- `K7 T3.13 BE-2: a 2 MiB frame closes only its own socket (1009) on a real server; the wall beside it carries on`
- `K7 T3.14 SEC-8: 10,000 seeded fuzz frames (JSON and not, before and after hello, every socket kind but the one in control) throw nothing and change nothing on the wall`
- `K7 SEC-8: a message the host throws on is caught: msg.error with the type only, and the next message is answered`
- `K7 S-16: a socket past 40 messages in a burst has the rest dropped; over its budget for 10 s it is closed (1008); one that keeps to 20 a second stays`
- `K7 S-16: per device, 20 commands in a burst, then RATE_LIMITED with retryAfterMs; 10 a second after that are applied`
- `K7 S-16: upgrades per address: 30 a minute from the LAN (then 429 with retryAfterMs), 120 from this computer (its own budget); through the real handler the 25th socket from one address gets 503`
- `K7 SEC-8: thumbnails: a JPEG data URL only, one per screen per 2 s; anything else is dropped and never reaches a remote; a wall’s text loses its control characters`
- `K7 R6c: a newly issued token is in the store at once (no 300 ms wait), through the plugin; presence says health {audit, store}`
- `K7 S-16: a good code with a wrong slot is kept for 3 tries, then burnt; wrong codes keep today’s 5-then-60 s lock`
- `K7 client: BUSY with retryAfterMs: twinSync.js does not connect again before it, and does after`
- `K7 S-4 wiring: the Math.random rule is enforced from K7 and clean; /api/route stays a warning until L1`

### Notes and deferred

- **Deferred (as planned):** the screen cards for `BUSY`, `RATE_LIMITED`, out of date, terminal deny and the calm unpaired card, and "Log not writing" from `presence.health` (K8); tokens hashed at rest (CF-later L5); ticket-based setup and the boot secret (K11); `enforce` host check (K12). SEC-8's separate "hellos per IP 20 a minute" is not built: S-16 replaced it with upgrades per IP plus 5 hellos per socket.
- **Behaviour to know:** under a flood of new or waiting sockets the oldest waiting screen may be evicted (it reconnects and shows a new code); a screen on this computer is evicted only after every LAN and every silent socket. Codes in practice stay ≤ 16 (one per waiting socket). A launcher started from the Multi-view card (no link) that loses the server now reconnects with back-off and is closed at the hello deadline each time (before K7 it stayed open and silent); `hello-deadline` `limit.hit` lines (one per 10 s at most) are the trace.
- **On the Mac Studio (by hand, at deploy):** reload every wall and the iPad (proto 3); after the extra restart in the checklist, `curl -s http://localhost:4173/api/twin-sync/health` shows `"proto":3` and `counters.limits` with nothing but `hello-deadline`.

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `k7-gate0.txt`, `k7-gate1.txt` (the boundary failure), `k7/gate2.txt`, `k7/gate3.txt` (final), `k7/build.log`, `k7/smoke1.txt`, `k7/smoke2.txt` (K3-S1 red: the first run's probes left in the reused QA folder; harness fixed), `k7/smoke3.txt` (final), `k7/repro1.txt`, `k7/mutate.py`, `k7-shapes.json`
- `qa-k7/runs/smoke-2026-10-24T01-12-24/`, `qa-k7/audit/`; `qa-k7-repro/runs/repro-pairing-2026-10-24T00-57-24/`

## L5 · hashed token store, v2 migration, tmp copy retired (server side; CF-later, run early per §6.1)

- **Date:** 23 Oct 2026, 20:20–21:35 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (Chrome for Testing, SwiftShader). The machine was under heavy outside load for most of the session (load average 40–70: Chrome, Spotlight indexing, a second agent building K8 in `gods-eye-view-cf-k8`); see the notes.
- **Code under test:** the `cf/core` working tree on top of `5c1cb6c` (K7, rebased onto the shell head `b7e2576`), served with `--ref worktree`. The revert drill restarts on `HEAD` (`5c1cb6c`, the K7 code: **below L5, so a re-pair by design**) and then on the working tree again.
- **QA server:** `:4181` on 127.0.0.1; data, audit and `TMPDIR` in the QA folder. Port checked free before every run (the K8 worktree shares it). Map keys passed 0 of 2 (as K1–K7). The live store paths and `~/Library/Logs/trip-twin/` were only ever `stat`ed; the live :4173 server was never contacted; the real Mac Studio store was never read.
- **Proto:** unchanged (`PROTO = 3`): no message changes shape; the plain token still travels only in the welcome or `paired` that delivers it. No page needs a reload for this deploy.
- **Gate verdict: PASS.**

### What landed

- `server/tripTwin/twinTokens.js` (new): `tokenHash` (sha256, hex), `sameToken` (`crypto.timingSafeEqual` over the 32 bytes; a non-hex or short hash is refused), `TOKENS` for the host, `hashDevices` (v1 → v2 records), `scrubText` (hashes plain token fields in raw text, a torn file too; a token cut by the tear goes with the rest of the tear) and `plainTokenFiles` (the whole-folder scan: a plain token field, or any known token verbatim).
- `src/operations/tripTwin/twinSessionHost.js`: device records hold **`tokenHash`, never the token**, in memory and in `snapshot()`. A presented token is checked with `tokens.same`; a reload gets back the token it showed; a new token leaves the host only in the reply that issues it. A restored record with a plain `token` (a v1 store, older tests) is hashed on the way in, so a K2–K7 store also restores. `tokens` is injected; the relay passes `TOKENS`. The default is the same sha256 and `timingSafeEqual`, reached through `process.getBuiltinModule('node:crypto')` at first use, so `src/` still has **no `node:` import** (browser-module boundary). The audit's `token: kept|issued|none` is unchanged.
- `server/tripTwin/sessionStore.js`: **`STORE_VERSION = 2`**. A v2 store with a plain token fails the shape check (quarantined); `tokenHash` must be a sha256. **A v1 store migrates once on load:** first the plain copy `session.v1.json` (0600, the v1 store as it was; not written for a v1 store that holds no token), then `session.json` rewritten in place as `v:2` (`hashedAt`), then the marker (`hashedAt`, `plainCopy`). Log `store.hashed` (token count, no tokens). A pre-K2 tmp store goes straight to v2 the same way. At every start the backup and `quarantine/` are hashed in place (`store.scrubbed`), and once the marker exists the tmp-path store and its temp are deleted unread (`store.tmp_removed`), even when a reverted build wrote them again. The copy is **never deleted by the server**: `store.plain_copy_kept` at every start and `status().plainCopy` (health) until it is dropped by hand. `docOf` hashes whatever it is given, so this code never writes a plain token. `forget()` also rewrites the plain copy without the forgotten devices. New exports: `scanForPlainTokens`, `dropPlainCopy`, `scanPaths`, `PLAIN_COPY_FILE`, `PLAIN_VERSION`.
- **The tmp-path dual write is gone** (`dualWrite` option and `store.dual_write_error` removed from the store; the catalogue value stays for old lines).
- `scripts/trip-twin-store.mjs` (new, by hand): `scan [--keep-plain-copy]` (exit 1 when any file at rest holds a plain token; names files only) and `drop-plain-copy` (deletes `session.v1.json`, notes `plainCopyDroppedAt` in the marker, then scans; a `deploy-copy.json` from before L5 is reported, not deleted).
- `server/tripTwin/syncRelay.js`: hosts are built with `tokens: TOKENS`. `auditLog.js`: `relay.boot` `store` may be `hashed`.
- Gate script: baseline **280** (274 − 1 + 7); **the token scan and the v1 migration test are required every run**, as the audit canary is (`REQUIRED_TESTS`).
- Harness (`qa-twin-multiview.mjs`): K1-S9 on an L5 build checks the store is v:2 with hashes only and no tmp-path copy; **K2-S1 below L5 expects the re-pair state** (the reverted build quarantines the v:2 store; S1–S5 get pair codes, the remote `FORGOTTEN`, the S6 page its pair card, the server answers); **K2-S2 forward** checks no `store.migrated`, no tmp file, then re-pairs S1–S6 and the remote as `re-pair.md` says (new launcher setup, QR, S6 by code); K7-S2 looks for the token's hash in the store; **new L5-S1** scans the QA data folder and TMPDIR for every token the run was given (15) and any plain token field; the K6 canary also searches every token seen. A revert to an L5-or-later build still expects a plain rejoin.
- Runbooks: `deploy-mac-studio.md` (store paragraph, step 4b first-L5 check with `TRIP_TWIN_V1_FIXTURE=<copy>`, step 7 log lines, step 17 order, rollback below L5 with `session.v1.json`, K2/K11/L5 rows with the **revert drill and the drop as explicit by-hand steps**), `re-pair.md` (a revert below L5 after the drop is a re-pair; what the walls show; rolling forward again), `break-glass.md` (`session.v1.json` in the delete list; `trip-twin-store.mjs scan` as the check).
- Fixture `fixtures/twinStore-v1-k7-redacted.json`: the pre-K2 fixture run through the **real K7 code** (`5c1cb6c`) migration and host, so it is exactly what K2–K7 write (v:1, refs, tokens redacted).

### What L5 took over from K11 (S-14 sequencing)

S-14 had the K2 dual write run "until K11", when the tmp file is deleted. L5 lands before K11, and a dual write would put plain tokens back in `os.tmpdir()`, against "after L5 no plain token at all". A revert below L5 is a re-pair anyway once the plain copy is dropped, so the dual write buys nothing after L5. **L5 therefore stops the dual write and deletes the tmp file (at every start once migration is settled).** Before the drop, the revert path is the plain copy in the data folder, not the tmp file. **K11 no longer has a tmp file to retire or a dual write to stop.** Its other store work stands: Forget and Forget all rewrite the store, the backup and (while it exists) the plain copy (`forget()` already does); its token scan ("no forgotten device's token") now runs over hashes, and `scanForPlainTokens` with the forgotten tokens covers it.

### Gate

| Check | Command | Result |
|---|---|---|
| Baseline smoke on `5c1cb6c` (the shell commits underneath are new) | `node scripts/qa-twin-multiview.mjs smoke --ref HEAD --dir <scratchpad>/l5/qa-base` | **PASS** (`smoke-2026-10-24T01-24-17`): 30 pass, 6 TODO, 0 pageerror; revert drill to `46de6ad` (K6) and forward again green. 2 console errors, the known SwiftShader artefact on the S6 page (no WebGL context), plus the allowed FIRMS 503. |
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS** on the fifth run (41 s): 280 tests in 31 files, 280 pass, 0 fail, 0 skip, 0 todo; baseline 280. The first four runs failed **only** `K6 SEC-12: 10,000 events in a burst delay a heartbeat by at most 50 ms` (54–308 ms late) at load averages 18–70. That test drives `auditLog.js` alone (no tokens, no store); an A/B in the same minutes failed it on a clean archive of `5c1cb6c` too (96.5 ms) while the L5 tree passed 3 of 3. Machine load, not L5; recorded, threshold not touched. |
| Required every run | same | **PASS**: both K6 canary tests, and both L5 tests (the whole-folder token scan; the v1 migration with rejoin). |
| Wiring | same | `Math.random`: enforced, clean. `/api/route` warnings unchanged (`twinCustomPaths.js:148`, `twinPaths.js:44`; L1). |
| Shared-file guard | same | Clean (7 CF commits checked, plus the working tree). |
| Repo tests | `npm test` (run by the gate) | **PASS.** Exit 0; 3286 tests, 3285 pass, 0 fail, 1 skip (Windows-only DACL test); allocation probes skipped on Node 22. |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/l5/twin-dist` | **PASS** (exit 0; the usual chunk-size note; no `ncFixture` in the output). |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --ref worktree --dir <scratchpad>/l5/qa-l5b` | **PASS** (`smoke-2026-10-24T02-08-18`): 31 pass, 6 TODO (after shell step C), 0 pageerror, 0 console.error. K1-S9: QA store `v:2`, S1–S6, token hashes only, no tmp-path copy. K1-S10 to S13 (restart-and-reconnect) green. **K2-S1 (revert to `5c1cb6c`, below L5):** the K7 code quarantined the `v:2` store and started a fresh wall; S1–S5 got pair codes, the remote `FORGOTTEN`, the S6 page its pair card; server up; nothing crashed. **K2-S2 (forward):** no `store.migrated`, no tmp file; S1–S5 and the remote re-paired from a new launcher setup, S6 by code. K5-S3 green after it. K7-S2: the new token's hash in the store after 53 ms. **L5-S1:** 16 tokens searched in the QA data folder and TMPDIR: 0 hits. K6-S1 canary: 37 secrets (every token and setup link of the run), 0 hits. |
| Smoke, first attempt | same, `--dir <scratchpad>/l5/qa-l5` | FAIL, not L5: at load average ~60 the S6 puppeteer page detached at the first restart (`Attempted to use detached Frame`), so every later page step failed (K1-S12/S13, the page parts of K2-S1/S2, K7-S6); and K1-S14 tripped because Jesse's live :4173 server (pid 81005) saved its own tmp store at 20:46:17 (as in K2). The socket-level L5 steps (K1-S9, K1-S10/S11, L5-S1) passed in it. |
| CF-2 repro | `node scripts/qa-twin-multiview.mjs repro-pairing --wait-expiry --ref worktree --dir <scratchpad>/l5/qa-l5-repro3` | **All 12 automated steps GREEN** (`repro-pairing-2026-10-24T02-16-55`): R-1, R-2, R-H1, R-H1c, R-H2, R-Hb, R-K4a, R-Hd, R-He (restart: the wall rejoins by its token against a hash), R-3, R-3q and **R-H4 live** (a stuck remote sent 627 hellos with a forgotten token over the 10.5-minute wait, all told FORGOTTEN, none refused or limited; then S4 was opened again and rejoined). 2 console errors, the known SwiftShader artefact (a headless popup gets no WebGL context). A first `--wait-expiry` attempt (`qa-l5-repro2`) never started: the K8 agent took :4181 between the port check and the start. The same repro without `--wait-expiry` (`qa-l5-repro`) was 11 GREEN, R-H4 not run. |
| Mutation check | host accepts any token; no backup/quarantine scrub; tmp file kept; no plain copy; dual write back; Forget skips the copy; a start drops the copy; v1 loaded as is | 1, 2, 4, 5, 4, 2, 5 and 4 of the store and L5 tests turn red; restored code green (`l5/mutate.txt`). |
| Revert drill with the real K7 code | `node <scratchpad>/l5/gen/drill-k7.mjs` (the K7 store and host from `git archive 5c1cb6c`, on a copy of the fixture) | L5 start hashes in place and keeps the copy; **K7 on the hand-restored `session.v1.json`: S1–S6 and the remote rejoin**; forward: `store.hashed` (7), tmp file K7 wrote deleted, all rejoin; `drop-plain-copy`: scan clean; **K7 on the `v:2` store: quarantined, fresh, every wall a pair code, the remote denied** (the re-pair by design); L5 forward after that: fresh, scan 0 (`l5/drill-k7.txt`). |

### Test names added in L5 (`twinTokens.test.mjs`)

- `L5 SEC-6: a token is kept as its sha256 and checked with timingSafeEqual; the host holds hashes only and a token leaves it only in the reply that issues it or to the device that showed it; a wrong token, its hash shown as a token, or none is refused`
- `L5 gate: a v1 store (K2–K7) migrates once to v:2 in place; every wall and the remote rejoin with the token they hold (no re-pair); the marker says hashedAt; the plain copy is the v1 store; the next start loads v:2 and hashes nothing` (required every run)
- `L5 gate: the whole-folder token scan (S-14): after a migration, pairings, restarts, a torn store in quarantine/, a stale backup and a tmp store a reverted build wrote, no plain token is at rest in the data folder, session.prev.json, quarantine/ or the relay’s os.tmpdir() files (the plain copy aside until its drill)` (required every run)
- `L5 revert drill (S-14): before the copy is dropped, a revert below L5 restores session.v1.json by hand: a v1 store with every token, which K2–K7 load and their walls rejoin; Forget rewrites the copy too; forward again it is hashed once more; after drop-plain-copy a revert is a re-pair (K2–K7 refuse a v:2 store)`
- `L5: a v:2 store with a plain token in it fails the shape check and is quarantined, hashed in place there; a torn store’s cut-off token is dropped with the rest of the tear`
- `L5 S-14: the tmp-path dual write is retired: no save writes os.tmpdir(); a tmp store a reverted build wrote is deleted unread at the next start, its temp too; a pre-K2 tmp store with no marker is still migrated once (hashed), then deleted`
- `L5: drop-plain-copy is by hand only: no start deletes the copy; scripts/trip-twin-store.mjs scan reports it, drop-plain-copy deletes it and notes it in the marker; a deploy-copy.json from before L5 is reported, not deleted; health says plainCopy; nothing printed holds a token`

Retired: `store: revert-and-restart: the pre-K2 loader still finds the wall in the tmp file (dual write)` (no dual write from L5). Changed for the new shape: four K2 store tests (v:2, no tmp copy, tmp deleted, Forget by hash) and one K7 test (the hash is in the store at once, not the token).

### Notes and deferred

- **The sequencing fix** is above: L5 retires the tmp copy that S-14 gave to K11. Nothing else in the plan changes; K11's gate keeps its token scan.
- **Departures:** (1) the plain copy is not written for a v1 store that holds no token (a fresh wall), so a revert drill on a fresh wall has nothing to restore and is a re-pair either way. (2) The backup and `quarantine/` are hashed **in place** at every start rather than deleted: S-14 keeps them for a hand restore, and a hashed v1 file still restores onto L5. A torn file loses whatever follows a token cut by the tear. (3) A tmp store that is not usable at the first start is deleted rather than "left in place" (K2's wording): it may hold plain tokens. (4) The host's default sha256 comes from `process.getBuiltinModule('node:crypto')` (Node ≥ 22.3), so `src/` keeps no `node:` import; the relay passes `TOKENS` from `server/tripTwin/twinTokens.js` explicitly. (5) `deploy-copy.json` (the deploy checklist's own copy) is reported by the scan, not deleted by `drop-plain-copy`: it is the operator's file and step 17 deletes it.
- **Not changed:** the token format and lifetime (L6 adds expiry); proto (no message changes shape); no page reload needed; the client still keeps its token in `localStorage` (a stolen device still holds a working token until Forget at K11).
- **Deferred:** nothing from the L5 row. L6 adds `pairedAt`/expiries to the same records.
- **By hand on the Mac Studio (the L5 deploy):** (1) before: the deploy copy of `session.json` (`v:1`) and step 4b, `TRIP_TWIN_V1_FIXTURE="$D/deploy-copy.json" node --test src/operations/tripTwin/twinTokens.test.mjs` must end `# fail 0`; (2) restart from the same kind of shell as before; the log shows `store.hashed` (the number of tokens), `store.tmp_removed`, `store.plain_copy_kept`; no page reload is needed; (3) the usual checks; health's `store` shows `"plainCopy":true`; (4) **the revert drill**: stop, `git checkout 5c1cb6c` (or the commit noted), `cp -p "$D/session.v1.json" "$D/session.json"`, start, six walls and the iPad rejoin with no code; stop, check out L5, start, `store.hashed` again, everything rejoins; (5) only then `rm -f "$D/deploy-copy.json"` and `node scripts/trip-twin-store.mjs drop-plain-copy` from the checkout in the Vite shell: `deleted session.v1.json`, `clean: no plain token at rest`; (6) from then on a revert below L5 is a re-pair (`re-pair.md`). If the drill cannot be run that day, leave the copy: the server never deletes it.

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `l5/smoke-base.txt` and `l5/qa-base/runs/smoke-2026-10-24T01-24-17/` (baseline on `5c1cb6c`); `l5/smoke1.txt` and `l5/qa-l5/runs/smoke-2026-10-24T01-42-17/` (first attempt, load); `l5/smoke2.txt` and `l5/qa-l5b/runs/smoke-2026-10-24T02-08-18/` (final)
- `l5/gate1.txt` … `l5/gate4.txt` (the K6 timing failures), `l5/gate5.txt` and `l5/gate5.json` (final), `l5/build.log`, `l5/mutate.py`, `l5/mutate.txt`
- `l5/repro1.txt` and `l5/qa-l5-repro/` (without `--wait-expiry`: 11 GREEN, R-H4 not run), `l5/repro2.txt` (port taken, not run), `l5/repro3.txt` and `l5/qa-l5-repro3/` (with it, final)
- `l5/gen/make-v1.mjs` (the v1 fixture made with the K7 code), `l5/gen/drill-k7.mjs`, `l5/drill-k7.txt`, `l5/k7code/` (`git archive 5c1cb6c` of the two Trip Twin folders), `l5/headrepo/` (the full `5c1cb6c` archive for the A/B)

## K8 · operator states, part 1: describer, wall chips and cards, remote status strip, Screens & devices (screen slice; no proto bump)

- **Date:** 23–24 Oct 2026, 20:30–22:45 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (Chrome for Testing, SwiftShader). Load average 20–70 through the run (other builds on the machine).
- **Code under test:** the `cf/k8` working tree on top of `7b95e1f` (K7 `5c1cb6c` plus the cherry-picked K6 test fix `49da0ba`; afterwards rebased onto `cf/core` `49da0ba`, which adds L5, and the gate re-run there), served with `--ref worktree`. Shell step C is in the base; this is the first CF slice that edits the shell's screen files (Jesse paused the shell terminal).
- **QA server:** `:4181` on 127.0.0.1, own data, audit and `TMPDIR` folders; map keys passed 0 of 2 (as K1–K7); checked free before every run (it was busy with L5's runs for a while; waited). The live :4173 server and the live store paths were never contacted or opened.
- **Proto numbers:** unchanged, `PROTO = 3`. No message changed shape: the pairing refusal's new words travel in the existing `error` text (schema row 3 still matches).
- **Gate verdict: PASS.**

### What landed

- `src/operations/tripTwin/twinDescribe.js` (new, pure): parts `{scope, field, key?, to}` from a diff of two states (`diffParts`, `describeChange`) or a dry run of the reducer (`describeCommand`); `render(change, {audience: 'remote'|'wall'|'log'|'voice'})` per 05's golden table (CF-D8: "iPad", never "iPad · EV"); the field-label table; `byText` (a device's host-given name, "another device" if unknown, never an id; "Voice · " for V1); `chipText` (≤ 56 characters: the time goes first, then the summary is cut with "…", the device name never; suffixes give way last); `scopeLine`, `lastChangeOf`, `metaPhrase` (a change known only from meta); `controlText` (the remote's control cell, incl. 2d after 15 s); `STATUS`; `wallCard` (every wall card's copy). People and places are named per surface: full name on the remote, `wallName` on walls (initials in Visitor mode), the id in the log; an unknown person is "a person".
- **Walls** (`twinScreen.js`, `tripTwin.css`, `page.js` names and a `data-tt-render` hook): the chip says "S4 · Radar on · by iPad · 21:32" for 3 s on the walls a change touched ("S3 · Pinned: kept as it is · push by iPad · 21:32" on a pinned one, "Undone: …" for an undo), then "S4 · Remote: iPad · last change 2:14 ago" (+ "by Laptop" when another device made it), "Remote offline (iPad) · since 21:30", "not connected". Steel only (C65): the chip's `.warn` amber is gone; the words carry the state. **Calm unpaired card** (`body.tt-unpaired`): only the field, the dot grid and one card; everything else hidden; the 3D render loop paused; on pairing the role is applied again and the scene resumes. Cards: pair ("PAIR THIS SCREEN", code, "Code valid until 21:42 · a new one appears then", host footer), link used/expired, lost pairing (ID_IN_USE), slot taken (7a, after the reload), token expired (6b copy, reachable from L6), and with no code: replaced (7, with "Use this window instead": this window alone takes a fresh id and asks for a code; the shared slot record stays the other window's), out of date (1a, after the one guarded reload), rejoining paused (6c), too many waiting (6d), any other refusal. `twinSync.js` tells a wall (`refused`) why it asked again after a terminal refusal. The band under the chip is untouched (V1 voice strip).
- **Remote** (`remote/remote.js`, `remote/stations.js`, `remote.instrument.css`): the status strip's control cell ("In control · this remote (iPad)", "View only · iPad in control since 21:20", "View only · no remote in control", "Not connected · retrying", then "Can't reach the Trip Twin computer from {host} · retrying"); "Log not writing" from `presence.health.audit` (one chip, dim amber text, never on walls); out of date (RELOAD at hello): the page stays, strip item "This remote page is out of date · nothing was sent" + Reload, an error bar, nothing is sent. The active-station card gains "Last change on S4 · 21:32 · radar on · by Laptop" for the target (the last change anywhere for All). Result lines come from the dry run ("S2: streets on", "S1, S2, S4, S5, S6: lightning on · S3 pinned, unchanged", "Every screen back to Live and role defaults · pinned too"; "Undone on S2: streets off" from the undone state). The rail foot's Screens is **Screens & devices** (screens list, Pair a screen, then role, display, whole wall): a wrong code says the tries left, the fifth starts the pause, the Pair button reads "Pair (0:48)" and stays off until it ends; success "Paired S3 · it shows S3's role now"; screen cards say "Last change by Laptop" only when another device made it.
- **Host** (`twinSessionHost.js`, `twinProtocol.js`): the pairing refusals say "Code not recognised or expired · 3 tries left before a 1-minute pause" and "Pairing paused until 21:33:10 after 5 wrong codes · screens already paired are not affected" (`pairWrongText`, `pairLockedText`; `pairPausedUntil` reads the end back for the remote). Values only; the 5-then-60 s rule is unchanged.
- **Launcher** (`twinEntry.js`): a status strip on the host's launch card and on the other computer's launch page: "Log not writing"; "This page is out of date" + Reload (setup refused RELOAD, or a launch page told RELOAD at hello).
- **Hooks (PHASE-CF-PLAN §3.2 c):** `data-tt-status`, `-control`, `-status-item`, `-reload`, `-bar`, `-confirm`, `-undo`, `-target`, `-rail`, `-active`, `-last-change`, `-station`, `-foot`, `-layer`, `-pin`, `-return-all`, `-pair`, `-pair-go`, `-pair-result`, `-screen`, `-ask-control`, `-handover`, `-aperture` on the remote; `-rail`, `-active`, `-station`, `-foot`, `-menu`, `-aperture` on the All-in-one rail (`twinStations.js`); `-chip`, `-card`, `-render` on walls.
- Runbook: deploy K8 row. Gate script: baseline 289. Existing tests changed for the new pairing words only (`twinSession.test.mjs`, `twinLimits.test.mjs`: `/locked/` → the pause text).

### Gate

| Check | Command | Result |
|---|---|---|
| Trip Twin tests | `node scripts/test-trip-twin.mjs` | **PASS** (33 s). 289 tests in 31 files: 289 pass, 0 fail, 0 skip, 0 todo; baseline 289 (274 + 15). An earlier run without the K6 test fix failed only `K6 SEC-12` (a heartbeat 51.9–70 ms late under load 57–68, on the K7 base too); `49da0ba` cherry-picked as asked, test untouched otherwise. |
| Audit canary | same | **PASS** (both tests found and passing). |
| Wiring | same | `Math.random`: enforced, clean. `/api/route` warnings unchanged (L1). |
| Shared-file guard | same | Clean (8 CF commits checked, plus the working tree). |
| Repo tests | `npm test` (run by the gate) | **PASS.** Exit 0; 3295 tests, 3294 pass, 0 fail, 1 skip (the Windows-only DACL test). |
| Twin build | `npx vite build --config vite.twin.config.js --outDir <scratchpad>/k8/twin-dist` | **PASS** (exit 0; the usual chunk-size note; no `ncFixture`). |
| Smoke | `node scripts/qa-twin-multiview.mjs smoke --ref worktree --dir <scratchpad>/qa-k8` | **PASS** (`smoke-2026-10-24T03-41-46`): **44 pass, 0 fail, 0 TODO**, 0 pageerror. K1's six DOM stubs are real steps (below). 13 console.error lines, all allowed kinds: one FIRMS 503, and the known SwiftShader artefact (extra headless pages get no WebGL context: "open failed … webgl2", then "harness failed … useDefaultRenderLoop" from the standalone scene on a page with no viewer) on the pages K8-S5/S6/T6 open late in the run. |
| Restart and revert | same run | K1-S9 to S13 (restart-and-reconnect), K2-S1 (revert to `HEAD`, the K7 code) and K2-S2 (forward, `store.loaded`, no `store.migrated`) pass; K5-S3 after them. K1-S12 now waits again if the Vite client reloads the S6 page just after its socket came back (seen once in this run's attempts; a harness race, not a product change). |
| CF-2 repro | `node scripts/qa-twin-multiview.mjs repro-pairing --wait-expiry --ref worktree --dir <scratchpad>/qa-k8-repro` | **All 12 automated steps GREEN** (`repro-pairing-2026-10-24T03-17-52`), 0 console errors. R-H4: 627 hellos with a forgotten token over the 10.5-minute wait, all told FORGOTTEN, then S4 opened again and rejoined. M4.1 by-hand rows NOT RUN (Mac Studio). |
| 05's golden table | `twinDescribe.test.mjs` | The four rows (remote result, wall chip, log row), plus Visitor mode initials; 200 seeded commands: the dry run names exactly the screens and wall-wide fields the reducer changed, pinned = skipped, no "safe"/"all clear"/"recommended". |
| Chip ≤ 56 | same | Every host-given name (incl. "Trip Twin computer 2") × the longest trip title, every role and layer label, "Pinned…", with and without suffixes: ≤ 56, name never cut, the time dropped first. The longest trip with "iPad" fits whole: "S4 · Every screen: Spring choir tour · by iPad · 21:32". |
| E8.1 | smoke K8-S2; unit (relay) | Live: the S6 page named the device **5 ms** after the command ("S6 · Scale grid off · by Trip Twin computer · 22:12"), then "last change 0:03 ago". On loopback the host names the QA remote "Trip Twin computer" (CF-D8); "by iPad" through a LAN-peer remote is the relay unit test (S2 chip "S2 · Streets on · by iPad · 21:32", then "S2 · Remote: Laptop · last change 2:14 ago by iPad" after a handover). |
| No saturated colour on wall chrome | smoke K8-S9; `k8/sat.mjs`, `k8/sat2.mjs` | Smoke: 10 shots (the chip band twice, the pair card, every card with no code, the lost and link cards): **0** pixels with HSV S > 0.35 and V > 0.35. Capture at 2560 and 5K: every card 0; the chip band 0 from the badge rightwards (the only coloured pixels in the 2560/5K head clips are the 3D scene's teal lines at the clip's left edge, behind the translucent header, not chrome). |
| Appendix D strings | unit + smoke | Unit: 1, 1a, 1c, 2d, 3, 6b, 6c, 6d, 7, 7a and SUP-5's pair, lost, link-used and pairing refusals, literally. Smoke (DOM): pair card, chip, 7 replaced (+ button), 1a, 1 (remote strip + bar), 1c (launch page), 3 (remote and launcher; never on a wall), 6c and 6d and a refusal (scripted relay answers), lost (scripted ID_IN_USE once, then the real pair code), link used (a real expired link), the pairing refusal and success, the control cell rows. 7a is shown in the capture run (a real slot handed to another device). |

### K1's smoke stubs, now real (no TODO left)

- **K1-T1 / K8-R2** target S2, Layers & display, a layer on, Undo: S2 changes and goes back; "S2: streets on", "Last change on S2 · 22:12 · streets on · by Trip Twin computer 2", "Undone on S2: streets off".
- **K1-T2 / K8-R3** pin S3 in Screens & devices, All push: S3 untouched; "S1, S2, S4, S5, S6: lightning on · S3 pinned, unchanged".
- **K1-T3 / K8-R4** Return all asks first; Confirm; every wall Live; "Every screen back to Live and role defaults · pinned too".
- **K1-T4 / K8-R7** Screens & devices pairing: "Code not recognised or expired · 4 tries left before a 1-minute pause", then "Paired S5 · it shows S5's role now"; the old S5 told SLOT_TAKEN and paired back by the page.
- **K1-T5 / K8-R1** the remote page at 1180×820 is view only ("View only · Trip Twin computer in control since 22:11"), asks, does not take control; handed over: "In control · this remote (Trip Twin computer 2)"; K8-R5 hands it back.
- **K1-T6 / K8-T6** the All-in-one at 2560×1440 and 1728×1117: rail, active pane, 6 tiles, foot menu layers/display/keys, the aperture toggles the rail.
- New: K8-S1 (calm unpaired), K8-S2 (E8.1), K8-R6 (Log not writing live: audit file made read-only; remote and launch page say it within one presence tick, commands keep working, walls never; gone once writable), K8-S4 (replaced), K8-S5 (out of date ×3), K8-S6 (cards), K8-S9 (steel). `full` mode is still a stub (E9, the core exit).

### Test names added in K8 (`twinDescribe.test.mjs`)

- `K8 SUP-1 golden table: the remote result, the wall chip (3 s) and the log row for the four golden commands (CF-D8: "iPad")`
- `K8 SUP-1: the dry run names exactly the screens and fields the reducer changes, for 200 seeded commands on changing walls`
- `K8 SUP-1: the field-label table names every field the reducer writes, and the number of screens`
- `K8 SUP-1: the log names ids only, never a person or a device id; an unknown person is "a person" on the walls, never the id`
- `K8 SUP-1: one change, each field in words: a role says the role only, a reset says defaults, a frame says what it frames, a join says nothing`
- `K8 SUP-3 (chip part): an undo reads "Undone: radar off" on that wall; an undo is never "back to role defaults"`
- `K8 SUP-4 chip rows: idle, idle by another device, a change, a wall-wide change, a pinned wall, remote offline, not connected, hands-on`
- `K8 SUP-4: the chip fits 56 characters with the longest trip title, every host-given name, every role and layer; the time goes first, then the summary is cut; the name never is`
- `K8 CL-11 byText: a name from the actor or its ref; "another device" when unknown; never an id; V1 prefixes Voice`
- `K8 SUP-4 status strip control cell: in control, view only with since, no remote in control, not connected, and after 15 s can’t reach (Appendix D 2d)`
- `K8 Appendix D: every wall card string (1a, 6b, 6c, 6d, 7, 7a; SUP-5 pairing, lost, link used), steel words, no code on the cards that replace the scene`
- `K8 Appendix D: remote and launcher status-strip strings (1, 1c, 3) and the out-of-date text an old page shows`
- `K8 SUP-5: pairing refusals from the host: tries left before the 1-minute pause, then when the pause ends; the remote reads the end back`
- `K8 SUP-4: the last change from meta (a page opened after it): the newest field on that wall or the wall-wide ones, in words where the value says it`
- `K8 E8.1 (relay part): a LAN remote named "iPad" changes S2; from its own messages the S2 wall names the iPad in the chip, then "last change … by iPad" while the Laptop is in control`

### Notes and deferred

- **Deferred:** 1b (the remote's per-slot "S3 needs a reload") needs a presence field the relay does not send (a shape change: with K9's proto 4); 2c (host card would-refuse device count) needs a device count in health (K12); 3a on the host card (K11's host card, L8's Log header); 7b/7c forgotten cards (K11); the remote's other refusal cards (K11/L6) keep the relay's text; partial undo words (K9). "Remote offline (iPad)" names the last controller this window saw (a freshly loaded wall shows "Remote offline · since …").
- **For review:** chip times are real 24 h times of the action on the wall's computer (SUP-1), shown beside the header's sample clock; the remote's result line is now the describer's (it names the screens and pins); the replaced card's button is sized for a mouse at the wall (hands-on), not for reading from 3 m.
- **On the Mac Studio (by hand, at deploy):** reload every wall and the iPad once; change one layer from the iPad and read "by iPad" on that wall's chip (the LAN path of E8.1).

### Evidence (session scratchpad, `/private/tmp/claude-501/-Users-jessetarvambp1-Sites-Safetrekr/bee4faae-35c4-47cb-aef3-657c3e2a12f6/scratchpad/`)

- `k8/gate1.txt` (final gate), `k8/build.log`, `k8/smoke1.txt` … `k8/smoke5.txt` (5 final; 1 and 3 red: a name clash in the new harness code, then the log item's 30 s retry and the K1-S12 reload race), `k8/repro1.txt`, `k8/cap.mjs`, `k8/sat.mjs`, `k8/sat2.mjs`
- `qa-k8/runs/smoke-2026-10-24T03-41-46/` (results and shots), `qa-k8-repro/runs/repro-pairing-2026-10-24T03-17-52/`
- `k8/shots/`: walls at 2560 and 5K (chip change and idle, unpaired, replaced, slot taken, out of date, rate limited, busy, refused, lost, link used), the remote at iPad size (view only, in control with the active-station card, Screens & devices wrong code and pause, Log not writing, out of date), the launcher (Log not writing, normal, out of date). A host-card shot was deleted: it printed a (throwaway) setup link.

## Rebase onto shell `fac0f77`, and wall keyboard commands under the CF contract (proto → 4)

- **Date:** 24 Oct 2026, 23:00–00:10 CDT. **Machine:** MacBook (macOS 26.5), Node 22.21.1, headless puppeteer (SwiftShader). Load average 9–25.
- **Why:** the shell track (Jesse, paused) committed `6615570` (no dot grid over the 3D view) and `fac0f77` (D5: L / D / K open a wall's own sheets) after CF's base `b7e2576`. `fac0f77` added a page → relay message `screen-cmd` in CF-owned files (`syncRelay.js`, `twinSessionHost.js`), written against pre-CF code: raw `by: 'screen'` and `by: 'S<n>'`, a free-text `label` in the broadcast, no audit line, no rate limit, no refusal codes.
- **Rebase:** `git rebase fac0f77` of `deb0751` … `ecd4e2c`; shell commits untouched. Conflicts were resolved by keeping both sides (the shell's sheet wiring beside K8's chip and describer; the shell's D5 relay test moved with K1's test file to `twinRelay.test.mjs`). The shell's "Set at this screen" wall text gave way to K8's chip, which now names the wall ("by S6 keyboard"). The calm unpaired card keeps its dot-grid field only while 3D is paused; the live 3D view has no grid, as `6615570` wants. The rebase itself was done by a builder that then stopped (account usage limit); the integration below was done by the coordinator.
- **Integration (new commit on top):**
  - `twinProtocol.js`: `screen-cmd` joins `MSG_TYPES`; `VIA.KEYBOARD = 'keyboard'`; **`PROTO = PROTO_MIN = 4`**. The CMD state a wall causes has `by` = the wall's actor, whose `slot` is a number (a remote's is null): the schema hash changed (`by.slot`: null → null|number), so the rule (S-15) bumps. Nothing from CF is deployed yet, so this costs no extra reload. **Later numbers shift by one: K9 → 5, K10 → 6, K11 → 7** (PHASE-CF-PLAN §6.4 still says 4/5/6).
  - `twinSessionHost.js` `screenCommand`: the shell's allowlist is kept as written; attribution is the wall's ref (`refOfId`), never `S<n>`; refusals carry `VALIDATION_COMMAND` (or `UNKNOWN_COMMAND`) and write `cmd.refused`; an applied change writes `cmd.applied` (actor via `keyboard`, diffs as for a remote). No Undo entry and no lease, as the shell designed it.
  - `syncRelay.js`: `screen-cmd` goes through the per-device command limit (`RATE_LIMITED` + `retryAfterMs`, `limit.hit device-cmd`), then broadcasts `{cause: 'cmd', changed, skipped, by: actor}`. The page's `label` is never read or sent on: every page words the change with the describer.
  - `auditLog.js`: actor `via` may be `keyboard`. `twinDescribe.js` `byText`: a screen actor reads "S6 keyboard". Remote: the shell's notice keeps its words, with the describer's text: "S6 · scale grid on · set at the screen".
- **Tests:** the shell's D5 relay test adapted to the actor shape (and refusal codes); new: limit and no-claimed-actor (relay), cmd.applied / cmd.refused via keyboard with a planted label kept out of the folder (audit), byText for screens, "S6 keyboard" in the 56-character chip test, `screen-cmd` in the golden transcript (schema row 4). Baseline **298**.
- **Smoke:** new step **D5-S1**: the S6 page presses L, turns the grid on in its own sheet; the remote hears a CMD state by S6 via keyboard (no label, no raw id); the chip reads "S6 · Scale grid on · by S6 keyboard · HH:MM · hands-on". K7-S6 (5K thumbnails) missed its 30 s wait once in four runs under load and now waits 60 s (it checks format, size and spacing, not speed).

### Gate

| Check | Result |
|---|---|
| `node scripts/test-trip-twin.mjs` | **PASS**: 298/298; `npm test` exit 0, 3304 tests, 1 skip (Windows-only); canary, L5 scan and migration, Math.random and the shared-file guard clean. |
| Twin build | **PASS** (`rebase-fac0f77/twin-dist`). |
| Smoke `--ref worktree` | **PASS** (`smoke4.txt`): 46 pass, 0 fail, 0 TODO, 0 pageerror (console.error: FIRMS 503 and SwiftShader WebGL only). Earlier runs: D5-S1 regex first missed the chip's "hands-on" ending; K7-S6 once (above). |
| `repro-pairing --wait-expiry` | **PASS**: 12/12 GREEN incl. the live R-H4 wait (`qa-repro/runs/repro-pairing-2026-10-24T04-58-12`); 0 pageerror. |

### For K9 and K10 (what the wall's keyboard path must meet)

- **K9 (revision-checked undo):** a wall can now change a field the remote's open Undo would restore (e.g. the remote turns radar on S4, then S4's sheet turns it off). The rev check must skip that field and say so; the wall's own change has no Undo entry.
- **K10 (server confirm):** `screen-cmd` touches only a wall's own layers, motion, scale and text size: all Tier A (no confirm). Keep it so: anything that would need a confirm stays off this path. A wall changes state **without the lease**, by design (D5): "In control" on the remote means control of every wall-wide and cross-wall change, not of each wall's own display.
- **Visitor mode** hides names; the wall sheets change no names, but K10/K13 should check the sheet shows nothing a visitor should not see.
