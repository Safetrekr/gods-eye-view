# Phase 10 review: supervision and control safety

**Verdict:** the session model, rev-ordered writes, confirm and undo, lease, and STALE/offline states are in place (shots 22, 23, 29). Two P0s let a wall show something false while looking normal.

## P0: must fix, even for a prototype

**P0-1 · The relay trusts the `id` and `kind` a device claims.**
- `syncRelay.js:67` stores `{id, kind}` even when `hello` is denied. Every later message (`cmd`, `undo`, `request-control`, `thumb`, `local`) uses that id.
- Denied sockets also receive `presence`, which includes the controller's id (`:72`).
- Reproduced with fake sockets: a client with no token reads the id, says `hello` again as `remote-ipad`, and sends `report: {floor: 30}`. The relay acks `ok: true`, and the walls would credit it to `Remote: iPad`.
- The same hole lets any LAN client:
  - receive every thumbnail;
  - forge thumbnails or "hands-on" text;
  - mark the real controller offline (`host.gone`);
  - unpair a screen (`twinSessionHost.js:152`).
- **Fix:**
  - Bind identity only after `hello` succeeds.
  - Drop every other message from unauthenticated sockets, and send them nothing.
  - Allow one socket per device id.
  - Add a relay test.

**P0-2 · Report time and age are made up for operator-entered reports.**
- `page.js:744-749` uses the current clock and `ageMin: 0`.
- Shot 31 (21:41) shows "operator entry · 21:41"; shot 33 (21:42) shows "21:42" for the same report. The banner always says "0 min ago".
- A wall that reloads stamps the report again (`twinScreen.js:188`).
- **Fix:**
  - The host stamps `report.at` and `report.by`.
  - Walls render "reported 21:12 · 30 min ago".
  - Test that the age keeps rising and survives a reload.

## P1: fix in this phase

**P1-1 · A new setup silently wipes a live wall.**
- The launcher sends `setup` on every `welcome` (`twinEntry.js:191-198`), so any reconnect re-runs setup.
- `host.setup` replaces the session without asking (`twinSessionHost.js:81-98`). That clears the incident and pins, and turns **Visitor mode off**.
- Any web page in a browser on that computer counts as "local" (`syncRelay.js:197`), because the upgrade has no `Origin` check.
- **Fix:**
  - Send setup only on a click, and make it idempotent.
  - Ask first if a session has a controller, an incident or Visitor mode on.
  - Keep Visitor mode on across a new setup.
  - Check `Origin` on the upgrade.

**P1-2 · Pins don't stop session-wide pushes.**
- A pin shields only screen fields. Session `mode` and `day` changes still reach a pinned S3.
- `reset` with target `all` ignores pins (`twinSession.js:138-149`).
- Shot 22 confirms "Every screen → Advance · Day 2" while the incident is **OPEN**, and mentions neither S3 nor the incident.
- **Fix:**
  - Pinned screens keep their own mode, or the confirm says so.
  - Reset-all skips pins.
  - Advance-to-All during an incident needs a second confirm, and S3 stays Live.

**P1-3 · Undo doesn't match the user's action.**
- `showDay` on one target sends two commands (`remote.js:170-178`):
  1. an **unconfirmed** `session.day` change, which moves every Advance wall;
  2. the role change, which is all that Undo reverts.
- Undo restores a whole-session snapshot (`twinSession.js:88`, `:212`).
- Undoing a `frame` replays an older nonce (`twinScreen.js:182`).
- **Fix:**
  - One atomic command per action.
  - Undo reverses only the fields that action wrote, checking each field's rev.
  - Label camera moves "can't be undone".

**P1-4 · An acknowledgement isn't tied to an incident.**
- `incidentAck` is a boolean, reset only when `session.report` is patched (`twinSession.js:107`).
- A later incident from the trip data (`stations.js:449`) arrives already shrunk.
- **Fix:** store `incidentAck = {key, by, at}`. Shrink the banner only when the key matches the wall's own incident.

**P1-5 · Hands-on lets one wall drift away from the session.**
- **A wall can dismiss the incident for itself.** "Dismiss report…" (`twinHud.js:672`, in `.tt-rcol`) isn't hidden on walls (`tripTwin.css:3693-3701`), and hands-on enables pointer events (`:3724`). That wall drops the banner for good; the remote never knows. Hide it.
- **Nothing marks a local view.** After 20 s the chip says "Remote: …" again while the camera and selection stay local. Show `LOCAL VIEW · since 14:02`, and add "Return to remote view" on the remote.
- **The offline warning disappears.** While hands-on, the chip loses its amber and its hands-on tag (`twinScreen.js:239-244`, `css:3731`; shot 34 vs 33).
- **Queued camera moves can wait forever.** Only `pointerup` releases them; add `pointercancel` and `blur`.

**P1-6 · Hand-over.**
- A request is auto-granted after 15 s even when the controller is online and active (`twinSessionHost.js:230-234`).
- The controller sees two bare buttons, with no requester name, no countdown and no notice afterwards (`remote.js:248-256`).
- The wall chip says only "Laptop", so a hand-over between two laptops is invisible.
- **Fix:**
  - Auto-grant only when the controller is offline or has been idle for at least 60 s.
  - Show "Laptop·4F asks for control · passes in 15 s · Keep".
  - Cancel the request if the requester leaves.

**P1-7 · A replaced screen stays on with no warning.**
- Pairing or setup clears the old device's slot without telling it (`twinSessionHost.js:122-126`, `203-207`).
- The old device keeps rendering S2 with a normal chip, but its thumbnails are dropped, so the remote can't see it.
- **Fix:**
  - The relay sends `unpaired`.
  - The old device shows "Replaced as S2 — pair again".
  - The remote gets "Move to slot / Unpair".

**P1-8 · A relay restart loses everything.**
- The host is in memory only. After a restart, screens show a pairing code and the remote is denied (its setup parameter was stripped, `remote.js:529`). The only way back is a fresh setup.
- **Fix:** save `{session, tokens}` to JSON on each rev and reload at start. Walls show "Session restored".

**P1-9 · The STALE band gives the wrong age after a restore from cache.**
- If a wall boots with the relay down, `linkAgeS` is null, so the band reads "last update [now] · 0:00 ago" (`twinScreen.js:248-253`) over cached state of unknown age.
- **Fix:**
  - Store `at` and `sessionId` with the cached state.
  - Show "CACHED · from 14:02 (3 h ago)".
  - Grey state that is old or from another session.

## P2

- **"Remote offline" timer:** it disappears within 5 s because `offlineSince` is lost on each presence message (`twinScreen.js:386`). Shot 33 shows no timer.
- **Chip wording:** "10 s ago" (shot 31) is time since the last change, not link age. Say "changed 10 s ago".
- **Confirm bar:** it never expires. Expire it after 15 s or on a rev change.
- **Two steps:** add a confirm for turning Visitor mode off and for "Clear the reported floor" (`stations.js:510`).
- **Banner timing:** each wall runs its own 15 s data timer (`page.js:4996`), so banners can appear up to 15 s apart.
- **`NEVER_ON_WALL`:** it is unused (`twinScreenRoles.js:103`). Add a DOM test in Visitor mode.

## Privacy

- Walls show first name + initial; Visitor mode shows initials (shot 31, S3).
- No medical fields exist. Full names appear on the remote only.
- **Acceptable** once P0-1 and P1-1 land.

## Security posture

**Acceptable for a prototype, with the caveats kept in the UI:**
- plain `ws`, LAN only, no sign-in;
- a 10-minute QR setup token;
- remote tokens that never expire;
- setup from localhost only.

**Must fix now:**
- P0-1;
- the `Origin` check.

**Should fix:**
- Make the setup token single-use for remotes; a second remote needs the controller's approval.
- Strip `setup=` from screen URLs after they join (`twinEntry.js:221`).

**Production:** wss, device enrolment, SSO, signed commands, an audit log, and token revoke.
