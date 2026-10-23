# Break-glass: get the wall back when nothing else works

In this order; stop at the first step that works (PHASE-CF-PLAN K2, S-11, S-14; cf/01-security.md §6). Each step is weaker than the one before. Write down what you did for the phase review.

## 1. Walls stuck on "connecting": add the name first

The page was opened through a name or address the relay does not allow (a new DHCP address, the `.local` name, a venue network). From K3 the dev log says `host.would_refuse` with the Host, and the same line is in `~/Library/Logs/trip-twin/would-refuse.jsonl` (or `$TRIP_TWIN_AUDIT_DIR`). In K3 nothing is refused yet for this reason (report mode); from K12 it is.

```sh
tail -n 20 ~/Library/Logs/trip-twin/would-refuse.jsonl   # host, origin, peer, reason; never a token
```

```sh
export TRIP_TWIN_ALLOWED_HOSTS="jesses-mac-studio.local,192.168.1.3"   # the names in use; no wildcards
```

Restart (as in [deploy-mac-studio.md](deploy-mac-studio.md) step 6, in the shell where you exported it). Reload the walls.

## 2. Only then: host check `report`

```sh
export TRIP_TWIN_HOST_CHECK=report
```

Restart. `report` keeps today's same-origin rule and the tokens; it only stops the new allowlist from refusing (S-11). The status strip says "Host check relaxed" (from K12). Undo it after the demo: unset it and restart.

## 3. Forget all (from K11)

On the Mac Studio launcher: Forget all. Every device, code and setup token goes; then re-pair ([re-pair.md](re-pair.md)).

## 4. Last resort: delete every store file, restart, re-pair

Use this if Forget all is not available or not enough (an unknown device paired, a token may be captured: also follow [unknown-device.md](unknown-device.md)). Deleting only `session.json` is **not enough**: the backup and the old tmp copy hold the same tokens.

1. Stop the server: `lsof -ti tcp:4173 -sTCP:LISTEN | xargs kill`.
2. Delete **all** store files and the backup, by path. `D` is `~/Library/Application Support/SafeTrekr/trip-twin` unless `TRIP_TWIN_DATA_DIR` is set (then that folder):
   ```sh
   D="$HOME/Library/Application Support/SafeTrekr/trip-twin"
   T="$(node -p 'require("os").tmpdir()')"   # in the shell that starts Vite
   rm -f  "$D/session.json" "$D/session.json.tmp"
   rm -f  "$D/session.prev.json" "$D/session.prev.json.tmp"
   rm -f  "$D/deploy-copy.json"
   rm -rf "$D/quarantine"
   rm -f  "$T/trip-twin-soc-session.json" "$T/trip-twin-soc-session.json.tmp"
   rm -f  /tmp/trip-twin-soc-session.json /tmp/trip-twin-soc-session.json.tmp   # if Vite ever ran without $TMPDIR (SSH)
   ```
   Keep `$D/migrated.json`: it holds no token, and it stops the old tmp path from ever being read as a store again.
3. Check that no token copy is left (prints file names only):
   ```sh
   grep -rl '"token"' "$D" "$T/trip-twin-soc-session.json" /tmp/trip-twin-soc-session.json 2>/dev/null
   ```
   Expect no output.
4. Restart ([deploy-mac-studio.md](deploy-mac-studio.md) step 6). From K11 a restart also makes a new boot secret, so every old token is dead. The log says `store.fresh`.
5. Re-pair the walls and the iPad from the launcher ([re-pair.md](re-pair.md)). Clear the iPad's site data for the Mac Studio address if it still offers an old pairing.
