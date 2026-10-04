// N105 Step 3a (4b) — PURE decompose/recompose seam (K2 half-one, UX-35 pure).
// Binds to: N105.plan.r2.md Step 3a + PL-5; N105.design.r2.md §1 + D-6b (amended:
// recompose takes KEPT spans only, N105.ux.r2.md §A); UXR-14.
//
// WHY THIS IS A POWER ROW (K2, SILENT). The whole truthfulness guarantee rests on
// "recompose can only emit spans it is handed." If recompose re-reads the
// candidate document, a dropped fabrication ships in a clean-looking persisted
// .docx. These tests pin the by-construction property: the emitted text is
// EXACTLY the retained spans, nothing more. The orchestrator-level mutants
// (hand recompose kept+flagged, or skip recompose) live in idealPipeline.test.js;
// here the PURE invariants are round-trip fidelity, subset omission, and UXR-14.
//
// RED on HEAD: the module does not exist (collection failure). Satisfiability is
// proven by the reference implementation in the TDD seat's scratchpad pass.

import { describe, it, expect } from "vitest";
import { decomposeToSpans, recomposeFromSpans } from "./spanDocument.js";

// Fixture document. The shape is deliberately unambiguous so the heading/employer
// classification UXR-14 depends on is pinned by the fixture, not guessed:
//  - an ALL-CAPS line with no lowercase letters is a SECTION HEADING
//  - a line of the form "<Name> — <Title> (<dates>)" is an EMPLOYER/DATES line
//  - every other non-blank line is a content span (a bullet)
const RESULT_LINES = [
  "PROFESSIONAL EXPERIENCE",
  "Acme Corp — Senior Engineer (2020-2024)",
  "Reduced support-ticket volume by improving the docs",
  "Scaled the platform to 10,000,000 users",
  "SKILLS",
  "JavaScript and Python",
];
const RESULT = RESULT_LINES.join("\n");

// contextKeyOf: the real production orchestrator supplies the nearest preceding
// employer as the context key. The fixture's only employer is "Acme Corp".
const contextKeyOf = () => "Acme Corp";

function decompose() {
  return decomposeToSpans(RESULT, RESULT_LINES, { contextKeyOf });
}

function spanIdByText(spans, needle) {
  const found = spans.find((s) => s.text.includes(needle));
  if (!found) throw new Error(`fixture span not found: ${needle}`);
  return found.id;
}

describe("decomposeToSpans", () => {
  it("mints a stable id, a section, a contextKey and an order on each content span", () => {
    const { spans } = decompose();
    const bullet = spans.find((s) => s.text.includes("Reduced support-ticket volume"));
    expect(bullet).toBeTruthy();
    expect(typeof bullet.id).toBe("string");
    expect(bullet.id.length).toBeGreaterThan(0);
    expect(bullet.contextKey).toBe("Acme Corp");
    expect(typeof bullet.order).toBe("number");
  });

  it("gives every span a distinct id (span discipline — never a union)", () => {
    const { spans } = decompose();
    const ids = spans.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("recomposeFromSpans — emits EXACTLY the retained spans (D-6b)", () => {
  it("round-trips: recompose with ALL spans reproduces the original lines (no-op control)", () => {
    const { spans, layout } = decompose();
    const { result, resultLines } = recomposeFromSpans(layout, spans);
    expect(resultLines).toEqual(RESULT_LINES);
    expect(result).toBe(RESULT);
  });

  it("omits a dropped span's text while keeping its siblings in order", () => {
    const { spans, layout } = decompose();
    const fabricationId = spanIdByText(spans, "10,000,000 users");
    const retained = spans.filter((s) => s.id !== fabricationId);

    const { result, resultLines } = recomposeFromSpans(layout, retained);

    // The fabrication is ABSENT (the K2 property, by construction).
    expect(result).not.toMatch(/10,000,000 users/);
    // Its surviving sibling bullet is still present and still under its employer.
    expect(result).toMatch(/Reduced support-ticket volume/);
    const emIdx = resultLines.findIndex((l) => l.includes("Acme Corp"));
    const keptIdx = resultLines.findIndex((l) => l.includes("Reduced support-ticket volume"));
    expect(emIdx).toBeGreaterThanOrEqual(0);
    expect(keptIdx).toBeGreaterThan(emIdx);
  });

  // UXR-14 (a): never emit a section heading with zero retained spans beneath it.
  it("drops an ORPHAN section heading when all its content spans are removed", () => {
    const { spans, layout } = decompose();
    const skillsSpanId = spanIdByText(spans, "JavaScript and Python");
    const retained = spans.filter((s) => s.id !== skillsSpanId);

    const { result } = recomposeFromSpans(layout, retained);

    // SKILLS has no retained content -> its heading must not appear.
    expect(result).not.toMatch(/SKILLS/);
    // The EXPERIENCE heading (still has a retained bullet) must remain.
    expect(result).toMatch(/PROFESSIONAL EXPERIENCE/);
  });

  // UXR-14 (b): an employer/dates line is KEPT even when all its bullets are
  // removed (AC-10 real-chronology). This is the opposite of the orphan-heading
  // rule and the two together are the discriminator against a naive "drop any
  // line with nothing under it" implementation.
  it("KEEPS an employer/dates line even when all of its bullets are removed", () => {
    const { spans, layout } = decompose();
    const bulletIds = spans
      .filter((s) => s.text.includes("Reduced support-ticket volume") || s.text.includes("10,000,000 users"))
      .map((s) => s.id);
    const retained = spans.filter((s) => !bulletIds.includes(s.id));

    const { result } = recomposeFromSpans(layout, retained);

    expect(result).toMatch(/Acme Corp — Senior Engineer \(2020-2024\)/);
  });
});
