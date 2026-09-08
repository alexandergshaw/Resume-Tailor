// @vitest-environment jsdom
//
// AC-K-B3: THE AUTO FILL BOOKMARKLET MUST HAVE A NON-POINTER ROUTE.
//
// THE DEFECT THIS FILE FALSIFIES
// ------------------------------
// `AutofillProfileDialog.js:109-127` renders the generated bookmarklet as a
// `<Link href={bookmarklet} draggable onClick={(e) => e.preventDefault()}>`
// with the caption "Drag me to your bookmarks bar." The `preventDefault()` means
// activating it -- by keyboard OR by click -- does nothing at all, and there is
// no copy control anywhere in the file. The ENTIRE auto-fill feature, the thing
// that fills an ATS application form from the saved profile, is gated behind a
// mouse drag.
//
// WHY THE FIX IS NOT "MAKE THE DRAG KEYBOARD-ACCESSIBLE"
// -----------------------------------------------------
// A bookmarklet fundamentally reaches the bookmarks bar by being dragged there
// or by being pasted into a new-bookmark dialog. There is no keyboard drag to
// build. The equivalent route is therefore: copy the `javascript:` URL to the
// clipboard, and say in the dialog how to paste it into a new bookmark. The
// drag stays as the pointer shortcut -- the dialog's own comment at `:18-21`
// already describes the clipboard as the second route ("clicking Auto Fill on a
// card opens the posting and copies the same bookmarklet"), so this is making
// the dialog match a route the feature already has.
//
//   MANUAL / BROWSER-ONLY (not asserted here, and not claimed):
//     * The real clipboard write (`navigator.clipboard.writeText` is stubbed
//       here; jsdom implements no clipboard, and a real browser also gates the
//       API on a user gesture and a secure context).
//     * That the copied `javascript:` URL, pasted into a new bookmark and run on
//       a live posting, fills the form. That is the feature's own end-to-end
//       check, not a keyboard one.
//     * The focus ring's visibility on the new control inside the dialog.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AutofillProfileDialog from "./AutofillProfileDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let writeText;

const PROFILE = {
  fullName: "Alex Shaw",
  email: "alexandergshaw@gmail.com",
};

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
  }
  writeText = vi.fn(async () => {});
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function accessibleName(node) {
  if (!node) return "";
  const labelled = node.getAttribute("aria-labelledby");
  if (labelled) {
    const target = document.getElementById(labelled);
    if (target) return (target.textContent || "").trim();
  }
  return (
    node.getAttribute("aria-label")
    || (node.textContent || "").trim()
    || node.getAttribute("title")
    || ""
  ).trim();
}

// MUI Dialog renders into a portal on document.body, not into `container`.
function scope() {
  return document.body;
}

function copyControl() {
  return Array.from(scope().querySelectorAll('button, [role="button"]')).find((node) =>
    /copy/i.test(accessibleName(node))
  );
}

async function render(overrides = {}) {
  await act(async () => {
    root.render(
      createElement(AutofillProfileDialog, {
        open: true,
        onClose: vi.fn(),
        profile: PROFILE,
        onSaved: vi.fn(),
        ...overrides,
      })
    );
  });
  // The dialog seeds its draft from `profile` on a 0ms timeout (`:28-35`).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return scope();
}

describe("K-B3 -- the Auto Fill bookmarklet has a route that is not a drag", () => {
  it("renders a copy control", async () => {
    await render();
    const copy = copyControl();
    expect(copy, "the dialog offers no way to obtain the bookmarklet without dragging").toBeTruthy();
    expect(copy.tagName).toBe("BUTTON");
    expect(copy.classList.contains("MuiButtonBase-root"), "opts out of the app-wide focus ring").toBe(true);
    expect(copy.getAttribute("tabindex")).not.toBe("-1");
  });

  it("puts the real bookmarklet on the clipboard when activated", async () => {
    await render();
    const copy = copyControl();
    expect(copy).toBeTruthy();
    await act(async () => {
      copy.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0][0]);
    // NOTE ON WHAT THIS CANNOT ASSERT: the obvious strongest check would be
    // `copied === draggable.getAttribute("href")`, since both the anchor's
    // href and this clipboard write read the SAME `bookmarklet` variable in
    // AutofillProfileDialog.js (`:50,64,149`). That check was tried here and
    // does not hold -- React (this repo runs react-dom 19.2.4) unconditionally
    // runs any `href`/`src` value through `sanitizeURL`, which replaces a
    // `javascript:`-scheme value with a fixed throwing stub before it ever
    // reaches the DOM (react-dom-client.development.js and the server bundle
    // both do this; verified directly here, not inferred: the rendered
    // anchor's `getAttribute("href")` comes back as
    // "javascript:throw new Error('React has blocked a javascript: URL as a
    // security precaution.')", not the real bookmarklet). So the drag
    // affordance's *rendered* href can never be compared against, in this
    // test or in a real browser -- that is a real defect in
    // AutofillProfileDialog.js's plain `href={bookmarklet}` JSX prop, outside
    // this test file's scope to fix (it would need a ref + manual
    // `setAttribute` to bypass React's sanitizer, which a bookmarklet needs
    // and a normal link never does). Flagged separately; not asserted here.
    expect(copied.startsWith("javascript:")).toBe(true);
    // A bookmarklet is "javascript:" + encodeURIComponent(body), so the
    // profile values inside it are percent-encoded (e.g. "Alex Shaw" becomes
    // "Alex%20Shaw" in the raw string). Asserting on the raw string would pin
    // that encoding detail instead of the guarantee this test is for -- that
    // the saved profile data actually made it into the bookmarklet -- so
    // decode first and check the decoded body.
    const decoded = decodeURIComponent(copied.slice("javascript:".length));
    expect(decoded).toContain("Alex Shaw");
    expect(decoded).toContain(PROFILE.email);
  });

  it("confirms the copy, so the user knows the invisible action happened", async () => {
    await render();
    const copy = copyControl();
    await act(async () => {
      copy.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(scope().textContent || "").toMatch(/copied/i);
  });

  it("tells the user what to do with the copied text", async () => {
    // A clipboard string is useless without "create a new bookmark and paste
    // this as its URL". The drag caption alone does not say that.
    await render();
    const text = scope().textContent || "";
    expect(text).toMatch(/bookmark/i);
    expect(text).toMatch(/paste|new bookmark/i);
  });

  it("GUARD (passes before the fix): the drag affordance survives", async () => {
    // Drag-to-bookmarks-bar is the fastest route for a mouse user and must not
    // be removed in the name of accessibility.
    await render();
    const draggable = scope().querySelector('[draggable="true"]');
    expect(draggable).toBeTruthy();
    const href = String(draggable.getAttribute("href") || "");
    expect(href.startsWith("javascript:")).toBe(true);
    // MAJOR 5: `startsWith("javascript:")` alone is a VACUOUS check -- React
    // 19's `sanitizeURL` replaces a real `javascript:` href with a fixed
    // throwing stub ("javascript:throw new Error('React has blocked a
    // javascript: URL as a security precaution.')") that ALSO starts with
    // "javascript:". This assertion can therefore be proven to fail: revert
    // the `ref` + `useLayoutEffect` fix in AutofillProfileDialog.js (i.e. go
    // back to a plain `href={bookmarklet}` prop) and the string above stops
    // being the real bookmarklet without this check ever noticing. Decoding
    // the payload and requiring the profile data actually entered above is
    // what makes it fail for the right reason.
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).toContain("Alex Shaw");
    expect(decoded).toContain(PROFILE.email);
  });

  it("keeps the real bookmarklet on the DOM anchor after an edit re-renders the dialog", async () => {
    // The `useLayoutEffect` fix has to re-run on every `bookmarklet` change,
    // not just at mount -- otherwise editing a field re-renders the <Link>
    // with a new `href={bookmarklet}` prop, React re-sanitizes THAT commit,
    // and only the FIRST render's value was ever real.
    await render();
    const nameField = Array.from(scope().querySelectorAll("input")).find((el) => el.value === "Alex Shaw");
    expect(nameField, "full name field not found").toBeTruthy();
    // A controlled MUI/React input needs the value set through the native
    // setter (not the `.value =` property React itself has patched), or
    // React's change-detection never sees a real change and no re-render
    // happens at all -- see ExperienceTab.test.js:440 for the same pattern.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(nameField, "Jordan Lee");
      nameField.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const draggable = scope().querySelector('[draggable="true"]');
    expect(draggable).toBeTruthy();
    const href = String(draggable.getAttribute("href") || "");
    expect(href.startsWith("javascript:")).toBe(true);
    const decoded = decodeURIComponent(href.slice("javascript:".length));
    expect(decoded).toContain("Jordan Lee");
    expect(decoded).not.toContain("Alex Shaw");
  });
});
