// THE CHOKE POINTS: three wrappers that make "everything that happened" a
// structural property instead of a promise.
//
// ---------------------------------------------------------------------------
// WHY WRAPPERS AND NOT CALL SITES
// ---------------------------------------------------------------------------
// There are 52 files in this app that call fetch(). Instrumenting them one by
// one would be 52 chances to forget, 52 diffs to review, and -- the part that
// actually matters -- it would capture only the subsystems somebody remembered.
// The failure this whole feature is written against is a completeness claim
// nothing can falsify, and "we added a log line everywhere we thought of" is
// exactly that claim.
//
// One wrapper around `fetch` captures every network call in the tab, including
// the ones written after this module and the ones written by somebody who never
// read it. Same for the error surfaces and for `history`. What a choke point
// CANNOT see -- a WebSocket, a full page navigation, another tab -- is
// enumerated in activityChannels.js, printed in the downloaded file, and
// checked against the real tree by activityCoverage.sweep.test.js. That pairing
// is the honest version of "everything".
//
// ---------------------------------------------------------------------------
// RULES EVERY WRAPPER HERE FOLLOWS
// ---------------------------------------------------------------------------
//   * It is transparent. The original return value is returned, the original
//     rejection is re-thrown UNCHANGED (`toBe`, not `toEqual`), the original
//     console call still happens, the navigation still occurs.
//   * It never throws. A logging failure must not break the thing being logged,
//     and one of the surfaces wrapped here is the error handler itself.
//   * It is reversible. `install` returns an `uninstall` that restores the
//     exact original function objects and removes every listener, so a test (or
//     a component unmount) leaves no residue on a shared global.
//   * It is idempotent per target. Installing twice does not double-record.
//   * It takes its target and its clock as arguments, so the whole module is
//     testable against a plain object with four properties on it -- no jsdom,
//     no real network, no patched real globals.

import { recordActivity, markActivityLogInstalled } from "./appActivityLog.js";
import { redactUrlForLog, redactSecretText } from "./activityRedaction.js";

// Targets currently instrumented. A WeakSet so a torn-down jsdom window is not
// kept alive by this module.
const installedTargets = new WeakSet();

function messageOf(value) {
  try {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === "object" && typeof value.message === "string") return value.message;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  } catch {
    return "[unreadable]";
  }
}

function urlOf(input) {
  try {
    if (typeof input === "string") return input;
    if (input && typeof input === "object" && typeof input.url === "string") return input.url;
    return String(input ?? "");
  } catch {
    return "";
  }
}

function methodOf(input, init) {
  try {
    if (init && typeof init === "object" && typeof init.method === "string") return init.method.toUpperCase();
    if (input && typeof input === "object" && typeof input.method === "string") return input.method.toUpperCase();
    return "GET";
  } catch {
    return "GET";
  }
}

function pathOf(target) {
  try {
    const loc = target && target.location;
    if (!loc) return "";
    return redactUrlForLog(`${loc.pathname || ""}${loc.search || ""}`);
  } catch {
    return "";
  }
}

/**
 * installActivityInstrumentation({ target, log, now }) -> uninstall()
 *
 * `log` defaults to the module-level session log, so the ordinary caller is a
 * one-liner: `installActivityInstrumentation()`.
 */
export function installActivityInstrumentation({ target = globalThis, log = null, now = Date.now } = {}) {
  const noop = () => {};
  if (!target || typeof target !== "object") return noop;
  if (installedTargets.has(target)) return noop;
  installedTargets.add(target);

  const record = log ? (channel, type, fields) => log.record(channel, type, fields) : recordActivity;
  const markInstalled = log ? (at) => log.markInstalled(at) : markActivityLogInstalled;
  const clock = typeof now === "function" ? now : Date.now;
  const readClock = () => {
    try {
      const value = clock();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };

  const restore = [];

  // -------------------------------------------------------------------------
  // CHOKE POINT 1 -- fetch. Records the request AND its outcome: a log that
  // says a request was attempted and not how it ended cannot explain a failure,
  // which is the one job this file has.
  // -------------------------------------------------------------------------
  const originalFetch = typeof target.fetch === "function" ? target.fetch : null;
  if (originalFetch) {
    const wrapped = function activityLoggedFetch(input, init) {
      const startedAt = readClock();
      let method = "GET";
      let path = "";
      try {
        method = methodOf(input, init);
        path = redactUrlForLog(urlOf(input));
      } catch {
        // Bookkeeping never costs the request.
      }
      let result;
      try {
        result = originalFetch.call(target, input, init);
      } catch (error) {
        try {
          record("net", "fetch", { method, path, status: null, ok: false, error: messageOf(error) });
        } catch {
          /* never break a request */
        }
        throw error;
      }
      if (!result || typeof result.then !== "function") return result;
      return result.then(
        (response) => {
          try {
            record("net", "fetch", {
              method,
              path,
              status: response && typeof response.status === "number" ? response.status : null,
              ok: !!(response && response.ok),
              ms: readClock() - startedAt,
            });
          } catch {
            /* never break a request */
          }
          return response;
        },
        (error) => {
          try {
            record("net", "fetch", {
              method,
              path,
              status: null,
              ok: false,
              error: messageOf(error),
              ms: readClock() - startedAt,
            });
          } catch {
            /* never break a request */
          }
          // Re-thrown unchanged: a caller matching on the error identity must
          // see the same object it would have without this wrapper.
          throw error;
        },
      );
    };
    target.fetch = wrapped;
    restore.push(() => {
      if (target.fetch === wrapped) target.fetch = originalFetch;
    });
  }

  // -------------------------------------------------------------------------
  // CHOKE POINT 2 -- errors. Uncaught exceptions, unhandled rejections, and the
  // console methods a developer already reaches for.
  // -------------------------------------------------------------------------
  const console_ = target.console;
  if (console_ && typeof console_ === "object") {
    // Re-entrancy guard. If recording an error itself logs an error, an
    // unguarded wrapper recurses until the tab dies -- and a log that hangs the
    // app is worse than no log.
    let inside = false;
    for (const level of ["error", "warn"]) {
      const original = typeof console_[level] === "function" ? console_[level] : null;
      if (!original) continue;
      const wrapped = function activityLoggedConsole(...args) {
        if (!inside) {
          inside = true;
          try {
            record("err", `console.${level}`, { message: args.map(messageOf).filter(Boolean).join(" ") });
          } catch {
            /* never break a console call */
          } finally {
            inside = false;
          }
        }
        return original.apply(console_, args);
      };
      console_[level] = wrapped;
      restore.push(() => {
        if (console_[level] === wrapped) console_[level] = original;
      });
    }
  }

  const canListen = typeof target.addEventListener === "function" && typeof target.removeEventListener === "function";
  if (canListen) {
    const listen = (type, handler) => {
      target.addEventListener(type, handler);
      restore.push(() => target.removeEventListener(type, handler));
    };

    listen("error", (event) => {
      try {
        record("err", "uncaught", {
          message: redactSecretText(messageOf(event && event.message !== undefined ? event.message : event)),
          source: event && typeof event.filename === "string" ? redactUrlForLog(event.filename) : "",
          line: event && typeof event.lineno === "number" ? event.lineno : null,
        });
      } catch {
        /* an error handler that throws is how a page dies twice */
      }
    });

    listen("unhandledrejection", (event) => {
      try {
        record("err", "unhandled-rejection", { message: messageOf(event && event.reason) });
      } catch {
        /* see above */
      }
    });

    // -----------------------------------------------------------------------
    // CHOKE POINT 3 -- navigation. `popstate` is Back/Forward; the two history
    // methods below are every in-app route change the router performs.
    // -----------------------------------------------------------------------
    listen("popstate", () => {
      try {
        record("nav", "popstate", { path: pathOf(target) });
      } catch {
        /* never break navigation */
      }
    });
  }

  const history = target.history;
  if (history && typeof history === "object") {
    for (const method of ["pushState", "replaceState"]) {
      const original = typeof history[method] === "function" ? history[method] : null;
      if (!original) continue;
      const wrapped = function activityLoggedHistory(...args) {
        try {
          const url = args[2];
          record("nav", method, { path: url === undefined ? pathOf(target) : redactUrlForLog(urlOf(url)) });
        } catch {
          /* never break navigation */
        }
        return original.apply(history, args);
      };
      history[method] = wrapped;
      restore.push(() => {
        if (history[method] === wrapped) history[method] = original;
      });
    }
  }

  try {
    markInstalled(readClock());
  } catch {
    /* the stamp is a nicety; the wrappers are the feature */
  }

  return function uninstallActivityInstrumentation() {
    installedTargets.delete(target);
    for (const undo of restore) {
      try {
        undo();
      } catch {
        // One failed restore must not strand the others.
      }
    }
    restore.length = 0;
  };
}
