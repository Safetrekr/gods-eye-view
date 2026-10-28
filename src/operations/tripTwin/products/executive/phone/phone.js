// SafeTrekr Executive B2: a bare mock phone (twin-phone.html). It pairs as
// device kind `phone` for one participant (EP-35 §7) and lists what
// selectPhone sends it, with Accept and answer buttons. The Traveler app's
// look is B5. Pairing: `?ticket=…` (a link from the presenter), or `?p=…`
// on the Trip Twin computer itself. Every string goes through textContent.
import { connectExec } from '../host/execClient.js';
import { EXEC_MSG } from '../host/execProtocol.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('ph-app');
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const head = el('header', 'ph-head');
const chip = el('span', 'ph-chip', 'SAMPLE');
const who = el('span', 'ph-who', 'Pairing…');
const link = el('span', 'ph-link', 'connecting');
head.append(chip, who, link);
const status = el('div', 'ph-status');
const list = el('div', 'ph-list');
const note = el('div', 'ph-note');
app.append(head, status, list, note);

let phone = null;
const delivered = new Set();

function send(cmd) {
  return client.request({ t: EXEC_MSG.PHONE_CMD, cmd }).then((r) => {
    note.textContent = r.ok
      ? `${cmd.type} sent`
      : `refused: ${r.code || r.error}`;
    return r;
  });
}

function render() {
  if (!phone) return;
  who.textContent = phone.callsign;
  const bits = [`sharing ${phone.sharing}`];
  if (phone.next_checkin_due_at)
    bits.push(`next check-in ${phone.next_checkin_due_at.slice(11, 16)}Z`);
  status.replaceChildren(el('div', 'ph-line', bits.join(' · ')));
  if (phone.checkin) {
    const b = el('button', 'ph-btn', 'Check in: OK');
    b.onclick = () =>
      send({ type: 'checkin.respond', status: 'ok', text: 'OK' });
    status.append(b);
  }
  const share = el(
    'button',
    'ph-btn',
    phone.sharing === 'on' ? 'Pause sharing' : 'Share location',
  );
  share.onclick = () =>
    send({ type: 'sharing.set', on: phone.sharing !== 'on' });
  status.append(share);

  list.replaceChildren(
    ...(phone.alerts.length ? [] : [el('div', 'ph-dim', 'No alerts')]),
    ...phone.alerts.map((a) => {
      // A phone says delivered on receipt (EP-35 §7).
      if (!a.rung && !delivered.has(a.id) && !a.expired) {
        delivered.add(a.id);
        send({
          type: 'ack',
          push_id: a.id,
          rung: 'delivered',
          source: 'app open',
        });
      }
      const card = el('article', `ph-card${a.expired ? ' ph-expired' : ''}`);
      if (a.header) card.append(el('div', 'ph-kicker', a.header));
      card.append(
        el('div', 'ph-title', `${a.priority} · ${a.title}`),
        el('div', 'ph-msg', a.message),
        el(
          'div',
          'ph-meta',
          `${a.rung ? a.rung.toUpperCase() : 'NEW'}${a.dl ? ` · DL: ${a.dl.answer}` : ''}${a.expired ? ' · EXPIRED' : ''}${a.expiresAt ? ` · valid until ${a.expiresAt.slice(11, 16)}Z` : ''}`,
        ),
      );
      if (!a.expired) {
        const row = el('div', 'ph-row');
        const ack = (rung, label) => {
          const b = el('button', 'ph-btn', label);
          b.onclick = () =>
            send({
              type: 'ack',
              push_id: a.id,
              rung,
              source: rung === 'read' ? 'app open' : 'reply word',
            });
          row.append(b);
        };
        if (!a.rung || a.rung === 'delivered') ack('read', 'Open');
        // A detail leader answers in place of Accept (I5): the push's own
        // card carries the answer buttons.
        if ((a.buttons || []).includes('Non-concur')) {
          if (!a.dl)
            for (const answer of [
              'concur',
              'nonconcur',
              'executing',
              'request_support',
            ]) {
              const b = el('button', 'ph-btn', answer.replace('_', ' '));
              b.onclick = () =>
                send({
                  type: 'dl.respond',
                  push_id: a.id,
                  answer,
                  principal_informed: true,
                });
              row.append(b);
            }
        } else {
          if (a.rung !== 'accepted' && a.rung !== 'done')
            ack('accepted', 'Accept');
          if (a.rung === 'accepted') ack('done', 'Done');
        }
        card.append(row);
      }
      return card;
    }),
    ...phone.messages.map((m) =>
      el(
        'div',
        'ph-msgline',
        `${m.at.slice(11, 16)}Z · ${m.from} · ${m.text ?? m.kind}`,
      ),
    ),
  );
}

const client = connectExec({
  kind: 'phone',
  participantId: params.get('p'),
  ticket: params.get('ticket'),
  on: {
    status: (s) => (link.textContent = s),
    welcome: (m) => {
      who.textContent = m.callsign || m.participant_id;
      note.textContent = 'paired';
      // A ticket is used once: keep it out of the address bar.
      if (params.get('ticket'))
        history.replaceState(null, '', location.pathname);
    },
    loop: (m) => {
      if (m.view !== 'phone') return;
      phone = m.phone;
      if (m.clock) chip.textContent = m.clock.label;
      render();
    },
    clock: (c) => (chip.textContent = c.label),
    denied: (m) => (note.textContent = `refused: ${m.code} · ${m.error || ''}`),
  },
});
