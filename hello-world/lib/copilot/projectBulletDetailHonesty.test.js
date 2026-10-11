// N154 — the MANDATORY anti-fabrication OUTPUT GATE
// (lib/copilot/projectBulletDetailHonesty.js). RED on HEAD: the module does not
// exist, so the import fails at collection for the one intended reason.
//
// THIS IS THE LOAD-BEARING, NON-ZERO-POWER INSTRUMENT (plan R3, ledger
// PLAN-N154-2). The bullet is INVENTED and the detail elaborates it in the
// third person, but a detail that drifts into a scripted first-person line
// ("You could say: 'I built the pipeline.'") hands the candidate a claim they
// cannot back up — the one lie that ends an interview. A prompt clause is not a
// control anyone can apply to what the model actually wrote; this gate is, and
// the route runs it on every non-embedded success.
//
// The controls that keep it non-vacuous (mirroring techTermDetailHonesty.test):
//   • Control A (no-op): a clean third-person-only detail passes BYTE-UNCHANGED,
//     so "the claim is gone" cannot be passing because the gate deletes
//     everything (an assertion of ABSENCE is satisfied by a dead feature).
//   • Control B (per-claim-shape power): each claim shape has its OWN assertion
//     embedded among clean sentences that must survive.
//
// REUSE, NOT DUPLICATION (D2): the detector isFirstPersonClaim and the markup/
// sentence helpers are single-sourced in techTermDetailHonesty.js; this gate
// imports them. The single-source census below guards against a future build
// that copies the regex list instead (it passes on HEAD today — disclosed as a
// regression guard, not a red).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  PROJECT_BULLET_DETAIL_MAX_SENTENCES,
  sanitizeProjectBulletDetail,
} from "./projectBulletDetailHonesty.js";

const CLEAN_A = "A strong candidate might describe cutting alert noise with better routing.";
const CLEAN_B = "The work could involve tuning thresholds across several services.";
// A scripted first-person line with a decimal inside it ("v2.5") so the claim
// sentence carries an INNER period the splitter must not leak across.
const CLAIM = "You could say: 'I built the paging pipeline in v2.5 to cut noise.'";

describe("sanitizeProjectBulletDetail strips a scripted first-person claim, keeps the clean remainder", () => {
  it("removes the scripted claim and keeps BOTH clean sentences", () => {
    const out = sanitizeProjectBulletDetail(`${CLEAN_A} ${CLAIM} ${CLEAN_B}`);
    expect(out).not.toContain("I built");
    expect(out).not.toContain("You could say");
    // No fragment leaked across the inner period ("v2.5").
    expect(out).not.toContain("to cut noise");
    expect(out).toContain("A strong candidate might describe");
    expect(out).toContain("The work could involve tuning thresholds");
  });

  it("[CONTROL A — no-op] a clean third-person detail passes BYTE-UNCHANGED", () => {
    const clean = `${CLEAN_A} ${CLEAN_B}`;
    expect(sanitizeProjectBulletDetail(clean)).toBe(clean);
  });
});

describe("[CONTROL B] each first-person claim SHAPE is caught on its own", () => {
  const shapes = [
    { name: "I built …", claim: "I built the ingestion pipeline from scratch." },
    { name: "We used …", claim: "We used Kafka to decouple the services." },
    { name: "I have experience with …", claim: "I have experience with distributed tracing." },
    { name: "You could say: 'I …'", claim: "You could say: 'I designed the schema myself.'" },
    { name: "in my experience …", claim: "In my experience, a cache avoids the stampede." },
    { name: "my team … with …", claim: "My team shipped it with a feature flag." },
  ];

  it.each(shapes)("drops the claim sentence: $name", ({ claim }) => {
    const out = sanitizeProjectBulletDetail(`${CLEAN_A} ${claim} ${CLEAN_B}`);
    expect(out).toContain("A strong candidate might describe");
    expect(out).toContain("The work could involve tuning thresholds");
    // The distinctive tell of the claim is gone.
    expect(out).not.toMatch(/\bI built\b|\bWe used\b|\bI have experience\b|You could say|In my experience|My team/);
  });
});

describe("all-claims collapses to an honest empty", () => {
  it("returns '' when every sentence is a first-person claim", () => {
    const out = sanitizeProjectBulletDetail(
      "I built the cache over a weekend. We used Redis for it. I led the rollout.",
    );
    expect(out).toBe("");
  });
});

describe("markdown, links and contact detail are stripped (a hard gate, not only a prompt clause)", () => {
  it("strips markdown/URL/email tokens, keeping the prose", () => {
    const out = sanitizeProjectBulletDetail(
      "**Caching** reduces load for this kind of project. See https://example.com/docs. Reach ops@example.com.",
    );
    expect(out).not.toContain("**");
    expect(out).not.toContain("https://");
    expect(out).not.toContain("ops@example.com");
    expect(out.toLowerCase()).toContain("caching");
  });
});

describe("totality and the sentence cap", () => {
  it("never throws on non-string or junk input, coercing to ''", () => {
    for (const junk of [undefined, null, 42, {}, [], Symbol.iterator]) {
      expect(() => sanitizeProjectBulletDetail(junk)).not.toThrow();
      expect(sanitizeProjectBulletDetail(junk)).toBe("");
    }
  });

  it("caps the kept sentences at PROJECT_BULLET_DETAIL_MAX_SENTENCES (6, owner-tunable)", () => {
    expect(PROJECT_BULLET_DETAIL_MAX_SENTENCES).toBe(6);
    const eight =
      "One matters here. Two matters here. Three matters here. Four matters here. " +
      "Five matters here. Six matters here. Seven matters here. Eight matters here.";
    const kept = sanitizeProjectBulletDetail(eight).split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(kept.length).toBeLessThanOrEqual(PROJECT_BULLET_DETAIL_MAX_SENTENCES);
    expect(kept.length).toBe(PROJECT_BULLET_DETAIL_MAX_SENTENCES);
  });
});

describe("the first-person detector is single-sourced, not duplicated (D2)", () => {
  // A source census over lib/copilot, comment-stripped so a rule ABOUT the
  // detector is not read as a copy of it. DISCLOSURE: this passes on HEAD today
  // (the regex list already lives only in techTermDetailHonesty.js); its job is
  // to RED a future build that duplicates the list into the new gate rather than
  // importing it. Kept as a regression guard, not counted as a red.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  // A fragment distinctive to the FIRST_PERSON_CLAIM_RES list, not to ordinary prose.
  const DETECTOR_FRAGMENT = "have\\s+experience\\s+with";

  function filesContaining(fragment) {
    const dir = path.join(process.cwd(), "lib/copilot");
    const hits = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".js") || name.endsWith(".test.js")) continue;
      const code = strip(readFileSync(path.join(dir, name), "utf8"));
      if (code.includes(fragment)) hits.push(name);
    }
    return hits;
  }

  it("[canary] the detector fragment is found in techTermDetailHonesty.js", () => {
    expect(filesContaining(DETECTOR_FRAGMENT)).toContain("techTermDetailHonesty.js");
  });

  it("the regex list lives in EXACTLY ONE module, and the new gate imports the detector", () => {
    expect(filesContaining(DETECTOR_FRAGMENT)).toEqual(["techTermDetailHonesty.js"]);
    const gate = strip(readFileSync(path.join(process.cwd(), "lib/copilot/projectBulletDetailHonesty.js"), "utf8"));
    expect(gate).toMatch(/import\s*\{[^}]*isFirstPersonClaim[^}]*\}\s*from\s*["']\.\/techTermDetailHonesty(?:\.js)?["']/);
  });
});
