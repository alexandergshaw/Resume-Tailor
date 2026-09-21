// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N50 (N53 folded in) TDD RED hand-off -- the panel's DISPLAY CONTRACT for the
// action queue: what a section shows while its action is in progress or
// waiting, and where an action's outcome is reported. AC-N50.15(b)(d) and
// AC-N50.16(a)(b) at the renderer; plan.r2.md section 2.2 (S3), D-1..D-5.
// ---------------------------------------------------------------------------
//
// THIS IS THE PROP-CONTRACT HALF. It renders the panel with the props S3 adds
// -- `sectionActivity`, `sectionOutcomes`, `wholePackQueued` -- and proves
// the renderer honours them. It proves NOTHING about whether the dialog ever
// passes them: that is AppViewDialog.prepQueue.reachability.test.js (this
// directory), which mounts the real dialog and reads the real network. A
// renderer that draws a queue nobody feeds is the defect class this repo keeps
// shipping, so both halves exist and neither substitutes for the other.
//
// RED ON HEAD, every case except the two labelled controls: HEAD's panel does
// not read any of the three props, has no role="status" region, and renders
// no section-scoped outcome at all. The controls are GREEN on HEAD.
//
// Copy is pinned by MEANING, not by literal: a line must name its section
// (and the version, for a restore), a waiting line must read differently from
// an in-progress one and say it is queued (design ledger 12's leading word),
// and an outcome must name what failed. plan section 2.2's suggested sentences
// may be reworded within those constraints.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import PrepPackPanel from "./PrepPackPanel.js";
import { maximalPanelProps } from "@/test/helpers/prepMaximalFixture.js";
import { norm, controlName, accessibleName, groupNameOf, INTERACTIVE_SELECTOR } from "@/test/helpers/prepPanelInstruments.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(props) {
  await act(async () => root.render(createElement(PrepPackPanel, props)));
  return container.firstElementChild;
}

const LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};
const ALL = ["aboutYou", "whyRole", "askThem", "stages"];
const idle = (overrides = {}) => maximalPanelProps({ transients: false }, overrides);
const groupFor = (el, section) => [...el.querySelectorAll('[role="group"]')].find((g) => accessibleName(g) === LABELS[section]);
const buttons = (el) => [...el.querySelectorAll('button, [role="button"]')];
const statusOf = (el, section) => {
  const group = groupFor(el, section);
  return group ? group.querySelector('[role="status"]') : null;
};
const sectionRegenerate = (el, section) =>
  buttons(el).find((b) => /regenerate/i.test(controlName(b)) && controlName(b).includes(LABELS[section]));
const footAlerts = (el) => [...el.querySelectorAll('[role="alert"]')].filter((n) => groupNameOf(n) === "");

const ACTIVITY = {
  "in-progress generate": { state: "in-progress", kind: "generate", revision: null },
  "in-progress restore": { state: "in-progress", kind: "restore", revision: 3 },
  "queued generate": { state: "queued", kind: "generate", revision: null },
  "queued restore": { state: "queued", kind: "restore", revision: 4 },
};

describe("D-1 -- each activity line sits in its own group, names its section, and is never a control", () => {
  for (const [label, activity] of Object.entries(ACTIVITY)) {
    it(`[${label}] on askThem: non-interactive text naming the section${activity.revision ? " and the version" : ""}, inside the askThem group's status region`, async () => {
      const el = await render(idle({ sectionActivity: { askThem: activity } }));
      const status = statusOf(el, "askThem");
      expect(status, "no role=status region in the askThem group").toBeTruthy();
      const text = norm(status.textContent);
      expect(text).toContain(LABELS.askThem);
      if (activity.revision) expect(text).toMatch(new RegExp(`\\b${activity.revision}\\b`));
      expect(status.querySelectorAll(INTERACTIVE_SELECTOR), "the activity line must not be interactive").toHaveLength(0);
      const spinner = status.querySelector('[role="progressbar"]');
      if (activity.state === "queued") {
        expect(spinner, "a waiting line must not show progress").toBe(null);
        expect(text).toMatch(/queued/i);
      } else {
        expect(spinner, "an in-progress line shows progress").toBeTruthy();
      }
      expect(el.querySelectorAll("button[disabled], [aria-disabled='true']")).toHaveLength(0);
    });
  }

  it("a waiting line reads DIFFERENTLY from the in-progress line for the same action", async () => {
    for (const kind of ["generate", "restore"]) {
      const revision = kind === "restore" ? 5 : null;
      const lineFor = async (state) => {
        const status = statusOf(await render(idle({ sectionActivity: { stages: { state, kind, revision } } })), "stages");
        expect(status, `no role=status region in the stages group (${state} ${kind})`).toBeTruthy();
        return norm(status.textContent);
      };
      const inProgress = await lineFor("in-progress");
      const queued = await lineFor("queued");
      expect(inProgress.length).toBeGreaterThan(0);
      expect(queued.length).toBeGreaterThan(0);
      expect(queued, kind).not.toBe(inProgress);
    }
  });
});

describe("D-2 -- a section with activity offers NOTHING to click; the other three keep their controls (AC-N50.15(b)(d))", () => {
  for (const state of ["in-progress", "queued"]) {
    it(`[${state}] the whyRole group has zero buttons and zero disclosures; aboutYou, stages and askThem keep Regenerate and history`, async () => {
      const el = await render(idle({ sectionActivity: { whyRole: { state, kind: "generate", revision: null } } }));
      const busy = groupFor(el, "whyRole");
      expect(busy, "no whyRole group").toBeTruthy();
      expect(buttons(busy).map(controlName)).toEqual([]);
      expect(busy.querySelectorAll("summary")).toHaveLength(0);
      for (const other of ["aboutYou", "stages", "askThem"]) {
        expect(sectionRegenerate(groupFor(el, other), other), `${other} lost its Regenerate`).toBeTruthy();
        expect(groupFor(el, other).querySelectorAll("summary"), `${other} lost its history`).toHaveLength(1);
      }
    });
  }

  it("[the RETAINED generatingSections prop] a listed section with no sectionActivity entry is shown in progress, and its siblings stay usable", async () => {
    // The landed sectionActions.test.js:305-319 case keeps using this prop.
    const el = await render(idle({ generatingSections: ["askThem"] }));
    expect(sectionRegenerate(el, "askThem")).toBeUndefined();
    expect(statusOf(el, "askThem"), "no role=status region in the askThem group").toBeTruthy();
    expect(norm(statusOf(el, "askThem").textContent)).toContain(LABELS.askThem);
    expect(sectionRegenerate(el, "whyRole")).toBeTruthy();
  });
});

describe("D-3 (R9) -- the status region is present BEFORE anything is announced, so the announcement is heard", () => {
  it("each group has an empty role=status region when idle, and the SAME node carries the line once the section becomes active", async () => {
    // A live region inserted together with its text is not announced by most
    // screen readers; only a change inside an existing region is.
    const el = await render(idle());
    const before = {};
    for (const section of ALL) {
      before[section] = statusOf(el, section);
      expect(before[section], `no idle status region for ${section}`).toBeTruthy();
      expect(norm(before[section].textContent)).toBe("");
    }
    await render(idle({ sectionActivity: { stages: { state: "queued", kind: "generate", revision: null } } }));
    const after = statusOf(container.firstElementChild, "stages");
    expect(after).toBe(before.stages);
    expect(norm(after.textContent)).toContain(LABELS.stages);
  });
});

describe("D-4 -- an outcome is reported INSIDE the group where the action was taken (AC-N50.16(a)(b))", () => {
  const REPORTED = [
    ["generate refused (in-flight)", { kind: "generate", revision: null, result: { status: "refused", reason: "in-flight" } }],
    ["generate refused (error)", { kind: "generate", revision: null, result: { status: "refused", reason: "error" } }],
    ["generate disabled", { kind: "generate", revision: null, result: { status: "disabled" } }],
    ["generate error", { kind: "generate", revision: null, result: { error: "Request failed.", networkError: true } }],
    ["restore conflict", { kind: "restore", revision: 6, result: { status: "conflict" } }],
    ["restore refused", { kind: "restore", revision: 6, result: { status: "refused", reason: "in-flight" } }],
    ["restore error", { kind: "restore", revision: 6, result: { error: "Something went wrong." } }],
    ["restore network failure", { kind: "restore", revision: 6, result: { error: "Failed to fetch", networkError: true } }],
  ];
  for (const [label, outcome] of REPORTED) {
    it(`[${label}] renders a role=alert inside the stages group that names the section${outcome.kind === "restore" ? " and the version" : ""}, and nothing at the panel foot`, async () => {
      const el = await render(idle({ triggerMessage: null, sectionOutcomes: { stages: outcome } }));
      const group = groupFor(el, "stages");
      expect(group, "no stages group").toBeTruthy();
      const alerts = [...group.querySelectorAll('[role="alert"]')];
      expect(alerts, "silence is the defect").toHaveLength(1);
      const text = norm(alerts[0].textContent);
      expect(text).toContain(LABELS.stages);
      if (outcome.kind === "restore") expect(text).toMatch(/\b6\b/);
      expect(text).not.toMatch(/\b(above|below|beneath|underneath)\b/i);
      expect(footAlerts(el).map((n) => norm(n.textContent))).toEqual([]);
    });
  }

  const SILENT = [
    ["restored", { kind: "restore", revision: 6, result: { status: "restored" } }],
    ["generate ready", { kind: "generate", revision: null, result: { status: "ready", section: "stages" } }],
    ["generate partial", { kind: "generate", revision: null, result: { status: "partial" } }],
    ["generate failed", { kind: "generate", revision: null, result: { status: "failed" } }],
    ["generate unavailable", { kind: "generate", revision: null, result: { status: "unavailable" } }],
  ];
  for (const [label, outcome] of SILENT) {
    it(`[over-fire control: ${label}] a normal terminal outcome renders NO alert -- the refetched pack already shows it`, async () => {
      // GREEN ON HEAD for the wrong reason (HEAD renders no section outcome at
      // all); its partner above is what makes the pair discriminating.
      const el = await render(idle({ triggerMessage: null, sectionOutcomes: { stages: outcome } }));
      expect(el.querySelectorAll('[role="alert"]')).toHaveLength(0);
    });
  }

  it("the panel ignores the queue's bookkeeping: an outcome already marked seen still renders", async () => {
    const el = await render(idle({ triggerMessage: null, sectionOutcomes: { whyRole: { kind: "restore", revision: 2, result: { status: "conflict" }, seen: true } } }));
    const group = groupFor(el, "whyRole");
    expect(group, "no whyRole group").toBeTruthy();
    expect(group.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("an outcome is still reported while the section's controls are unavailable (a running pack) -- never silent", async () => {
    const el = await render(idle({ status: "running", triggerMessage: null, sectionOutcomes: { aboutYou: { kind: "restore", revision: 2, result: { status: "refused", reason: "in-flight" } } } }));
    const group = groupFor(el, "aboutYou");
    expect(group, "no aboutYou group").toBeTruthy();
    expect(buttons(group), "precondition: no section control while running").toHaveLength(0);
    expect(group.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("two sections' outcomes land in their OWN groups and do not bleed into each other", async () => {
    const el = await render(
      idle({
        triggerMessage: null,
        sectionOutcomes: {
          aboutYou: { kind: "generate", revision: null, result: { status: "refused", reason: "error" } },
          askThem: { kind: "restore", revision: 8, result: { status: "conflict" } },
        },
      }),
    );
    const about = groupFor(el, "aboutYou");
    const ask = groupFor(el, "askThem");
    expect(about && ask, "groups missing").toBeTruthy();
    expect(norm(about.querySelector('[role="alert"]')?.textContent)).toContain(LABELS.aboutYou);
    expect(norm(ask.querySelector('[role="alert"]')?.textContent)).toContain(LABELS.askThem);
    expect(groupFor(el, "whyRole").querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(groupFor(el, "stages").querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
});

describe("D-5 -- a queued whole-pack regenerate replaces its button, and the caption goes with it", () => {
  it("[wholePackQueued] no whole-pack Regenerate button, a non-interactive queued line that names the whole pack, and no destructive caption", async () => {
    const el = await render(idle({ wholePackQueued: true }));
    expect(buttons(el).find((b) => /^regenerate$/i.test(controlName(b))), "the whole-pack button must be replaced").toBeUndefined();
    const line = [...el.querySelectorAll("*")].find((n) => /queued/i.test(n.textContent || "") && /whole pack/i.test(n.textContent || "") && groupNameOf(n) === "" && n.children.length === 0);
    expect(line, "no queued line naming the whole pack").toBeTruthy();
    expect(line.closest("button, a[href], summary")).toBe(null);
    expect(el.querySelector('[data-testid="regenerate-caption"]')).toBe(null);
    expect(el.querySelectorAll("button[disabled], [aria-disabled='true']")).toHaveLength(0);
  });

  it("[control, green on HEAD] without the flag the whole-pack Regenerate and its caption are there", async () => {
    const el = await render(idle());
    expect(buttons(el).find((b) => /^regenerate$/i.test(controlName(b)))).toBeTruthy();
    expect(el.querySelector('[data-testid="regenerate-caption"]')).toBeTruthy();
  });

  it("[precedence guard, green on HEAD] a pack already generating shows 'Generating' even if a whole-pack regenerate is also marked queued", async () => {
    // plan section 2.2: in-flight -> queued -> no-description -> button.
    const el = await render(idle({ wholePackQueued: true, generating: true, onGenerateNow: vi.fn() }));
    expect(norm(el.textContent)).toMatch(/generating/i);
    expect(buttons(el).find((b) => /^regenerate$/i.test(controlName(b)))).toBeUndefined();
  });
});
