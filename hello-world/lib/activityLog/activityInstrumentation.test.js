// THE CHOKE POINTS, EXERCISED.
//
// "Everything that has happened" is only honest if the capture is structural.
// Three of the four channels are choke points -- one wrapper each around
// `fetch`, the error surfaces and `history` -- so a subsystem nobody thought
// about is captured anyway, WITHOUT that subsystem opting in. This file proves
// each wrapper actually fires and actually carries the OUTCOME, against a
// synthetic global rather than the real one.
//
// jsdom is not needed and not used: the installer takes its target as an
// argument (the same dependency-injection discipline every log module in this
// repo uses for `Date.now`), so a plain object with the four surfaces on it is
// a complete test double.

import { describe, it, expect } from "vitest";
import { installActivityInstrumentation } from "./activityInstrumentation.js";
import { createActivityLog } from "./appActivityLog.js";

function fakeGlobal({ fetchImpl } = {}) {
  const listeners = new Map();
  const target = {
    fetch: fetchImpl || (async () => ({ status: 200, ok: true })),
    console: { error: () => {}, warn: () => {}, log: () => {} },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    history: {
      pushState() {},
      replaceState() {},
    },
    location: { pathname: "/", search: "", hash: "" },
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    listenerCount(type) {
      return (listeners.get(type) || new Set()).size;
    },
  };
  return target;
}

function harness(options) {
  const log = createActivityLog({ now: () => 1000, startedAt: 1000 });
  const target = fakeGlobal(options);
  const uninstall = installActivityInstrumentation({ target, log, now: () => 1000 });
  return { log, target, uninstall, events: () => log.snapshot().events };
}

describe("[choke point] fetch", () => {
  it("records the request AND its outcome", async () => {
    const h = harness({ fetchImpl: async () => ({ status: 201, ok: true }) });
    await h.target.fetch("/api/tailor", { method: "POST" });
    const [entry] = h.events();
    expect(entry.channel).toBe("net");
    expect(entry.method).toBe("POST");
    expect(entry.path).toBe("/api/tailor");
    expect(entry.status).toBe(201);
    expect(entry.ok).toBe(true);
  });

  it("records a FAILED request as failed, and still returns the response", async () => {
    const h = harness({ fetchImpl: async () => ({ status: 503, ok: false }) });
    const res = await h.target.fetch("/api/drive/status");
    expect(res.status).toBe(503);
    const [entry] = h.events();
    expect(entry.status).toBe(503);
    expect(entry.ok).toBe(false);
  });

  it("records a REJECTED request and re-throws it unchanged", async () => {
    const boom = new TypeError("Failed to fetch");
    const h = harness({
      fetchImpl: async () => {
        throw boom;
      },
    });
    await expect(h.target.fetch("/api/x")).rejects.toBe(boom);
    const [entry] = h.events();
    expect(entry.channel).toBe("net");
    expect(entry.error).toContain("Failed to fetch");
    expect(entry.status).toBe(null);
  });

  it("never lets its own bookkeeping break a request", async () => {
    const h = harness({ fetchImpl: async () => ({ status: 200, ok: true }) });
    // A Request object rather than a string: the wrapper must degrade the URL
    // field, never throw into the caller's fetch.
    const res = await h.target.fetch({ url: "/api/from-request-object", method: "PUT" });
    expect(res.status).toBe(200);
    expect(h.events()).toHaveLength(1);
  });

  it("does not write a query VALUE into the log", async () => {
    const h = harness();
    await h.target.fetch("/api/callback?code=super-secret-oauth-code-123&state=x");
    expect(JSON.stringify(h.events())).not.toContain("super-secret-oauth-code-123");
  });

  it("restores the original fetch on uninstall", async () => {
    const original = async () => ({ status: 200, ok: true });
    const h = harness({ fetchImpl: original });
    h.uninstall();
    expect(h.target.fetch).toBe(original);
    await h.target.fetch("/api/x");
    expect(h.events()).toHaveLength(0);
  });

  it("is idempotent: installing twice does not double-record", async () => {
    const h = harness();
    installActivityInstrumentation({ target: h.target, log: h.log, now: () => 1000 });
    await h.target.fetch("/api/x");
    expect(h.events()).toHaveLength(1);
  });
});

describe("[choke point] errors", () => {
  it("records an uncaught error with its message", () => {
    const h = harness();
    h.target.dispatch("error", { message: "Cannot read properties of null", filename: "app.js", lineno: 42 });
    const [entry] = h.events();
    expect(entry.channel).toBe("err");
    expect(entry.type).toBe("uncaught");
    expect(entry.message).toContain("Cannot read properties of null");
  });

  it("records an unhandled promise rejection", () => {
    const h = harness();
    h.target.dispatch("unhandledrejection", { reason: new Error("nobody caught me") });
    const [entry] = h.events();
    expect(entry.channel).toBe("err");
    expect(entry.type).toBe("unhandled-rejection");
    expect(entry.message).toContain("nobody caught me");
  });

  it("records console.error and console.warn, and still calls through", () => {
    const seen = [];
    const h = harness();
    h.target.console.error = (...args) => seen.push(args);
    // Re-install so the wrapper wraps the spy (the test double replaced the
    // method after the first install).
    h.uninstall();
    installActivityInstrumentation({ target: h.target, log: h.log, now: () => 1000 });
    h.target.console.error("tailor failed", { code: 500 });
    h.target.console.warn("slow response");
    const types = h.events().map((e) => e.type);
    expect(types).toContain("console.error");
    expect(types).toContain("console.warn");
    expect(seen).toHaveLength(1);
  });

  it("keeps a console.error from becoming an infinite loop", () => {
    // If recording an error itself console.errors, the wrapper must not
    // re-enter. A log that hangs the tab is worse than no log.
    const h = harness();
    let depth = 0;
    h.target.console.error = () => {
      depth += 1;
      if (depth < 5) h.target.console.error("again");
    };
    h.uninstall();
    installActivityInstrumentation({ target: h.target, log: h.log, now: () => 1000 });
    expect(() => h.target.console.error("start")).not.toThrow();
    expect(h.events().length).toBeLessThan(50);
  });

  it("does not write a secret a stack trace carries", () => {
    const h = harness();
    h.target.dispatch("error", { message: "auth failed for Bearer 9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c" });
    expect(JSON.stringify(h.events())).not.toContain("9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c");
  });
});

describe("[choke point] navigation", () => {
  it("records a pushState route change and still performs it", () => {
    let pushed = null;
    const h = harness();
    h.target.history.pushState = (...args) => {
      pushed = args;
    };
    h.uninstall();
    installActivityInstrumentation({ target: h.target, log: h.log, now: () => 1000 });
    h.target.history.pushState({}, "", "/copilot");
    expect(pushed).toEqual([{}, "", "/copilot"]);
    const [entry] = h.events();
    expect(entry.channel).toBe("nav");
    expect(entry.path).toBe("/copilot");
  });

  it("records Back/Forward", () => {
    const h = harness();
    h.target.location = { pathname: "/tracking", search: "", hash: "" };
    h.target.dispatch("popstate", {});
    const [entry] = h.events();
    expect(entry.channel).toBe("nav");
    expect(entry.type).toBe("popstate");
    expect(entry.path).toBe("/tracking");
  });
});

describe("installation is honest about itself", () => {
  it("stamps the install instant on the log", () => {
    const log = createActivityLog({ now: () => 4242, startedAt: 1 });
    installActivityInstrumentation({ target: fakeGlobal(), log, now: () => 4242 });
    expect(log.snapshot().installedAt).toBe(4242);
  });

  it("survives a target missing every surface it wants", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    let uninstall;
    expect(() => {
      uninstall = installActivityInstrumentation({ target: {}, log, now: () => 1 });
    }).not.toThrow();
    expect(() => uninstall()).not.toThrow();
  });

  it("removes its listeners on uninstall", () => {
    const h = harness();
    expect(h.target.listenerCount("error")).toBe(1);
    h.uninstall();
    expect(h.target.listenerCount("error")).toBe(0);
    expect(h.target.listenerCount("unhandledrejection")).toBe(0);
    expect(h.target.listenerCount("popstate")).toBe(0);
  });
});
