import { createClient } from '@supabase/supabase-js';
import { fetchOperations, SnapshotPoller } from './api.js';
import {
  currentFreshness,
  nearbyCameras,
  validPoint,
  makeAircraftLink,
  liveAircraftLink,
} from './model.js';
import './operations.css';

// Replace the upstream explorer chrome before constructing any scene or tools.
// Its voice, annotations, sharing, capture, and debug bootstrap never execute.
const root = document.createElement('div');
root.id = 'ops-root';
root.innerHTML = `
  <main id="ops-login" class="ops-login">
    <section class="ops-intro"><img src="/safetrekr-logo.svg" alt="SafeTrekr" width="210" />
      <p class="ops-eyebrow">OPERATIONS / WORLD VIEW</p><h1>A world of context.<br>Every traveler in view.</h1>
      <p>Bring your trips, people, and safety resources into one shared picture.</p>
      <div class="ops-orbit" aria-hidden="true"><span></span><span></span><span></span><i></i></div>
      <p class="ops-intro-foot">SafeTrekr operations · Built on God’s Eye View</p>
    </section>
    <section class="ops-signin"><div class="ops-signin-content"><p class="ops-eyebrow">STAFF ACCESS</p><h2>Sign in to World View</h2>
      <p>Use your SafeTrekr staff account.</p>
      <form id="ops-login-form"><label>Email address<input name="email" type="email" autocomplete="username" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="ops-primary" type="submit">Sign in</button></form>
      <form id="ops-mfa-form" hidden><label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label><button class="ops-primary" type="submit">Verify code</button></form>
      <p id="ops-auth-error" class="ops-error" role="alert"></p><button id="ops-switch-account" hidden>Use another account</button>
      <button id="ops-demo" class="ops-demo" hidden>Explore a sample trip</button>
      <p class="ops-small">Access follows your staff permissions. Traveler data stays within your authorized trips.</p>
    </div></section>
  </main>
  <div id="ops-console" hidden>
    <div id="cesiumContainer" aria-label="Interactive 3D operations globe"></div>
    <header class="ops-header"><img src="/safetrekr-logo.svg" alt="SafeTrekr" width="152" /><span class="ops-divider"></span><span>World View</span>
      <span id="ops-environment" class="ops-environment">PRODUCTION · READ ONLY</span><span class="ops-header-spacer"></span><span id="ops-sync" role="status">Connecting…</span><button id="ops-signout">Sign out</button></header>
    <aside class="ops-sidebar" aria-label="Trips and participants">
      <div class="ops-sidebar-heading"><p class="ops-eyebrow">OPERATIONS</p><h2 id="ops-scope-title">Your world, at a glance</h2><p id="ops-totals"></p></div>
      <div class="ops-filters"><label for="ops-window">Trip window</label><select id="ops-window"><option value="current">Traveling today</option><option value="upcoming">Upcoming trips</option><option value="all">All trips</option></select>
      <button id="ops-all-trips" hidden>← All trips</button></div>
      <nav id="ops-tabs" class="ops-tabs" aria-label="Operations views"></nav>
      <div id="ops-source-issues" class="ops-source-issues" role="status" hidden></div>
      <div id="ops-list" class="ops-list"></div><div id="ops-pagination" class="ops-pagination"></div>
    </aside>
    <aside id="ops-detail" class="ops-detail" aria-label="Selection details"></aside>
    <div class="ops-map-controls"><button id="ops-frame">Fit trip view</button><button id="ops-stop-follow">Stop following</button><button id="ops-layers-button" aria-expanded="false" aria-controls="ops-layers">Layers</button></div>
    <section id="ops-layers" class="ops-layers" aria-label="Map layers" hidden></section>
    <div class="ops-legend"><span><i style="background:#71cc9a"></i>Traveler</span><span><i style="background:#75b9f2"></i>Chaperone</span><span><i style="background:#e6bb66"></i>Aging</span><span><i style="background:#d98585"></i>Last known</span></div>
    <div id="ops-loading" class="ops-loading" role="status"><span class="ops-spinner"></span><p id="ops-loader-status">Connecting to SafeTrekr…</p></div>
  </div>`;
document.body.replaceChildren(root);
document.body.classList.add('operations');
document.title = 'SafeTrekr · World View';
const $ = (id) => document.getElementById(id);
const show = (id, visible) => {
  $(id).hidden = !visible;
};
const put = (id, value) => {
  $(id).textContent = value;
};
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const button = (text, fn, className) => {
  const n = node('button', text, className);
  n.type = 'button';
  n.addEventListener('click', fn);
  return n;
};
const paragraph = (parent, text, className = 'ops-muted') =>
  parent.appendChild(node('p', text, className));
const shortTime = (value, timezone) => {
  if (!value) return 'Time not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
      timeZoneName: 'short',
    });
  } catch {
    return date.toLocaleString();
  }
};
const human = (value) => String(value || 'unknown').replaceAll('_', ' ');
let session = null,
  demo = false,
  globe = null,
  snapshot = null,
  receivedAt = 0,
  selected = null;
let lifecycle = 0,
  sceneAbort = null,
  tab = 'trips',
  starting = false,
  connectionError = '';
let filters = { window: 'current', offset: 0, tripId: null };
const links = new Map();
let onlyFlights = false;
const tabs = [
  ['trips', 'Trips'],
  ['people', 'People'],
  ['flights', 'Flights'],
  ['itinerary', 'Itinerary'],
  ['safety', 'Safety'],
  ['status', 'Status'],
];
let mfaFactor = null;
let pendingCleanup = Promise.resolve();
const visibleRoles = { traveler: true, chaperone: true };
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const auth =
  supabaseUrl && publicKey
    ? createClient(supabaseUrl, publicKey, {
        auth: {
          storage: window.sessionStorage,
          storageKey: 'safetrekr-worldview-auth',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;

const poller = new SnapshotPoller({
  request: async (signal) => {
    if (demo) return (await import('./demo.js')).demoSnapshot();
    if (!session?.access_token)
      throw Object.assign(new Error('Sign in again.'), { status: 401 });
    return fetchOperations(session.access_token, filters, signal);
  },
  onData: acceptSnapshot,
  onError: (error) => {
    if ([401, 403].includes(error.status)) {
      void lockView(error.message);
      return;
    }
    connectionError = error.message;
    updateSync();
    if (!snapshot) {
      $('ops-list').replaceChildren(
        node('p', error.message, 'ops-empty'),
        button('Retry', () => poller.start()),
      );
    }
  },
});

async function lockView(message = '') {
  lifecycle += 1;
  starting = false;
  poller.stop();
  sceneAbort?.abort();
  // Hide the private scene synchronously, before async teardown/sign-out.
  show('ops-console', false);
  show('ops-login', true);
  $('ops-list').replaceChildren();
  $('ops-detail').replaceChildren();
  $('ops-pagination').replaceChildren();
  put('ops-totals', '');
  put('ops-source-issues', '');
  put('ops-scope-title', 'Your world, at a glance');
  snapshot = null;
  selected = null;
  links.clear();
  onlyFlights = false;
  visibleRoles.traveler = true;
  visibleRoles.chaperone = true;
  filters = { window: 'current', offset: 0, tripId: null };
  $('ops-window').value = 'current';
  tab = 'trips';
  const oldGlobe = globe;
  globe = null;
  put('ops-auth-error', message);
  show('ops-switch-account', Boolean(session));
  if (oldGlobe) pendingCleanup = oldGlobe.dispose();
  await pendingCleanup;
}

async function signOut() {
  demo = false;
  await lockView();
  session = null;
  if (auth) await auth.auth.signOut({ scope: 'local' });
  show('ops-switch-account', false);
  show('ops-mfa-form', false);
  show('ops-login-form', true);
  $('ops-login-form').reset();
}

async function openSession(nextSession, sample = false) {
  session = nextSession;
  if (!sample && !session) {
    await lockView();
    return;
  }
  if (globe) {
    poller.start();
    return;
  }
  if (starting) return;
  starting = true;
  const epoch = ++lifecycle;
  sceneAbort = new AbortController();
  const signal = sceneAbort.signal;
  try {
    if (!sample) {
      const { data, error } =
        await auth.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      if (data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
        const factors = await auth.auth.mfa.listFactors();
        if (factors.error) throw factors.error;
        mfaFactor = factors.data.totp.find((f) => f.status === 'verified')?.id;
        if (!mfaFactor)
          throw new Error(
            'This account requires an authentication method not supported here yet.',
          );
        show('ops-login-form', false);
        show('ops-mfa-form', true);
        show('ops-switch-account', true);
        return;
      }
    }
    demo = sample;
    const data = sample
      ? (await import('./demo.js')).demoSnapshot()
      : await fetchOperations(session.access_token, filters, signal);
    if (epoch !== lifecycle) return;
    show('ops-login', false);
    show('ops-console', true);
    show('ops-loading', true);
    put(
      'ops-environment',
      sample ? 'SIMULATED DATA · SAMPLE TRIP' : 'PRODUCTION · READ ONLY',
    );
    const { createOperationsGlobe } = await import('./globe.js');
    await pendingCleanup;
    if (epoch !== lifecycle) return;
    const created = await createOperationsGlobe({
      loaderStatus: $('ops-loader-status'),
      signal,
      onSelect: selectRecord,
    });
    if (epoch !== lifecycle) {
      await created.dispose();
      return;
    }
    globe = created;
    buildLayers();
    acceptSnapshot(data);
    globe.frameTrip(filters.tripId);
    show('ops-loading', false);
    poller.start();
  } catch (error) {
    if (epoch === lifecycle && error.name !== 'AbortError')
      await lockView(error.message || 'Could not open World View.');
  } finally {
    if (epoch === lifecycle) starting = false;
  }
}

function acceptSnapshot(data) {
  snapshot = data;
  receivedAt = performance.now() - (data.transportAgeSeconds || 0) * 1000;
  connectionError = '';
  globe?.setSnapshot(data);
  if (selected) {
    const key = {
      person: 'participants',
      flight: 'flights',
      place: 'places',
      event: 'itinerary',
      safety: 'safety_points',
      alert: 'alerts',
    }[selected.kind];
    const replacement = data[key]?.find(
      (record) =>
        record.id === selected.record.id &&
        record.trip_id === selected.record.trip_id,
    );
    selected = replacement ? { ...selected, record: replacement } : null;
  }
  renderList();
  renderDetail();
  updateSync();
  updateAircraftLinks();
}

function updateSync() {
  if (!snapshot) {
    put('ops-sync', connectionError || 'Connecting…');
    return;
  }
  const age = Math.floor((performance.now() - receivedAt) / 1000);
  put(
    'ops-sync',
    connectionError
      ? `Feed interrupted · snapshot ${age}s old`
      : `${demo ? 'Sample' : 'Snapshot'} · ${age}s ago`,
  );
  $('ops-sync').classList.toggle(
    'ops-warning-text',
    Boolean(connectionError) || age > 45,
  );
  $('ops-sync').title =
    connectionError ||
    `Server snapshot: ${snapshot.generated_at}. Location age is shown separately.`;
}

function changeFilters(next) {
  filters = { ...filters, ...next };
  selected = null;
  snapshot = null;
  links.clear();
  if (globe) {
    globe.stopFollowing();
    globe.setSnapshot({
      participants: [],
      places: [],
      itinerary: [],
      safety_points: [],
      geofences: [],
      group_zones: [],
    });
    globe.flights.setContactPresentation({ onlyHighlighted: onlyFlights });
  }
  $('ops-list').replaceChildren(
    node('p', 'Loading authorized trips…', 'ops-empty'),
  );
  renderDetail();
  poller.start();
}

function tripName(id) {
  return snapshot?.trips.find((t) => t.id === id)?.title || 'Trip';
}
function tripTimezone(id) {
  return snapshot?.trips.find((t) => t.id === id)?.timezone;
}
function addRow(parent, title, detail, action, badge) {
  const row = button('', action, 'ops-row');
  row.append(node('strong', title), node('span', detail, 'ops-row-detail'));
  if (badge) row.append(node('span', badge, 'ops-row-badge'));
  parent.append(row);
  return row;
}

function renderList() {
  if (!snapshot) return;
  const list = $('ops-list');
  list.replaceChildren();
  $('ops-tabs').replaceChildren(
    ...tabs.map(([id, name]) => {
      const b = button(
        name,
        () => {
          tab = id;
          renderList();
        },
        tab === id ? 'is-active' : '',
      );
      b.setAttribute('aria-current', tab === id ? 'page' : 'false');
      return b;
    }),
  );
  put(
    'ops-scope-title',
    filters.tripId ? tripName(filters.tripId) : 'Your world, at a glance',
  );
  const located = snapshot.participants.filter((p) =>
    validPoint(p.coordinates),
  ).length;
  put(
    'ops-totals',
    `${snapshot.trips.length} trips loaded · ${located}/${snapshot.participants.length} people located`,
  );
  show('ops-all-trips', Boolean(filters.tripId));
  $('ops-source-issues').hidden = !snapshot.source_issues.length;
  put(
    'ops-source-issues',
    snapshot.source_issues
      .map(
        (x) =>
          `${human(x.source)}: ${x.reason === 'row_limit' ? 'partial results' : 'unavailable'}`,
      )
      .join(' · '),
  );
  if (tab === 'trips')
    for (const trip of snapshot.trips)
      addRow(
        list,
        trip.title || 'Untitled trip',
        `${trip.destination || ''} · ${trip.start_date} — ${trip.end_date}`,
        () => {
          tab = 'people';
          changeFilters({ tripId: trip.id, offset: 0 });
        },
        human(trip.status),
      );
  if (tab === 'people') {
    const roles = node('div', undefined, 'ops-role-filters');
    for (const role of ['traveler', 'chaperone']) {
      const label = node('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = visibleRoles[role];
      input.addEventListener('change', () => {
        visibleRoles[role] = input.checked;
        globe.setRole(role, input.checked);
        renderList();
      });
      label.append(input, document.createTextNode(`${human(role)}s`));
      roles.append(label);
    }
    list.append(roles);
    const elapsed = (performance.now() - receivedAt) / 1000;
    for (const person of snapshot.participants) {
      if (visibleRoles[person.role] === false) continue;
      const freshness = currentFreshness(person, elapsed);
      const row = addRow(
        list,
        person.name,
        `${human(person.role)} · ${tripName(person.trip_id)}`,
        () => selectRecord({ kind: 'person', record: person }),
        freshness.label,
      );
      row.dataset.freshness = freshness.state;
      row.dataset.personId = person.id;
    }
  }
  if (tab === 'flights') {
    paragraph(
      list,
      'Assignments are scheduled passengers, not proof of boarding. Green aircraft are staff-linked to a dated leg.',
      'ops-small ops-list-note',
    );
    const label = node('label', undefined, 'ops-checkbox');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = onlyFlights;
    input.addEventListener('change', () => {
      onlyFlights = input.checked;
      updateAircraftLinks();
    });
    label.append(
      input,
      document.createTextNode('Show only linked SafeTrekr aircraft'),
    );
    list.append(label);
    for (const flight of snapshot.flights)
      addRow(
        list,
        `${flight.airline || ''} ${flight.flight_number || 'Flight'}`,
        `${flight.departure_airport || '?'} → ${flight.arrival_airport || '?'} · ${shortTime(flight.departure_time, tripTimezone(flight.trip_id))}`,
        () => selectRecord({ kind: 'flight', record: flight }),
        `${flight.participant_ids.length} assigned · ${links.has(flight.id) ? 'staff linked' : 'not linked'}`,
      );
  }
  if (tab === 'itinerary')
    for (const event of [...snapshot.itinerary].sort((a, b) =>
      `${a.event_date} ${a.start_time}`.localeCompare(
        `${b.event_date} ${b.start_time}`,
      ),
    ))
      addRow(
        list,
        event.title,
        `${event.event_date || ''} · ${event.start_time || 'Time unset'} · ${event.location_name || 'Location unset'}`,
        () => selectRecord({ kind: 'event', record: event }),
        validPoint(event.coordinates) ? 'On map' : 'No coordinates',
      );
  if (tab === 'safety') {
    for (const point of snapshot.safety_points)
      addRow(
        list,
        point.name,
        `${human(point.category)} · ${tripName(point.trip_id)}`,
        () => selectRecord({ kind: 'safety', record: point }),
        human(point.approval_status),
      );
    for (const place of snapshot.places)
      addRow(
        list,
        place.name,
        `${human(place.kind)} · ${place.address || 'Address not set'}`,
        () => selectRecord({ kind: 'place', record: place }),
      );
  }
  if (tab === 'status') {
    paragraph(
      list,
      'Roll-call marking, alert acknowledgments, and GPS freshness are separate signals.',
      'ops-small ops-list-note',
    );
    for (const muster of snapshot.musters) {
      const section = node('section', undefined, 'ops-status-item');
      section.append(node('h3', muster.title || muster.name || 'Roll call'));
      paragraph(
        section,
        `${shortTime(muster.scheduled_time, tripTimezone(muster.trip_id))} · ${human(muster.status)}`,
      );
      paragraph(
        section,
        `${muster.counts.present} present · ${muster.counts.absent} absent · ${muster.counts.excused} excused · ${muster.counts.unmarked} unmarked`,
      );
      list.append(section);
    }
    for (const muster of snapshot.morning_musters) {
      const section = node('section', undefined, 'ops-status-item');
      section.append(node('h3', 'Morning muster'));
      paragraph(
        section,
        `${shortTime(muster.scheduled_for, tripTimezone(muster.trip_id))} · ${human(muster.status)}`,
      );
      list.append(section);
    }
    for (const alert of snapshot.alerts)
      addRow(
        list,
        alert.headline,
        alert.tl_dr || human(alert.category),
        () => selectRecord({ kind: 'alert', record: alert }),
        `${alert.priority || human(alert.severity)} · ${alert.acknowledged_count} acknowledged`,
      );
  }
  if (!list.querySelector('.ops-row, .ops-status-item'))
    paragraph(
      list,
      'No records in the loaded trip page. Choose another trip window or page.',
      'ops-empty',
    );
  const page = $('ops-pagination');
  page.replaceChildren();
  if (!filters.tripId) {
    const previous = button('← Previous', () =>
      changeFilters({ offset: Math.max(0, filters.offset - 10) }),
    );
    previous.disabled = filters.offset === 0;
    const next = button('Next →', () =>
      changeFilters({ offset: filters.offset + 10 }),
    );
    next.disabled = !snapshot.page.has_more;
    page.append(
      previous,
      node(
        'span',
        snapshot.page.total
          ? `${filters.offset + 1}–${filters.offset + snapshot.trips.length} / ${snapshot.page.total}`
          : '0 trips',
      ),
      next,
    );
  }
}

function selectRecord(value) {
  selected = value;
  renderDetail();
  if (validPoint(value.record.coordinates))
    globe.focus(value.record.coordinates);
}

function renderDetail() {
  const parent = $('ops-detail');
  // A background snapshot must not destroy an in-progress aircraft form.
  if (
    parent.contains(document.activeElement) &&
    document.activeElement.closest('#ops-aircraft-form')
  )
    return;
  parent.replaceChildren();
  if (!selected) {
    parent.append(
      node('p', 'WORLD VIEW', 'ops-eyebrow'),
      node('h2', 'Context starts with a person.'),
    );
    paragraph(
      parent,
      'Select a traveler, trip location, or safety point to explore nearby public cameras and ground-level context.',
    );
    paragraph(
      parent,
      'Pins show the latest reported fix. A fresh location does not establish that a traveler is safe or accounted for.',
      'ops-small',
    );
    paragraph(parent, globe?.mapMode || '3D world view', 'ops-detail-foot');
    return;
  }
  const { kind, record } = selected;
  parent.append(
    button(
      'Close',
      () => {
        selected = null;
        renderDetail();
      },
      'ops-close',
    ),
    node('p', human(kind).toUpperCase(), 'ops-eyebrow'),
    node(
      'h2',
      record.name ||
        record.title ||
        record.headline ||
        `${record.airline || ''} ${record.flight_number || 'Flight'}`,
    ),
  );
  paragraph(parent, tripName(record.trip_id));
  if (kind === 'person') {
    const f = currentFreshness(record, (performance.now() - receivedAt) / 1000);
    const stats = node('dl', undefined, 'ops-facts');
    const entries = [
      ['Role', human(record.role)],
      ['Location', f.label],
      ['Captured', shortTime(record.capturedAt, tripTimezone(record.trip_id))],
      [
        'Accuracy',
        Number.isFinite(record.accuracy_m)
          ? `±${Math.round(record.accuracy_m)} m`
          : 'Not reported',
      ],
      [
        'Battery at capture',
        Number.isFinite(record.battery_level)
          ? `${Math.round(record.battery_level * 100)}% · ${human(record.battery_state)}`
          : 'Not reported',
      ],
      [
        'Group boundary',
        record.group_zone_state
          ? `${human(f.state === 'fresh' ? record.group_zone_state : 'unknown')}${record.group_zone_ambiguous ? ' · uncertain fix' : ''}`
          : 'Open the trip for boundary status',
      ],
    ];
    for (const [key, value] of entries) {
      const cell = node('dd', value);
      cell.dataset.field = key;
      stats.append(node('dt', key), cell);
    }
    parent.append(stats);
    if (validPoint(record.coordinates)) {
      parent.append(
        button(
          'Follow reported position',
          () => globe.follow(record),
          'ops-primary',
        ),
      );
      paragraph(
        parent,
        'Follows incoming GPS updates, not a continuous movement trace.',
        'ops-small',
      );
    }
  }
  if (kind === 'flight') renderFlight(parent, record);
  else {
    if (record.address || record.location_address)
      paragraph(parent, record.address || record.location_address);
    if (kind === 'event')
      paragraph(
        parent,
        `${record.event_date || ''} · ${record.start_time || ''}–${record.end_time || ''} · ${tripTimezone(record.trip_id) || 'trip local time'}`,
      );
    if (record.approval_status)
      paragraph(
        parent,
        `${human(record.category)} · ${human(record.approval_status)}`,
        'ops-small',
      );
    if (record.instructions || record.tl_dr)
      paragraph(
        parent,
        record.instructions || record.tl_dr,
        'ops-instructions',
      );
    if (record.contact?.phone || record.phone)
      paragraph(parent, `Contact: ${record.contact?.phone || record.phone}`);
    if (kind === 'alert')
      paragraph(
        parent,
        `${record.acknowledged_count} assigned travelers/chaperones acknowledged. Required-recipient count is not available in this snapshot.`,
        'ops-small',
      );
    if (validPoint(record.coordinates)) {
      parent.append(node('h3', 'Nearby public cameras'));
      paragraph(
        parent,
        'Distance is measured from this reported location. Camera coverage and image freshness vary by source.',
        'ops-small',
      );
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Camera search radius');
      for (const distance of [1, 5, 25, 50]) {
        const option = new Option(`Within ${distance} km`, String(distance));
        option.selected = distance === 5;
        select.add(option);
      }
      const results = node('div', undefined, 'ops-camera-results');
      const search = button('Find cameras', async () => {
        const subject = selected;
        search.disabled = true;
        results.replaceChildren(
          node('p', 'Loading camera catalog…', 'ops-muted'),
        );
        try {
          await globe.manager.setEnabled('cctv', true, { origin: 'user' });
          if (
            subject?.record.id !== selected?.record.id ||
            subject?.kind !== selected?.kind ||
            !globe
          )
            return;
          const nearby = nearbyCameras(
            globe.cameras.getUIState().cameras || [],
            record.coordinates,
            Number(select.value),
          );
          results.replaceChildren();
          if (!nearby.length)
            paragraph(
              results,
              'No cataloged cameras within this radius. Try a wider radius; coverage is not worldwide.',
            );
          for (const camera of nearby.slice(0, 20))
            addRow(
              results,
              camera.name,
              `${camera.distance_km.toFixed(1)} km · ${camera.provider || camera.sourceLabel}`,
              () => {
                globe.stopFollowing();
                globe.cameras.selectCamera(camera.id, { focus: true });
              },
              `${human(camera.sourceKind)} · ${human(camera.sourceStatus)}`,
            );
        } catch {
          if (subject === selected)
            paragraph(
              results,
              'Camera catalog unavailable. Retry shortly.',
              'ops-error',
            );
        } finally {
          search.disabled = false;
        }
      });
      parent.append(select, search, results);
    }
  }
}

function renderFlight(parent, flight) {
  paragraph(
    parent,
    `${flight.departure_airport || '?'} → ${flight.arrival_airport || '?'}`,
    'ops-route',
  );
  paragraph(
    parent,
    `Departure: ${shortTime(flight.departure_time, tripTimezone(flight.trip_id))}`,
  );
  paragraph(
    parent,
    `Arrival: ${shortTime(flight.arrival_time, tripTimezone(flight.trip_id))}`,
  );
  paragraph(
    parent,
    `${flight.participant_ids.length} scheduled participants · ${human(flight.status || 'status not reported')}`,
  );
  for (const id of flight.participant_ids) {
    const p = snapshot.participants.find(
      (p) => p.id === id && p.trip_id === flight.trip_id,
    );
    if (p)
      parent.append(
        button(
          p.name,
          () => selectRecord({ kind: 'person', record: p }),
          'ops-passenger',
        ),
      );
  }
  const existing = links.get(flight.id);
  if (existing) {
    paragraph(
      parent,
      `Staff linked: ${existing.icao24.toUpperCase()} · expires ${new Date(existing.expiresAt).toLocaleTimeString()}`,
      'ops-success-text',
    );
    parent.append(
      button(
        'Follow aircraft',
        () => globe.flights.trackById(existing.icao24, { origin: 'user' }),
        'ops-primary',
      ),
      button('Remove link', () => {
        links.delete(flight.id);
        updateAircraftLinks();
        renderDetail();
        renderList();
      }),
    );
    return;
  }
  paragraph(parent, 'Link a live aircraft', 'ops-subtitle');
  paragraph(
    parent,
    'Enable the flight feed, select the aircraft to inspect it, then confirm its exact ICAO24 address for this dated leg. Links last up to two hours in this session.',
    'ops-small',
  );
  parent.append(
    button('Enable live flight layer', async (event) => {
      const trigger = event.currentTarget;
      trigger.disabled = true;
      try {
        await globe.manager.setEnabled('flights', true, { origin: 'user' });
      } catch {
        paragraph(parent, 'Live flight feed unavailable.', 'ops-error');
      } finally {
        trigger.disabled = false;
      }
    }),
  );
  const form = node('form');
  form.id = 'ops-aircraft-form';
  const label = node('label', 'ICAO24 address');
  const input = document.createElement('input');
  input.name = 'icao';
  input.placeholder = 'e.g. A1B2C3';
  input.pattern = '[a-fA-F0-9]{6}';
  input.maxLength = 6;
  input.required = true;
  label.append(input);
  const checkLabel = node('label', undefined, 'ops-checkbox');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.required = true;
  checkLabel.append(
    check,
    document.createTextNode(
      'I verified this aircraft belongs to this flight, date, and route.',
    ),
  );
  const submit = node('button', 'Link for this session', 'ops-primary');
  submit.type = 'submit';
  submit.disabled = flight.participant_ids.length === 0;
  const error = node('p', '', 'ops-error');
  error.setAttribute('role', 'alert');
  form.append(label, checkLabel, submit, error);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const aircraft = globe.flights.getContactById(input.value);
      links.set(flight.id, makeAircraftLink(flight, aircraft, check.checked));
      document.activeElement?.blur();
      updateAircraftLinks();
      renderList();
      renderDetail();
    } catch (problem) {
      error.textContent = problem.message;
    }
  });
  parent.append(form);
}

function updateAircraftLinks() {
  if (!globe || !snapshot) return;
  const ids = [];
  let removed = false;
  for (const [id, link] of links) {
    const flight = snapshot.flights.find((f) => f.id === id);
    const aircraft = globe.flights.getContactById(link.icao24);
    if (liveAircraftLink(link, flight, aircraft)) ids.push(link.icao24);
    else {
      links.delete(id);
      removed = true;
    }
  }
  globe.flights.setContactPresentation({
    highlightedIds: ids,
    onlyHighlighted: onlyFlights,
  });
  if (removed) {
    if (tab === 'flights') renderList();
    if (selected?.kind === 'flight') renderDetail();
  }
}

function buildLayers() {
  const container = $('ops-layers');
  container.replaceChildren(node('h3', 'Map layers'));
  for (const [id, title, checked] of [
    ['people', 'Travelers & chaperones', true],
    ['places', 'Lodging & venues', true],
    ['safety', 'Safety resources', true],
    ['itinerary', 'Itinerary stops', false],
    ['boundaries', 'Trip boundaries', true],
    ['flights', 'Live aircraft', false],
    ['cctv', 'Public cameras', false],
    ['earthquakes', 'USGS earthquakes', false],
  ]) {
    const label = node('label', undefined, 'ops-checkbox');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', async () => {
      if (['flights', 'cctv', 'earthquakes'].includes(id)) {
        input.disabled = true;
        try {
          await globe.manager.setEnabled(id, input.checked, { origin: 'user' });
        } catch {
          input.checked = false;
          paragraph(container, `${title} unavailable.`, 'ops-error');
        } finally {
          input.disabled = false;
        }
      } else globe.setLayer(id, input.checked);
    });
    label.append(input, document.createTextNode(title));
    container.append(label);
  }
  paragraph(
    container,
    'Public feeds have separate coverage, update times, and access terms. Live aircraft use the existing OpenSky / ADS-B sources.',
    'ops-small',
  );
}

$('ops-window').addEventListener('change', (event) =>
  changeFilters({ window: event.target.value, offset: 0, tripId: null }),
);
$('ops-all-trips').addEventListener('click', () => {
  tab = 'trips';
  changeFilters({ tripId: null, offset: 0 });
});
$('ops-frame').addEventListener('click', () =>
  globe?.frameTrip(filters.tripId),
);
$('ops-stop-follow').addEventListener('click', () => globe?.stopFollowing());
$('ops-signout').addEventListener('click', signOut);
$('ops-switch-account').addEventListener('click', signOut);
$('ops-layers-button').addEventListener('click', (event) => {
  const open = $('ops-layers').hidden;
  show('ops-layers', open);
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
$('ops-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!auth) return;
  put('ops-auth-error', '');
  const submit = event.currentTarget.querySelector('button');
  submit.disabled = true;
  const data = new FormData(event.currentTarget);
  try {
    const result = await auth.auth.signInWithPassword({
      email: String(data.get('email')).trim(),
      password: String(data.get('password')),
    });
    if (result.error) throw result.error;
    $('ops-login-form').elements.password.value = '';
    await openSession(result.data.session);
  } catch (error) {
    put('ops-auth-error', error.message || 'Sign-in failed.');
  } finally {
    submit.disabled = false;
  }
});
$('ops-mfa-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button');
  submit.disabled = true;
  try {
    const { error } = await auth.auth.mfa.challengeAndVerify({
      factorId: mfaFactor,
      code: String(new FormData(event.currentTarget).get('code')),
    });
    if (error) throw error;
    show('ops-mfa-form', false);
    const { data } = await auth.auth.getSession();
    await openSession(data.session);
  } catch (error) {
    put('ops-auth-error', error.message);
  } finally {
    submit.disabled = false;
  }
});
if (import.meta.env.DEV) {
  show('ops-demo', true);
  $('ops-demo').addEventListener('click', () => openSession(null, true));
  if (new URLSearchParams(location.search).get('demo') === '1')
    void openSession(null, true);
}
if (!auth) {
  put(
    'ops-auth-error',
    'Supabase configuration is missing. Add the public project URL and publishable key to .env.local, then restart.',
  );
  $('ops-login-form').querySelector('button').disabled = true;
} else {
  auth.auth.onAuthStateChange((event, value) => {
    // Supabase callbacks must return synchronously; auth work runs afterward.
    if (event === 'SIGNED_OUT' && !demo) {
      session = null;
      void lockView();
    } else if (event === 'TOKEN_REFRESHED') {
      session = value;
      if (globe && !demo) poller.start();
    } else if (
      event === 'SIGNED_IN' &&
      session?.user?.id &&
      value?.user?.id !== session.user.id
    ) {
      void lockView('Account changed. Sign in to load this account’s trips.');
      session = value;
    }
  });
  if (!(
    import.meta.env.DEV &&
    new URLSearchParams(location.search).get('demo') === '1'
  )) {
    void auth.auth.getSession().then(({ data }) => {
      if (data.session) void openSession(data.session);
    });
  }
}
setInterval(() => {
  updateSync();
  updateAircraftLinks();
  updateVisibleAges();
}, 5000);

function updateVisibleAges() {
  if (!snapshot) return;
  const elapsed = (performance.now() - receivedAt) / 1000;
  for (const row of $('ops-list').querySelectorAll('[data-person-id]')) {
    const person = snapshot.participants.find(
      (p) => p.id === row.dataset.personId,
    );
    if (!person) continue;
    const age = currentFreshness(person, elapsed);
    row.dataset.freshness = age.state;
    row.querySelector('.ops-row-badge').textContent = age.label;
  }
  if (selected?.kind === 'person') {
    const age = currentFreshness(selected.record, elapsed);
    const cell = $('ops-detail').querySelector('[data-field="Location"]');
    if (cell) cell.textContent = age.label;
    const zone = $('ops-detail').querySelector('[data-field="Group boundary"]');
    if (zone && age.state !== 'fresh' && selected.record.group_zone_state)
      zone.textContent = 'unknown';
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) poller.stop();
  else if (globe) poller.start();
});
window.addEventListener('pagehide', () => {
  poller.stop();
  sceneAbort?.abort();
  links.clear();
});
