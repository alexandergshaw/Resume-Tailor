// @vitest-environment jsdom
//
// N124 -- the shared PostingPicker remembers the companies the user recently
// practiced / interviewed for, across sessions, and offers their postings first.
// Binds to docs/loop/N124.design.r1.md (sections 3, 4, 6) with the owner's two
// pre-decisions: persist across sessions, and the field stays SINGLE-select.
//
// THE INERT-BY-DEFAULT FLOOR. With nothing persisted -- the state every landed
// suite that renders the real picker runs in -- the picker must render exactly as
// before: no group headers, options in fetch order, no key written. The first
// describe block pins that, so a change that leaks a "Recent" header or a write
// into the empty case fails here before it reaches the other copilot suites.
//
// THE REAL PICKER, THE REAL STORE. Only the posting loader is stubbed. Each case
// seeds localStorage and then re-imports the module graph (vi.resetModules), which
// is also the honest model of "a new session": the store hydrates from storage at
// import, exactly as it does on a page load.
//
// NEVER AUTO-SELECT. The remembered companies are surfaced as options to pick;
// nothing may call onChange on its own (an explicit blank choice is a supported
// state and must never be overridden). The "does not select for the user" case
// pins that with recents present AND matching.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { RECENT_COMPANIES_STORAGE_KEY as KEY } from "@/lib/copilot/recentCompanies.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fetchPracticePostings = vi.fn();
vi.mock("@/lib/copilot/postings", () => ({ fetchPracticePostings: (...a) => fetchPracticePostings(...a) }));

const mk = (id, title, company) => ({
  id,
  title,
  company,
  label: title && company ? `${title} — ${company}` : title || company,
});
// Newest applied first, the order fetchPracticePostings returns.
const INITECH = mk("a1", "Backend Engineer", "Initech");
const ACME_1 = mk("a2", "Staff Engineer", "Acme");
const HOOLI = mk("a3", "SRE", "Hooli");
const GLOBEX = mk("a4", "Platform Engineer", "Globex");
const ACME_2 = mk("a5", "Senior Engineer", "Acme");
const POSTINGS = [INITECH, ACME_1, HOOLI, GLOBEX, ACME_2];

const seed = (companies) =>
  window.localStorage.setItem(KEY, JSON.stringify(companies.map((company, i) => ({ company, lastUsedAt: 100 - i }))));
const persisted = () => {
  const raw = window.localStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw).map((e) => e.company);
};

let PostingPicker;
let container;
let root;

beforeEach(async () => {
  window.localStorage.clear();
  fetchPracticePostings.mockReset();
  fetchPracticePostings.mockResolvedValue(POSTINGS);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

// Re-import so the store hydrates from whatever the case seeded -- a fresh session.
async function freshPicker() {
  vi.resetModules();
  ({ default: PostingPicker } = await import("./PostingPicker.js"));
}

async function mount(props) {
  await freshPicker();
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(PostingPicker, { value: null, onChange: () => {}, ...props }),
      ),
    );
  });
  await flush();
}

// A picker whose parent owns the selection, as both clients do.
async function mountControlled(props = {}) {
  await freshPicker();
  const calls = [];
  function Harness() {
    const [value, setValue] = useState(null);
    return createElement(PostingPicker, {
      value,
      onChange: (next) => {
        calls.push(next);
        setValue(next);
      },
      ...props,
    });
  }
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(Harness)));
  });
  await flush();
  return calls;
}

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const input = () => document.body.querySelector(".MuiAutocomplete-root input");
async function openPopup() {
  await act(async () => {
    input().focus();
    input().dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await flush();
}
const optionLabels = () => [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent);
const groupLabels = () => [...document.body.querySelectorAll(".MuiAutocomplete-groupLabel")].map((g) => g.textContent);
const optionByLabel = (label) => [...document.body.querySelectorAll('[role="option"]')].find((o) => o.textContent === label);
async function click(el) {
  expect(el, "element to click not found").toBeTruthy();
  await act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await flush();
}
const clearButton = () => document.body.querySelector(".MuiAutocomplete-clearIndicator");

describe("nothing persisted: the picker is exactly today's picker", () => {
  it("renders no group header and keeps the options in fetch order", async () => {
    await mount();
    await openPopup();
    expect(groupLabels()).toEqual([]);
    expect(optionLabels()).toEqual(POSTINGS.map((p) => p.label));
  });

  it("keeps the plain listbox shape: every option is a direct child of the listbox, with no group wrapper", async () => {
    await mount();
    await openPopup();
    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox.querySelectorAll(':scope > [role="option"]')).toHaveLength(POSTINGS.length);
    expect(listbox.querySelector(".MuiAutocomplete-groupUl")).toBeNull();
  });

  it("does not create the storage key by mounting and opening it", async () => {
    await mount();
    await openPopup();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("does not call onChange on its own", async () => {
    const onChange = vi.fn();
    await mount({ onChange });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("remembered companies are surfaced as options, never selected", () => {
  it("puts the postings of a remembered company first under a single 'Recent' header, the rest under one 'All postings'", async () => {
    seed(["Acme"]);
    await mount();
    await openPopup();
    expect(groupLabels()).toEqual(["Recent", "All postings"]);
    expect(optionLabels()).toEqual([ACME_1, ACME_2, INITECH, HOOLI, GLOBEX].map((p) => p.label));
  });

  it("orders several remembered companies most-recent first", async () => {
    seed(["Globex", "Acme"]);
    await mount();
    await openPopup();
    expect(optionLabels().slice(0, 3)).toEqual([GLOBEX, ACME_1, ACME_2].map((p) => p.label));
    expect(groupLabels()).toEqual(["Recent", "All postings"]);
  });

  it("matches a remembered company case-insensitively", async () => {
    seed(["  hooli "]);
    await mount();
    await openPopup();
    expect(optionLabels()[0]).toBe(HOOLI.label);
  });

  it("does not offer a remembered company that no longer has a posting", async () => {
    seed(["Umbrella", "Acme"]);
    await mount();
    await openPopup();
    expect(optionLabels()).toHaveLength(POSTINGS.length);
    expect(optionLabels().join("|")).not.toContain("Umbrella");
    expect(optionLabels()[0]).toBe(ACME_1.label);
  });

  it("shows no group header and the original order when no remembered company matches any posting", async () => {
    seed(["Umbrella"]);
    await mount();
    await openPopup();
    expect(groupLabels()).toEqual([]);
    expect(optionLabels()).toEqual(POSTINGS.map((p) => p.label));
  });

  it("does not select for the user: onChange is not called and the field stays blank", async () => {
    const onChange = vi.fn();
    seed(["Acme"]);
    await mount({ onChange });
    await openPopup();
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe("");
  });

  it("an explicit blank stays blank: a parent that cleared the field is not re-filled from the list", async () => {
    seed(["Acme"]);
    const calls = await mountControlled();
    await openPopup();
    await click(optionByLabel(ACME_1.label));
    expect(calls).toEqual([ACME_1]);
    await click(clearButton());
    expect(calls).toEqual([ACME_1, null]);
    expect(input().value).toBe("");
    await flush();
    expect(calls).toEqual([ACME_1, null]);
  });

  it("leaves the typed search alone: filtering by typing still narrows the grouped list", async () => {
    seed(["Acme"]);
    await mount();
    await openPopup();
    await act(async () => {
      const el = input();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, "SRE");
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await flush();
    expect(optionLabels()).toEqual([HOOLI.label]);
  });
});

describe("an explicit selection is remembered", () => {
  it("records the chosen posting's company and still calls onChange with the posting", async () => {
    const calls = await mountControlled();
    await openPopup();
    await click(optionByLabel(GLOBEX.label));
    expect(calls).toEqual([GLOBEX]);
    expect(persisted()).toEqual(["Globex"]);
  });

  it("surfaces the company on the next open in the same session, and on a fresh session", async () => {
    const calls = await mountControlled();
    await openPopup();
    await click(optionByLabel(GLOBEX.label));
    await click(clearButton());
    expect(calls).toEqual([GLOBEX, null]);
    await openPopup();
    expect(optionLabels()[0]).toBe(GLOBEX.label);
    expect(groupLabels()).toEqual(["Recent", "All postings"]);

    // A new session: the module graph is discarded and storage is all that is left.
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    await openPopup();
    expect(optionLabels()[0]).toBe(GLOBEX.label);
    expect(groupLabels()).toEqual(["Recent", "All postings"]);
  });

  it("re-choosing a remembered company moves it to the front instead of duplicating it", async () => {
    seed(["Acme", "Globex"]);
    const calls = await mountControlled();
    await openPopup();
    await click(optionByLabel(GLOBEX.label));
    expect(calls).toEqual([GLOBEX]);
    expect(persisted()).toEqual(["Globex", "Acme"]);
  });

  it("clearing the field writes nothing", async () => {
    seed(["Acme"]);
    const calls = await mountControlled();
    await openPopup();
    await click(optionByLabel(GLOBEX.label));
    const afterSelect = window.localStorage.getItem(KEY);
    await click(clearButton());
    expect(calls).toEqual([GLOBEX, null]);
    expect(window.localStorage.getItem(KEY)).toBe(afterSelect);
    expect(persisted()).toEqual(["Globex", "Acme"]);
  });

  it("choosing a title-only posting (no company) calls onChange but remembers nothing", async () => {
    const titleOnly = mk("t1", "Freelance gig", "");
    fetchPracticePostings.mockResolvedValue([titleOnly, ACME_1]);
    seed(["Acme"]);
    const calls = await mountControlled();
    await openPopup();
    const before = window.localStorage.getItem(KEY);
    await click(optionByLabel(titleOnly.label));
    expect(calls).toEqual([titleOnly]);
    expect(window.localStorage.getItem(KEY)).toBe(before);
  });

  it("a restore through initialId is not an explicit selection and records nothing", async () => {
    const onChange = vi.fn();
    await mount({ onChange, initialId: "a2" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(ACME_1);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("storage that throws does not take the picker down", () => {
  it("renders and selects with a localStorage that throws on every read and write", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const calls = await mountControlled();
    await openPopup();
    expect(optionLabels()).toEqual(POSTINGS.map((p) => p.label));
    await click(optionByLabel(GLOBEX.label));
    expect(calls).toEqual([GLOBEX]);
  });
});

describe("the rest of the picker is unchanged", () => {
  it("a load failure still says so, and a remembered company is not offered as a stand-in", async () => {
    seed(["Acme"]);
    fetchPracticePostings.mockRejectedValue(new Error("boom"));
    await mount();
    await openPopup();
    expect(document.body.querySelector(".MuiFormHelperText-root")?.textContent).toBe("boom");
    expect(document.body.querySelector(".MuiAutocomplete-noOptions")?.textContent).toBe(
      "Could not load your postings — see the error below.",
    );
    expect(optionLabels()).toEqual([]);
    expect(groupLabels()).toEqual([]);
  });

  it("an empty account still says there are no tracked postings, even with a remembered company", async () => {
    seed(["Acme"]);
    fetchPracticePostings.mockResolvedValue([]);
    await mount();
    await openPopup();
    expect(document.body.querySelector(".MuiAutocomplete-noOptions")?.textContent).toBe(
      "No tracked postings yet — add one from the Tracking tab.",
    );
    expect(groupLabels()).toEqual([]);
  });

  it("keeps its accessible name and is keyboard-reachable: arrow-down lands on the first remembered posting", async () => {
    seed(["Globex"]);
    await mount({ label: "Interviewing for" });
    const field = input();
    expect(field.getAttribute("role")).toBe("combobox");
    expect(field.labels[0]?.textContent).toContain("Interviewing for");
    // The first ArrowDown opens the list; the next one highlights its first option.
    await openPopup();
    await act(async () => {
      field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await flush();
    const active = document.getElementById(field.getAttribute("aria-activedescendant"));
    expect(active?.textContent).toBe(GLOBEX.label);
    expect(active?.getAttribute("role")).toBe("option");
  });

  it("group headers are not options: they are not selectable and not in the option list", async () => {
    seed(["Acme"]);
    await mount();
    await openPopup();
    expect(optionLabels()).not.toContain("Recent");
    expect(optionLabels()).not.toContain("All postings");
  });
});
