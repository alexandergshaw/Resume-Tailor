// @vitest-environment jsdom
//
// N105 Step 8-UI -- RemovedClaimsList, the gate-output panel (UX-25, UX-36).
// Lands RED: the component does not exist yet. Bodies assert the real DOM.
//
// Render contract pinned here:
//   <RemovedClaimsList
//      removed={[{ spanId, text, section, contextKey, reasonCode, flag, anchor }]}
//      leftOut={[{ spanId, text, reasonCode }]} />
//   - "Removed - verify and add back (n)": full claim text (never clamped,
//     marked data-quoted), where it sits (contextKey), a plain-language reason
//     from REMOVAL_REASONS, the imported UNVERIFIED_FLAG tag (never retyped),
//     and a "Copy line" button that copies exactly the claim text.
//   - "Left out ... (n)": claim text + reason, and NO action buttons at all.
//   - a group with zero items is not rendered.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import RemovedClaimsList from "./RemovedClaimsList.js";
import { UNVERIFIED_FLAG } from "@/lib/llm/ideal/applicationReadyGate.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REMOVED_ONE = [
  {
    spanId: "s1",
    text: "Scaled the platform to 10 million monthly active users",
    section: "Experience",
    contextKey: "Acme - Staff Engineer",
    reasonCode: "partial-match",
    flag: UNVERIFIED_FLAG,
    anchor: "Led the platform team",
  },
];

let container;
let root;
let writeText;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(RemovedClaimsList, props));
  });
}

const text = () => container.textContent || "";

describe("N105 Step 8-UI -- the Removed group", () => {
  it("renders the full claim, where it sits, the reason, the imported tag and a Copy line button", async () => {
    await render({ removed: REMOVED_ONE, leftOut: [] });
    const body = text();
    expect(body).toMatch(/Removed - verify and add back \(1\)/);
    expect(body).toMatch(/Scaled the platform to 10 million monthly active users/);
    expect(body).toMatch(/Under:\s*Acme/);
    // REMOVAL_REASONS for a flagged (partial-match) claim.
    expect(body).toMatch(/Part of this could not be matched to your resume/);
    // The AC-4 flag string, IMPORTED (never retyped) -- shown only in the panel.
    expect(body).toContain(UNVERIFIED_FLAG);
    // The claim text is quoted so the band's clean-verdict sweep excludes it.
    const quoted = [...container.querySelectorAll("[data-quoted]")];
    expect(quoted.some((n) => /Scaled the platform/.test(n.textContent || ""))).toBe(true);
    const copyBtn = [...container.querySelectorAll("button")].find((b) => /copy line/i.test(b.textContent || ""));
    expect(copyBtn).toBeTruthy();
  });

  it("Copy line copies EXACTLY the claim text", async () => {
    await render({ removed: REMOVED_ONE, leftOut: [] });
    const copyBtn = [...container.querySelectorAll("button")].find((b) => /copy line/i.test(b.textContent || ""));
    await act(async () => {
      copyBtn.click();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("Scaled the platform to 10 million monthly active users");
  });

  it("caps at 8 rows with 'Show all (9)'", async () => {
    const nine = Array.from({ length: 9 }, (_v, i) => ({
      spanId: `r${i}`,
      text: `Removed claim line ${i + 1}`,
      section: "Experience",
      contextKey: "Acme - Staff Engineer",
      reasonCode: "partial-match",
      flag: UNVERIFIED_FLAG,
      anchor: null,
    }));
    await render({ removed: nine, leftOut: [] });
    const body = text();
    expect(body).toMatch(/Removed claim line 8/);
    expect(body).not.toMatch(/Removed claim line 9\b/);
    expect(body).toMatch(/show all/i);
  });
});

describe("N105 Step 8-UI -- the Left out group", () => {
  it("lists dropped claims with reasons and NO action buttons", async () => {
    await render({
      removed: [],
      leftOut: [
        { spanId: "d1", text: "Fluent in Mandarin", reasonCode: "no-match" },
        { spanId: "d2", text: "Managed the Berlin office", reasonCode: "membership" },
      ],
    });
    const body = text();
    expect(body).toMatch(/Left out/);
    expect(body).toMatch(/\(2\)/);
    expect(body).toMatch(/Fluent in Mandarin/);
    expect(body).toMatch(/Managed the Berlin office/);
    // REMOVAL_REASONS for dropped claims.
    expect(body).toMatch(/No matching fact in your resume/);
    expect(body).toMatch(/Belongs to a different employer/);
    // UX-25: the Left-out group offers nothing to click (no add-back, no copy).
    expect(container.querySelectorAll("button").length).toBe(0);
  });
});

describe("N105 Step 8-UI -- empty groups are omitted", () => {
  it("renders neither heading when both lists are empty", async () => {
    await render({ removed: [], leftOut: [] });
    const body = text();
    expect(body).not.toMatch(/Removed - verify/);
    expect(body).not.toMatch(/Left out/);
  });
});
