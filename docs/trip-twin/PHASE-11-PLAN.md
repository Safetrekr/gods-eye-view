# Phase 11 plan: full UX · UI · IA · brand · motion polish

Date: 16 Oct 2026. Base: `7822a99` (phase 10). Benchmark before multi-view: tag `poc_v1_stable`.

## Goal (Jesse)
Every screen "absolute top notch": futuristic with purpose, eye candy for investors, nothing fake. Smooth animation for real-time things, modelled on podium's drawer and cards, Oblivion's UI and the Rolls-Royce shore-control film. Clean up the spaces, the walls and the remote.

## Decisions taken with Jesse (16 Oct)
- Wall motion: live + event-driven, plus a cinematic layer; every tier has its own on/off switch in settings.
- Brand: open to a broader refresh, proposed and documented before it is applied. Proposal: artifact "Trip Twin Brand Directions" (A Deep Field · B Instrument · C Carbon).
- Demo stage: both the six-wall + iPad setup and the All-in-one, equal weight.
- "AIA" = the autonomous interface agent review (factory-autonomous-interface-architect), plus IA. An AI assistant layer is welcome as a follow-on phase.

## Inputs
- `review/phase11/00-AUDIT.md` and `before/` (real monitor sizes).
- `05-motion-language.md` (principles P1–P7, tokens, calm budget, reduced motion) — the three tiers are a switchable layer on top of it; its hard rules (no overshoot, data snaps, operator owns the camera, pulse budget, vestibular caps) stay.
- podium `serras-portal/index.html`: fog-in/out (`cubic-bezier(.33,0,.18,1)` / `(.45,.05,.6,1)`), press-down `(.16,1,.3,1)`, rail wavefront stagger, cross-blur stage swap, backdrop blur 16 px, 4.6 s breath, reduced-motion fallbacks.
- Oblivion (GMUNK): a dot grid that everything hangs on, thin details, a unified bright palette, "familiar but a bit alien"; usability critique: equal-weight sections hide the primary workflow; subtle state changes need training; red used for two meanings confuses.
- Rolls-Royce film frames (`reference/`): subject isolated and surroundings dimmed, monochrome translucent glass, grid ground plane, ring hotspots, calm dark room, tablets dark.

## Work packages
### P11-A Motion system (brand-independent, starts now)
- `twinMotion.js`: one controller; tiers `live`, `event`, `cine`; `reduced` from the system or the setting; `body` classes `tt-m-live`, `tt-m-event`, `tt-m-cine`; a `motion(tier)` guard for JS-driven animation (Cesium flights, sweeps, echoes).
- Settings: per screen fields `motion: {live, event, cine}` in `SCREEN_FIELDS` (remote 06 Layers → "Motion" group, per target or All), and three checkboxes in Display on the All-in-one replacing the single "Reduce motion" (which stays as the override).
- Live tier: live dot breath (4.6 s), snapshot sweep, fix ages ticking, LIVE badge breathing once per snapshot.
- Event tier: number swap with highlight and delta, hollow echo at the old fix, band fog-in, roster row enter/leave, chip grow on change.
- Cinematic tier: panel fog-in on open, rail wavefront on the remote, selection reticle, entry scan front, S1 idle drift after 60 s hands-off and no incident (Jesse to confirm), identify pulse.
- Tests: tier gating is pure (`motionClasses(state, reduced)`), reduced wins, per-screen fields round-trip through the reducer.

### P11-B Wall content and composition (brand-independent, starts now)
- W1 S1: tighter default framing on the site; stray pin labelled or hidden; chips row docked.
- W2 S2: people pins and accuracy rings at neighbourhood scale by default; headcounts as the largest numerals; a right column "who needs a check".
- W3 S3: no floors ladder when S1 shows it; idle state = Needs attention + "Changed in the last 10 min" + next schedule items; open state = the board.
- W4 S4: official / sensed / now bands with sources and ages at wall size; radar and lightning on by default; timeline at 20 px with the forecast horizon marked.
- W5 S5: schedule timeline with sunset arc; saved and suggested paths drawn on the map; checks column.
- W6 S6: a board of tiles filling the wall: local clock, phase, counts, next item, official alerts; the focus trip outlined; sorted by need.
- W7/W8: wall type scale per the artifact table.

### P11-C Remote (structure now, skin after the brand decision)
- Rail: station tiles always sit at the thumb; the context list fills the middle; when empty, the well shows the target's summary.
- Preview: larger, with the wall's role and badge drawn over it; snapshots at the real aspect.
- Station switch: fog-out/in with the wavefront; confirm bar enters from its slot; press-down on every control.
- Kickers to 11 px, tile labels to 11 px, status rows two lines.

### P11-D Entry and launch
- Chooser as a session start: wordmark, two choices as instruments, one line of guidance.
- Launch: three steps as three cards with one job each; the LAN warning as a quiet line unless the network is actually missing.

### P11-E Brand application (after Jesse's decision)
- Tokens in `tripTwin.css` and `remote.css`; display face loaded from Google Fonts; dot grid or rule texture on walls; glass panels; numerals.
- `docs/trip-twin/06-layer-taxonomy.md` §19 "Visual system" records the final tokens.

### P11-F Reviews
- The four design agents (UX, UI, supervision, IA) at 2560×1440, 1728×1117, 1180×820, 1440×900.
- Plus: motion designer (world-class-motion-designer) and the autonomous interface agent (factory-autonomous-interface-architect) on the remote's delegation, reversibility and supervision surfaces.
- Fix list → implement → after-shots → Status → commit and push.

### Follow-on (not this phase)
- AI assistant layer: a short situation summary on the remote and the incident wall from the sample data only.
- 03 Weather station; "who may be at or above" on the remote; wss and single-use tokens.

## Verification
- 132+ Trip Twin unit tests pass; new motion and settings tests.
- Capture harness `review/phase11/capture.mjs` (from the audit) rerun for after-shots; zero console errors.
- Calm budget check on each wall at rest with all tiers on: ≤ 1 continuous mover, ≤ 3 pulsing, camera 0 (05 §4.4), measured over 15 s.
