# Demo day

The morning of a demo, on the Mac Studio, before anyone is in the room (PHASE-CF-PLAN §6.2; ET S10). No deploy within 48 hours of a demo (CF-D10). The launcher will show these as one pre-flight line once K6 and K11 land; until then, check by hand.

1. **Reload every page**: the six walls and the iPad.
2. **Routing health up** (health from K6; before that, draw one rally path on the iPad and see the minutes).
3. **The log is writing** (health from K6; before that, `tail ~/Library/Logs/trip-twin-dev.log` shows today's lines). Store lines should read `store.loaded`, never `store.saved_error`: `grep '\[trip-twin\] store\.' ~/Library/Logs/trip-twin-dev.log | tail -3`.
4. **Host-check mode `enforce`** (from K12). `report` is break-glass only ([break-glass.md](break-glass.md)).
5. **iPad pairing not near its limit**. If the iPad warns, press Renew (from L6). An iPad unused for a week may need a new code ([re-pair.md](re-pair.md)).
6. **The iPad is on the expected network name or IP** (the one in the launcher's QR).
7. **At a venue network:** `TRIP_TWIN_ALLOWED_HOSTS` set to the name or address the iPad uses (no wildcards), then restart; check that the iPad connects.
8. **Rehearse the E15 script with the presenter**: target → action → confirm → undo; Cancel; the 15 s timeout; a partial undo after a handover; an undo of Visitor that asks.
9. Every wall in its slot with a live link, the iPad in control, one command and one undo. If anything fails and there is no time, [re-pair.md](re-pair.md) first; [break-glass.md](break-glass.md) only if re-pairing does not work.
