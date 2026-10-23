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
