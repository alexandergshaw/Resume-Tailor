import { describe, expect, it } from "vitest";
import { createSessionLog, renderSessionLogMarkdown } from "./sessionLog";

// AC-W1.2. The session log learns its provider AFTER it is created.
//
// `createSessionLog` already takes a `provider`, stores it in the snapshot and
// renders it as "- Provider: ${provider}" — the whole path exists. Practice
// mode fills it in ("practice"). The LIVE path never has: `startLog()` is
// called at the very top of `start()`, deliberately, so that even a session
// which fails moments later still has a `session.start` entry to explain what
// it was. At that moment nobody knows the provider yet — `createSttStream`
// only learns it a network round trip later, from the token response.
//
// So the log needs to be told, once, after the fact. That is what `setProvider`
// is for. The alternative — delaying `startLog()` until the socket resolves —
// would trade a diagnostic field for the entire failed-session diagnostic
// path, which is the more valuable of the two by a wide margin.

describe("createSessionLog#setProvider (AC-W1.2)", () => {
  it("renders 'unknown' until it is told, exactly as today", () => {
    // The pre-existing behaviour, asserted so the change cannot be mistaken
    // for one that removes the fallback.
    const log = createSessionLog({ mode: "live", source: "inperson", startedAt: 0 });
    expect(log.snapshot().provider).toBeUndefined();
    expect(renderSessionLogMarkdown(log.snapshot())).toContain("- Provider: unknown");
  });

  it("carries the provider into the snapshot and the markdown once set", () => {
    const log = createSessionLog({ mode: "live", source: "inperson", startedAt: 0 });
    log.setProvider("elevenlabs");
    expect(log.snapshot().provider).toBe("elevenlabs");
    expect(renderSessionLogMarkdown(log.snapshot())).toContain("- Provider: elevenlabs");
  });

  it("keeps a provider passed at construction when nothing overrides it", () => {
    // Practice mode's existing call site passes it up front and must keep
    // working byte-for-byte.
    const log = createSessionLog({ mode: "practice", source: "practice", provider: "practice", startedAt: 0 });
    expect(log.snapshot().provider).toBe("practice");
    expect(renderSessionLogMarkdown(log.snapshot())).toContain("- Provider: practice");
  });

  it("ignores a value that is not a usable name rather than rendering a blank", () => {
    // The renderer already defaults a non-string to "unknown", but a log that
    // accepted `""` would render "- Provider: " — a line that looks like a
    // rendering bug rather than an absent fact. Refused at the setter so there
    // is one rule, not two.
    const log = createSessionLog({ mode: "live", source: "inperson", startedAt: 0 });
    for (const bad of ["", "   ", null, undefined, 42, {}]) {
      log.setProvider(bad);
      expect(renderSessionLogMarkdown(log.snapshot())).toContain("- Provider: unknown");
    }
  });

  it("never throws, whatever it is handed", () => {
    // Same contract as every other method on this object: recording must
    // never be able to interrupt the interview the log exists to explain.
    const log = createSessionLog({ mode: "live", source: "inperson", startedAt: 0 });
    expect(() => log.setProvider(Symbol("nope"))).not.toThrow();
    expect(() => log.setProvider()).not.toThrow();
  });

  it("does not disturb the events already recorded", () => {
    // The positive control for the assertions above: setProvider changes one
    // field and nothing else. A snapshot rebuilt from scratch on set would
    // silently drop the session's history.
    const log = createSessionLog({ mode: "live", source: "inperson", startedAt: 0 });
    log.event("session.start", { source: "inperson" });
    log.event("status", { status: "live" });
    log.setProvider("deepgram");
    const snap = log.snapshot();
    expect(snap.events.map((e) => e.type)).toEqual(["session.start", "status"]);
    expect(snap.provider).toBe("deepgram");
  });
});
