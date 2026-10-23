// Trip Twin multi-view wire names and codes (Phase CF K4; PHASE-CF-PLAN
// S-8, S-16, C16). Constants only: one list for the relay, the session
// host, the walls and the remote. K5 completes it (PROTO, PROTO_MIN, the
// command codes and the schema hash).

/** Hello deny codes: `{t:'welcome', type:'denied', code, error}`. */
export const DENY = Object.freeze({
  NO_ID: 'NO_ID',
  ID_IN_USE: 'ID_IN_USE',
  ID_COPIED: 'ID_COPIED',
  TICKET_USED: 'TICKET_USED',
  TICKET_EXPIRED: 'TICKET_EXPIRED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORGOTTEN: 'FORGOTTEN',
  RATE_LIMITED: 'RATE_LIMITED',
  BUSY: 'BUSY',
  NOT_TRUSTED: 'NOT_TRUSTED',
  UNKNOWN_KIND: 'UNKNOWN_KIND',
  ALREADY_IDENTIFIED: 'ALREADY_IDENTIFIED',
  BOOT_STALE: 'BOOT_STALE',
  RELOAD: 'RELOAD',
});

/**
 * Terminal deny codes (S-16): the client drops that token or ticket and
 * stops reconnecting with it. A wall falls to a fresh id and the pair
 * card; a remote or a launcher shows its refusal and stops.
 */
export const TERMINAL_DENY = Object.freeze([
  DENY.FORGOTTEN,
  DENY.TOKEN_EXPIRED,
  DENY.ID_IN_USE,
  DENY.TICKET_USED,
  DENY.TICKET_EXPIRED,
]);

export const isTerminalDeny = (code) => TERMINAL_DENY.includes(code);

/**
 * Why a device lost its pairing: `{t:'unpaired', reason}`. Only these
 * clear a window's identity (C16, review/cf/01-reasoning.md S2).
 */
export const UNPAIRED = Object.freeze({
  FORGOTTEN: 'FORGOTTEN',
  SLOT_TAKEN: 'SLOT_TAKEN',
  EXPIRED: 'EXPIRED',
});

/**
 * A same-id takeover is its own message (C16, sec S13): the older window
 * gets `{t:'replaced'}`, which never touches storage. Old pages ignore an
 * unknown type, so an old `unpaired` handler can never wipe the winner.
 */
export const REPLACED = 'replaced';

/** WebSocket close codes the relay uses. */
export const CLOSE = Object.freeze({
  ALREADY_IDENTIFIED: 4002,
  REPLACED: 4003,
});
