# Deploy to the Mac Studio (both tracks)

For every CF slice and every shell-track deploy (PHASE-CF-PLAN §6.2, CF-D10; cf/07-reasoning.md ET-10). Claude deploys over SSH only when Jesse says "deploy now" for that slice. Nothing unattended. Jesse reloads the iPad.

**Host.** `jessetms@Jesses-Mac-Studio.local` (192.168.1.3). Checkout `~/Sites/Safetrekr/gods-eye-view`. Server: `npx vite --config vite.twin.config.js --host 0.0.0.0 --port 4173`, log `~/Library/Logs/trip-twin-dev.log`. It stops on reboot.

**Store (from K2).** `~/Library/Application Support/SafeTrekr/trip-twin/` (folder 0700, files 0600), or `TRIP_TWIN_DATA_DIR` if set. Files: `session.json` (the wall, `v:1`), `session.prev.json` (backup of the last good start), `migrated.json` (marker, no tokens), `quarantine/` (bad files set aside). Until K11 the relay also writes the old copy at `$TMPDIR/trip-twin-soc-session.json`, so a revert to older code still finds the wall. Store lines in the log start with `[trip-twin] store.`.

## Before

1. **Is a session live?** A report open, or a remote holding the lease, or a demo within 48 hours. If yes, **stop here** (CF-D10).
2. Note the commit now running: `git -C ~/Sites/Safetrekr/gods-eye-view rev-parse --short HEAD`.
3. **Copy the store** to one fixed place (one copy only; it holds plain tokens):
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

## Deploy

5. `git -C ~/Sites/Safetrekr/gods-eye-view pull` (the branch for this slice).
6. Restart Vite, **from the same kind of shell as before** (so `$TMPDIR` is the same and the first K2 start finds the old store):
   ```sh
   lsof -ti tcp:4173 -sTCP:LISTEN | xargs kill
   cd ~/Sites/Safetrekr/gods-eye-view
   nohup npx vite --config vite.twin.config.js --host 0.0.0.0 --port 4173 >> ~/Library/Logs/trip-twin-dev.log 2>&1 &
   ```
7. Read the store lines: `grep '\[trip-twin\] store\.' ~/Library/Logs/trip-twin-dev.log | tail -5`. Expect `store.loaded` (or, on the first K2 start, `store.migrated` with the six slots). `store.quarantined`, `store.reset`, `store.dir_refused` or `store.memory_only` mean stop and go to "If it fails".
8. **Reload every wall and the iPad** (always after a protocol bump; S-15).

## Check (all must pass)

9. Six walls in the right slots, each with a live link.
10. The iPad is in control.
11. One command and one undo.
12. One confirmed command (All › Advance).
13. Routing health is up (from K6 health; before that, draw one rally path).
14. The log is writing (from K6: health says so; before that, `tail ~/Library/Logs/trip-twin-dev.log`).
15. Host-check mode is the one intended (from K3: `report`; from K12: `enforce` unless break-glass). The boot line `[trip-twin] hosts.check` in the dev log names the mode and the would-refuse file; `curl -s http://localhost:4173/api/twin-sync/info` shows `hostCheck` and `hostAllowed: true`. Then `wc -l ~/Library/Logs/trip-twin/would-refuse.jsonl`: lines from the walls or the iPad mean a name is missing from the list (K12 would refuse them; [break-glass.md](break-glass.md) step 1).
16. Restart once more (step 6) and check that everything rejoins without a pair code.
17. Delete the deploy copy once all of this passes: `rm -f "$D/deploy-copy.json"`.

## If it fails

1. `git checkout <the commit noted in step 2>`, restart (step 6).
2. Restore the copy:
   - reverting to a commit **from K2 on**: `cp -p "$D/deploy-copy.json" "$D/session.json"`;
   - reverting to a commit **before K2**: nothing to do while the K2 dual write runs (the tmp copy is current). If it is missing, `cp -p "$D/deploy-copy.json" "$(node -p 'require("os").tmpdir()')/trip-twin-soc-session.json"`.
   Then restart again.
3. **Forget again** every device forgotten since the copy was taken (Forget lands in K11): the copy brings them back.
4. Rolling forward again after a revert below K2: the K2 store is loaded, not the tmp file (no fallback read). A device paired while the old code ran must be re-paired ([re-pair.md](re-pair.md)).
5. Walls locked out: [re-pair.md](re-pair.md); last resort: [break-glass.md](break-glass.md).

## Per-slice notes

| Slice | Rollback | Store effect |
|---|---|---|
| K2 | revert + restart (the tmp copy is current) | moves to the data folder; old tmp file kept and written until K11 |
| K4 | revert + restart; every page reloads and rejoins on the old keys | none on the server. In the browsers: wall slot records `tripTwin.soc.slot.<N>` and the remote record `tripTwin.soc.remote` (localStorage) are added; the old keys (the sessionStorage id, localStorage `token.<id>`) are still written until the core exit, so a revert finds every pairing. After the deploy: every wall rejoins its slot after the reload; then close one wall window, wait, and open it again from the launcher: same slot, no code (M4.1). A launcher opened on `127.0.0.1` or `[::1]` goes to `localhost` before Start (S-23); walls already paired on `127.0.0.1` stay there. |
| K11 | revert + restart + restore the copy | tmp copy deleted, dual write stops |
| L5 | revert below L5 means a re-pair (tokens hashed in place, `v:2`) | the plain pre-migration copy is deleted once this deploy's revert drill passes |
