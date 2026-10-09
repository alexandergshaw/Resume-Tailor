// @vitest-environment jsdom
//
// N151b (4b) — T5 / R8 / R9: the switcher UI, proven through the REAL
// TemplateLibraryPanel mounted in a host, the same surface a user meets. jsdom
// renders components here (vitest.config.js oxc lang:"jsx"; the precedent is
// ApplyingControls.markTemplate.test.js). The panel is driven by a stub
// `library` (the useTemplateLibrary result) so this isolates the markup + the
// a11y contract + the reachability of select/delete from the hook's state
// machine (that is T4).
//
// REACHABILITY: the active template is read off the CHECKED radio; a different
// template is activated by CLICKING its radio input (a real activation, not a
// handler call); a template is deleted by CLICKING its delete button. No
// callback is invoked directly.
//
// RED on HEAD: app/components/applying/TemplateLibraryPanel.js does not exist
// (module-not-found) — the whole file reds until Step 4. GREEN after Step 4.
//
// Mutations that must RED:
//   R8 — render a Select (MUI non-native, WCAG 2.5.3) instead of a RadioGroup, or
//        leave the active template's radio UNCHECKED.
//   R9 — give the delete controls a repeated/identical accessible name.
// No-op CONTROL that must survive: the empty / signed-out / null-selection states
// still render their own copy (the gate is state-specific, not a blanket hide).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import TemplateLibraryPanel from "./TemplateLibraryPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: "user-1" };
const A = { id: "tmpl-a", name: "Classic", kind: "resume" };
const B = { id: "tmpl-b", name: "Modern", kind: "resume" };

function stubLibrary(overrides = {}) {
  return {
    templates: [A, B],
    selectedId: "tmpl-a",
    loading: false,
    error: "",
    refresh: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

async function render(props = {}) {
  await act(async () => {
    root.render(createElement(TemplateLibraryPanel, { kind: "resume", currentUser: USER, ...props }));
  });
}

// Accessible name from aria-label, else the text of aria-labelledby targets.
function accName(el) {
  const label = (el.getAttribute("aria-label") || "").trim();
  if (label) return label;
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
}
function radios() {
  return [...container.querySelectorAll('input[type="radio"]')];
}
function deleteButtons() {
  return [...container.querySelectorAll("button")].filter((b) =>
    /^delete\b/i.test((b.getAttribute("aria-label") || "").trim()));
}
async function clickEl(el) {
  await act(async () => { el.click(); });
}

describe("the switcher is an a11y-correct radio group (T5 / R8)", () => {
  it("renders a role=radiogroup with an accessible name, one radio per template, active one CHECKED", async () => {
    const library = stubLibrary();
    await render({ library });

    const group = container.querySelector('[role="radiogroup"]');
    expect(group, "no radiogroup — a Select or plain list is not the a11y-correct control").toBeTruthy();
    expect(accName(group), "the radio group has no accessible name").toMatch(/template library/i);

    const rs = radios();
    expect(rs.map((r) => r.value).sort()).toEqual(["tmpl-a", "tmpl-b"]);
    const checked = rs.filter((r) => r.checked);
    expect(checked, "exactly one radio should be checked — the active template").toHaveLength(1);
    expect(checked[0].value).toBe("tmpl-a");
  });

  it("the template names are the radios' labels (not hidden in a Tooltip)", async () => {
    await render({ library: stubLibrary() });
    expect(container.textContent).toContain("Classic");
    expect(container.textContent).toContain("Modern");
  });

  it("clicking a DIFFERENT template's radio calls library.select with that id", async () => {
    const library = stubLibrary();
    await render({ library });
    const modern = radios().find((r) => r.value === "tmpl-b");
    expect(modern, "no radio for the Modern template").toBeTruthy();
    await clickEl(modern);
    expect(library.select).toHaveBeenCalledTimes(1);
    expect(library.select).toHaveBeenCalledWith("tmpl-b");
  });
});

describe("delete controls have distinct accessible names (T5 / R9)", () => {
  it("each template has a delete control whose name names THAT template, and they are distinct", async () => {
    await render({ library: stubLibrary() });
    const dels = deleteButtons();
    expect(dels, "a delete control per template").toHaveLength(2);
    const names = dels.map((b) => (b.getAttribute("aria-label") || "").trim());
    expect(new Set(names).size, "delete controls share an accessible name").toBe(2);
    expect(names.some((n) => /classic/i.test(n))).toBe(true);
    expect(names.some((n) => /modern/i.test(n))).toBe(true);
  });

  it("clicking a delete control calls library.remove with that template's id", async () => {
    const library = stubLibrary();
    await render({ library });
    const delA = deleteButtons().find((b) => /classic/i.test(b.getAttribute("aria-label") || ""));
    await clickEl(delA);
    expect(library.remove).toHaveBeenCalledTimes(1);
    expect(library.remove).toHaveBeenCalledWith("tmpl-a");
  });
});

describe("states (T5 / R8 controls)", () => {
  it("signed out: shows a sign-in prompt and NO radio group", async () => {
    await render({ currentUser: null, library: stubLibrary({ templates: [], selectedId: null }) });
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.textContent).toMatch(/sign in/i);
  });

  it("empty: shows an empty-state message and NO radio group", async () => {
    await render({ library: stubLibrary({ templates: [], selectedId: null }) });
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.textContent).toMatch(/no (saved )?templates/i);
  });

  it("null selection WITH templates: no radio checked, and a null-state caption is shown", async () => {
    await render({ library: stubLibrary({ selectedId: null }) });
    const checked = radios().filter((r) => r.checked);
    expect(checked, "no template is selected, so no radio should be checked").toHaveLength(0);
    expect(container.textContent).toMatch(/no template selected/i);
  });
});
