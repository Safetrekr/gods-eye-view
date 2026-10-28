// SafeTrekr Executive (EP-50 B1): builds the engine's one fixture file,
// products/executive/data/day.json, from the six reviewed data files in
// plans/trip-twin/executive/data/ (roster, intel, regional, mentions,
// movement, loop). No writes here: the CLI writes, --check compares.
//
// What it does (EP-35 §§2, 5; EP-41):
// - normalises the three intake files' differing field names into one
//   IntelBundle shape, keeping only what the engine and the screens read;
//   a bundle's later members become `history` patches, so the timeline can
//   replay a bundle growing (the march: C3 → C2, P3 → P2);
// - strips the intake authors' own match results out of the bundles (the
//   engine computes them) and keeps them under `expected` for the tests;
// - carries loop.json's scripted events, the two morning situations'
//   decisions from intel.json, the VALE decisions in mentions.json that
//   loop.json does not mirror, and movement.json's routine check-ins;
// - asserts the EP-41 ledger and that every id resolves, and throws on any
//   breach, so a bad input never reaches day.json.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DAY_OUT =
  'src/operations/tripTwin/products/executive/data/day.json';
export const GOLDEN_OUT =
  'src/operations/tripTwin/products/executive/loop/replay.golden.json';
export const SOURCE_FILES = Object.freeze([
  'roster.json',
  'intel.json',
  'regional.json',
  'mentions.json',
  'movement.json',
  'loop.json',
]);
const DEMO_DATE = '2026-10-27';
const T0 = '2026-10-27T00:00:00Z';

/** The roster's cities by place (the intake generators' own table). */
const CITY_PLACES = {
  Austin: [
    'pl-fairmont-austin',
    'pl-long-center',
    'pl-halden-site-east',
    'pl-aus',
    'pl-halden-fo-austin',
    'pl-halden-hq-austin',
    'pl-westlake-hills',
    'pl-austin',
  ],
  London: [
    'pl-park-plaza-waterloo',
    'pl-royal-festival-hall',
    'pl-halden-london',
    'pl-marylebone',
    'pl-london',
  ],
  Farnborough: ['pl-fab', 'pl-aviator-farnborough'],
  'Washington DC': [
    'pl-kennedy-center',
    'pl-dupont-area',
    'pl-foggy-bottom-campus',
    'pl-halden-dc',
    'pl-westin-dulles',
    'pl-iad-ga',
    'pl-iad',
    'pl-dc',
  ],
  'New York': ['pl-halden-ny', 'pl-uws', 'pl-new-york', 'pl-jfk'],
  Miami: [
    'pl-four-seasons-miami',
    'pl-brickell',
    'pl-coconut-grove',
    'pl-miami',
  ],
  Zurich: ['pl-halden-zurich', 'pl-seefeld', 'pl-zurich', 'pl-zrh'],
  Dubai: [
    'pl-halden-dubai',
    'pl-dubai-marina',
    'pl-dubai',
    'pl-dxb',
    'pl-jumeirah-emirates-towers',
  ],
};
const CITY_OF = Object.fromEntries(
  Object.entries(CITY_PLACES).flatMap(([c, ids]) => ids.map((id) => [id, c])),
);
/** Region names in regional.json that hold roster cities. */
const REGION_CITIES = { Texas: ['Austin'] };

/** Authoring fields that no engine or screen reads. */
const DROP = new Set([
  'dtg',
  'local',
  'sample_chip',
  'counter_after',
  'mirror_of',
  'rule',
  'supersedes_mv',
  'satisfies_mv',
  'movement_ref',
  'then',
  'sharing_rule',
  'consent_ref',
  'per',
  'at_dtg',
  'issued_dtg',
  'valid_until_dtg',
  'raised_dtg',
  'closed_dtg',
  'actor',
]);
/** EP-35 §1: `by` is VALE, ORTEGA, a participant id or generator. */
const BY = { 'w-vale': 'VALE', 'w-ortega': 'ORTEGA', system: 'generator' };
const byOf = (v) => BY[v] || v;
const KEEP_NOTE = new Set([
  'verification.decide',
  'intel.watch',
  'intel.dismiss',
  'message.send',
]);

const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** ISO UTC, seconds kept, no milliseconds. */
export const isoZ = (v) =>
  new Date(typeof v === 'number' ? v : Date.parse(v))
    .toISOString()
    .replace('.000Z', 'Z');
const ms = (v) => Date.parse(v);
/** "1337Z" on the demo day (watch times in intel.json situations). */
const zOn = (hhmmz, date = DEMO_DATE) =>
  isoZ(`${date}T${hhmmz.slice(0, 2)}:${hhmmz.slice(2, 4)}:00Z`);
const addS = (iso, s) => isoZ(ms(iso) + s * 1000);

/** Every ISO-with-offset string becomes ISO UTC; display strings stay. */
function zDeep(v) {
  if (typeof v === 'string') return ISO.test(v) ? isoZ(v) : v;
  if (Array.isArray(v)) return v.map(zDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = zDeep(x);
    return out;
  }
  return v;
}
const compact = (o) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const strip = (reason) =>
  typeof reason === 'string' ? reason.replace(/^not raised: /, '') : null;
const sha = (text) => createHash('sha256').update(text).digest('hex');

function placeRef(p) {
  if (!p) return null;
  return compact({
    place_id: p.place_id,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    precision: p.precision,
    accuracy_m: p.accuracy_m,
    mgrs: p.mgrs ?? null,
    entrances: p.entrances,
  });
}

// ------------------------------------------------------------------ roster

function rosterPart(R) {
  const places = {};
  for (const [id, p] of Object.entries(R.places))
    places[id] = { sample: true, ...placeRef(p), city: CITY_OF[id] || null };
  const detailOf = {};
  const details = {};
  for (const p of R.people)
    if (p.detail?.leader) {
      const id = `d-${p.callsign.toLowerCase()}`;
      details[id] = {
        id,
        sample: true,
        principal: p.id,
        leader: p.detail.leader,
        agents: p.detail.agents,
        advance_agent: p.detail.advance_agent,
        vehicles: p.detail.vehicles,
        comms_check: zDeep(p.detail.comms_check),
      };
      detailOf[p.id] = id;
      detailOf[p.detail.leader] = id;
      for (const a of p.detail.agents) detailOf[a] = id;
    }
  // The spouse shares the principal's detail (roster: detail.shares).
  for (const p of R.people)
    if (p.detail?.shares && detailOf[p.detail.shares]) {
      detailOf[p.id] = detailOf[p.detail.shares];
      details[detailOf[p.id]].also_covers = p.id;
    }
  const people = {};
  for (const p of R.people) {
    people[p.id] = compact({
      id: p.id,
      sample: true,
      callsign: p.callsign,
      name: p.name,
      initials: p.initials,
      role: p.role,
      title: p.title,
      group: p.group,
      protection: p.protection,
      tier: p.tier,
      posture: p.posture,
      current_city: p.current_city,
      tz: p.current_tz,
      travelling: p.travelling,
      detail_id: detailOf[p.id] || null,
      position_source: p.position_source,
      sharing: p.location_sharing,
      checkin_every_min: p.check_in?.interval_min ?? null,
      checkin_points: p.check_in?.points,
      checkin_overdue_after_min: p.check_in?.overdue_after_min ?? null,
      consent: p.consent
        ? {
            re_tier_sharing: p.consent.re_tier_sharing,
            can_pause: p.consent.can_pause,
            scope: p.consent.scope,
          }
        : undefined,
      escalation: (p.escalation_chain || []).map((s) =>
        compact({
          step: s.order,
          role: s.role,
          participant_id: s.ref === 'self' ? p.id : (s.ref ?? null),
          wait_min: s.window_min ?? null,
          via: s.via,
          external: s.external || undefined,
          needs: /supervisor/.test(s.note || '') ? 'countersign' : undefined,
        }),
      ),
      local_contact: p.designated_local_contact?.ref,
      phone_display: p.phone_display,
      home_area: p.home_area ? placeRef(p.home_area) : undefined,
      day_schedule: (p.day_schedule || []).map((w) =>
        compact({
          from: isoZ(w.from),
          to: isoZ(w.to),
          place_id: w.place_id,
          label: w.label,
          precision: w.precision,
          leg_id: w.leg_id,
        }),
      ),
    });
  }
  const legs = {};
  for (const l of R.legs)
    legs[l.id] = compact({
      id: l.id,
      sample: true,
      trip_id: l.trip_id,
      person_id: l.person_id,
      participants: l.participants,
      kind: l.kind,
      label: l.label,
      main_label: l.main_label,
      start: isoZ(l.start),
      end: isoZ(l.end),
      tz: l.tz,
      place: placeRef(l.place),
      origin: placeRef(l.origin),
      destination: placeRef(l.destination),
      mode: l.mode,
      radius_m: l.radius_m,
      corridor_m: l.corridor_m,
      window_min: l.window_min,
      parent_leg: l.parent_leg,
      briefed: Boolean(l.briefed),
      city: CITY_OF[l.place?.place_id] || null,
      advance: l.advance ? zDeep(l.advance) : undefined,
      official_instructions: [],
    });
  const staff = R.watch.staff.map((s) => ({
    id: s.id,
    sample: true,
    callsign: s.callsign,
    name: s.name,
    role: s.role.toLowerCase(),
    signs_as: s.signs_as,
  }));
  return {
    places,
    people,
    legs,
    details,
    watch: {
      name: R.watch.name,
      staff,
      client_viewer: R.watch.client_viewer,
      two_person_rule: R.watch.two_person_rule,
    },
    trips: R.trips.map((t) => ({
      id: t.id,
      sample: true,
      name: t.name,
      kind: t.kind,
      lead_person: t.lead_person,
      participants: t.participants,
      city: t.city,
      protection: t.protection,
      leg_ids: t.leg_ids,
    })),
    vehicles: R.vehicles.map((v) => ({
      id: v.id,
      sample: true,
      callsign: v.callsign,
      driver: v.driver,
      assigned_to: v.assigned_to,
      city: v.city,
    })),
    brief: {
      at: isoZ(R.daily_brief.at),
      main_line: R.daily_brief.main_line,
      legs_today: R.daily_brief.legs_today,
      legs: R.daily_brief.legs.map((l) => l.leg_id),
      postures: R.daily_brief.postures,
      protection: R.daily_brief.protection,
    },
    enterprise: {
      family: R.enterprise.family,
      namesake_to_dismiss: R.enterprise.namesake_to_dismiss?.name,
      cities: R.enterprise.cities,
    },
  };
}

// ------------------------------------------------------------------ intake

/** Patches for members that arrive after the bundle (EP-35 §1 "extends"). */
function historyOf(base, members, final, extra = {}) {
  const at0 = ms(base.ingested_at);
  const timed = members
    .map((m, i) => ({ ...m, i, t: ms(m.received_at || base.ingested_at) }))
    .sort((a, b) => a.t - b.t || a.i - b.i);
  const firstIds = timed.filter((m) => m.t <= at0).map((m) => m.intel_id);
  if (!firstIds.length && timed.length) firstIds.push(timed[0].intel_id);
  const gh = extra.grade_history || [];
  const ph = extra.priority_history || [];
  const stateAt = (t, ids) => {
    const out = { member_intel_ids: ids, source_count: ids.length };
    const g = gh.filter((h) => ms(h.at) <= t).pop();
    if (g) {
      out.grade = g.grade;
      out.source_rating = g.grade[0];
      out.info_credibility = Number(g.grade.slice(1));
      out.corroborated = Boolean(g.corroborated_by);
    }
    const p = ph.filter((h) => ms(h.at) <= t).pop();
    if (p) out.operational_priority = p.priority;
    // The bundle's place follows its latest non-social member with a place.
    const geoM = timed
      .filter(
        (m) => ids.includes(m.intel_id) && m.geo && m.source_kind !== 'mention',
      )
      .pop();
    if (geoM && extra.memberGeo) {
      out.geo = {
        name: geoM.geo.name,
        lat: geoM.geo.lat,
        lon: geoM.geo.lon,
        precision: geoM.geo.precision,
        accuracy_m: geoM.geo.accuracy_m,
        mgrs: geoM.geo.mgrs ?? null,
      };
    }
    const last = timed.filter((m) => ids.includes(m.intel_id)).pop();
    if (last?.msg_type === 'cancel') out.msg_type = 'cancel';
    return out;
  };
  const head = stateAt(at0, firstIds);
  const history = [];
  let ids = firstIds;
  let prev = head;
  for (const t of [
    ...new Set(timed.filter((m) => m.t > at0).map((m) => m.t)),
  ]) {
    ids = [...ids, ...timed.filter((m) => m.t === t).map((m) => m.intel_id)];
    const now = stateAt(t, ids);
    const patch = { at: isoZ(t) };
    for (const [k, v] of Object.entries(now))
      if (JSON.stringify(v) !== JSON.stringify(prev[k])) patch[k] = v;
    history.push(patch);
    prev = { ...prev, ...now };
  }
  // The last state must be the file's own final bundle.
  for (const k of ['source_count', 'grade', 'operational_priority'])
    if (final[k] !== undefined && prev[k] !== undefined && prev[k] !== final[k])
      throw new Error(
        `${base.bundle_id}: history ends at ${k}=${prev[k]}, file says ${final[k]}`,
      );
  return { head, history };
}

function geoOf(lat, lon, o) {
  return compact({
    name: o.name,
    lat,
    lon,
    precision: o.precision,
    accuracy_m: o.accuracy_m ?? null,
    mgrs: o.mgrs ?? null,
  });
}

function intelBundle(b) {
  const p = b.place || {};
  const polygon =
    b.geo?.type === 'Polygon'
      ? b.geo.coordinates[0].map(([lon, lat]) => [lat, lon])
      : undefined;
  const base = {
    bundle_id: b.bundle_id,
    sample: true,
    file: 'intel',
    title: b.title,
    short_summary: b.short_summary,
    category: b.category,
    event_type: b.event_type,
    msg_type: b.msg_type,
    severity: b.severity,
    operational_priority: b.operational_priority,
    source_class: b.source_class,
    source_kind: b.source_kind,
    partner_feed: Boolean(b.partner_feed),
    source_rating: b.source_rating,
    info_credibility: b.info_credibility,
    grade: b.grade,
    confidence_aggregate: b.confidence_aggregate,
    credibility_score: b.credibility_score,
    sent_at: isoZ(b.times.observed_at),
    received_at: isoZ(b.times.received_at),
    ingested_at: isoZ(b.times.ingested_at),
    city: p.city || null,
    geo: { ...geoOf(p.lat, p.lon, p), polygon },
    geo_precision: p.precision,
    accuracy_m: p.accuracy_m ?? null,
    mgrs: p.mgrs ?? null,
    geo_scope: b.geo_scope,
    hazard_area: Boolean(b.hazard_area),
    subjects: [],
    mention_class: null,
    cluster_id: null,
    related_to: null,
    duplicate_of: b.duplicate_of?.bundle_id || null,
    duplicate_of_intel: b.duplicate_of?.intel_id || undefined,
    region_cities:
      p.precision === 'region'
        ? b.banner_for?.length
          ? b.banner_for
          : [p.city]
        : [],
    lineage_hash: b.lineage_hash,
    source_tag: b.source_tag,
    live_stand_in: b.live_stand_in,
    intake_reason: strip(b.not_raised_reason),
    why_raised_text: b.match?.why_raised || undefined,
    salute: b.salute,
  };
  const members = (b.members || []).map((m) => ({
    intel_id: m.intel_id,
    source_class: m.source_class,
    msg_type: m.msg_type,
    observed_at: isoZ(m.observed_at),
    received_at: isoZ(m.received_at),
    text: m.text,
  }));
  const { head, history } = historyOf(base, members, b);
  return compact({
    ...base,
    ...head,
    members,
    history: history.length ? history : undefined,
  });
}

function regionalBundle(b) {
  const g = b.geo || {};
  const region = g.precision === 'region' || b.geo_precision === 'region';
  const base = {
    bundle_id: b.bundle_id,
    sample: true,
    file: 'regional',
    title: b.title,
    short_summary: b.short_summary,
    category: b.category,
    event_type: b.event_type,
    msg_type: b.msg_type,
    severity: b.severity,
    operational_priority: b.priority,
    source_class: b.source_class,
    source_kind: b.source_kind,
    partner_feed: Boolean(b.partner_feed),
    source_rating: b.source_rating,
    info_credibility: b.info_credibility,
    grade: b.grade,
    confidence_aggregate: b.confidence_aggregate,
    sent_at: isoZ(b.sent_at),
    received_at: isoZ(b.ingested_at),
    ingested_at: isoZ(b.ingested_at),
    effective_at: b.effective_at ? isoZ(b.effective_at) : undefined,
    expires_at: b.expires_at ? isoZ(b.expires_at) : null,
    city: b.city,
    geo: geoOf(g.lat, g.lon, g),
    geo_precision: b.geo_precision || g.precision,
    accuracy_m: b.accuracy_m ?? g.accuracy_m ?? null,
    mgrs: b.mgrs ?? null,
    geo_scope: b.geo_scope,
    hazard_area: false,
    subjects: [],
    mention_class: null,
    cluster_id: null,
    related_to: b.related_to || null,
    duplicate_of:
      /^duplicate of (b-[\w-]+)/.exec(b.not_raised_reason || '')?.[1] || null,
    region_cities: region ? REGION_CITIES[b.city] || [b.city] : [],
    official_instruction: Boolean(b.official_instruction),
    lineage_hash: b.lineage_hash,
    version: b.version,
    supersedes: b.supersedes,
    source_tag: b.source_tag,
    intake_reason: strip(b.not_raised_reason),
    not_raised_detail: b.not_raised_detail,
    why_raised_text: b.match?.line || undefined,
    card_sources: b.card_sources,
    card_grade: b.card_grade,
    card_times: b.card_times,
    known: b.known,
    unknown: b.unknown,
  };
  const members = (b.members || []).map((m) =>
    compact({
      intel_id: m.intel_id,
      source_class: m.source_class,
      source_kind: m.source_kind,
      grade: m.grade,
      msg_type: m.msg_type,
      observed_at: isoZ(m.observed_at),
      received_at: isoZ(m.received_at),
      text: m.text,
      geo: m.geo ? geoOf(m.geo.lat, m.geo.lon, m.geo) : undefined,
      corroborates: m.corroborates || undefined,
    }),
  );
  const { head, history } = historyOf(base, members, b, {
    grade_history: b.grade_history,
    priority_history: b.priority_history,
    memberGeo: Boolean(b.grade_history),
  });
  return compact({
    ...base,
    ...head,
    members,
    history: history.length ? history : undefined,
  });
}

function mentionBundle(b, raw) {
  const leg = /\b(l-[a-z0-9-]+)\b/.exec(b.claimed_time || '')?.[1] || null;
  const cp = b.claimed_place;
  const story =
    b.match ||
    b.link ||
    b.decision ||
    ['threat', 'doxx', 'travel-plan leak'].includes(b.mention_class);
  const base = {
    bundle_id: b.bundle_id,
    sample: true,
    file: 'mentions',
    title: b.title,
    short_summary: b.short_summary,
    category: b.category,
    event_type: b.event_type,
    msg_type: b.msg_type,
    severity: b.severity,
    operational_priority: b.operational_priority,
    source_class: b.source_class,
    source_kind: b.source_kind,
    partner_feed: Boolean(b.partner_feed),
    source_rating: b.source_rating,
    info_credibility: b.info_credibility,
    grade: b.grade,
    confidence_aggregate: b.confidence_aggregate,
    credibility_score: b.credibility_score,
    sent_at: isoZ(b.sent_at),
    received_at: isoZ(b.ingested_at),
    ingested_at: isoZ(b.ingested_at),
    city: null,
    geo: null,
    geo_precision: b.geo_precision ?? null,
    accuracy_m: b.accuracy_m ?? null,
    mgrs: b.mgrs ?? null,
    geo_scope: b.geo_scope ?? null,
    hazard_area: false,
    pinned: false,
    subjects: (b.subjects || []).map((s) => ({
      person_id: s.person_id,
      callsign: s.callsign,
      how: s.how,
    })),
    mention_class: b.mention_class,
    cluster_id: b.cluster_id,
    claimed:
      cp || b.claimed_time
        ? compact({
            place_id: cp?.place_id,
            name: cp?.name,
            precision: cp?.precision,
            accuracy_m: cp?.accuracy_m,
            mgrs: cp?.mgrs ?? undefined,
            category: cp?.category,
            building_type: cp?.building_type,
            time_text: b.claimed_time || undefined,
            leg_id: leg || undefined,
          })
        : null,
    posted_by_roster: b.posted_by_roster || undefined,
    related_to: b.link
      ? {
          kind: b.link.kind,
          person_id: b.link.person_id,
          leg_id: b.link.leg_id,
        }
      : null,
    related_label: b.related_label,
    duplicate_of:
      /^duplicate of (b-[\w-]+)/.exec(b.not_raised_reason || '')?.[1] || null,
    region_cities: [],
    lineage_hash: b.lineage_hash,
    source_tag: b.source_tag,
    intake_reason: strip(b.not_raised_reason),
    why_raised_text: b.match?.line || undefined,
    feed_line: b.feed_line,
    card_header: b.card_header,
    evidence: b.evidence,
    origin: b.origin
      ? { display: b.origin.display, desk_only: true }
      : undefined,
    lang: b.lang,
  };
  const members = raw
    .filter((m) => m.bundle_id === b.bundle_id)
    .map((m) => ({ intel_id: m.id, received_at: isoZ(m.received_at) }));
  const { head, history } = historyOf(base, members, b);
  const posts = story
    ? raw
        .filter((m) => m.bundle_id === b.bundle_id)
        .map((m) =>
          compact({
            id: m.id,
            handle: m.handle,
            lang: m.lang,
            text: m.text,
            translation: m.translation || undefined,
            posted_at: isoZ(m.posted_at),
            observed_at: isoZ(m.observed_at),
            received_at: isoZ(m.received_at),
            reshare_of: m.reshare_of || undefined,
          }),
        )
    : undefined;
  return compact({
    ...base,
    ...head,
    posts,
    history: history.length ? history : undefined,
  });
}

// ------------------------------------------------------------------ events

function loopEvent(e) {
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (DROP.has(k)) continue;
    if (k === 'note' && !KEEP_NOTE.has(e.type)) continue;
    out[k] = zDeep(v);
  }
  out.by = byOf(e.by);
  // A SALUTE's observed time is a DTG in loop.json; the engine reads instants.
  if (
    e.type === 'salute.file' &&
    typeof e.time === 'string' &&
    !ISO.test(e.time)
  ) {
    const m = /^(\d{2})(\d{2})(\d{2})Z OCT 26$/.exec(e.time);
    if (!m) throw new Error(`${e.id}: SALUTE time ${e.time} is not a DTG`);
    out.time = isoZ(`2026-10-${m[1]}T${m[2]}:${m[3]}:00Z`);
  }
  out.sample = true;
  return out;
}

/** The two morning situations live in intel.json (loop-notes). */
function morningEvents(b) {
  const s = b.situation;
  const v = s.verification;
  const tag = s.sit_id.replace('s-intel-', 'am-');
  const out = [];
  const ev = (n, at, type, by, fields) =>
    out.push({
      id: `e-${tag}-${n}`,
      sample: true,
      at,
      beat: 0,
      by,
      via: 'script',
      type,
      ...fields,
    });
  ev(1, zOn(v.verified_at), 'verification.decide', v.verified_by, {
    sit_id: s.sit_id,
    verification_id: v.id,
    version: v.version,
    decision: v.decision,
    grade: v.grade,
    grade_token: `${v.grade.source}${v.grade.info}`,
    basis: [b.bundle_id],
    basis_members: v.basis,
    corroborated_by: v.corroborated_by || [],
    note: v.note,
  });
  if (v.countersigned_by)
    ev(
      2,
      zOn(v.countersigned_at),
      'verification.countersign',
      v.countersigned_by,
      {
        sit_id: s.sit_id,
        verification_id: v.id,
        version: v.version,
        two_person_line: `raised ${s.raised.z} · ${v.verified_by} · countersigned ${v.countersigned_at} · ${v.countersigned_by}`,
      },
    );
  for (const [i, n] of (s.notified || []).entries())
    ev(3 + i, zOn(n.at), 'message.send', n.by, {
      sit_id: s.sit_id,
      to: n.participant_id,
      kind: n.kind,
      text: n.text,
    });
  const decided = zOn(s.close.closed_at);
  const signed = zOn(s.sitrep.signed_at);
  ev(6, decided, 'sitrep.draft', 'generator', {
    sit_id: s.sit_id,
    sitrep_id: s.sitrep.id,
    version: 1,
    drafted_by: 'system',
    card: { ...s.sitrep.slots, SIGNED: '—' },
  });
  ev(7, signed, 'sitrep.sign', s.sitrep.signed_by, {
    sit_id: s.sit_id,
    sitrep_id: s.sitrep.id,
    version: 1,
    signed: `Signed ${s.sitrep.signed_by} ${s.sitrep.signed_at.slice(0, 4)}Z`,
  });
  // I7: a close needs a signed SITREP, so the close lands just after the
  // signature; the analyst's "no change" decision time rides along.
  ev(8, addS(signed, 10), 'situation.close', s.close.by, {
    sit_id: s.sit_id,
    reason: s.close.reason,
    decided_at: decided,
    close_note: s.close.note,
    sitrep_id: s.sitrep.id,
    main_row: s.record_line,
  });
  return out;
}

function decisionEvents(M, mirrored) {
  const out = [];
  for (const b of M.bundles) {
    const d = b.decision;
    if (!d) continue;
    const type = d.kind === 'dismiss' ? 'intel.dismiss' : 'intel.watch';
    if (mirrored.has(`${b.bundle_id}|${type}`)) continue;
    out.push(
      compact({
        id: `e-dec-${b.bundle_id}`,
        sample: true,
        at: isoZ(d.at),
        beat: 0,
        by: d.by,
        via: 'script',
        type,
        bundle_id: b.bundle_id,
        reason: d.reason,
        note: d.note || undefined,
        feed_line: b.feed_line,
      }),
    );
  }
  return out;
}

function movementEvents(V, superseded) {
  const out = [];
  for (const e of V.events) {
    if (superseded.has(e.id)) continue;
    const base = {
      id: e.id,
      sample: true,
      at: isoZ(e.at),
      by: byOf(e.by),
      via: 'script',
    };
    if (e.type === 'checkin.due')
      out.push({
        ...base,
        type: 'checkin.due',
        person_id: e.person_id,
        point: e.point,
      });
    else if (e.type === 'checkin.respond')
      out.push(
        compact({
          ...base,
          type: 'checkin.respond',
          person_id: e.person_id,
          point: e.point,
          status: e.status,
          text: e.text,
          fix_id: e.fix_id,
        }),
      );
    else if (e.type === 'comms.due')
      out.push({
        ...base,
        type: 'comms.due',
        detail_id: e.detail_id,
        person_id: e.person_id,
        due_at: isoZ(e.at),
        cadence_min: e.interval_min,
        overdue_after_min: e.overdue_after_min,
      });
    else if (e.type === 'comms.check')
      out.push({
        ...base,
        type: 'checkin.respond',
        kind: 'comms_check',
        detail_id: e.detail_id,
        person_id: e.by,
        due_at: isoZ(e.due_at),
        status: e.status,
        text: e.status,
        agents: e.agents,
        net: e.net,
      });
    else if (e.type === 'checkin.call')
      out.push({
        ...base,
        type: 'message.send',
        to: e.person_id,
        kind: 'note',
        call: true,
        point: e.point,
        outcome: e.outcome,
        text: e.text,
      });
    else
      throw new Error(
        `${e.id}: movement event ${e.type} is not superseded by loop.json`,
      );
  }
  return out;
}

/** A fix, compact: `sample` is the file's; the grid follows from format.mgrs. */
function fixOf(f) {
  return compact({
    id: f.id,
    person_id: f.subject_id,
    at: isoZ(f.at),
    lat: f.lat,
    lon: f.lon,
    accuracy_m: f.accuracy_m,
    precision: f.precision,
    source: f.source,
    via: f.via,
    activity: f.activity,
    place_id: f.place_id,
    privacy: f.privacy,
  });
}

// ------------------------------------------------------------------ build

export function readSources(dir) {
  const texts = {};
  for (const f of SOURCE_FILES) texts[f] = readFileSync(join(dir, f), 'utf8');
  return texts;
}

/** Build day.json (object) from the six source texts. Throws on a breach. */
export function buildDay(texts) {
  const R = JSON.parse(texts['roster.json']);
  const I = JSON.parse(texts['intel.json']);
  const G = JSON.parse(texts['regional.json']);
  const M = JSON.parse(texts['mentions.json']);
  const V = JSON.parse(texts['movement.json']);
  const L = JSON.parse(texts['loop.json']);
  for (const [f, d] of Object.entries({ R, I, G, M, V, L }))
    if (d.sample !== true) throw new Error(`${f}: sample is not true`);

  const roster = rosterPart(R);
  const bundles = [
    ...I.bundles.map(intelBundle),
    ...G.bundles.map(regionalBundle),
    ...M.bundles.map((b) => mentionBundle(b, M.mentions)),
  ].sort(
    (a, b) =>
      ms(a.ingested_at) - ms(b.ingested_at) ||
      (a.bundle_id < b.bundle_id ? -1 : 1),
  );

  const mirrored = new Set(
    L.events.filter((e) => e.bundle_id).map((e) => `${e.bundle_id}|${e.type}`),
  );
  const superseded = new Set();
  for (const e of L.events)
    for (const k of ['supersedes_mv', 'satisfies_mv'])
      if (e[k]) superseded.add(String(e[k]).split(' ')[0]);
  const morning = I.bundles.filter((b) => b.situation).flatMap(morningEvents);
  // MAIN's short form of each recommendation, as loop.json writes its rows
  // (`CALLSIGN · leg · short · state · next update`); a DETAIL row has none.
  const loopEvents = L.events.map(loopEvent);
  for (const d of loopEvents.filter((e) => e.type === 'recommendation.draft')) {
    const row = loopEvents
      .filter((e) => e.sit_id === d.sit_id && typeof e.main_row === 'string')
      .map((e) => e.main_row.split(' · '))
      .find((parts) => parts.length >= 4 && !parts[2].startsWith('DL:'));
    if (row) d.main_short = row[2];
  }
  const events = [
    ...loopEvents,
    ...morning,
    ...decisionEvents(M, mirrored),
    ...movementEvents(V, superseded),
  ];

  // Fixture situations: where each opens (EP-35 §1: on intel.received).
  const raises = L.situations.map((s) => ({
    bundle_id: s.bundle_id,
    sit_id: s.sit_id,
    at: isoZ(s.raised_at),
  }));

  const anchors = {};
  for (const c of L.checkpoints)
    if (!(c.beat in anchors))
      anchors[c.beat] = isoZ(
        `2026-10-${c.anchor.slice(0, 2)}T${c.anchor.slice(2, 4)}:${c.anchor.slice(4, 6)}:00Z`,
      );
  const checkpoints = L.checkpoints.map((c) => ({
    beat: c.beat,
    checkpoint: c.checkpoint,
    from: isoZ(
      `2026-10-${c.from.slice(0, 2)}T${c.from.slice(2, 4)}:${c.from.slice(4, 6)}:00Z`,
    ),
    to: isoZ(
      `2026-10-${c.to.slice(0, 2)}T${c.to.slice(2, 4)}:${c.to.slice(4, 6)}:00Z`,
    ),
    rate: c.rate,
  }));

  const intelSit = Object.fromEntries(
    I.bundles
      .filter((b) => b.situation)
      .map((b) => [b.situation.sit_id, b.situation]),
  );
  const expected = {
    note: 'Test material: the intake authors’ own results. The engine never reads this block.',
    ledger: L.ledger,
    counter_after: Object.fromEntries(
      L.events.map((e) => [
        e.id,
        ['in', 'matched', 'raised', 'pushed', 'closed'].map(
          (k) => e.counter_after[k],
        ),
      ]),
    ),
    situations: L.situations.map((s) => ({
      sit_id: s.sit_id,
      bundle_id: s.bundle_id,
      person_id: s.person_id,
      leg_id: s.leg_id,
      protection: s.protection,
      raised_at: isoZ(s.raised_at),
      why_raised: s.why_raised,
      verification_id: s.verification_id,
      recommendation_id: s.recommendation_id,
      push_id: s.push_id,
      sitrep_id: s.sitrep_id,
      signed_at: intelSit[s.sit_id]
        ? zOn(intelSit[s.sit_id].sitrep.signed_at)
        : isoZ(
            `2026-10-${s.signed_at.slice(0, 2)}T${s.signed_at.slice(2, 4)}:${s.signed_at.slice(4, 6)}:00Z`,
          ),
      final_state: s.final_state,
    })),
    matches: {},
    banners: {},
  };
  const every = [
    ...I.bundles.map((b) => [b, isoZ(b.times.ingested_at)]),
    ...G.bundles.map((b) => [b, isoZ(b.ingested_at)]),
    ...M.bundles.map((b) => [b, isoZ(b.ingested_at)]),
  ];
  for (const [b, at] of every) {
    if (b.match)
      expected.matches[b.bundle_id] = {
        leg_id: b.match.leg_id,
        distance_m: b.match.distance_m ?? b.match.distance,
        window: b.match.window,
        matched_at: b.match.matched_at ? isoZ(b.match.matched_at) : at,
      };
    if (b.banner_for?.length) expected.banners[b.bundle_id] = b.banner_for;
    else if (/region, banner only/.test(b.not_raised_reason || ''))
      expected.banners[b.bundle_id] = REGION_CITIES[b.city] || [b.city];
  }

  // Member texts and SALUTE blocks only where a screen opens the bundle.
  const story = new Set([
    ...Object.keys(expected.matches),
    ...Object.keys(expected.banners),
    ...raises.map((r) => r.bundle_id),
    ...bundles.filter((b) => b.related_to || b.history).map((b) => b.bundle_id),
    ...events.flatMap((e) =>
      [
        e.bundle_id,
        ...[e.basis, e.related].filter(Array.isArray).flat(),
      ].filter(Boolean),
    ),
  ]);
  for (const b of bundles)
    if (!story.has(b.bundle_id)) {
      delete b.salute;
      if (b.members)
        b.members = b.members.map((m) => ({
          intel_id: m.intel_id,
          received_at: m.received_at,
        }));
    }

  const day = {
    sample: true,
    schema: 'safetrekr-executive/day/v1',
    label: 'SAMPLE: fictional family, people, posts and incidents',
    demo_date: DEMO_DATE,
    t0: T0,
    end: '2026-10-28T01:01:00Z',
    sources: Object.fromEntries(SOURCE_FILES.map((f) => [f, sha(texts[f])])),
    display: L.display,
    attribution: {
      text: V.attribution,
      url: V.attribution_url,
      scope: V.attribution_scope,
    },
    beats: Object.fromEntries(
      Object.entries(anchors).map(([b, at]) => [b, at]),
    ),
    checkpoints,
    ...roster,
    raises,
    bundles: Object.fromEntries(bundles.map((b) => [b.bundle_id, b])),
    events: events.sort((a, b) => ms(a.at) - ms(b.at)),
    fixes: V.fixes.map(fixOf),
    schedule_positions: V.schedule_positions.map((s) =>
      compact({
        id: s.id,
        sample: true,
        person_id: s.person_id,
        from: isoZ(s.from),
        to: isoZ(s.to),
        place_id: s.place_id,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        precision: s.precision,
        accuracy_m: s.accuracy_m,
        mgrs: s.mgrs ?? null,
        label: s.label,
        sharing: s.sharing,
      }),
    ),
    paths: V.paths.map((p) =>
      compact({
        id: p.id,
        sample: true,
        subjects: p.subjects,
        leg_id: p.leg_id,
        departed: isoZ(p.departed),
        arrived: isoZ(p.arrived),
        mode: p.mode,
        streets: p.streets,
        length_m: p.length_m,
        precision: p.precision,
        note: p.note,
        coords: p.coords,
      }),
    ),
    chatter_trend: M.chatter_trend.map((h) => ({
      hour: isoZ(h.hour),
      mentions: h.mentions,
      company_chatter: h.company_chatter,
    })),
    expected,
  };
  assertDay(day, { I, G, M, L });
  return day;
}

// ------------------------------------------------------------------ asserts

const fail = (msg) => {
  throw new Error(`day.json: ${msg}`);
};

/** EP-41's ledger from the fixtures alone, and every id resolves. */
export function assertDay(day, src = null) {
  const at1430 = ms('2026-10-27T14:30:00Z');
  const at0100 = ms('2026-10-28T01:00:00Z');
  const bundles = Object.values(day.bundles);
  const byFile = (f, t) =>
    bundles.filter((b) => b.file === f && ms(b.ingested_at) <= t).length;
  const want = { intel: [95, 110], regional: [46, 54], mentions: [45, 50] };
  for (const [f, [a, b]] of Object.entries(want)) {
    if (byFile(f, at1430) !== a)
      fail(`${f} has ${byFile(f, at1430)} bundles by 1430Z, EP-41 says ${a}`);
    if (byFile(f, at0100) !== b)
      fail(`${f} has ${byFile(f, at0100)} bundles by 0100Z, EP-41 says ${b}`);
  }
  const m = day.expected.matches;
  const mt = (f, lo, hi) =>
    Object.entries(m).filter(
      ([id, x]) =>
        day.bundles[id].file === f &&
        ms(x.matched_at) > lo &&
        ms(x.matched_at) <= hi,
    ).length;
  const wantM = { intel: [4, 1], regional: [2, 1], mentions: [1, 2] };
  for (const [f, [a, b]] of Object.entries(wantM)) {
    if (mt(f, -Infinity, at1430) !== a)
      fail(
        `${f} matched by 1430Z is ${mt(f, -Infinity, at1430)}, EP-41 says ${a}`,
      );
    if (mt(f, at1430, at0100) !== b)
      fail(
        `${f} matched after 1430Z is ${mt(f, at1430, at0100)}, EP-41 says +${b}`,
      );
  }
  const sits = day.expected.situations;
  const raised = (t) => sits.filter((s) => ms(s.raised_at) <= t).length;
  const closed = (t) => sits.filter((s) => ms(s.signed_at) <= t).length;
  const pushes = day.events.filter((e) => e.type === 'push.send');
  const pushed = (t) => pushes.filter((e) => ms(e.at) <= t).length;
  const matched = (t) =>
    Object.values(m).filter((x) => ms(x.matched_at) <= t).length;
  const inn = (t) => bundles.filter((b) => ms(b.ingested_at) <= t).length;
  const counter = (t) => ({
    in: inn(t),
    matched: matched(t),
    raised: raised(t),
    pushed: pushed(t),
    closed: closed(t),
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (
    !same(counter(at1430), {
      in: 186,
      matched: 7,
      raised: 2,
      pushed: 0,
      closed: 2,
    })
  )
    fail(`counter at 1430Z is ${JSON.stringify(counter(at1430))}`);
  if (
    !same(counter(at0100), {
      in: 214,
      matched: 11,
      raised: 6,
      pushed: 4,
      closed: 6,
    })
  )
    fail(`counter at 0100Z is ${JSON.stringify(counter(at0100))}`);
  // The fixture counters on every loop.json event agree with the selectors.
  for (const e of day.events.filter((x) => day.expected.counter_after[x.id])) {
    const c = counter(ms(e.at));
    const got = [c.in, c.matched, c.raised, c.pushed, c.closed];
    if (!same(got, day.expected.counter_after[e.id]))
      fail(
        `${e.id} counter_after ${day.expected.counter_after[e.id]} vs selectors ${got}`,
      );
    if (!(
      c.raised <= c.matched &&
      c.pushed <= c.raised &&
      c.closed <= c.raised
    ))
      fail(`${e.id}: an EP-35 §4 inequality fails at ${e.at}`);
  }
  // Every bundle but the matched, the linked and the banners carries a reason.
  for (const b of bundles)
    if (
      !m[b.bundle_id] &&
      !b.related_to &&
      !day.expected.banners[b.bundle_id] &&
      !b.intake_reason
    )
      fail(
        `${b.bundle_id} is neither matched nor linked and has no not_raised_reason`,
      );

  // Ids resolve.
  const ids = new Set();
  for (const e of day.events) {
    if (!e.id) fail(`an event has no id (${e.type} ${e.at})`);
    if (ids.has(e.id)) fail(`duplicate event id ${e.id}`);
    ids.add(e.id);
    if (!ISO.test(e.at) || !e.at.endsWith('Z'))
      fail(`${e.id}: at is not ISO UTC`);
    if (e.sample !== true) fail(`${e.id}: sample is not true`);
  }
  const actors = new Set([
    'generator',
    ...day.watch.staff.map((s) => s.callsign),
    ...Object.keys(day.people),
  ]);
  const sitIds = new Set(sits.map((s) => s.sit_id));
  const made = {
    verification_id: new Set(),
    recommendation_id: new Set(),
    push_id: new Set(),
    sitrep_id: new Set(),
  };
  const order = [...day.events];
  for (const e of order) {
    if (e.type === 'verification.decide')
      made.verification_id.add(e.verification_id);
    if (e.type === 'recommendation.draft')
      made.recommendation_id.add(e.recommendation_id);
    if (e.type === 'push.send') made.push_id.add(e.push_id);
    if (e.type === 'sitrep.draft') made.sitrep_id.add(e.sitrep_id);
  }
  const person = (id, where) => {
    if (id != null && !day.people[id]) fail(`${where}: unknown person ${id}`);
  };
  for (const e of order) {
    const where = e.id;
    if (!actors.has(e.by)) fail(`${where}: unknown actor ${e.by}`);
    if (e.sit_id && !sitIds.has(e.sit_id))
      fail(`${where}: unknown situation ${e.sit_id}`);
    if (e.bundle_id && !day.bundles[e.bundle_id])
      fail(`${where}: unknown bundle ${e.bundle_id}`);
    if (e.leg_id && !day.legs[e.leg_id])
      fail(`${where}: unknown leg ${e.leg_id}`);
    if (e.detail_id && !day.details[e.detail_id])
      fail(`${where}: unknown detail ${e.detail_id}`);
    for (const k of Object.keys(made))
      if (e[k] && !made[k].has(e[k]))
        fail(`${where}: ${k} ${e[k]} is never created`);
    person(e.person_id, where);
    person(e.participant_id, where);
    if (typeof e.to === 'string' && e.to.startsWith('p-')) person(e.to, where);
    for (const r of e.recipients || [])
      person(typeof r === 'string' ? r : r.participant_id, where);
    const refs = [e.basis, e.related].filter(Array.isArray).flat();
    for (const b of refs)
      if (!day.bundles[b])
        fail(`${where}: unknown bundle ${b} in basis/related`);
  }
  for (const r of day.raises) {
    if (!day.bundles[r.bundle_id])
      fail(`raise ${r.sit_id}: unknown bundle ${r.bundle_id}`);
    if (ms(r.at) < ms(day.bundles[r.bundle_id].ingested_at))
      fail(`raise ${r.sit_id} before its bundle arrives`);
  }
  for (const l of Object.values(day.legs)) {
    person(l.person_id, l.id);
    for (const p of l.participants || []) person(p, l.id);
    if (l.place?.place_id && !day.places[l.place.place_id])
      fail(`${l.id}: unknown place`);
  }
  for (const p of Object.values(day.people))
    for (const s of p.escalation || [])
      person(s.participant_id, `${p.id} escalation`);
  for (const d of Object.values(day.details))
    for (const a of [d.principal, d.leader, ...d.agents]) person(a, d.id);
  const subjects = new Set([
    ...Object.keys(day.people),
    ...day.vehicles.map((v) => v.id),
  ]);
  for (const f of day.fixes)
    if (!subjects.has(f.person_id))
      fail(`${f.id}: unknown subject ${f.person_id}`);
  for (const b of bundles) {
    for (const s of b.subjects || []) person(s.person_id, b.bundle_id);
    if (
      b.related_to &&
      typeof b.related_to === 'string' &&
      !day.bundles[b.related_to]
    )
      fail(`${b.bundle_id}: related_to ${b.related_to} is unknown`);
    if (b.duplicate_of && !day.bundles[b.duplicate_of])
      fail(`${b.bundle_id}: duplicate_of is unknown`);
    if (b.sample !== true) fail(`${b.bundle_id}: sample is not true`);
  }
  if (src) {
    // Every source event and bundle made it across.
    if (
      src.L.events.length !==
      day.events.filter((e) => /^e-\d{4}$/.test(e.id)).length
    )
      fail('loop.json events were dropped');
    if (
      src.I.bundles.length + src.G.bundles.length + src.M.bundles.length !==
      bundles.length
    )
      fail('intake bundles were dropped');
  }
  return true;
}

/** One record per line: reviewable diffs, compact file. */
export function serialiseDay(day) {
  const lines = ['{'];
  const keys = Object.keys(day);
  keys.forEach((k, i) => {
    const v = day[k];
    const end = i === keys.length - 1 ? '' : ',';
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      lines.push(`  ${JSON.stringify(k)}: [`);
      v.forEach((x, j) =>
        lines.push(`    ${JSON.stringify(x)}${j === v.length - 1 ? '' : ','}`),
      );
      lines.push(`  ]${end}`);
    } else if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).length > 4
    ) {
      lines.push(`  ${JSON.stringify(k)}: {`);
      const ks = Object.keys(v);
      ks.forEach((kk, j) =>
        lines.push(
          `    ${JSON.stringify(kk)}: ${JSON.stringify(v[kk])}${j === ks.length - 1 ? '' : ','}`,
        ),
      );
      lines.push(`  }${end}`);
    } else lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${end}`);
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** The generated files as text, keyed by repo path. */
export async function buildExecutiveOutputs(texts) {
  const day = buildDay(texts);
  const dayText = serialiseDay(day);
  const out = { [DAY_OUT]: dayText };
  const { goldenFor } =
    await import('../src/operations/tripTwin/products/executive/timeline.js');
  out[GOLDEN_OUT] =
    `${JSON.stringify(goldenFor(JSON.parse(dayText), sha), null, 2)}\n`;
  return out;
}
