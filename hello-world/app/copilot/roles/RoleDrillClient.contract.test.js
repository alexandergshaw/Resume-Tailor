// @vitest-environment jsdom
//
// AC-Q9 - the "Speak as" drill's own surface.
//
// Rendered rather than reasoned about, because most of this feature's
// acceptance criteria ARE the markup: what is on screen before the first
// click, whether the reveal is a real disclosure, whether the status region is
// mounted early enough to be announced, whether a control's accessible name
// matches the words a voice-control user can see, and whether the panel's
// claims about its own answer are true. None of that survives being extracted
// into a pure function (see vitest.config.js's own comment, and
// app/components/JobDescriptionTab.test.js as the precedent).
//
// The network clients are mocked; everything else - the register data, the
// pace estimate, the persisted role choice - is the real module.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/copilot/roleDrillClient", () => ({
  fetchRoleSituation: vi.fn(),
  fetchRoleResponse: vi.fn(),
}));

import RoleDrillClient from "./RoleDrillClient.js";
import { fetchRoleSituation, fetchRoleResponse } from "@/lib/copilot/roleDrillClient";
import { DEFAULT_ROLE, ROLE_REGISTERS, roleRegister } from "@/lib/copilot/roleRegisters";
import { spokenEstimate } from "@/lib/copilot/spokenPace";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const REGISTER = roleRegister(DEFAULT_ROLE);
const OTHER = ROLE_REGISTERS.find((r) => r.value !== DEFAULT_ROLE);
const ROLE_STORAGE_KEY = "copilot-speak-as-role";

const SITUATION_A = {
  id: `${DEFAULT_ROLE}-first`,
  prompt: "Your director stops you in the hallway and asks why the release slipped a week.",
  context: "The director already has the dates; what they want is your read on it.",
};
const SITUATION_B = {
  id: `${DEFAULT_ROLE}-second`,
  prompt: "A teammate tells you, in your one to one, that they are thinking of leaving.",
  context: "Nothing has been said to anyone else yet.",
};

function situationPayload(situation = SITUATION_A, overrides = {}) {
  return { role: DEFAULT_ROLE, situation, source: "embedded", exhausted: false, ...overrides };
}

function responsePayload(role = DEFAULT_ROLE, source = "embedded") {
  const register = roleRegister(role);
  return {
    role,
    lines: register.beatLabels.map((label, i) => ({
      label,
      text: `Line ${i + 1}: this is a full sentence a person could say out loud in the room.`,
    })),
    cadence: register.cadence,
    terms: register.vocabulary,
    // Term STRINGS, the one shape this feature carries end to end.
    termsUsed: register.vocabulary.slice(0, 2).map((v) => v.term),
    avoid: register.avoid,
    source,
  };
}

// The accessible-name model that matches what assistive tech actually
// computes: aria-labelledby, then aria-label, then a native <label>
// association, then text with hidden subtrees stripped, then title. A naive
// `aria-label || textContent` both accepts names no screen reader can reach
// and rejects correct markup - and omitting the <label> step would fail a
// correctly labelled native select for no stated reason.
function accessibleName(el) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  if (el.id) {
    const associated = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (associated) return (associated.textContent || "").trim();
  }
  const wrapping = el.closest("label");
  if (wrapping) return (wrapping.textContent || "").trim();
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  const inner = (clone.textContent || "").trim();
  return inner || (el.getAttribute("title") || "").trim();
}

const buttons = () => [...container.querySelectorAll("button")];
const buttonNamed = (re) => buttons().find((b) => re.test(accessibleName(b)));
const text = () => container.textContent || "";
const listItemContaining = (needle) =>
  [...container.querySelectorAll("li")].find((li) => (li.textContent || "").includes(needle));

async function render() {
  await act(async () => {
    root.render(createElement(RoleDrillClient, {}));
  });
}

async function click(el) {
  expect(el, "control not found").toBeTruthy();
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.click();
  });
}

function picker() {
  return container.querySelector("select") || container.querySelector('[role="combobox"]');
}

async function openPicker() {
  const native = container.querySelector("select");
  if (native) return [...native.options];
  await click(container.querySelector('[role="combobox"]'));
  return [...document.querySelectorAll('[role="option"]')];
}

// Works against a native <select> and against MUI's listbox alike, so the test
// asserts the OUTCOME (the role can be changed) without mandating either.
async function chooseRole(label, value) {
  const native = container.querySelector("select");
  if (native) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        globalThis.HTMLSelectElement.prototype,
        "value",
      ).set;
      setter.call(native, value);
      native.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return;
  }
  const options = await openPicker();
  const option = options.find((o) => (o.textContent || "").trim().startsWith(label));
  await click(option);
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    globalThis.localStorage.clear();
  } catch {
    /* jsdom always has one; a private-mode throw must not fail the suite */
  }
  fetchRoleSituation.mockResolvedValue(situationPayload());
  fetchRoleResponse.mockResolvedValue(responsePayload());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("RoleDrillClient - the first thing you see (AC-Q0.2, AC-Q0.3)", () => {
  it("asks for a situation on mount, without the user clicking anything", async () => {
    await render();
    expect(fetchRoleSituation).toHaveBeenCalledTimes(1);
    expect(fetchRoleSituation.mock.calls[0][0].role).toBe(DEFAULT_ROLE);
    expect(fetchRoleSituation.mock.calls[0][0].asked).toEqual([]);
  });

  it("shows the situation as a heading, with its context", async () => {
    await render();
    const heading = [...container.querySelectorAll("h3")].find((h) =>
      (h.textContent || "").includes("why the release slipped"),
    );
    expect(heading, "the situation is not an h3").toBeTruthy();
    expect(text()).toContain(SITUATION_A.context);
  });

  it("tells the user to answer it out loud before revealing anything", async () => {
    await render();
    expect(text()).toMatch(/out loud/i);
  });

  it("generates NOTHING for the model answer until it is asked for", async () => {
    await render();
    expect(fetchRoleResponse).not.toHaveBeenCalled();
  });

  it("names the role being spoken as, and offers every role in the registry", async () => {
    await render();
    expect(picker(), "no role picker").toBeTruthy();
    expect(accessibleName(picker())).toMatch(/speak as/i);
    expect(text()).toContain(REGISTER.blurb);

    const options = await openPicker();
    expect(options.length).toBe(ROLE_REGISTERS.length);
    for (const register of ROLE_REGISTERS) {
      expect(
        options.some((o) => (o.textContent || "").includes(register.label)),
        `${register.value} is not offered`,
      ).toBe(true);
    }
  });
});

describe("RoleDrillClient - the reveal (AC-Q0.5, AC-Q9.4, AC-Q9.6)", () => {
  it("is a disclosure: expanded state, one request, cached across hide and show", async () => {
    await render();
    const reveal = buttonNamed(/reveal a model answer/i);
    expect(reveal.getAttribute("aria-expanded")).toBe("false");

    await click(reveal);
    expect(fetchRoleResponse).toHaveBeenCalledTimes(1);
    expect(fetchRoleResponse.mock.calls[0][0]).toEqual({
      role: DEFAULT_ROLE,
      situationId: SITUATION_A.id,
      situationPrompt: SITUATION_A.prompt,
    });

    expect(buttonNamed(/model answer/i).getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain("Line 1:");

    await click(buttonNamed(/model answer/i));
    expect(text()).not.toContain("Line 1:");
    await click(buttonNamed(/model answer/i));
    expect(text()).toContain("Line 1:");
    expect(fetchRoleResponse).toHaveBeenCalledTimes(1);
  });

  it("shows the beats, the cadence, the terms and what not to say", async () => {
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    const body = text();
    for (const label of REGISTER.beatLabels) expect(body).toContain(label);
    expect(body).toContain(REGISTER.cadence[0]);
    expect(body).toContain(REGISTER.vocabulary[0].term);
    expect(body).toContain(REGISTER.vocabulary[0].signals);
    expect(body).toContain(REGISTER.avoid[0].phrase);
    expect(body).toContain(REGISTER.avoid[0].why);
  });

  it("states the answer's real spoken length, not a hardcoded one", async () => {
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    const { words, seconds } = spokenEstimate(responsePayload().lines);
    expect(words).toBeGreaterThan(0);
    expect(text()).toContain(`${words} words`);
    expect(text()).toContain(`${seconds} second`);
  });

  it("marks exactly the terms the answer actually used", async () => {
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    const used = responsePayload().termsUsed;
    expect(used.length).toBe(2);
    for (const term of used) {
      const item = listItemContaining(term);
      expect(item, `${term} is not listed`).toBeTruthy();
      expect(item.textContent, `${term} is not marked as used`).toMatch(/used in this answer/i);
    }
    const unused = REGISTER.vocabulary.map((v) => v.term).filter((t) => !used.includes(t));
    expect(unused.length).toBeGreaterThan(0);
    const unusedItem = listItemContaining(unused[0]);
    expect(unusedItem, `${unused[0]} is not listed`).toBeTruthy();
    expect(unusedItem.textContent).not.toMatch(/used in this answer/i);
  });

  it("says honestly what drafted it, including when Gemini could not", async () => {
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    expect(text()).toMatch(/no AI provider/i);

    // A new SITUATION is required for each caption: the answer is cached per
    // situation id, so re-revealing the same one would (correctly) never
    // re-request and the caption could not change.
    fetchRoleSituation.mockResolvedValue(situationPayload(SITUATION_B));
    fetchRoleResponse.mockResolvedValue(responsePayload(DEFAULT_ROLE, "gemini"));
    await click(buttonNamed(/new situation/i));
    await click(buttonNamed(/reveal a model answer/i));
    expect(text()).toMatch(/Gemini/);

    fetchRoleSituation.mockResolvedValue(
      situationPayload({ ...SITUATION_A, id: `${DEFAULT_ROLE}-third` }),
    );
    fetchRoleResponse.mockResolvedValue(responsePayload(DEFAULT_ROLE, "fallback"));
    await click(buttonNamed(/new situation/i));
    await click(buttonNamed(/reveal a model answer/i));
    // Neither of the other two sentences is true here: Gemini did not write
    // it, and the user did not choose an engine with no AI provider.
    const caption = text();
    expect(caption).toMatch(/could not/i);
    expect(caption).not.toMatch(/drafted by Google Gemini/i);
  });
});

describe("RoleDrillClient - moving on (AC-Q9.2, AC-Q9.4, AC-Q9.12)", () => {
  it("asks for a new situation, remembering the one already shown", async () => {
    await render();
    fetchRoleSituation.mockResolvedValue(situationPayload(SITUATION_B));
    await click(buttonNamed(/new situation/i));

    expect(fetchRoleSituation).toHaveBeenCalledTimes(2);
    expect(fetchRoleSituation.mock.calls[1][0].asked).toEqual([SITUATION_A.prompt]);
    expect(text()).toContain("thinking of leaving");
  });

  it("clears a revealed answer when the situation changes", async () => {
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    expect(text()).toContain("Line 1:");

    fetchRoleSituation.mockResolvedValue(situationPayload(SITUATION_B));
    await click(buttonNamed(/new situation/i));

    expect(text()).not.toContain("Line 1:");
    expect(buttonNamed(/reveal a model answer/i).getAttribute("aria-expanded")).toBe("false");
  });

  it("says so when the situations have started repeating", async () => {
    fetchRoleSituation.mockResolvedValue(situationPayload(SITUATION_A, { exhausted: true }));
    await render();
    expect(text()).toMatch(/every situation for this role/i);
  });

  it("does not claim repetition while fresh situations remain", async () => {
    await render();
    expect(text()).not.toMatch(/every situation for this role/i);
  });

  it("loads a situation for a newly chosen role with no further click", async () => {
    await render();
    fetchRoleSituation.mockResolvedValue({
      role: OTHER.value,
      situation: { id: `${OTHER.value}-first`, prompt: "A different scene entirely.", context: "c" },
      source: "embedded",
      exhausted: false,
    });
    await chooseRole(OTHER.label, OTHER.value);

    expect(fetchRoleSituation).toHaveBeenCalledTimes(2);
    expect(fetchRoleSituation.mock.calls[1][0].role).toBe(OTHER.value);
    expect(fetchRoleSituation.mock.calls[1][0].asked).toEqual([]);
    expect(text()).toContain("A different scene entirely.");
  });

  it("discards a slow situation for a role the user has moved off", async () => {
    // AC-Q9.2. Without a generation ref this passes only by luck of timing:
    // the first role's response resolves LAST here, which is exactly the case
    // that repaints a stale scene under the new role's name.
    let resolveFirst;
    fetchRoleSituation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await render();
    fetchRoleSituation.mockResolvedValue({
      role: OTHER.value,
      situation: { id: `${OTHER.value}-first`, prompt: "A different scene entirely.", context: "c" },
      source: "embedded",
      exhausted: false,
    });
    await chooseRole(OTHER.label, OTHER.value);
    expect(text()).toContain("A different scene entirely.");

    await act(async () => {
      resolveFirst(situationPayload());
    });
    expect(text()).not.toContain("why the release slipped");
    expect(text()).toContain("A different scene entirely.");
  });

  it("remembers the chosen role for the next visit (AC-Q0.4)", async () => {
    await render();
    fetchRoleSituation.mockResolvedValue({
      role: OTHER.value,
      situation: { id: `${OTHER.value}-first`, prompt: "A different scene entirely.", context: "c" },
      source: "embedded",
      exhausted: false,
    });
    await chooseRole(OTHER.label, OTHER.value);
    expect(globalThis.localStorage.getItem(ROLE_STORAGE_KEY)).toBe(OTHER.value);

    // Remount from scratch, the way leaving the mode and coming back does.
    await act(async () => root.unmount());
    root = createRoot(container);
    fetchRoleSituation.mockClear();
    await render();

    // The role is remembered - and so is the situation that was already
    // fetched for it. Asserting a FETCH here would be asserting the bug:
    // remounting is exactly what happens when the user flicks to Live
    // interview and back, and refetching there loses the scene they were
    // mid-drill on and re-bills a model call for a round trip they
    // experienced as free.
    expect(picker().value).toBe(OTHER.value);
    expect(text()).toContain("A different scene entirely.");
    expect(fetchRoleSituation).not.toHaveBeenCalled();
  });
});

describe("RoleDrillClient - not overclaiming, and not going dead", () => {
  it("says when the answer is the role's general shape, not an answer to this scene", async () => {
    // On Gemini every situation after the first has a generated id that is
    // not in the bank, so a model failure yields the register's generic
    // beats. Captioning that "Gemini could not draft this one" alone leaves
    // the user reading an answer about a slipped deadline under a scene
    // about two engineers competing for one promotion.
    fetchRoleResponse.mockResolvedValue({
      ...responsePayload(DEFAULT_ROLE, "fallback"),
      situationMatched: false,
    });
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    expect(text()).toMatch(/general shape/i);
  });

  it("does not say that when the answer really was written for this scene", async () => {
    fetchRoleResponse.mockResolvedValue({
      ...responsePayload(DEFAULT_ROLE, "fallback"),
      situationMatched: true,
    });
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    expect(text()).not.toMatch(/general shape/i);
  });

  it("starts a fresh cycle once the role's situations have been exhausted", async () => {
    // `asked` never shrinks on its own, so once everything has been asked
    // the server returns the same first situation forever - and because its
    // id is unchanged, a revealed answer stays open too. "New situation"
    // becomes a control that does nothing at all, under a line promising
    // the situations will start repeating.
    fetchRoleSituation.mockResolvedValue(situationPayload(SITUATION_A, { exhausted: true }));
    await render();
    fetchRoleSituation.mockResolvedValue(situationPayload(SITUATION_B));
    await click(buttonNamed(/new situation/i));
    expect(fetchRoleSituation.mock.calls[1][0].asked).toEqual([]);
    expect(text()).toContain("thinking of leaving");
  });

  it("does not reopen a panel the user closed while the draft was in flight", async () => {
    // Click, then click again before it lands. The drill's whole premise is
    // answering before you look; an answer that reappears against the
    // user's own action is the worst available behaviour here.
    let resolveReveal;
    fetchRoleResponse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReveal = resolve;
        }),
    );
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    await click(buttonNamed(/model answer/i));
    await act(async () => {
      resolveReveal(responsePayload());
    });
    expect(text()).not.toContain("Line 1:");
    expect(buttonNamed(/reveal a model answer/i).getAttribute("aria-expanded")).toBe("false");
  });

  it("does not let a queue of situation requests build up behind one button", async () => {
    let pending = 0;
    fetchRoleSituation.mockImplementation(() => {
      pending += 1;
      return new Promise(() => {});
    });
    await render();
    const next = buttonNamed(/new situation/i);
    if (next) {
      await click(next);
      expect(buttonNamed(/new situation/i)?.disabled ?? true).toBe(true);
    }
    expect(pending).toBeLessThanOrEqual(2);
  });
});

describe("RoleDrillClient - accessibility (AC-Q9.6 to AC-Q9.9)", () => {
  it("points the disclosure at the panel it actually opens", async () => {
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    const control = buttonNamed(/model answer/i);
    const id = control.getAttribute("aria-controls");
    expect(id, "the reveal control names no panel").toBeTruthy();
    const panel = document.getElementById(id);
    expect(panel, `aria-controls points at #${id}, which does not exist`).toBeTruthy();
    expect(panel.textContent).toContain("Line 1:");
  });

  it("keeps a status region mounted from the start and changes its TEXT on reveal", async () => {
    await render();
    const region = container.querySelector('[role="status"]');
    expect(region, "no status region before the reveal").toBeTruthy();
    // A loading SITUATION is not an answer: this region speaks for the reveal
    // only, so it must still be empty here even though a fetch has resolved.
    expect((region.textContent || "").trim()).toBe("");

    await click(buttonNamed(/reveal a model answer/i));
    const after = container.querySelector('[role="status"]');
    expect(after).toBe(region);
    expect(after.textContent).toMatch(/Answer ready/i);
  });

  it("gives every control a name that contains its own visible text, with no aria-label", async () => {
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    const controls = [...buttons(), ...container.querySelectorAll('[role="combobox"]')];
    expect(controls.length).toBeGreaterThan(1);
    for (const el of controls) {
      const name = accessibleName(el);
      expect(name.length, "a control has no accessible name").toBeGreaterThan(0);
      const visible = (el.textContent || "").trim();
      if (visible) expect(name).toContain(visible);
      // MUI's Tooltip becomes an aria-label and RENAMES a control that has
      // visible text, which breaks voice control (WCAG 2.5.3). Nothing in
      // this feature needs one.
      expect(el.hasAttribute("aria-label"), `${visible} carries an aria-label`).toBe(false);
    }
  });

  it("skips no heading level between the situation and the panel's sections", async () => {
    // Measured in a browser first: MUI's `variant="subtitle2"` renders an
    // <h6> by default, so the panel's section labels jumped h3 -> h6 - the
    // exact gap a screen-reader user navigating by heading falls into. The
    // drill mounts under the tab's own h2, so it starts at h3.
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    const levels = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels.length).toBeGreaterThan(1);
    expect(levels[0]).toBe(3);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1], `jump from h${levels[i - 1]} to h${levels[i]}`).toBeLessThanOrEqual(1);
    }
  });

  it("marks every list as a list, with only list items inside", async () => {
    await render();
    await click(buttonNamed(/reveal a model answer/i));
    const lists = [...container.querySelectorAll("ul")];
    // Guard first: zero lists means zero iterations, and a panel built out of
    // Stacks and divs would sail through the loop below having proved nothing.
    expect(lists.length, "the panel renders no lists at all").toBeGreaterThan(0);
    for (const ul of lists) {
      expect(ul.getAttribute("role")).toBe("list");
      for (const child of [...ul.children]) expect(child.tagName).toBe("LI");
    }
  });

  it("uses the accessible text colour token, not the muted one", async () => {
    // --text-muted measures 4.15:1 on --bg-surface in light mode, under the
    // 4.5:1 threshold for normal text (R-228).
    const dir = path.join(process.cwd(), "app", "copilot", "roles");
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"));
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) expect(src).not.toContain("--text-muted");
  });

  it("keeps every file in the feature under the size cap", () => {
    const dir = path.join(process.cwd(), "app", "copilot", "roles");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const lines = readFileSync(path.join(dir, file), "utf8").split("\n").length;
      expect(lines, `${file} is ${lines} lines`).toBeLessThan(1000);
    }
  });
});

describe("RoleDrillClient - failure", () => {
  it("reports a failed situation load with a retry, and says nothing in the status region", async () => {
    fetchRoleSituation.mockRejectedValue(new Error("Situation request failed (500)."));
    await render();
    const alert = container.querySelector('[role="alert"]');
    expect(alert, "no alert for a failed load").toBeTruthy();
    expect(alert.textContent).toMatch(/failed/i);
    const region = container.querySelector('[role="status"]');
    expect(region, "the status region disappeared in the error state").toBeTruthy();
    expect((region.textContent || "").trim()).toBe("");

    fetchRoleSituation.mockResolvedValue(situationPayload());
    await click(buttonNamed(/retry/i));
    expect(text()).toContain("why the release slipped");
  });

  it("reports a failed reveal without losing the situation", async () => {
    await render();
    fetchRoleResponse.mockRejectedValue(new Error("Model answer request failed (500)."));
    await click(buttonNamed(/reveal a model answer/i));
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(text()).toContain("why the release slipped");
  });
});
