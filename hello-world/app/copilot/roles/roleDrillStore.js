// BUG (adversarial review, post-AC-Q9): the wiring wave mounts RoleDrillClient
// from a ternary (`mode === "roles" ? <RoleDrillClient /> : ...`), so leaving
// "Speak as" for another mode UNMOUNTS this whole feature - and every piece of
// state useRoleDrill.js kept in a plain `useState` died with it. Re-entering
// the mode then looked, from the component's own point of view, exactly like
// a first visit: the mount effect fired a fresh fetchRoleSituation (a real
// Gemini call on the default engine, for a round trip the user experienced as
// free), with an EMPTY asked list (so the server could hand back a situation
// already worked through) and `exhausted` reset to false (so a genuinely
// exhausted role stopped saying so).
//
// The fix: hoist the session-scoped state out of the component entirely, into
// a module-scoped store - the exact shape useRoleChoice.js already uses for
// the persisted role, and for the same reason: a value that must survive
// beyond any one mount of the component that reads it. Concretely, per role:
// the asked-prompt list, the last situation shown, whether that role's own
// situation bank is exhausted, and every revealed answer (keyed by situation
// id) so hide/show and a return visit both serve the cache instead of paying
// for another fetchRoleResponse.
//
// Backed by localStorage (like useRoleChoice.js's own role persistence)
// rather than a bare in-memory Map, for two independent reasons: it survives
// an actual page reload, not just a mode switch inside the same tab load -
// arguably a STRONGER fix than the bug report asked for, since "the user
// left and came back" doesn't stop being true just because they refreshed -
// and it means this file's own jsdom test suite gets real per-test isolation
// for free from `localStorage.clear()` in RoleDrillClient.contract.test.js's
// existing `beforeEach`, without that frozen file needing to know this store
// exists at all.
//
// Snapshots are memoized against the RAW string last read from localStorage,
// not re-parsed on every call: `useSyncExternalStore` requires getSnapshot to
// return the SAME reference when nothing changed, and `JSON.parse` allocates
// a fresh object every time it runs. Comparing the raw string first (cheap,
// and correct even when something OUTSIDE this module's own API touches
// localStorage - e.g. a test calling `localStorage.clear()` directly) is
// what keeps repeated reads referentially stable without a stale in-memory
// mirror that could silently diverge from what's actually stored.
//
// `resetRoleDrillStore` is a test-only escape hatch. Production code has no
// reason to ever call it - the entire point of this store is that it outlives
// every mount for the life of the tab - but nothing here prevents an errant
// call from anywhere, so: this export exists purely so a test file can force
// a clean slate between cases, and it must never be imported from anything
// other than a test.

const STORAGE_KEY = "copilot-speak-as-drill";

const EMPTY_ASKED = Object.freeze([]);
const EMPTY_ANSWERS = Object.freeze({});
// The shared, referentially-stable "nothing known yet" entry - returned for
// any role not yet present in storage, and as this store's
// `useSyncExternalStore` server snapshot. A fresh object literal per call
// would defeat the whole point (React would see a "new" value on every
// render and warn/loop), so this is allocated exactly once.
export const EMPTY_ROLE_ENTRY = Object.freeze({
  situation: null,
  exhausted: false,
  asked: EMPTY_ASKED,
  answers: EMPTY_ANSWERS,
  revealedSituationId: null,
});

let lastRaw; // the exact string last read from localStorage (or null/undefined)
let lastParsed = {}; // the { [role]: entry } object that raw string parsed to

function readRaw() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Every entry read in this module goes through here, so a direct write to
// localStorage from anywhere else (this module's own `writeAll` below, or a
// test clearing storage out from under it) is always picked up on the next
// read, while an UNCHANGED raw string still returns the exact same parsed
// object reference as before.
function allEntries() {
  const raw = readRaw();
  if (raw === lastRaw) return lastParsed;
  lastRaw = raw;
  try {
    lastParsed = raw ? JSON.parse(raw) : {};
  } catch {
    lastParsed = {};
  }
  return lastParsed;
}

const listeners = new Set();

function notify() {
  listeners.forEach((cb) => cb());
}

export function subscribeRoleDrill(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function writeAll(nextAll) {
  lastParsed = nextAll;
  try {
    lastRaw = JSON.stringify(nextAll);
    window.localStorage.setItem(STORAGE_KEY, lastRaw);
  } catch {
    // Quota exceeded / private browsing / no window: the update still
    // applies for the rest of this tab via `notify` below (the same
    // fallback useRoleChoice.js's own writeRole already accepts) - it just
    // won't survive a reload.
  }
  notify();
}

// The one entry a component actually reads, normalized so a caller never
// has to guard against a missing role.
export function getRoleDrillEntry(role) {
  return allEntries()[role] || EMPTY_ROLE_ENTRY;
}

export function getAskedPrompts(role) {
  return getRoleDrillEntry(role).asked;
}

// Every write below starts from this, not from `all[role] || {}` directly:
// a role's PARTIAL entry (e.g. one `recordSituation` created before any
// reveal ever wrote an `answers` field) must still normalize back to the
// full shape on the next write, the same way `getRoleDrillEntry` normalizes
// it on read. Without this, `entry.answers[situationId]` on a role that has
// a situation but no revealed answer yet reads a plain `undefined` instead
// of `{}` and throws - exactly the bug this comment is here to prevent
// reintroducing.
function normalizedPrev(all, role) {
  const prev = all[role];
  return prev
    ? { ...EMPTY_ROLE_ENTRY, ...prev }
    : { ...EMPTY_ROLE_ENTRY };
}

// A new situation landed for `role` - from a fresh fetch, never from the
// user merely looking at the page. Appends its prompt to the asked list
// (deduplicated) and clears any REVEAL VISIBILITY left over from whatever
// situation was on screen before - the underlying answer cache for the old
// situation id is untouched, only which one is currently shown resets.
//
// BUG (adversarial review): `asked` never shrinking on its own meant that
// once every situation in a role's bank had been asked, the server had
// nothing left to serve but the SAME first situation, forever - and because
// its id never changed, "New situation" produced zero visible change, right
// underneath a notice promising the situations would start repeating. The
// fix: a response reporting `exhausted: true` starts that role's cycle over
// - the asked list resets to empty here, so the NEXT request (read via
// getAskedPrompts) genuinely asks the server to serve from the top of the
// bank again rather than pinning on one scene forever.
export function recordSituation(role, situation, exhausted) {
  const all = allEntries();
  const prev = normalizedPrev(all, role);
  const asked = exhausted
    ? []
    : situation?.prompt && !prev.asked.includes(situation.prompt)
      ? [...prev.asked, situation.prompt]
      : prev.asked;
  writeAll({
    ...all,
    [role]: {
      ...prev,
      situation: situation || null,
      exhausted: !!exhausted,
      asked,
      revealedSituationId: null,
    },
  });
}

// A model answer was drafted for `situationId` under `role` - caches it
// (so hide/show, and a later return visit, never re-request it) and marks
// it as the one currently shown.
export function recordAnswer(role, situationId, payload) {
  const all = allEntries();
  const prev = normalizedPrev(all, role);
  writeAll({
    ...all,
    [role]: {
      ...prev,
      answers: { ...prev.answers, [situationId]: payload },
      revealedSituationId: situationId,
    },
  });
}

// Shows or hides an ALREADY-cached answer (the disclosure toggle) without
// touching the cache itself - hiding must never discard what's cached, and
// showing an already-cached answer must never re-fetch it.
export function setRevealVisible(role, situationId, visible) {
  const all = allEntries();
  const prev = normalizedPrev(all, role);
  writeAll({
    ...all,
    [role]: { ...prev, revealedSituationId: visible ? situationId : null },
  });
}

// Test-only. See this file's own doc comment: never call this from
// anything but a test.
export function resetRoleDrillStore() {
  writeAll({});
}
