// N50 plan.r2.md F-1 (M7): the maximal fixture's SELF-CHECK. It ties
// test/helpers/prepMaximalFixture.js to the real pack schema, so 8b can never
// judge a state the app cannot produce.
//
// GREEN ON HEAD, deliberately: this is the fixture's own contract, not an N50
// acceptance test. It goes RED when the schema moves under the fixture -- the
// N49/N51 claim and provenance changes are the expected trigger -- and that
// red is the prompt to update the fixture in the chunk that moved the schema.
//
// Both lib imports already have other test importers, so no count in
// lib/sourceScan/exportReachability.sweep.test.js moves (and test/ is
// classified TEST there, so this file's own imports are never shipping edges).
//
// MEASURED POWER (plan.r2.md R24; re-run by the 4b seat against an isolated
// copy, never committed): a line citing a claim id the pack does not carry,
// `claims: null`, and an emptied askThem each turn the first two cases RED.
// BLIND SPOT, measured: a line that names an untrusted person survives
// `normalizePack` unchanged, so this check does not exercise the O-15 name
// path. That is `prepParse`'s own tests' job.

import { describe, it, expect } from "vitest";
import { normalizePack } from "@/lib/interviewPrep/prepParse";
import { completeSections } from "@/lib/interviewPrep/prepPack";
import { PREP_SECTION_REVISIONS_MAX } from "@/lib/interviewPrep/prepConstants.js";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import {
  PREP_SECTIONS,
  maximalClaims,
  maximalPack,
  maximalRevisions,
  maximalTrustedNames,
  maximalPanelProps,
  maximalGetResponse,
  maximalPackStrings,
} from "./prepMaximalFixture.js";

const sorted = (xs) => [...xs].sort();

describe("F-1: the maximal fixture is a state the real schema produces", () => {
  it("the real normalizePack returns the maximal pack UNCHANGED (nothing thinned, nothing repaired)", () => {
    expect(normalizePack(maximalPack(), maximalTrustedNames())).toEqual(maximalPack());
  });

  it("the real completeSections lists all four sections for the maximal pack", () => {
    expect(sorted(completeSections(maximalPack()))).toEqual(sorted(PREP_SECTIONS));
  });

  it("the GET stub claims exactly the sections the real completeSections computes for its own pack", () => {
    const body = maximalGetResponse();
    expect(body.completeSections).toEqual([...completeSections(body.pack)]);
  });
});

describe("AC-N50.18(a): the fixture carries every element of the maximal state", () => {
  it("four populated sections: aboutYou 5 lines, whyRole 4, askThem 5, >=3 stages each with >=3 questions and a suggested answer", () => {
    const s = maximalPack().sections;
    expect(s.aboutYou.answer.lines).toHaveLength(5);
    expect(s.whyRole.answer.lines).toHaveLength(4);
    expect(s.askThem.questions).toHaveLength(5);
    expect(s.stages.stages.length).toBeGreaterThanOrEqual(3);
    for (const stage of s.stages.stages) {
      expect(stage.questions.length).toBeGreaterThanOrEqual(3);
      expect(typeof stage.recommendedAnswer === "string" && stage.recommendedAnswer.trim().length > 0).toBe(true);
    }
    // One suggested answer is long-form prose -- the one a clamp eats first.
    expect(Math.max(...s.stages.stages.map((st) => st.recommendedAnswer.length))).toBeGreaterThan(300);
  });

  it("at least one cited item per section; exactly one item cites the unsafe claim; the orphan claim is cited nowhere", () => {
    const s = maximalPack().sections;
    const supportsBySection = {
      aboutYou: s.aboutYou.answer.lines.map((l) => l.support),
      whyRole: s.whyRole.answer.lines.map((l) => l.support),
      askThem: s.askThem.questions.map((q) => q.support),
      stages: s.stages.stages.map((st) => st.support),
    };
    for (const section of PREP_SECTIONS) {
      expect(supportsBySection[section].filter(Boolean).length, section).toBeGreaterThan(0);
    }
    const all = Object.values(supportsBySection).flat().filter(Boolean).map((sup) => sup.claimId);
    expect(all.filter((id) => id === "cU")).toHaveLength(1);
    expect(all).not.toContain("cO");
    // Every stage is cited (one marker per stage, on the name -- N43).
    expect(supportsBySection.stages.every(Boolean)).toBe(true);
  });

  it("the unsafe and safe claims are what they claim to be, judged by the REAL href gate", () => {
    const byId = new Map(maximalClaims().map((c) => [c.id, c]));
    expect(safeExternalHref(byId.get("cU").sourceUrl)).toBeFalsy();
    for (const id of ["c1", "c2", "c3", "cO"]) {
      expect(safeExternalHref(byId.get(id).sourceUrl), id).toBe(byId.get(id).sourceUrl);
    }
  });

  it("PREP_SECTION_REVISIONS_MAX revisions per section, the newest live, exactly one created by a restore", () => {
    const { sectionRevisions, liveRevisions } = maximalRevisions();
    expect(PREP_SECTION_REVISIONS_MAX).toBeGreaterThan(1);
    for (const section of PREP_SECTIONS) {
      expect(sectionRevisions[section]).toHaveLength(PREP_SECTION_REVISIONS_MAX);
      expect(liveRevisions[section]).toBe(PREP_SECTION_REVISIONS_MAX);
      // Metadata only (AC-UX.2): no revision row carries a body.
      for (const row of sectionRevisions[section]) expect(Object.keys(row).sort()).toEqual(["createdAt", "engine", "restoredFrom", "revision"]);
    }
    const restored = Object.values(sectionRevisions).flat().filter((row) => row.restoredFrom != null);
    expect(restored).toHaveLength(1);
  });

  it("a candidate name and >=3 interviewer names, a whole-pack trigger message, and the two N53 transients", () => {
    const props = maximalPanelProps();
    expect(props.candidateName).toBeTruthy();
    expect(props.interviewerNames.length).toBeGreaterThanOrEqual(3);
    expect(typeof props.triggerMessage === "string" && props.triggerMessage.length > 0).toBe(true);
    const states = Object.values(props.sectionActivity).map((a) => a.state).sort();
    expect(states).toEqual(["in-progress", "queued"]);
    // ...and the idle variant drops exactly those.
    expect(maximalPanelProps({ transients: false }).sectionActivity).toEqual({});
  });

  it("the trusted names F-1 normalizes with are exactly the names the panel shows", () => {
    const props = maximalPanelProps();
    expect([props.candidateName, ...props.interviewerNames]).toEqual(maximalTrustedNames());
  });
});

describe("builders return fresh objects, and the derived strings follow the pack", () => {
  it("mutating one returned pack never leaks into the next call", () => {
    const a = maximalPack();
    a.sections.aboutYou.answer.lines[0].text = "MUTATED";
    a.claims.pop();
    const b = maximalPack();
    expect(b.sections.aboutYou.answer.lines[0].text).not.toBe("MUTATED");
    expect(b.claims).toHaveLength(5);
    const r = maximalRevisions();
    r.sectionRevisions.aboutYou.length = 0;
    expect(maximalRevisions().sectionRevisions.aboutYou).toHaveLength(PREP_SECTION_REVISIONS_MAX);
  });

  it("maximalPackStrings is derived from the pack: counts match, and the orphan claim's text is excluded", () => {
    const { t1, t2, claims } = maximalPackStrings();
    const s = maximalPack().sections;
    const stageQuestions = s.stages.stages.reduce((n, st) => n + st.questions.length, 0);
    expect(t1).toHaveLength(5 + 4 + 5 + s.stages.stages.length + stageQuestions);
    expect(t2).toHaveLength(s.stages.stages.length);
    const orphan = maximalClaims().find((c) => c.id === "cO").text;
    expect(claims).not.toContain(orphan);
    expect(claims).toHaveLength(4);
    // Canary: the orphan text really is in the pack, so the exclusion above is
    // the derivation working, not the string being absent.
    expect(maximalPack().claims.map((c) => c.text)).toContain(orphan);
  });
});
