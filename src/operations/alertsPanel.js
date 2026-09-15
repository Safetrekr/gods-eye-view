import { buildAlertFeed } from './alertFeed.js';
import { validPoint } from './model.js';

const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const button = (label, action, cls) => {
  const node = el('button', label, cls);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
};
const labels = {
  alert: 'Trip alert',
  direction: 'Group direction',
  geofence: 'Geofence',
  earthquake: 'Earthquake',
  fire: 'Fire observations',
};

export function mountAlertsPanel({
  panel,
  trigger,
  getContext,
  onPanelChange,
  onMap,
  onTrip,
  onAlert,
  onWorldControls,
}) {
  let alive = true,
    mode = 'nearby',
    category = 'all',
    onlyNew = false,
    scopeKey = '',
    expanded = null;
  let reviewed = new Set(),
    feed = { items: [], notices: [], total: 0 };
  let snapshot = null;
  const heading = el('div', undefined, 'ops-world-heading');
  const title = el('div');
  title.append(
    el('p', 'Monitor & respond', 'ops-eyebrow'),
    el('h2', 'Alerts & activity'),
  );
  const closeButton = button('Close', () => setOpen(false), 'ops-world-close');
  heading.append(title, closeButton);
  const filters = el('div', undefined, 'ops-alert-filters');
  const scopeNav = el('nav', undefined, 'ops-alert-scope');
  scopeNav.setAttribute('aria-label', 'World event scope');
  const scopes = [
    ['nearby', 'Near trips'],
    ['worldwide', 'Worldwide'],
  ].map(([id, label]) => {
    const choice = button(label, () => {
      mode = id;
      update();
    });
    choice.dataset.alertScope = id;
    scopeNav.append(choice);
    return [id, choice];
  });
  const typeLabel = el('label', 'Show');
  const typeSelect = el('select');
  typeSelect.id = 'ops-alert-category';
  for (const [value, label] of [
    ['all', 'All activity'],
    ['trip', 'Trip activity'],
    ['geofence', 'Geofences'],
    ['direction', 'Group directions'],
    ['earthquake', 'Earthquakes'],
    ['fire', 'Fires'],
  ]) {
    const option = el('option', label);
    option.value = value;
    typeSelect.append(option);
  }
  typeSelect.addEventListener('change', () => {
    category = typeSelect.value;
    render();
  });
  typeLabel.append(typeSelect);
  const newLabel = el('label', undefined, 'ops-alert-new-filter');
  const newInput = el('input');
  newInput.type = 'checkbox';
  newInput.addEventListener('change', () => {
    onlyNew = newInput.checked;
    render();
  });
  newLabel.append(newInput, el('span', 'Unreviewed only'));
  const reviewAll = button('Mark shown reviewed', () => {
    for (const item of visibleItems().slice(0, 100)) reviewed.add(item.id);
    render();
  });
  reviewAll.id = 'ops-alert-review-all';
  filters.append(scopeNav, typeLabel, newLabel, reviewAll);
  const coverage = el('p', '', 'ops-alert-coverage');
  const notices = el('div', undefined, 'ops-alert-notices');
  const summary = el('p', '', 'ops-alert-summary');
  summary.setAttribute('role', 'status');
  const list = el('div', undefined, 'ops-alert-list');
  list.id = 'ops-alert-list';
  const foot = el(
    'p',
    'Review status applies only to this signed-in view. It does not acknowledge an alert for travelers or confirm their safety.',
    'ops-alert-foot',
  );
  panel.replaceChildren(
    heading,
    filters,
    coverage,
    notices,
    summary,
    list,
    foot,
  );

  function setOpen(open, focus = true) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    onPanelChange(open);
    if (open) update();
    if (focus) (open ? closeButton : trigger).focus();
  }
  const toggle = () => setOpen(panel.hidden);
  trigger.addEventListener('click', toggle);
  const escape = (event) => {
    if (
      event.key === 'Escape' &&
      !panel.hidden &&
      !document.querySelector('dialog[open]')
    )
      setOpen(false);
  };
  document.addEventListener('keydown', escape);

  function visibleItems() {
    return feed.items.filter(
      (item) =>
        (!onlyNew || !reviewed.has(item.id)) &&
        (category === 'all' ||
          item.kind === category ||
          (category === 'trip' &&
            ['alert', 'direction', 'geofence'].includes(item.kind))),
    );
  }

  function render() {
    if (!alive) return;
    const focused = list.contains(document.activeElement)
      ? {
          id: document.activeElement.closest('[data-event-id]')?.dataset
            .eventId,
          action: document.activeElement.dataset.action,
        }
      : null;
    const previousScroll = list.scrollTop;
    for (const [id, choice] of scopes)
      choice.setAttribute('aria-pressed', String(mode === id));
    const unread = feed.items.filter((item) => !reviewed.has(item.id)).length;
    trigger.textContent = unread
      ? `Alerts · ${unread > 99 ? '99+' : unread}`
      : 'Alerts';
    trigger.title = `${unread} unreviewed items in ${mode === 'nearby' ? 'the near-trips view' : 'the worldwide view'}`;
    trigger.classList.toggle('ops-alert-unread', unread > 0);
    coverage.textContent =
      mode === 'nearby'
        ? 'Active trip alerts + last 24 hours of geofence and world events. Earthquakes within 250 km, fire areas within ~25 km of fresh locations or loaded trip sites. Proximity does not establish impact.'
        : 'Active trip alerts + last 24 hours of geofence and world events. Worldwide M2.5+ earthquakes and grouped heat observations. Private activity stays limited to loaded trips.';
    notices.replaceChildren(...feed.notices.map((text) => el('p', text)));
    if (
      feed.notices.some((text) =>
        /layer is off|is loading|feed is delayed/.test(text),
      )
    )
      notices.append(button('Open World controls', onWorldControls));
    notices.hidden = !feed.notices.length;
    const items = visibleItems();
    summary.textContent = `${Math.min(100, items.length)} of ${items.length.toLocaleString()} matching items · ${snapshot?.trips.length || 0} loaded trips`;
    reviewAll.disabled = !items
      .slice(0, 100)
      .some((item) => !reviewed.has(item.id));
    const nodes = items.slice(0, 100).map((item) => {
      const article = el('article', undefined, 'ops-alert-card');
      article.dataset.eventId = item.id;
      article.dataset.kind = item.kind;
      article.dataset.priority = String(item.priority);
      article.classList.toggle('is-reviewed', reviewed.has(item.id));
      const meta = el('div', undefined, 'ops-alert-meta');
      meta.append(
        el(
          'span',
          `${labels[item.kind]}${item.priority === 3 ? ' · Critical' : item.priority === 2 ? ' · Attention' : ''}`,
        ),
        el(
          'span',
          reviewed.has(item.id) ? 'Reviewed here' : 'New',
          'ops-alert-review-state',
        ),
      );
      const title = button(
        item.title,
        () => {
          expanded = expanded === item.id ? null : item.id;
          render();
        },
        'ops-alert-title',
      );
      title.dataset.action = 'expand';
      title.setAttribute('aria-expanded', String(expanded === item.id));
      const time = el(
        'time',
        item.timeMs
          ? new Date(item.timeMs).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short',
            })
          : 'Time not supplied',
      );
      if (item.timeMs) time.dateTime = new Date(item.timeMs).toISOString();
      const origin = el('p', `${item.source} · `, 'ops-alert-origin');
      origin.append(time);
      article.append(meta, title, origin);
      const match = item.near?.[0];
      if (match)
        article.append(
          el(
            'p',
            `~${Math.round(match.distanceKm)} km from ${tripName(match.tripId)} · ${match.label}${item.tripIds.length > 1 ? ` + ${item.tripIds.length - 1} other trip(s)` : ''}`,
            'ops-alert-match',
          ),
        );
      else if (item.tripIds.length)
        article.append(
          el('p', item.tripIds.map(tripName).join(' · '), 'ops-alert-match'),
        );
      const detail = el('div', undefined, 'ops-alert-body');
      detail.hidden = expanded !== item.id;
      detail.append(el('p', item.body), el('p', item.detail, 'ops-small'));
      const actions = el('div', undefined, 'ops-alert-card-actions');
      const add = (label, action, id) => {
        const b = button(label, action);
        b.dataset.action = id;
        actions.append(b);
      };
      if (validPoint(item.coordinates))
        add('View on map', () => onMap(item), 'map');
      if (item.record)
        add('Open trip alert', () => onAlert(item.record), 'alert');
      for (const id of item.tripIds.slice(0, 3))
        add(`Open ${tripName(id)}`, () => onTrip(id), `trip:${id}`);
      if (!reviewed.has(item.id))
        add(
          'Mark reviewed here',
          () => {
            reviewed.add(item.id);
            render();
          },
          'review',
        );
      detail.append(actions);
      article.append(detail);
      return article;
    });
    list.replaceChildren(...nodes);
    if (!items.length)
      list.append(
        el(
          'p',
          onlyNew
            ? 'No unreviewed items match these filters.'
            : 'No matching events in the available feeds. Check source status above; this is not an all-clear.',
          'ops-empty',
        ),
      );
    list.scrollTop = previousScroll;
    if (focused) {
      const card = [...list.children].find(
        (node) => node.dataset.eventId === focused.id,
      );
      const target =
        card &&
        [...card.querySelectorAll('button')].find(
          (button) => button.dataset.action === focused.action,
        );
      (target || closeButton).focus({ preventScroll: true });
    }
  }
  const tripName = (id) =>
    snapshot?.trips.find((trip) => trip.id === id)?.title || 'Trip';

  function update() {
    const context = getContext();
    snapshot = context.snapshot;
    const nextKey = `${context.accountId}:${context.demo}:${snapshot?.scope?.kind}:${snapshot?.scope?.org_id}`;
    if (nextKey !== scopeKey) {
      reviewed.clear();
      expanded = null;
      scopeKey = nextKey;
    }
    feed = buildAlertFeed({ ...context, mode });
    // Scope filters must not turn already-reviewed world items back into new
    // items. Bound this identifier-only, session-local history independently.
    if (reviewed.size > 10000) reviewed = new Set([...reviewed].slice(-10000));
    if (context.connectionError)
      feed.notices.unshift(
        'Trip feed interrupted. This panel is showing the last available snapshot.',
      );
    else if (context.elapsedSeconds > 45)
      feed.notices.unshift(
        'Trip snapshot is aging. Activity may be incomplete.',
      );
    render();
  }
  const timer = setInterval(() => {
    if (!document.hidden) update();
  }, 15000);
  update();
  return {
    update,
    open: (focus = true) => setOpen(true, focus),
    close: (focus = true) => setOpen(false, focus),
    dispose() {
      alive = false;
      clearInterval(timer);
      reviewed.clear();
      feed = null;
      snapshot = null;
      trigger.removeEventListener('click', toggle);
      document.removeEventListener('keydown', escape);
      panel.replaceChildren();
      panel.hidden = true;
      trigger.textContent = 'Alerts';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.classList.remove('ops-alert-unread');
      onPanelChange(false);
    },
  };
}
