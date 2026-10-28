// SafeTrekr Executive B3: the WebSocket tap (EP-51 §3). The wall page is
// page.js, unchanged; its relay socket is opened by twinSync.js
// connectSync, which reads globalThis.WebSocket when it connects
// (twinIdentity.js browserEnv). Installed before page.js is imported, this
// tap swaps in a subclass that adds one more message listener to the
// relay socket and hands the executive messages ({t:'loop'},
// {t:'loop-clock'}, {t:'loop-role'}) to the walls. Nothing is changed,
// dropped or reordered: the wall's own listener sees every message as the
// relay sent it. twinTap.test.mjs fails if connectSync stops reading
// globalThis.WebSocket at connect time.

/** The relay's socket path (twinSync.js). */
export const RELAY_PATH = /\/api\/twin-sync$/;
/** Every executive message starts with this (execProtocol.js EXEC_MSG). */
const EXEC_PREFIX = '{"t":"loop';

/**
 * Wrap `target.WebSocket` once. `onMessage(m)` gets each parsed executive
 * message from a relay socket. Returns the class now in place.
 */
export function installTap(onMessage, { target = globalThis } = {}) {
  const Native = target.WebSocket;
  if (!Native) return null;
  if (Native.executiveTap) return Native;
  class TappedWebSocket extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      if (!RELAY_PATH.test(String(url))) return;
      this.addEventListener('message', (e) => {
        const text = e?.data;
        if (typeof text !== 'string' || !text.startsWith(EXEC_PREFIX)) return;
        let m;
        try {
          m = JSON.parse(text);
        } catch {
          return;
        }
        try {
          onMessage(m);
        } catch (err) {
          // A wall drawing error never reaches the relay socket.
          globalThis.console?.error?.('executive wall', err);
        }
      });
    }
  }
  Object.defineProperty(TappedWebSocket, 'executiveTap', { value: true });
  target.WebSocket = TappedWebSocket;
  return TappedWebSocket;
}
