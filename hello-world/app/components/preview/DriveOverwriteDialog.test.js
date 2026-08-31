// @vitest-environment jsdom
//
// The foreign-edit conflict prompt is the riskiest element in the Drive
// feature (`UX.md` rev 2 §5): it interrupts a deliberately one-click flow,
// so every dismissal route must write nothing, Escape must not leak past
// this prompt and close the whole preview, and focus must never land on a
// button (a pending Enter keypress must not become an overwrite). This file
// renders the real component (`app/components/JobDescriptionTab.test.js` is
// the worked example for rendering a component under jsdom in this repo)
// rather than testing it as a pure function, because every property above
// IS the markup and the DOM event wiring.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DriveOverwriteDialog from "./DriveOverwriteDialog.js";
import {
  overwriteHeading,
  overwriteBody,
  saveAsNewDocLabel,
  overwriteDocLabel,
  DRIVE_OVERWRITE_DISMISS_LABEL,
} from "@/lib/drive/driveMessages.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function baseProps(overrides) {
  return {
    docNames: ["Acme - Senior Engineer - Resume"],
    onSaveAsNew: vi.fn(),
    onOverwrite: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(DriveOverwriteDialog, props));
  });
}

function group() {
  return container.querySelector('[role="group"]');
}

function buttons() {
  return [...container.querySelectorAll("button")];
}

function buttonNamed(pattern) {
  return buttons().find((b) => pattern.test(b.textContent.trim()));
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("DriveOverwriteDialog -- copy (UX.md §5.3, verbatim)", () => {
  it("single-Doc conflict: heading names the Doc in curly quotes, body is the exact hedge sentence", async () => {
    const docNames = ["Acme - Senior Engineer - Resume"];
    await render(baseProps({ docNames }));
    const heading = document.getElementById(group().getAttribute("aria-labelledby"));
    const body = document.getElementById(group().getAttribute("aria-describedby"));
    // Imported and called for real (not a copy) -- proves this render is
    // actually wired to driveMessages.js's own exports, not a local
    // recomputation of the same words.
    expect(heading.textContent).toBe(overwriteHeading(docNames));
    expect(body.textContent).toBe(overwriteBody(docNames));
    // Pinned literals -- the guard: if driveMessages.js's wording and its
    // own driveMessages.test.js were reworded together (the mutation that
    // defeated a previous attempt at this rule), the two assertions above
    // would still pass because both sides come from the same live import.
    // These two don't -- they pin the sentence as text, so this test goes
    // red the moment the rendered copy no longer matches it.
    expect(heading.textContent).toBe(
      "“Acme - Senior Engineer - Resume” has changed in your Drive since this app last saved it.",
    );
    expect(body.textContent).toBe(
      "That could be an edit, or just a rename, a move, or a comment — the app can't tell which. Overwriting replaces whatever is in the Doc now, and this app can't undo it.",
    );
    expect(buttonNamed(/^Save as a new Doc$/)).toBeDefined();
    expect(buttonNamed(/^Overwrite the Doc$/)).toBeDefined();
    expect(buttonNamed(/^Save as a new Doc$/).textContent.trim()).toBe(saveAsNewDocLabel(docNames));
    expect(buttonNamed(/^Overwrite the Doc$/).textContent.trim()).toBe(overwriteDocLabel(docNames));
  });

  it("both-Docs conflict: one prompt, plural heading/body, plural button labels", async () => {
    const docNames = ["Acme - Senior Engineer - Resume", "Acme - Senior Engineer - Cover Letter"];
    await render(baseProps({ docNames }));
    const heading = document.getElementById(group().getAttribute("aria-labelledby"));
    const body = document.getElementById(group().getAttribute("aria-describedby"));
    expect(heading.textContent).toBe(overwriteHeading(docNames));
    expect(body.textContent).toBe(overwriteBody(docNames));
    // Pinned literals -- see the singular case above for why both forms
    // matter: this is the guard half, not a redundant duplicate of the
    // live-import assertions above.
    expect(heading.textContent).toBe("Both Docs have changed in your Drive since this app last saved them.");
    expect(body.textContent).toBe(
      "That could be edits, or just renames, moves, or comments — the app can't tell which. Overwriting replaces whatever is in the Docs now, and this app can't undo it.",
    );
    expect(buttonNamed(/^Save as new Docs$/)).toBeDefined();
    expect(buttonNamed(/^Overwrite the Docs$/)).toBeDefined();
    expect(buttonNamed(/^Save as new Docs$/).textContent.trim()).toBe(saveAsNewDocLabel(docNames));
    expect(buttonNamed(/^Overwrite the Docs$/).textContent.trim()).toBe(overwriteDocLabel(docNames));
  });

  // "Not now" is identical in both forms -- UX.md never pluralises it.
  it("'Not now' does not change between the singular and plural forms", async () => {
    await render(baseProps({ docNames: ["A", "B"] }));
    const notNow = buttonNamed(/^Not now$/);
    expect(notNow).toBeDefined();
    expect(notNow.textContent.trim()).toBe(DRIVE_OVERWRITE_DISMISS_LABEL);
    expect(notNow.textContent.trim()).toBe("Not now");
  });
});

describe("DriveOverwriteDialog -- three actions, safe-first (AC-S16, UX.md §5.4)", () => {
  it("renders exactly three buttons", async () => {
    await render(baseProps());
    expect(buttons()).toHaveLength(3);
  });

  // This tests UX.md's own safe-first-in-DOM-order requirement ("The safe
  // option comes first in DOM order so Tab reaches it first"). It is
  // DELIBERATELY NOT an assertion of AC-S18's prose listing, which names
  // the actions Overwrite -> Save-as-new and which UX.md §12 note 6
  // explicitly says must NOT be read as a DOM-order requirement -- asserting
  // that order here would fail a correct, safe-first implementation.
  it("puts 'Save as a new Doc' first, 'Overwrite the Doc' second, 'Not now' last", async () => {
    await render(baseProps());
    expect(buttons().map((b) => b.textContent.trim())).toEqual([
      "Save as a new Doc",
      "Overwrite the Doc",
      "Not now",
    ]);
  });

  it("'Save as a new Doc' calls onSaveAsNew and nothing else", async () => {
    const props = baseProps();
    await render(props);
    await click(buttonNamed(/^Save as a new Doc$/));
    expect(props.onSaveAsNew).toHaveBeenCalledTimes(1);
    expect(props.onOverwrite).not.toHaveBeenCalled();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("'Overwrite the Doc' calls onOverwrite and nothing else", async () => {
    const props = baseProps();
    await render(props);
    await click(buttonNamed(/^Overwrite the Doc$/));
    expect(props.onOverwrite).toHaveBeenCalledTimes(1);
    expect(props.onSaveAsNew).not.toHaveBeenCalled();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("'Not now' calls onDismiss and writes nothing (onSaveAsNew/onOverwrite never called)", async () => {
    const props = baseProps();
    await render(props);
    await click(buttonNamed(/^Not now$/));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    expect(props.onSaveAsNew).not.toHaveBeenCalled();
    expect(props.onOverwrite).not.toHaveBeenCalled();
  });
});

describe("DriveOverwriteDialog -- focus never lands on a button (UX.md §5.4)", () => {
  it("moves focus to the prompt CONTAINER on mount, not to any button", async () => {
    // Paired positive control: assert it was NOT already true before the
    // assertion that it became true, per UX.md §12 note 1/AC-A4 -- otherwise
    // this passes against a component with no focus management at all.
    expect(document.activeElement).not.toBe(container);
    await render(baseProps());
    const node = group();
    expect(node).not.toBeNull();
    expect(document.activeElement).toBe(node);
    expect(document.activeElement.tagName).not.toBe("BUTTON");
  });
});

describe("DriveOverwriteDialog -- unmount mid-decision (WAVE3-SEAMS.md MAJ-1's adjacent untested route)", () => {
  // Nothing is written when this prompt unmounts without the user choosing
  // one of its three actions (this component only ever calls onSaveAsNew /
  // onOverwrite / onDismiss from its own button handlers and Escape) -- but
  // before this fix, React removing the focused container from the DOM let
  // the browser's default kick in and focus fell to <body>, stranding a
  // keyboard user with no visible indication of where focus went.
  it("restores focus to whatever had it before this prompt mounted, instead of stranding it on <body>", async () => {
    const outside = document.createElement("button");
    outside.textContent = "Save to Drive";
    document.body.appendChild(outside);
    try {
      outside.focus();
      expect(document.activeElement).toBe(outside);

      const props = baseProps();
      await render(props);
      // Mount-time focus takes over, per the existing focus-management rule.
      expect(document.activeElement).toBe(group());

      // Unmount mid-decision: the caller drops this prompt via some route
      // other than its own buttons (e.g. the whole modal closes) -- nothing
      // was clicked, so nothing should have been written.
      await act(async () => {
        root.render(null);
      });

      expect(container.querySelector('[role="group"]')).toBeNull();
      expect(document.activeElement).toBe(outside);
      expect(props.onSaveAsNew).not.toHaveBeenCalled();
      expect(props.onOverwrite).not.toHaveBeenCalled();
      expect(props.onDismiss).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it("does not yank focus back if the user already moved focus elsewhere before this prompt unmounted", async () => {
    const outside = document.createElement("button");
    const another = document.createElement("button");
    document.body.appendChild(outside);
    document.body.appendChild(another);
    try {
      outside.focus();
      await render(baseProps());
      expect(document.activeElement).toBe(group());

      // The user tabs or clicks away from the prompt themselves, to
      // something else entirely, before it closes.
      another.focus();
      expect(document.activeElement).toBe(another);

      await act(async () => {
        root.render(null);
      });

      // Focus stays where the USER put it -- not yanked back to `outside`.
      expect(document.activeElement).toBe(another);
    } finally {
      outside.remove();
      another.remove();
    }
  });

});

describe("DriveOverwriteDialog -- Escape (UX.md §5.6, AC-S16)", () => {
  it("Escape calls onDismiss and stopPropagation()s so an ancestor (MUI Modal's own handler) never sees it", async () => {
    const ancestorHandler = vi.fn();
    // Simulates MUI's Modal attaching its Escape handler to the modal ROOT,
    // an ANCESTOR of this prompt -- exactly the shape DocumentPreviewDialog
    // will have once this component is mounted inside it. Attached to
    // `document`, a genuine ANCESTOR of `container`, not to `container`
    // itself: React's own root listener is attached to `container` (the
    // node passed to `createRoot`), so a listener placed there races React's
    // registration order instead of testing real DOM bubbling.
    document.addEventListener("keydown", ancestorHandler);
    try {
      const props = baseProps();
      await render(props);

      await act(async () => {
        group().dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });

      expect(props.onDismiss).toHaveBeenCalledTimes(1);
      expect(props.onSaveAsNew).not.toHaveBeenCalled();
      expect(props.onOverwrite).not.toHaveBeenCalled();
      expect(ancestorHandler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", ancestorHandler);
    }
  });

  it("a non-Escape key does not dismiss and does not stop propagation", async () => {
    const ancestorHandler = vi.fn();
    document.addEventListener("keydown", ancestorHandler);
    try {
      const props = baseProps();
      await render(props);

      await act(async () => {
        group().dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });

      expect(props.onDismiss).not.toHaveBeenCalled();
      expect(ancestorHandler).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", ancestorHandler);
    }
  });
});

describe("DriveOverwriteDialog -- accessible structure (AC-A8)", () => {
  it("aria-labelledby and aria-describedby resolve to the heading and body text respectively", async () => {
    await render(baseProps());
    const node = group();
    const labelledBy = node.getAttribute("aria-labelledby");
    const describedBy = node.getAttribute("aria-describedby");
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(labelledBy).not.toBe(describedBy);
    expect(document.getElementById(labelledBy).textContent).toContain("has changed in your Drive");
    expect(document.getElementById(describedBy).textContent).toContain("this app can't undo it");
  });

  it("the container carries tabIndex=-1 (programmatically focusable, not in normal Tab order as a stop of its own)", async () => {
    await render(baseProps());
    expect(group().getAttribute("tabindex")).toBe("-1");
  });
});

describe("DriveOverwriteDialog -- touch targets (AC-M3, source-level guard for the sx-bare-number trap)", () => {
  it("uses explicit '44px' strings for the in-flight touch-target size, never a bare 44", async () => {
    const src = readFileSync(join(HERE, "DriveOverwriteDialog.js"), "utf8");
    expect(src).toContain('"44px"');
    // Guards the repo's own recorded trap (answerStatus.js:69-80): a bare
    // number in `sx` is a multiplier/fraction, not a pixel value.
    expect(/minHeight:\s*\{[^}]*xs:\s*44[^p]/.test(src)).toBe(false);
  });
});

// Strips BOTH block comments (`/* ... */`, including JSDoc `/** ... */`) and
// whole lines whose trimmed content starts with `//`, IDENTICAL discipline
// to `lib/drive/driveSourceSweep.test.js`'s own `stripComments` (read there
// for the full rationale). WAVE3-SEAMS.md MAJOR M-3: this file's "imports
// the prompt copy" sweep used to grep the RAW file text, and this
// component's own header comment (above `DriveOverwriteDialog`'s
// declaration) names all five imported identifiers in prose -- so a mutation
// that deleted the entire import block and hardcoded `{"Not now"}` in place
// of `{DRIVE_OVERWRITE_DISMISS_LABEL}` still left five of six raw-text
// assertions green (the sixth, `overwriteHeading`, also still matched the
// header comment, so ALL of them stayed green, and the whole file passed).
// Exactly R-279's recorded comment-stripping trap, reintroduced here.
function stripComments(src) {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlockComments
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

describe("DriveOverwriteDialog -- copy has exactly one home (source-level guard against re-duplication)", () => {
  // This feature has shipped two duplication defects before: strings
  // re-derived locally instead of imported from driveMessages.js (two of
  // twelve silently diverged), and a message reworded together with its own
  // test while a row builder kept emitting the old sentence elsewhere. This
  // component's four prompt sentences were themselves a flagged instance of
  // the first pattern until this file's own copy assertions above wired them
  // to the live driveMessages.js exports. This sweep guards against that
  // regressing: someone re-adding a local hardcoded copy of the sentences
  // (e.g. "for convenience", or a fallback "just in case the import breaks")
  // is exactly the second spelling this rule exists to prevent.

  it("[canary] stripComments blanks this file's own header-comment identifiers, proving the sweep below isn't self-matching", () => {
    // This file's own header comment (above) mentions "overwriteHeading" in
    // prose while describing the sweep -- exactly the shape that defeated
    // the raw-text version of this check. If stripComments failed to blank
    // it, this canary would fail too.
    const commentOnly = "// overwriteHeading, overwriteBody, saveAsNewDocLabel";
    expect(stripComments(commentOnly)).not.toContain("overwriteHeading");
  });

  it("imports the prompt copy from driveMessages.js rather than recomputing it -- checked on COMMENT-STRIPPED source", async () => {
    const rawSrc = readFileSync(join(HERE, "DriveOverwriteDialog.js"), "utf8");
    const src = stripComments(rawSrc);
    // Positive control: the raw file DOES still contain these names in its
    // header comment (the exact condition that let the mutation hide) --
    // proving the strip below is load-bearing, not vacuous.
    expect(rawSrc).toContain("overwriteHeading");
    expect(src).toContain('from "@/lib/drive/driveMessages"');
    expect(src).toContain("overwriteHeading");
    expect(src).toContain("overwriteBody");
    expect(src).toContain("saveAsNewDocLabel");
    expect(src).toContain("overwriteDocLabel");
    expect(src).toContain("DRIVE_OVERWRITE_DISMISS_LABEL");
  });

  it("no longer hardcodes the prompt sentences -- they exist only in driveMessages.js now", async () => {
    const src = stripComments(readFileSync(join(HERE, "DriveOverwriteDialog.js"), "utf8"));
    expect(src).not.toContain("has changed in your Drive since this app last saved it");
    expect(src).not.toContain("Both Docs have changed in your Drive since this app last saved them");
    expect(src).not.toContain("the app can't tell which");
    expect(src).not.toContain("Save as new Docs");
    expect(src).not.toContain("Overwrite the Docs");
  });

  // WAVE3-SEAMS.md's own M11 mutation ("the whole file passed") left the
  // import statement IN PLACE and swapped ONLY the JSX usage
  // ({DRIVE_OVERWRITE_DISMISS_LABEL} -> {"Not now"}). Because the import
  // line still names every identifier, the plain "does the comment-stripped
  // source CONTAIN this identifier anywhere" sweep above cannot tell
  // "imported" apart from "imported AND actually used" -- both are true
  // for a file that imports the constant and then ignores it. A rendered
  // -DOM comparison can't catch it either: `DRIVE_OVERWRITE_DISMISS_LABEL`'s
  // value ("Not now") is IDENTICAL to the retyped literal, so
  // `notNow.textContent === DRIVE_OVERWRITE_DISMISS_LABEL` is true whether
  // the component reads the import or just happens to hardcode the same
  // words -- pinned literals and live-import comparisons are the same
  // assertion when the two strings agree, which they always do right after
  // a mutation retypes the CURRENT value. So this sweep checks USAGE SHAPE
  // instead: the four functions must be CALLED (`name(`), and the one
  // plain-string export must appear as its own bare JSX expression
  // (`{DRIVE_OVERWRITE_DISMISS_LABEL}`) -- the exact shape the mutation
  // destroys, since the import-list form (`DRIVE_OVERWRITE_DISMISS_LABEL,`)
  // never has a `}` immediately after the identifier.
  it("every imported copy identifier is actually CALLED or USED as a JSX expression, not just named in the import list", async () => {
    const src = stripComments(readFileSync(join(HERE, "DriveOverwriteDialog.js"), "utf8"));
    for (const fn of ["overwriteHeading", "overwriteBody", "saveAsNewDocLabel", "overwriteDocLabel"]) {
      expect(src).toMatch(new RegExp(`\\b${fn}\\s*\\(`));
    }
    expect(src).toMatch(/\{\s*DRIVE_OVERWRITE_DISMISS_LABEL\s*\}/);
  });

  it("[canary] the usage-shape check above DOES go red against the exact M11 mutation shape (import kept, usage retyped)", () => {
    const mutated = stripComments(
      readFileSync(join(HERE, "DriveOverwriteDialog.js"), "utf8"),
    ).replace("{DRIVE_OVERWRITE_DISMISS_LABEL}", '{"Not now"}');
    // Positive control first: the un-mutated source really does match.
    expect(stripComments(readFileSync(join(HERE, "DriveOverwriteDialog.js"), "utf8"))).toMatch(
      /\{\s*DRIVE_OVERWRITE_DISMISS_LABEL\s*\}/,
    );
    // After the mutation, the bare-JSX-expression shape is gone even though
    // the import line still names the identifier -- proving this check,
    // unlike the plain toContain sweep it replaces, is not dead.
    expect(mutated).not.toMatch(/\{\s*DRIVE_OVERWRITE_DISMISS_LABEL\s*\}/);
  });
});
