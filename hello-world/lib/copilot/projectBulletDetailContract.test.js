// N154 — the shared per-bullet-detail key (lib/copilot/projectBulletDetailContract.js).
// RED on HEAD: the module does not exist, so the import fails at collection for
// the one intended reason.
//
// The key is the GENERATION GUARD (plan §2, mirroring techTermDetailContract):
// an example-project entry carries NO id and NO version, so the key is
// content-derived. A response settling under a key the UI no longer computes
// (a regenerated pool whose bullet-at-index changed, another question, a
// different engine) is simply never read. The LOAD-BEARING case is the
// changed-bullet-at-index one: if the bullet text were NOT in the key, a
// regenerated pool would serve a detail written for a bullet that is no longer
// there — a stale fabrication read aloud mid-interview.

import { describe, it, expect } from "vitest";
import {
  PROJECT_BULLET_MAX_CHARS,
  PROJECT_TITLE_MAX_CHARS,
  PROJECT_SIBLINGS_MAX,
  projectBulletDetailKey,
} from "./projectBulletDetailContract.js";

const BASE = {
  question: "Tell me about an incident.",
  title: "Rebuilt the paging rotation",
  competency: "incident response",
  bullet: "Cut alert noise from 5 to 1 per shift",
  bulletIndex: 0,
  applicationId: "app-1",
  engine: "gemini",
};

describe("projectBulletDetailKey — pure, total, content-derived", () => {
  it("is a deterministic, non-empty string for the same inputs", () => {
    const a = projectBulletDetailKey(BASE);
    const b = projectBulletDetailKey({ ...BASE });
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).toBe(b);
  });

  it("[generation guard] changes when the BULLET AT AN INDEX changes (no stale serve)", () => {
    // The one that matters: a regenerated pool whose bullet at this index is
    // different must compute a different key, or a detail written for the old
    // bullet is served for the new one.
    expect(projectBulletDetailKey(BASE)).not.toBe(
      projectBulletDetailKey({ ...BASE, bullet: "Mean time to ack within the target" }),
    );
  });

  it("changes when the BULLET INDEX changes (two byte-identical bullets cannot collide)", () => {
    expect(projectBulletDetailKey({ ...BASE, bulletIndex: 0 })).not.toBe(
      projectBulletDetailKey({ ...BASE, bulletIndex: 1 }),
    );
  });

  it("changes when the TITLE changes (Row 1 vs Row 2, and two pool projects, stay distinct)", () => {
    expect(projectBulletDetailKey(BASE)).not.toBe(
      projectBulletDetailKey({ ...BASE, title: "Scaled a read-replica fleet" }),
    );
  });

  it("changes when the QUESTION changes", () => {
    expect(projectBulletDetailKey(BASE)).not.toBe(
      projectBulletDetailKey({ ...BASE, question: "Tell me about scaling." }),
    );
  });

  it("changes when the COMPETENCY changes", () => {
    expect(projectBulletDetailKey(BASE)).not.toBe(
      projectBulletDetailKey({ ...BASE, competency: "reliability" }),
    );
  });

  it("changes when the grounding (applicationId) changes", () => {
    expect(projectBulletDetailKey(BASE)).not.toBe(
      projectBulletDetailKey({ ...BASE, applicationId: "app-2" }),
    );
  });

  it("changes when the engine changes (a record under one engine is never served under another)", () => {
    expect(projectBulletDetailKey(BASE)).not.toBe(
      projectBulletDetailKey({ ...BASE, engine: "external" }),
    );
  });

  it("normalises whitespace and case in question/title/bullet so a trivial reformat is one key", () => {
    expect(projectBulletDetailKey(BASE)).toBe(
      projectBulletDetailKey({
        ...BASE,
        question: "  Tell  me  about an incident.  ",
        title: "Rebuilt The Paging Rotation",
        bullet: "   Cut alert noise from 5 to 1 per shift   ",
      }),
    );
  });

  it("tolerates an absent/empty competency (Row 2 may carry \"\")", () => {
    expect(() => projectBulletDetailKey({ ...BASE, competency: "" })).not.toThrow();
    // "" and a missing competency compute the same key: both normalise to "".
    expect(projectBulletDetailKey({ ...BASE, competency: "" })).toBe(
      projectBulletDetailKey({ ...BASE, competency: undefined }),
    );
  });

  it("a malformed bulletIndex does not collide with the real index 0", () => {
    // A non-integer index is folded to a sentinel, so a client bug that passes a
    // bad index produces a DIFFERENT key rather than silently keying as index 0.
    const good = projectBulletDetailKey({ ...BASE, bulletIndex: 0 });
    for (const bad of [undefined, null, "0", 1.5, NaN, {}]) {
      expect(projectBulletDetailKey({ ...BASE, bulletIndex: bad })).not.toBe(good);
    }
  });

  it("never throws on junk", () => {
    expect(() => projectBulletDetailKey()).not.toThrow();
    expect(() => projectBulletDetailKey({ question: null, title: 7, bullet: {}, applicationId: [], engine: 3 })).not.toThrow();
    expect(typeof projectBulletDetailKey({})).toBe("string");
  });
});

describe("the exported validation bounds", () => {
  it("names the bullet, title and sibling bounds the route and prompt share", () => {
    expect(PROJECT_BULLET_MAX_CHARS).toBe(200);
    expect(PROJECT_TITLE_MAX_CHARS).toBe(160);
    expect(PROJECT_SIBLINGS_MAX).toBe(3);
  });
});
