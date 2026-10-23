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
