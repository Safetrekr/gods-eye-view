# Unknown device or wiped wall

A device you do not know paired with or controlled the wall, or the wall was wiped (cf/01-security.md §6, response runbook; exit E20 tabletop). Prototype scale, mock data only.

**Severity.** SEV2 if the wall was wiped or an unknown device paired or controlled it. SEV3 if there were only refused attempts.

1. **Cut it off.** Forget all on the Mac Studio launcher (from K11). Until K11, or if the launcher is not reachable: stop the server (`lsof -ti tcp:4173 -sTCP:LISTEN | xargs kill`).
2. **Read what happened.** From K6, the audit log in `~/Library/Logs/trip-twin/` (or `TRIP_TWIN_AUDIT_DIR`): `upgrade-refused`, `setup-reuse`, `hello`, `pair`, and the peer IPs around the time. Until K6, the dev log `~/Library/Logs/trip-twin-dev.log` (store lines start `[trip-twin] store.`). Note times and IPs; never copy a token into notes.
3. **Restart with fresh tokens and re-pair.** If Forget all ran, restart (new boot secret from K11). If not, or a token may have been captured, delete every store file first: [break-glass.md](break-glass.md) step 4. Then re-pair the walls and the iPad from fresh tokens ([re-pair.md](re-pair.md)).
4. **If a token was captured, confirm it is gone** from every store file, not just `session.json`: the store, `session.prev.json`, `quarantine/`, `deploy-copy.json` and the old tmp-path copy (break-glass step 4.3 lists the paths; the check prints file names only).
5. **Write a blameless note** in the phase review: what was seen, when, what was done, what to change.

A 15-minute tabletop of this runbook runs at the CF exit (E20).
