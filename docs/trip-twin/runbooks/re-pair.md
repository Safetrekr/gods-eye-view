# Re-pair walls and the iPad

When a wall shows a pair code it should not, or the iPad says "Pair this remote". Nothing here deletes files; for that see [break-glass.md](break-glass.md).

## Why a device may need a new pairing

- The store was set aside at start (`[trip-twin] store.quarantined` and `store.reset` in `~/Library/Logs/trip-twin-dev.log`). The wall starts fresh by design: a bad file is never half-loaded, and the backup is never restored by code (S-14). Restore it by hand (below) or re-pair.
- A device was paired while the Mac Studio ran older code (a revert below K2), and the newer code is back: it loads its own store, not the tmp file, so that device re-pairs.
- **An iPad unused for a week may lose its token to Safari's storage limits** and need a new code. That is Safari, not a bug.
- From L5 (hashed tokens): a revert to code below L5 means every device re-pairs.
- The device was Forgotten (from K11), or its pairing expired (from L6).

## Restore the backup by hand (store set aside at start)

Do this **before the server restarts again**: the backup is replaced by the store at every good start.

```sh
D="$HOME/Library/Application Support/SafeTrekr/trip-twin"   # or $TRIP_TWIN_DATA_DIR
lsof -ti tcp:4173 -sTCP:LISTEN | xargs kill
ls -l "$D" "$D/quarantine"
cp -p "$D/session.prev.json" "$D/session.json" && chmod 600 "$D/session.json"
cd ~/Sites/Safetrekr/gods-eye-view
nohup npx vite --config vite.twin.config.js --host 0.0.0.0 --port 4173 >> ~/Library/Logs/trip-twin-dev.log 2>&1 &
grep '\[trip-twin\] store\.' ~/Library/Logs/trip-twin-dev.log | tail -3   # expect store.loaded
```

Then reload the walls and the iPad. The backup holds the wall as it was at the last good start: Forget again any device forgotten since then. Never copy a file out of `quarantine/` back as the store; it failed the shape check. Leave it there for a look, then delete it.

## Re-pair

1. **Walls on the Mac Studio:** on the Mac Studio, open the launcher (`http://localhost:4173/twin.html`), choose Multi-view and Start. It opens S1 to S6 in their windows; each joins its slot.
2. **The iPad:** scan the QR the launcher shows. The iPad joins and takes control if no one holds it.
3. **A screen on another computer:** open the wall page there; it shows a 4-digit code. On the iPad, Screens station › Pair a screen: enter the code and the slot, then Pair.
4. Check: six walls in their slots with live links, the iPad in control, one command and one undo.

If walls stay on "connecting" (they never get a code), the problem is the host name, not the pairing: [break-glass.md](break-glass.md) step 1.
