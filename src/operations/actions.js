const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const option = (value, label) => Object.assign(el('option', label), { value });
const groups = {
  all: 'All trip participants',
  travelers: 'Travelers',
  chaperones: 'Chaperones',
};

export function eligibleDestinations(snapshot, tripId, audience) {
  return (snapshot?.safety_points || []).filter(
    (point) =>
      point.trip_id === tripId &&
      point.approval_status === 'active' &&
      ['rally_point', 'safe_house', 'relocation', 'poi'].includes(
        point.source,
      ) &&
      point.visibility !== 'org_internal' &&
      (!point.chaperone_only || audience === 'chaperones') &&
      (point.address || point.coordinates),
  );
}

export function deliveryMessage(result) {
  const delivery = result.push_delivery || {};
  if (typeof delivery.provider_accepted !== 'number')
    return 'The alert was saved in the traveler app. Push acceptance could not be confirmed. Check the trip before sending again.';
  return (
    `The alert was saved in the traveler app. Push service accepted ${delivery.provider_accepted} device notifications` +
    `${typeof delivery.attempted === 'number' ? ` out of ${delivery.attempted} attempted` : ''}.` +
    `${delivery.unreached_recipients ? ` ${delivery.unreached_recipients} recipients have no confirmed push acceptance.` : ''}` +
    `${delivery.retry_scheduled ? ' Automatic push retries are scheduled.' : ''}` +
    ' Acceptance does not confirm that a traveler has seen the message.'
  );
}

export function mountTripActions({
  container,
  getContext,
  onSent,
  onAuthError,
}) {
  let generation = 0,
    scopeKey = '',
    activeTrip = null;
  const dialog = el('dialog', undefined, 'ops-action-dialog');
  dialog.id = 'ops-action-dialog';
  document.body.append(dialog);
  const close = () => {
    generation++;
    activeTrip = null;
    dialog.close();
    dialog.replaceChildren();
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  const buttons = [
    ['broadcast', 'Send alert', 'send_alert'],
    ['direct-group', 'Direct group', 'direct_group'],
  ].map(([kind, label, capability]) => {
    const button = el('button', label, 'ops-action-launch');
    button.type = 'button';
    button.dataset.action = kind;
    button.addEventListener('click', () => open(kind));
    container.append(button);
    return { button, capability };
  });

  function update() {
    const { snapshot, accountId, demo } = getContext();
    const nextKey = `${accountId}:${demo}:${snapshot?.scope?.kind}:${snapshot?.scope?.org_id}`;
    if (
      nextKey !== scopeKey ||
      (activeTrip && !snapshot?.trips.some((trip) => trip.id === activeTrip))
    )
      close();
    scopeKey = nextKey;
    for (const { button, capability } of buttons) {
      button.hidden = !snapshot?.capabilities?.[capability];
      button.disabled = !snapshot?.trips.length;
    }
    container.hidden = buttons.every(({ button }) => button.hidden);
  }

  function open(kind, preset = {}) {
    const ctx = getContext();
    const capability = kind === 'broadcast' ? 'send_alert' : 'direct_group';
    if (!ctx.snapshot?.capabilities?.[capability] || !ctx.snapshot.trips.length)
      return;
    close();
    const epoch = generation;
    const heading = el(
      'h2',
      kind === 'broadcast' ? 'Send alert' : 'Direct group',
    );
    heading.id = 'ops-action-heading';
    dialog.setAttribute('aria-labelledby', heading.id);
    const cancel = el('button', 'Close', 'ops-action-close');
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    const form = el('form');
    form.id = 'ops-action-form';
    const fields = el('div');
    const field = (label, input) => {
      const wrapper = el('label', label);
      wrapper.append(input);
      fields.append(wrapper);
      return input;
    };
    const trip = field('Trip', el('select'));
    trip.name = 'trip';
    trip.append(
      ...ctx.snapshot.trips.map((t) =>
        option(t.id, t.title || 'Untitled trip'),
      ),
    );
    trip.value = preset.tripId || ctx.tripId || ctx.snapshot.trips[0].id;
    activeTrip = trip.value;
    const audience = field('Send to', el('select'));
    audience.name = 'audience';
    audience.append(
      ...Object.entries(groups).map(([value, label]) => option(value, label)),
    );
    const title = el('input');
    title.name = 'title';
    title.maxLength = 200;
    title.required = true;
    const message = el('textarea');
    message.name = 'message';
    message.maxLength = 4000;
    message.rows = 5;
    message.required = true;
    const severity = el('select');
    severity.name = 'severity';
    severity.append(
      ...[
        ['low', 'Information'],
        ['medium', 'Notice'],
        ['high', 'Urgent'],
        ['critical', 'Emergency'],
      ].map(([v, label]) => option(v, label)),
    );
    severity.value = 'medium';
    const destination = el('select');
    destination.name = 'destination';
    destination.required = true;
    const minutes = el('input');
    Object.assign(minutes, {
      name: 'minutes',
      type: 'number',
      min: '1',
      max: '10080',
      value: '15',
      required: true,
    });
    const note = el('textarea');
    Object.assign(note, { name: 'note', maxLength: 2000, rows: 3 });
    const populateDestinations = () => {
      const current = getContext().snapshot;
      const selected = preset.destinationId
        ? `${preset.destinationSource}:${preset.destinationId}`
        : destination.value;
      destination.replaceChildren(
        option('', 'Select an approved destination'),
        ...eligibleDestinations(current, trip.value, audience.value).map(
          (point) =>
            option(
              `${point.source}:${point.id}`,
              `${point.name} · ${point.category.replaceAll('_', ' ')}`,
            ),
        ),
      );
      if ([...destination.options].some((o) => o.value === selected))
        destination.value = selected;
    };
    if (kind === 'broadcast') {
      field('Subject', title);
      field('Message', message);
      field('Priority', severity);
    } else {
      field('Destination', destination);
      field('Arrive within (minutes)', minutes);
      field('Additional instructions (optional)', note);
      fields.append(
        el(
          'p',
          'Only approved destinations visible to the selected audience are available. This sends an urgent alert with the destination and deadline.',
          'ops-small',
        ),
      );
      populateDestinations();
      audience.addEventListener('change', populateDestinations);
    }
    trip.addEventListener('change', () => {
      activeTrip = trip.value;
      if (kind !== 'broadcast') populateDestinations();
    });
    const error = el('p', '', 'ops-error');
    error.setAttribute('role', 'alert');
    const review = el('section', undefined, 'ops-action-review');
    review.hidden = true;
    const submit = el('button', 'Review message', 'ops-primary');
    submit.type = 'submit';
    const back = el('button', 'Back to edit');
    back.type = 'button';
    back.hidden = true;
    let payload = null,
      sending = false;
    back.addEventListener('click', () => {
      payload = null;
      fields.hidden = false;
      review.hidden = true;
      back.hidden = true;
      submit.textContent = 'Review message';
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (sending) return;
      error.textContent = '';
      const current = getContext();
      if (
        !current.snapshot?.trips.some((t) => t.id === trip.value) ||
        !current.snapshot.capabilities?.[capability]
      ) {
        close();
        return;
      }
      if (!payload) {
        let preview;
        if (kind === 'broadcast') {
          if (!title.value.trim() || !message.value.trim()) {
            error.textContent = 'Enter a subject and message.';
            return;
          }
          payload = {
            title: title.value.trim(),
            message: message.value.trim(),
            recipient_group: audience.value,
            severity: severity.value,
          };
          preview = `${payload.title}\n\n${payload.message}\n\nPriority: ${severity.selectedOptions[0].textContent}`;
        } else {
          const point = eligibleDestinations(
            current.snapshot,
            trip.value,
            audience.value,
          ).find((p) => `${p.source}:${p.id}` === destination.value);
          if (!point) {
            error.textContent =
              'Choose an approved destination for this audience.';
            return;
          }
          payload = {
            destination_id: point.id,
            destination_source: point.source,
            recipient_group: audience.value,
            arrival_minutes: Number(minutes.value),
            note: note.value.trim(),
          };
          preview = `Go to ${point.name}\n${point.address || ''}\n${point.coordinates ? `Map: ${point.coordinates.lat}, ${point.coordinates.lng}\n` : ''}Arrive within ${minutes.value} minutes.\n${note.value.trim()}`;
        }
        review.replaceChildren(
          el('h3', 'Review before sending'),
          el(
            'p',
            `${trip.selectedOptions[0].textContent} · ${groups[audience.value]}`,
          ),
          el('p', preview, 'ops-action-preview'),
          el(
            'p',
            current.demo
              ? 'Sample mode: this is a simulated send.'
              : 'This creates a traveler-app alert and sends a push notification to the selected audience. Participants need an active app account and push registration to receive push notifications.',
            'ops-small',
          ),
        );
        fields.hidden = true;
        review.hidden = false;
        back.hidden = false;
        submit.textContent = current.demo ? 'Simulate send' : 'Send now';
        submit.focus();
        return;
      }
      sending = true;
      submit.disabled = true;
      back.disabled = true;
      submit.textContent = 'Sending…';
      try {
        let result;
        if (current.demo)
          result = {
            alert_id: 'sample',
            push_delivery: { provider_accepted: 0, attempted: 0 },
          };
        else {
          const response = await fetch(
            `/api/safetrekr/operations/trips/${encodeURIComponent(trip.value)}/${kind}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${current.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
              cache: 'no-store',
              signal: AbortSignal.timeout(55000),
            },
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            if ([401, 403].includes(response.status) && generation === epoch)
              onAuthError?.(response.status);
            const detail =
              data.detail?.message ||
              (typeof data.detail === 'string' ? data.detail : null);
            const messages = {
              404: 'The trip or destination is no longer available.',
              409: detail || 'The destination is no longer available.',
              410: 'This trip has ended.',
              422: 'Check the message, destination, and arrival time.',
              429: 'Too many messages. Wait before sending again.',
            };
            throw Object.assign(
              new Error(
                messages[response.status] ||
                  'Send result could not be confirmed. Check the trip alerts before sending again.',
              ),
              {
                retryable: [404, 409, 410, 422, 429].includes(response.status),
              },
            );
          }
          result = data;
        }
        if (generation !== epoch) return;
        review.replaceChildren(
          el('h3', current.demo ? 'Simulated send complete' : 'Alert created'),
          el(
            'p',
            current.demo
              ? 'No notification was sent.'
              : deliveryMessage(result),
          ),
          el('p', `Trip: ${trip.selectedOptions[0].textContent}`, 'ops-small'),
        );
        back.hidden = true;
        submit.hidden = true;
        onSent?.(result, current.demo);
      } catch (problem) {
        if (generation !== epoch) return;
        error.textContent = problem.retryable
          ? problem.message
          : 'Send result could not be confirmed. The alert may already exist. Close this window and check the trip alerts before sending again.';
        if (problem.retryable) {
          sending = false;
          back.disabled = false;
          submit.disabled = false;
          submit.textContent = 'Send now';
        } else {
          back.hidden = true;
          submit.hidden = true;
          onSent?.(null, current.demo);
        }
      }
    });
    form.append(fields, review, error, back, submit);
    dialog.append(cancel, heading, form);
    dialog.showModal();
  }
  update();
  return {
    update,
    open,
    close,
    dispose() {
      close();
      dialog.remove();
      container.replaceChildren();
    },
  };
}
