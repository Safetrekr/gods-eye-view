// Advance mode (phase 3 Part B): before the trip, per site, no traveler
// positions. Answers "is this place and plan sound?": distances and times
// from the hotel, nearest emergency services, rally point status, floor
// numbering status, forecast and official alerts at the event time, light
// at the event time, and a checklist with who checked what and when.
import { bearingLabel, formatDistance, haversineM } from './twinData.js';
import { conditionText, fahrenheit, rainBand } from './twinWeather.js';
import { walkMinutes } from './twinPaths.js';

// --- time ------------------------------------------------------------------------

/** Offset (ms) of a time zone at an instant: local wall clock − UTC. */
function tzOffsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return wall - instant;
}

/** "2026-10-17" + "19:00" in a time zone → epoch ms. */
export function zonedToEpoch(date, time, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffsetMs(guess, timeZone);
  return guess - tzOffsetMs(first, timeZone);
}

export function localClock(epoch, timeZone) {
  return new Date(epoch).toLocaleTimeString('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Sunrise / sunset (NOAA simplified, ±2 min) for a date at a place → epoch ms.
 * Returns {rise, set} (null in polar day/night).
 */
export function sunTimes(date, lat, lon) {
  const [y, m, d] = date.split('-').map(Number);
  const n = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const rad = Math.PI / 180;
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqt =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const cosH =
    (Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) /
    (Math.cos(lat * rad) * Math.cos(decl));
  if (cosH < -1 || cosH > 1) return { rise: null, set: null };
  const ha = Math.acos(cosH) / rad;
  const noon = 720 - 4 * lon - eqt; // minutes UTC
  const day0 = Date.UTC(y, m - 1, d);
  return {
    rise: day0 + (noon - 4 * ha) * 60000,
    set: day0 + (noon + 4 * ha) * 60000,
  };
}

export function lightAt(epoch, place, date) {
  const { rise, set } = sunTimes(date, place.lat, place.lon);
  if (!rise) return { dark: null, text: 'Daylight unknown' };
  const dark = epoch < rise || epoch > set;
  return { dark, rise, set };
}

// --- events ------------------------------------------------------------------------

/**
 * Trip events for the scrubber: arrival at the hotel (Day 1) plus each
 * itinerary stop, in time order. sites: sitesForCity(); snapshot: trip data.
 */
export function tripEvents(snapshot, sites, timeZone) {
  const hotel = sites[0];
  const start = snapshot.trips?.[0]?.start_date;
  const events = [
    {
      key: 'arrival',
      siteKey: hotel.key,
      day: 1,
      date: start,
      start: '15:00',
      end: null,
      title: `Arrive · ${hotel.short}`,
    },
  ];
  for (const ev of snapshot.itinerary || []) {
    const place = snapshot.places?.find((p) => p.id === ev.place_id);
    const site = sites.find((s) => s.key === place?.site_key);
    if (!site) continue;
    events.push({
      key: ev.id,
      siteKey: site.key,
      day: site.day,
      date: ev.event_date,
      start: ev.start_time,
      end: ev.end_time,
      title: ev.title,
    });
  }
  for (const e of events)
    e.epoch = e.date ? zonedToEpoch(e.date, e.start, timeZone) : null;
  return events.sort((a, b) => (a.epoch ?? 0) - (b.epoch ?? 0));
}

// --- brief -----------------------------------------------------------------------

const NEAREST = [
  ['hospital', 'Hospital', (p) => p.emergency === 'yes'],
  ['police', 'Police'],
  ['fire_station', 'Fire station'],
];

/**
 * Forecast over an event window [start, end]: temperature at the start, the
 * coldest / warmest feel, thunder anywhere, the wettest hour (G9).
 */
export function forecastWindow(metJson, startEpoch, endEpoch) {
  const first = forecastAt(metJson, startEpoch);
  if (!first) return null;
  const steps = (metJson?.properties?.timeseries || []).filter((s) => {
    const t = Date.parse(s.time);
    return t >= startEpoch - 30 * 60000 && t <= (endEpoch || startEpoch);
  });
  let thunder = first.thunder;
  let wettest =
    first.hours === 1 ? first.precipMm || 0 : (first.precipMm || 0) / 6;
  let feelMin = first.apparentC;
  let feelMax = first.apparentC;
  for (const s of steps) {
    const d = s.data.instant.details;
    const n1 = s.data.next_1_hours;
    if (/thunder/.test(n1?.summary?.symbol_code || '')) thunder = true;
    wettest = Math.max(wettest, n1?.details?.precipitation_amount ?? 0);
    const a = d.apparent_air_temperature ?? d.air_temperature;
    feelMin = Math.min(feelMin, a);
    feelMax = Math.max(feelMax, a);
  }
  return {
    ...first,
    thunder,
    wettestMmH: wettest,
    feelMin,
    feelMax,
    covers: steps.length,
  };
}

/** The forecast step covering an instant from a MET Norway response. */
export function forecastAt(metJson, epoch) {
  const steps = metJson?.properties?.timeseries || [];
  let best = null;
  for (const s of steps) {
    const t = Date.parse(s.time);
    if (t <= epoch + 30 * 60000) best = s;
    else break;
  }
  if (!best || Math.abs(Date.parse(best.time) - epoch) > 6 * 3600000)
    return null;
  const d = best.data.instant.details;
  const next = best.data.next_1_hours || best.data.next_6_hours;
  return {
    time: best.time,
    tempC: d.air_temperature,
    apparentC: d.apparent_air_temperature ?? d.air_temperature,
    windMs: d.wind_speed ?? null,
    symbol: next?.summary?.symbol_code || null,
    condition: conditionText(next?.summary?.symbol_code),
    precipMm: next?.details?.precipitation_amount ?? null,
    hours: best.data.next_1_hours ? 1 : 6,
    thunder: /thunder/.test(next?.summary?.symbol_code || ''),
  };
}

/**
 * Everything the site brief shows, as data. ctx = {site, hotel, event,
 * snapshot, pois, metJson, alerts, numbering:{mapped, operator}, useF,
 * route: {walk, drive} | null, timeZone}.
 */
export function siteBrief(ctx) {
  const { site, hotel, event, snapshot, pois = [], metJson, alerts = [] } = ctx;
  const here = {
    lat: (site.anchors?.inside || site.center).lat,
    lon: (site.anchors?.inside || site.center).lon,
  };
  const hotelPt = {
    lat: (hotel.anchors?.inside || hotel.center).lat,
    lon: (hotel.anchors?.inside || hotel.center).lon,
  };
  const items = [];
  const place = snapshot.places?.find((p) => p.site_key === site.key);
  // Distance from the hotel.
  if (site.key !== hotel.key) {
    const d = haversineM(hotelPt, here);
    const w = walkMinutes(d * 1.3);
    items.push({
      key: 'from_hotel',
      label: 'From the hotel',
      text: ctx.route
        ? ctx.route
        : site.role === 'arrival'
          ? // An airport is a coach transfer, never a walk (Heathrow T5).
            `${formatDistance(d)} ${bearingLabel(hotelPt, here)} straight line · group transfer by coach · road route not checked`
          : `${formatDistance(d)} ${bearingLabel(hotelPt, here)} straight line · about ${w[0]}–${w[1]} min walk (estimate ×1.3 for streets) · street path not checked`,
      ok: Boolean(ctx.routeChecked),
    });
  }
  // Nearest emergency services (recorded OpenStreetMap places).
  for (const [kind, label, pref] of NEAREST) {
    const list = pois
      .filter((p) => p.kind === kind)
      .map((p) => ({ ...p, d: haversineM(here, p) }))
      .sort((a, b) => a.d - b.d);
    const best = (pref && list.find(pref)) || list[0];
    items.push({
      key: kind,
      label: `Nearest ${label.toLowerCase()}`,
      text: best
        ? `${best.name || label} · ${formatDistance(best.d)} ${bearingLabel(here, best)} straight line${kind === 'hospital' ? (best.emergency === 'yes' ? ' · emergency department listed in OpenStreetMap' : ' · emergency department not confirmed') : ''} · not verified`
        : `None found within the recorded area — check before the trip`,
      ok: Boolean(best),
    });
  }
  // Rally point.
  const rally = (snapshot.safety_points || []).find(
    (p) => p.location_id === place?.id && p.category === 'rally_primary',
  );
  items.push({
    key: 'rally',
    label: 'Rally point',
    text: !rally
      ? 'Not set'
      : `${rally.name.replace(/^Rally point \(primary\) · /, '')} · ${rally.approval_status === 'active' ? 'approved' : 'draft · not approved'}`,
    ok: rally?.approval_status === 'active',
    warn: !rally || rally.approval_status !== 'active',
  });
  // Floor numbering.
  const n = ctx.numbering || {};
  items.push({
    key: 'numbering',
    label: 'Floor numbering',
    text: n.mapped
      ? `Mapped · ${site.levels} floors · ground floor = ${site.groundFloorLabel}`
      : n.operator
        ? `Operator entry · ground floor = ${n.operator.groundLabel}${Number.isInteger(n.operator.topFloor) ? ` · top floor ${n.operator.topFloor}` : ''} · not verified`
        : 'Not mapped · answer the numbering question on the site card',
    ok: Boolean(n.mapped || n.operator),
    warn: !n.mapped && !n.operator,
  });
  // Light at the event time.
  if (event?.epoch) {
    const light = lightAt(event.epoch, here, event.date);
    items.push({
      key: 'light',
      label: 'Light',
      text:
        light.dark === null
          ? 'Daylight unknown'
          : (() => {
              const endEpoch = event.end
                ? zonedToEpoch(event.date, event.end, ctx.timeZone)
                : null;
              const endDark = endEpoch ? endEpoch > light.set : false;
              return `${light.dark ? 'After dark' : 'Daylight'} at ${event.start} · sunset ${localClock(light.set, ctx.timeZone)}${
                event.end
                  ? endDark && !light.dark
                    ? ` · ends ${event.end}, after dark — the walk back is in the dark`
                    : endDark
                      ? ` · ends ${event.end} — the walk back is in the dark`
                      : ` · ends ${event.end} in daylight`
                  : ''
              }`;
            })(),
      ok: true,
      warn:
        Boolean(light.dark) ||
        (event.end
          ? zonedToEpoch(event.date, event.end, ctx.timeZone) > light.set
          : false),
    });
  }
  // Forecast at the event time.
  const endEpoch =
    event?.end && event?.date
      ? zonedToEpoch(event.date, event.end, ctx.timeZone)
      : null;
  const fc =
    event?.epoch && metJson && metJson !== 'error'
      ? forecastWindow(metJson, event.epoch, endEpoch)
      : null;
  const t = (c) => (ctx.useF ? `${fahrenheit(c)} °F` : `${Math.round(c)} °C`);
  items.push({
    key: 'forecast',
    label: 'Forecast',
    text: fc
      ? `${t(fc.tempC)} at the start · ${fc.condition}${fc.feelMin !== fc.feelMax ? ` · feels ${t(fc.feelMin)}–${t(fc.feelMax)} over the event` : ''}${fc.wettestMmH ? ` · up to ${fc.wettestMmH} mm/h` : ''}${fc.thunder ? ' · thunder in the forecast window' : ''} · MET Norway forecast`
      : metJson === 'error'
        ? 'Forecast unavailable right now — check again before the trip'
        : event?.epoch
          ? 'No forecast for this time yet (MET Norway covers about 9 days)'
          : 'No event time',
    ok: Boolean(fc),
    warn:
      Boolean(fc?.thunder) ||
      ['moderate', 'heavy'].includes(rainBand(fc?.wettestMmH)) ||
      metJson === 'error',
  });
  // Official alerts covering the event time.
  const covering = event?.epoch
    ? alerts.filter((a) => {
        const on = Date.parse(a.onset || a.effective || 0) || 0;
        const end = Date.parse(a.ends || a.expires || 0) || Infinity;
        return on <= event.epoch + 3 * 3600000 && end >= event.epoch;
      })
    : [];
  items.push({
    key: 'alerts',
    label: 'Official alerts',
    text:
      ctx.alertsStatus === 'unavailable'
        ? 'Official alerts unavailable right now — not checked'
        : covering.length
          ? covering.map((a) => `${a.source}: ${a.event}`).join(' · ')
          : 'None on file for this time (checked now; alerts are issued close to the time)',
    ok: ctx.alertsStatus !== 'unavailable',
    warn: covering.length > 0 || ctx.alertsStatus === 'unavailable',
  });
  return { site, event, items };
}

/** Plain text for the day's sites (copy advance brief). */
export function briefText(
  briefs,
  { trip, day, asOf, simulated = false, alertSource = 'NWS' },
) {
  const lines = [
    `DRAFT FOR REVIEW · Advance brief · ${trip} · Day ${day} · as of ${asOf}`,
    'Not an approval. Planning view: no traveler positions. Distances are straight line unless a path is named; paths are suggested and unverified.',
  ];
  for (const b of briefs) {
    lines.push(
      '',
      `${b.event?.title || b.site.label} · ${b.event?.start || ''}${b.event?.end ? `–${b.event.end}` : ''} · ${b.site.label}`,
    );
    for (const it of b.items)
      lines.push(
        `- ${it.label}: ${it.text} [${it.checked ? `reviewed by ${it.checked}` : 'not reviewed'}]`,
      );
    for (const l of b.savedLines || []) lines.push(`- Saved path: ${l.text}`);
    if (b.notes) lines.push(`- Notes: ${b.notes}`);
  }
  lines.push(
    '',
    `Sources: OpenStreetMap (ODbL), MET Norway (CC BY 4.0), ${alertSource} alerts.${simulated ? ' Includes SIMULATED weather (prototype).' : ''} Sample trip, fictional people; dates shifted to start today.`,
  );
  return lines.join('\n');
}
