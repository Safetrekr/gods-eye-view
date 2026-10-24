# Deploy to the Mac Studio (both tracks)

For every CF slice and every shell-track deploy (PHASE-CF-PLAN §6.2, CF-D10; cf/07-reasoning.md ET-10). Claude deploys over SSH only when Jesse says "deploy now" for that slice. Nothing unattended. Jesse reloads the iPad.

**Host.** `jessetms@Jesses-Mac-Studio.local` (192.168.1.3). Checkout `~/Sites/Safetrekr/gods-eye-view`. Server: `npx vite --config vite.twin.config.js --host 0.0.0.0 --port 4173`, log `~/Library/Logs/trip-twin-dev.log`. It stops on reboot.

**Store (from K2).** `~/Library/Application Support/SafeTrekr/trip-twin/` (folder 0700, files 0600), or `TRIP_TWIN_DATA_DIR` if set. Files: `session.json` (the wall; `v:1` with plain tokens K2–K7, **`v:2` with token hashes from L5**), `session.prev.json` (backup of the last good start), `migrated.json` (marker, no tokens; from L5 also `hashedAt` and `plainCopy`), `quarantine/` (bad files set aside), and after the first L5 start `session.v1.json` (the plain pre-migration copy, kept until the L5 revert drill passes, then dropped by hand). K2–K7 also wrote the old copy at `$TMPDIR/trip-twin-soc-session.json`; **L5 stops that and deletes the file at every start** (a revert below L5 is a re-pair anyway, once the plain copy is dropped). `node scripts/trip-twin-store.mjs scan` lists any file at rest that still holds a plain token (names only). Store lines in the log start with `[trip-twin] store.`.

## Before

1. **Is a session live?** A report open, or a remote holding the lease, or a demo within 48 hours. If yes, **stop here** (CF-D10).
2. Note the commit now running: `git -C ~/Sites/Safetrekr/gods-eye-view rev-parse --short HEAD`.
3. **Copy the store** to one fixed place (one copy only; before L5 it holds plain tokens, from L5 token hashes):
   ```sh
   D="$HOME/Library/Application Support/SafeTrekr/trip-twin"
   mkdir -p -m 700 "$D"
   # From K2 on:
   cp -p "$D/session.json" "$D/deploy-copy.json" 2>/dev/null
   # Before K2 (first K2 deploy): the store is the tmp file. Use the same kind
   # of shell that starts Vite: $TMPDIR differs between a GUI Terminal and SSH.
   cp -p "$(node -p 'require("os").tmpdir()')/trip-twin-soc-session.json" "$D/deploy-copy.json" 2>/dev/null
   chmod 600 "$D/deploy-copy.json"
   ```
4. **First K2 deploy only:** check the copy migrates and its walls rejoin before you restart. After `git pull` (step 5), and without starting anything:
   ```sh
   TRIP_TWIN_STORE_FIXTURE="$D/deploy-copy.json" node --test src/operations/tripTwin/twinStore.test.mjs
   ```
   It must end `# fail 0`. The test prints no token. If it fails, do not restart: stay on the old commit.
4b. **First L5 deploy only:** the same check for the hashing migration, on the copy of the `v:1` store:
   ```sh
   TRIP_TWIN_V1_FIXTURE="$D/deploy-copy.json" node --test src/operations/tripTwin/twinTokens.test.mjs
   ```
   It must end `# fail 0` (the copy migrates once to `v:2` and every wall and the remote rejoin with the token it holds). It prints no token.

## Deploy

5. `git -C ~/Sites/Safetrekr/gods-eye-view pull` (the branch for this slice).
6. Restart Vite, **from the same kind of shell as before** (so `$TMPDIR` is the same and the first K2 start finds the old store):
   ```sh
   lsof -ti tcp:4173 -sTCP:LISTEN | xargs kill
   cd ~/Sites/Safetrekr/gods-eye-view
   nohup npx vite --config vite.twin.config.js --host 0.0.0.0 --port 4173 >> ~/Library/Logs/trip-twin-dev.log 2>&1 &
   ```
7. Read the store lines: `grep '\[trip-twin\] store\.' ~/Library/Logs/trip-twin-dev.log | tail -5`. Expect `store.loaded` (or, on the first K2 start, `store.migrated` with the six slots; on the first L5 start, `store.hashed` with the number of tokens hashed, `store.tmp_removed` and then `store.plain_copy_kept` at every start until the copy is dropped). `store.quarantined`, `store.reset`, `store.dir_refused` or `store.memory_only` mean stop and go to "If it fails".
8. **Reload every wall and the iPad** (always after a protocol bump; S-15).

## Check (all must pass)

9. Six walls in the right slots, each with a live link.
10. The iPad is in control.
11. One command and one undo.
12. One confirmed command (All › Advance).
13. Routing health is up (from L1, `/api/twin-routing/health`; until then, draw one rally path). The K6 health below does not cover routing.
14. The log is writing (from K6). On the Mac Studio itself (health answers this computer only: `localhost`, never the LAN name or IP): `curl -s http://localhost:4173/api/twin-sync/health` shows `"audit":{"ok":true,…}` with a `seq` that grows after the command in step 11, `"store":{"ok":true,…}` and `"confirmBypass":0`. Today's file is `~/Library/Logs/trip-twin/audit-YYYY-MM-DD.jsonl` (UTC day, 0600). `"ok":false` with `lastError` (`ENOSPC`, `EACCES`) means the log is not writing: the wall keeps working (fail open, CF-D9); free space or fix the folder's owner and mode, and within 30 s it writes again, with a `log.gap` line. Before K6: `tail ~/Library/Logs/trip-twin-dev.log`.
15. Host-check mode is the one intended (from K3: `report`; from K12: `enforce` unless break-glass). The boot line `[trip-twin] hosts.check` in the dev log names the mode and the would-refuse file; `curl -s http://localhost:4173/api/twin-sync/info` shows `hostCheck` and `hostAllowed: true`. Then `wc -l ~/Library/Logs/trip-twin/would-refuse.jsonl`: lines from the walls or the iPad mean a name is missing from the list (K12 would refuse them; [break-glass.md](break-glass.md) step 1).
16. Restart once more (step 6) and check that everything rejoins without a pair code.
17. Delete the deploy copy once all of this passes: `rm -f "$D/deploy-copy.json"`. **L5 deploy:** first the L5 revert drill (per-slice notes, L5 row), then this, then `node scripts/trip-twin-store.mjs drop-plain-copy`.

## If it fails

1. `git checkout <the commit noted in step 2>`, restart (step 6).
2. Restore the copy:
   - reverting to a commit **from K2 on**: `cp -p "$D/deploy-copy.json" "$D/session.json"`;
   - reverting from L5 to a commit **below L5** (K2–K7): `cp -p "$D/session.v1.json" "$D/session.json"` while the plain copy is still there (it is the wall as it was just before hashing; the deploy copy works too). After `drop-plain-copy` there is no plain store left: the revert means a re-pair ([re-pair.md](re-pair.md));
   - reverting to a commit **before K2**: from K2 to K7 nothing to do (the K2 dual write keeps the tmp copy current). From L5 there is no tmp copy: `cp -p "$D/session.v1.json" "$(node -p 'require("os").tmpdir()')/trip-twin-soc-session.json"` while the plain copy is there (or the deploy copy of a `v:1` store), else re-pair.
   Then restart again.
3. **Forget again** every device forgotten since the copy was taken (Forget lands in K11): the copy brings them back.
4. Rolling forward again after a revert below K2: the K2 store is loaded, not the tmp file (no fallback read). A device paired while the old code ran must be re-paired ([re-pair.md](re-pair.md)).
5. Walls locked out: [re-pair.md](re-pair.md); last resort: [break-glass.md](break-glass.md).

## Per-slice notes

| Slice | Rollback | Store effect |
|---|---|---|
| K2 | revert + restart (the tmp copy is current) | moves to the data folder; old tmp file kept and written until L5 (L5 took the retirement over from K11) |
| K4 | revert + restart; every page reloads and rejoins on the old keys | none on the server. In the browsers: wall slot records `tripTwin.soc.slot.<N>` and the remote record `tripTwin.soc.remote` (localStorage) are added; the old keys (the sessionStorage id, localStorage `token.<id>`) are still written until the core exit, so a revert finds every pairing. After the deploy: every wall rejoins its slot after the reload; then close one wall window, wait, and open it again from the launcher: same slot, no code (M4.1). A launcher opened on `127.0.0.1` or `[::1]` goes to `localhost` before Start (S-23); walls already paired on `127.0.0.1` stay there. |
| K5 (proto 2) | revert + restart; every page reloads onto the old client | additive: `session.json` gains `refs` (the ref table: `D<n>` → kind, name, slot; no ids) and `nextRef`; device records gain `ref`; `meta.by` and `lastUndo.by` hold refs. Older builds ignore the new fields (a revert loses the table: changes made before it then read "by nobody", never by the wrong device). **Proto bump: reload every wall and the iPad by hand right after the restart.** A page from before K5 is told RELOAD and joins nothing. It cannot reload itself (the guard ships with K5): Vite's client reloads open pages when the server comes back, and a page it missed keeps its last picture, so check every one. The iPad shows "This remote page is out of date · nothing was sent · Reload". From K5 on, a wall told RELOAD reloads itself at most once per 2 min. After the deploy: the S chip still names the remote; a remote opened on the Mac Studio itself is now called "Trip Twin computer" (CF-D8); two iPads read "iPad" and "iPad 2". |
| K6 | revert + restart; no page needs a reload (no proto bump) | none. New: audit files `audit-YYYY-MM-DD.jsonl` (and `.2.jsonl` past 20 MB) in `~/Library/Logs/trip-twin/` (or `TRIP_TWIN_AUDIT_DIR`), kept 30 days (`TRIP_TWIN_AUDIT_DAYS`) and 200 MB in all with `would-refuse.jsonl`, pruned at start and every 6 h. An older build leaves the files alone (K3 keeps appending `would-refuse.jsonl`); after a revert and forward again, `seq` carries on from the last line. Refs, kind names, codes and ids from closed lists only: no token, setup link, code, device id, page name, thumbnail or wall text; peer IPs on refusals only. `GET /api/twin-sync/health` and `/log` answer `localhost` on the Mac Studio only (403 from the iPad or the LAN name). Walls send hands-on and drift as fields once they have reloaded once on K6 (step 8 does that); an older wall page logs hands-on only. |
| K7 (proto 3) | revert + restart; every page reloads onto the old client; reload any wall that is waiting for a code | none to the format. New tokens are 256-bit (43 characters, base64url); tokens from before K7 stay valid, so nobody re-pairs, and an older build reads the new ones. A newly issued token is written at once (no 300 ms wait). A screen waiting for a code is no longer saved (its code lives in memory only). **Proto bump: reload every wall and the iPad by hand right after the restart** (a K5/K6 page is told RELOAD; walls reload themselves at most once per 2 min). Limits (`server/tripTwin/twinLimits.js`): 1 MiB per message; a socket that sends more than 40 a second has the rest dropped and is closed after 10 s over; 10 commands a second per device (burst 20), then "Too many changes at once"; upgrades 120 a minute from this computer, 30 from any other address; 64 sockets, 24 per address, 16 without a pairing (the oldest from another computer, then the oldest silent one, gives way); a socket that has not said a good hello within 5 s is closed; pair codes 20 in all and 6 per LAN address (this computer is exempt), re-issued and shown on the wall when one expires; a wrong slot keeps the code for 3 tries. **Wrong tokens never lock anyone out** (they are counted by address and device and logged as `limit.hit` `wrong-token`). After the deploy: `curl -s http://localhost:4173/api/twin-sync/health` shows `"proto":3`, `codes` and `counters.limits`; the six walls rejoin after one more restart without a single `limit.hit` other than `hello-deadline` from pages that were reloading. |
| K8 | revert + restart; no proto bump, but reload every wall and the iPad once so they run the new screens | none. Screen-only slice: walls name the device in the chip ("S4 · Radar on · by iPad · 21:32", then "S4 · Remote: iPad · last change 2:14 ago"); a window that is not on the wall shows one calm card and nothing else (pair code, shown in another window, out of date, rejoining paused, too many waiting); the remote's top bar says "In control · this remote (iPad)" / "View only · iPad in control since 21:20" and "Log not writing" while the audit log is down (so does the launch card); Screens is now **Screens & devices** in the remote's rail foot, and a wrong pairing code says how many tries are left before the 1-minute pause. After the deploy: change one layer on S4 from the iPad; S4's chip names the iPad for 3 s. |
| Wall keyboard, shell D5 (proto 4) | revert + restart; every page reloads onto the old client | none. A paired wall's own L / D sheet changes that wall's layers and display (`screen-cmd`); the change is attributed to the wall ("S4 · Radar on · by S4 keyboard · 21:32"), shares the 10-a-second command limit, and is logged as `cmd.applied` / `cmd.refused` with via `keyboard`. **Proto bump: reload every wall and the iPad by hand right after the restart.** After the deploy: `curl -s http://localhost:4173/api/twin-sync/health` shows `"proto":4`; press L on S4, turn a layer on; the iPad says "S4 · … · set at the screen". |
| K11 | revert + restart + restore the copy | none for the tmp copy: L5 already stopped the dual write and deletes the file at start |
| L5 | before `drop-plain-copy`: revert, `cp -p "$D/session.v1.json" "$D/session.json"`, restart; after it: revert below L5 means a re-pair ([re-pair.md](re-pair.md)) | `session.json` is rewritten in place as `v:2`: every device record holds `tokenHash` (sha256), never the token; walls and the iPad keep the tokens they hold, so **nobody re-pairs and no page needs a reload** (no proto bump). First the plain copy `session.v1.json` (0600) is written; the backup and `quarantine/` are hashed in place; the old `$TMPDIR/trip-twin-soc-session.json` is deleted (and at every later start, should an older build write it again). Health's `store` shows `"plainCopy":true` until the copy is dropped. **Revert drill (by hand, after the checks):** stop; `git checkout <the commit noted in step 2>`; `cp -p "$D/session.v1.json" "$D/session.json"`; start; six walls and the iPad rejoin with no code; stop; `git checkout <L5>`; start; the log says `store.hashed` and `store.tmp_removed`; everything rejoins again. **Then:** step 17 (`rm -f "$D/deploy-copy.json"`), then `node scripts/trip-twin-store.mjs drop-plain-copy` (run from the checkout, in the shell that starts Vite): it must say `deleted session.v1.json` and `clean: no plain token at rest`. From then on a revert below L5 is a re-pair. Never on a timer: if the drill cannot be run, the copy stays (and `store.plain_copy_kept` says so at every start) until it is. |
