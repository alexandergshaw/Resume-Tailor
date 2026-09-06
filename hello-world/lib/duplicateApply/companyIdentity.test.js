import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { companyIdentityKey, COMPANY_NAME_MAX_LENGTH } from "@/lib/duplicateApply/companyIdentity.js";
import { GREENHOUSE_COMPANIES } from "@/lib/greenhouse/companies";
import { LEVER_COMPANIES } from "@/lib/lever/companies";
import { ASHBY_COMPANIES } from "@/lib/ashby/companies";

// ---------------------------------------------------------------------------
// AC-duplicate-apply-r4.md §1.2 / C-5 … C-8, with 1g SEC-1 applied and the
// pipeline reordered (3-plan-dupapply.md §2.2). Two keys are "the same
// company" iff EQUAL AND NON-EMPTY -- that equality/non-empty contract is
// enforced by the caller (duplicateApplyVerdict.js, Wave 1B); this module's
// job is only to make "" the honest, unmergeable answer for anything that
// isn't a real company name, and to never let an attacker-controlled string
// freeze the tab.
//
// Standing bias: a false alarm (a false MERGE) is the expensive failure, so
// every accepted miss pinned below is deliberate -- do not "fix" one without
// re-reading AC C-5/C-6/C-22 first.
// ---------------------------------------------------------------------------

// A "plausible-wrong" pipeline used only to prove a handful of rows below
// actually discriminate, per the brief's step 3. Never imported by the
// module under test.
function incumbentStyleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(inc|llc|ltd|corp|co|company|technologies|labs|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

describe("companyIdentityKey", () => {
  // -------------------------------------------------------------------
  // Constraint 1 -- the 512-character cap REJECTS, never truncates
  // (1g SEC-1; brief constraint 1).
  // -------------------------------------------------------------------
  describe("the 512-character cap rejects rather than truncates", () => {
    it("exports COMPANY_NAME_MAX_LENGTH as 512", () => {
      expect(COMPANY_NAME_MAX_LENGTH).toBe(512);
    });

    it("a name at exactly the cap is processed normally", () => {
      const atCap = "A".repeat(COMPANY_NAME_MAX_LENGTH);
      expect(atCap.length).toBe(512);
      expect(companyIdentityKey(atCap)).not.toBe("");
    });

    it("a name one character over the cap is rejected to '', not truncated", () => {
      const overCap = "A".repeat(COMPANY_NAME_MAX_LENGTH + 1);
      expect(overCap.length).toBe(513);
      expect(companyIdentityKey(overCap)).toBe("");
    });

    it("[pair] two DIFFERENT long employer names sharing a 512+ character prefix are BOTH rejected -- never truncated into one fabricated key", () => {
      // This is the exact hazard the brief names: truncating instead of
      // rejecting would collapse two distinct employers sharing a long
      // prefix into one key, fabricating the very burst this feature
      // exists to detect.
      const sharedPrefix = "Acme".repeat(150); // 600 chars, already over cap
      const nameA = sharedPrefix + "HoldingsAlpha";
      const nameB = sharedPrefix + "HoldingsBeta";
      expect(nameA.length).toBeGreaterThan(COMPANY_NAME_MAX_LENGTH);
      expect(nameB.length).toBeGreaterThan(COMPANY_NAME_MAX_LENGTH);
      expect(nameA).not.toBe(nameB);
      const keyA = companyIdentityKey(nameA);
      const keyB = companyIdentityKey(nameB);
      expect(keyA).toBe("");
      expect(keyB).toBe("");
      // Not merged: neither the AC-defined "equal and non-empty" contract
      // nor any downstream consumer can read this pair as one company.
    });

    it("non-string input is rejected to '', never throws", () => {
      for (const bad of [null, undefined, 42, {}, [], true, NaN, Symbol("x")]) {
        expect(() => companyIdentityKey(bad)).not.toThrow();
        expect(companyIdentityKey(bad)).toBe("");
      }
    });
  });

  // -------------------------------------------------------------------
  // Constraint 2 -- the ReDoS hazard: 31.7s/200KB and 2,767ms/60k commas
  // measured (1g §S-4.4) must not be reachable. The separator class the
  // suffix regex quantifies over ([\s,]) must be collapsed BEFORE the
  // suffix strip -- not just whitespace.
  // -------------------------------------------------------------------
  // NOTE on what these four cases actually exercise: every input below is
  // well over COMPANY_NAME_MAX_LENGTH, so step 0's cap rejects it before
  // step 3's collapse or step 4's suffix regex ever run -- verified by
  // mutation (temporarily raising the cap made these four inputs slow
  // enough to matter and changed their '' results; temporarily narrowing
  // step 3's collapse back to whitespace-only, matching 1g's own
  // insufficient interim fix, did NOT reproduce the ReDoS here, because
  // the cap alone already intercepts anything this long). That is not a
  // gap: 1g's own recommendation is "pick (1)+(2)" precisely because the
  // cap and the reorder are independent, redundant mitigations, and the
  // reorder's own contribution (correctness regardless of any cap) is
  // separately, functionally pinned by the "Acme Ltd," case below, which
  // IS sensitive to collapsing commas before the anchor. These four cases
  // are the regression guard on the cap's rejection path staying O(1).
  describe("timing -- the quadratic suffix-strip regex must never run unbounded", () => {
    it("a 100KB run of spaces with no legal suffix completes well under the quadratic's measured time", () => {
      const big = "Acme" + " ".repeat(100000) + "Holdings";
      expect(big.length).toBeGreaterThan(100000);
      const t0 = performance.now();
      const result = companyIdentityKey(big);
      const elapsed = performance.now() - t0;
      // 1g measured 7,872ms unmitigated at this size. 500ms is generous
      // headroom for a slow CI box while still being ~15x tighter than the
      // quadratic's own measured time -- tight enough to catch a
      // regression, loose enough not to flake.
      expect(elapsed).toBeLessThan(500);
      expect(result).toBe(""); // over the 512 cap -> rejected
    });

    it("60,000 commas (the specific vector 1g measured at 2,767ms unmitigated) completes fast", () => {
      const manyCommas = ",".repeat(60000);
      const t0 = performance.now();
      const result = companyIdentityKey(manyCommas);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(500);
      expect(result).toBe("");
    });

    it("60,000 tabs (1g's second measured vector, 3,530ms unmitigated) completes fast", () => {
      const manyTabs = "\t".repeat(60000);
      const t0 = performance.now();
      const result = companyIdentityKey(manyTabs);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(500);
      expect(result).toBe("");
    });

    it("a 200KB run of spaces (1g's exact 31.7s probe input) completes fast", () => {
      const huge = "Acme" + " ".repeat(200000) + "Holdings";
      const t0 = performance.now();
      companyIdentityKey(huge);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(500);
    });
  });

  // -------------------------------------------------------------------
  // "Exactly ONE trailing legal-suffix strip, anchored at the end" (C-5).
  // -------------------------------------------------------------------
  describe("exactly one trailing legal-suffix strip, anchored at the end", () => {
    it("strips a single plain suffix", () => {
      expect(companyIdentityKey("Acme Inc.")).toBe("a:acme");
      expect(companyIdentityKey("Acme Ltd")).toBe("a:acme");
      expect(companyIdentityKey("Acme, Inc.")).toBe("a:acme");
      expect(companyIdentityKey("Acme   Ltd")).toBe("a:acme");
      expect(companyIdentityKey("Acme,,,,Inc")).toBe("a:acme");
    });

    // The AC's own re-measurement (1d T-3.4): "the two readings [one-strip
    // vs two-strip] disagree on 5" constructed multi-suffix rows. These are
    // pinned exactly because they are where a double-strip implementation
    // would silently diverge.
    it("[pin] Acme Inc. Ltd -- single strip removes only the trailing Ltd", () => {
      expect(companyIdentityKey("Acme Inc. Ltd")).toBe("a:acme inc");
    });
    it("[pin] Acme Corp Inc -- single strip removes only the trailing Inc", () => {
      expect(companyIdentityKey("Acme Corp Inc")).toBe("a:acme corp");
    });
    it("[pin] Acme Corp Corp -- single strip removes only the trailing Corp", () => {
      expect(companyIdentityKey("Acme Corp Corp")).toBe("a:acme corp");
    });
    it("[pin] Acme Ltd Ltd Ltd -- single strip removes only the trailing Ltd", () => {
      expect(companyIdentityKey("Acme Ltd Ltd Ltd")).toBe("a:acme ltd ltd");
    });

    it("[pin] Acme Pte Ltd does not group with Acme Ltd -- accepted miss, the price of the single strip", () => {
      // Pte Ltd (Singapore) / Pty Ltd (Australia) are single legal forms
      // written as two tokens, both of which are themselves suffix-list
      // members. One strip only ever removes "Ltd", leaving "Pte" behind,
      // so every Singaporean/Australian spelling fails to group with its
      // own unsuffixed name. AC C-5: this is a real, named cost accepted
      // because the error direction is a miss, never a merge.
      const withPteLtd = companyIdentityKey("Acme Pte Ltd");
      const withLtdOnly = companyIdentityKey("Acme Ltd");
      expect(withPteLtd).toBe("a:acme pte");
      expect(withLtdOnly).toBe("a:acme");
      expect(withPteLtd).not.toBe(withLtdOnly);
    });

    it("a double-strip implementation would over-merge these -- discriminator check", () => {
      // Not a defect in THIS module (guards the design decision itself):
      // demonstrates that "Acme Pte Ltd" and "Acme Ltd" would incorrectly
      // collapse to the same key if a second strip pass were applied,
      // which is exactly why C-5 insists on exactly one.
      const doubleStripped = "acme pte ltd"
        .replace(/[\s,]+(inc|llc|ltd|corp|corporation|incorporated|limited|plc|gmbh|sa|nv|bv|ab|oy|pty|pte)\.?$/, "")
        .replace(/[\s,]+(inc|llc|ltd|corp|corporation|incorporated|limited|plc|gmbh|sa|nv|bv|ab|oy|pty|pte)\.?$/, "");
      expect(doubleStripped).toBe("acme"); // would equal "Acme Ltd"'s key -- the false merge C-5 rejects
      expect(companyIdentityKey("Acme Pte Ltd")).not.toBe("a:acme");
    });
  });

  // -------------------------------------------------------------------
  // The non-Latin fallback namespace (C-6).
  // -------------------------------------------------------------------
  describe("the non-Latin fallback namespace ('r:')", () => {
    it("a company name with no ASCII alphanumerics still groups with itself", () => {
      // AC C-6: 10 real employer names across scripts with no ASCII
      // alphanumerics; under an ASCII-only rule all 10 reduce to "",
      // switching Signal 2 off for a whole class of employers.
      const samples = [
        "楽天", // Japanese (Rakuten)
        "Яндекс", // Cyrillic (Yandex)
        "阿里巴巴", // Chinese (Alibaba)
        "شركة الاتصالات", // Arabic
        "Ολυμπιακή Αεροπορία", // Greek
        "삼성전자", // Korean (Samsung Electronics)
      ];
      for (const name of samples) {
        const key = companyIdentityKey(name);
        expect(key).not.toBe("");
        expect(key.startsWith("r:")).toBe(true);
        expect(companyIdentityKey(name)).toBe(key); // groups with itself
      }
    });

    it("case-folds within one script: Яндекс / яндекс / ЯНДЕКС all reduce to one key", () => {
      const a = companyIdentityKey("Яндекс");
      const b = companyIdentityKey("яндекс");
      const c = companyIdentityKey("ЯНДЕКС");
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(a).not.toBe("");
    });

    it("collapses leading/trailing whitespace: '楽天' and ' 楽天 ' reduce to one key", () => {
      expect(companyIdentityKey("楽天")).toBe(companyIdentityKey(" 楽天 "));
    });

    it("[pair] the 'a:' and 'r:' namespaces never collide, structurally", () => {
      // Rakuten (Latin spelling) and 楽天 (its own name) are two different
      // real spellings of arguably the same company, and the fallback is
      // STRICTLY NARROWER than the ASCII path on purpose -- it must never
      // merge them, and it cannot, because the namespaces are disjoint by
      // construction.
      const latin = companyIdentityKey("Rakuten");
      const native = companyIdentityKey("楽天");
      expect(latin).toBe("a:rakuten");
      expect(native).toBe("r:楽天");
      expect(latin).not.toBe(native);
    });

    it("discriminator check: an ASCII-only rule with no fallback branch loses every non-Latin name to ''", () => {
      function asciiOnly(name) {
        if (typeof name !== "string" || name.length > COMPANY_NAME_MAX_LENGTH) return "";
        let s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
        s = s.replace(/&/g, " and ").replace(/[\s,]+/g, " ").trim();
        s = s.replace(/[^a-z0-9]+/g, " ").trim();
        return s ? "a:" + s : "";
      }
      expect(asciiOnly("楽天")).toBe(""); // the defect this module must not have
      expect(companyIdentityKey("楽天")).not.toBe("");
    });
  });

  // -------------------------------------------------------------------
  // C-6a -- punctuation-only inputs never produce a non-empty key, so they
  // can never group with each other (or with anything) via the fallback.
  // -------------------------------------------------------------------
  describe("[pair] a punctuation-only company name never groups with another punctuation-only name", () => {
    // AC's own 10 constructed junk inputs, verbatim.
    const junkInputs = ["-", "--", ".", "!!!", "/", "#", "…", "—", "", "   "];

    it.each(junkInputs)("%j reduces to the empty key", (junk) => {
      expect(companyIdentityKey(junk)).toBe("");
    });

    it("no two distinct junk inputs share a non-empty key (the fallback's any-script letter/digit guard)", () => {
      const keys = junkInputs.map((j) => companyIdentityKey(j));
      for (const k of keys) expect(k).toBe("");
      // Since every key is exactly "" and two "" keys are never "the same
      // company" (equal AND non-empty, per the module's documented
      // contract), no pair of these can ever be reported as a match.
    });

    it("discriminator check: a fallback missing the any-script letter/digit guard WOULD let junk collide", () => {
      function fallbackTooWide(name) {
        if (typeof name !== "string" || name.length > COMPANY_NAME_MAX_LENGTH) return "";
        let s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
        s = s.replace(/&/g, " and ").replace(/[\s,]+/g, " ").trim();
        s = s
          .replace(/[\s,]+(inc|llc|ltd|corp|corporation|incorporated|limited|plc|gmbh|sa|nv|bv|ab|oy|pty|pte)\.?$/, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        if (s) return "a:" + s;
        // BUG: falls back unconditionally, with no letter/digit requirement.
        return "r:" + name.trim().replace(/\s+/g, " ").normalize("NFKC").toLowerCase();
      }
      // Two blank/placeholder rows both literally "-" would fabricate a
      // false company match under the buggy rule...
      expect(fallbackTooWide("-")).toBe(fallbackTooWide("-"));
      expect(fallbackTooWide("-")).not.toBe("");
      // ...which is exactly what this module refuses to do:
      expect(companyIdentityKey("-")).toBe("");
    });
  });

  // -------------------------------------------------------------------
  // The NFKD fold is partial by design. Pin the measured behaviour rather
  // than "improving" it with a transliteration table (which would be a
  // widening rule needing its own attack).
  // -------------------------------------------------------------------
  describe("the Unicode fold is partial -- pin the measured behaviour", () => {
    it("folds characters with a canonical decomposition", () => {
      expect(companyIdentityKey("Café")).toBe("a:cafe");
      expect(companyIdentityKey("ＡＣＭＥ")).toBe("a:acme"); // fullwidth
      expect(companyIdentityKey("Nestlé")).toBe("a:nestle");
      expect(companyIdentityKey("Citroën")).toBe("a:citroen");
      expect(companyIdentityKey("Åhlens")).toBe("a:ahlens");
    });

    // Every failure below is in the UNDER-merge direction -- the safe
    // direction -- and is pinned so nobody "fixes" it with a
    // transliteration table.
    it("[accepted miss] Møller does not fold -- 'a:m ller', an internal gap", () => {
      expect(companyIdentityKey("Møller")).toBe("a:m ller");
      expect(companyIdentityKey("Møller")).not.toBe(companyIdentityKey("Moller"));
    });
    it("[accepted miss] Straße does not fold -- 'a:stra e', an internal gap", () => {
      expect(companyIdentityKey("Straße")).toBe("a:stra e");
      expect(companyIdentityKey("Straße")).not.toBe(companyIdentityKey("Strasse"));
    });
    it("[accepted miss] Łukasiewicz drops the leading letter -- 'a:ukasiewicz'", () => {
      expect(companyIdentityKey("Łukasiewicz")).toBe("a:ukasiewicz");
    });
    it("[accepted miss] Æther drops the leading letter -- 'a:ther'", () => {
      expect(companyIdentityKey("Æther")).toBe("a:ther");
    });
    it("[accepted miss] Ørsted drops the leading letter -- 'a:rsted'", () => {
      expect(companyIdentityKey("Ørsted")).toBe("a:rsted");
    });
    it("[accepted miss] Đại drops the non-decomposing consonant -- 'a:ai'", () => {
      expect(companyIdentityKey("Đại")).toBe("a:ai");
    });

    it("discriminator check: the incumbent's rule deletes the gap entirely; this module preserves it as a space", () => {
      // The incumbent's final step is a delete (`.replace(/[^a-z0-9]+/g, "")`),
      // so the non-decomposing "ø" vanishes without a trace: "møller" ->
      // "mller". This module's step 5 is a COLLAPSE-TO-SPACE, so the same
      // input leaves a boundary behind ("m ller") -- a different, and
      // separately measured, shape. Proof this pinned value is not vacuous.
      expect(incumbentStyleKey("Møller")).toBe("mller");
      expect(companyIdentityKey("Møller")).toBe("a:m ller");
    });
  });

  // -------------------------------------------------------------------
  // C-22 -- the company over-merge, the one widening rule that survives.
  // Real employers with different suffixes intentionally merge; this is a
  // demonstrated, accepted false-merge risk, not a defect.
  // -------------------------------------------------------------------
  describe("C-22 -- legal-suffix removal can over-merge two different real employers (accepted, mitigated elsewhere)", () => {
    it("two employers whose names differ only by a legal suffix merge to the same key", () => {
      expect(companyIdentityKey("Rolls-Royce PLC")).toBe(companyIdentityKey("Rolls-Royce"));
      expect(companyIdentityKey("Banco SA")).toBe(companyIdentityKey("Banco"));
      expect(companyIdentityKey("Standard Limited")).toBe(companyIdentityKey("Standard"));
      expect(companyIdentityKey("Sun Corp")).toBe(companyIdentityKey("Sun"));
      expect(companyIdentityKey("Delta Ltd")).toBe(companyIdentityKey("Delta"));
      expect(companyIdentityKey("Legal AB")).toBe(companyIdentityKey("Legal"));
    });

    it("[pin] Delta Ltd and Delta AB collapse to one key -- two different suffixes, one key, a known false merge", () => {
      // The likelier real-world case: a UK Ltd and a Swedish AB sharing a
      // stem are usually two distinct, unrelated companies.
      expect(companyIdentityKey("Delta Ltd")).toBe(companyIdentityKey("Delta AB"));
      expect(companyIdentityKey("Sun Corp")).toBe(companyIdentityKey("Sun GmbH"));
      expect(companyIdentityKey("Apex Inc")).toBe(companyIdentityKey("Apex Pty"));
    });

    it("[control] General Motors does not merge with General -- Motors is not a legal-suffix token", () => {
      expect(companyIdentityKey("General Motors")).not.toBe(companyIdentityKey("General"));
    });

    it("[control] two unrelated names with no shared suffix never merge", () => {
      expect(companyIdentityKey("Acme Systems")).not.toBe(companyIdentityKey("Acme Solutions"));
    });
  });

  // -------------------------------------------------------------------
  // C-8 -- normalizeCompanyKey (lib/scrape/atsLookup.js) must never be
  // reused, imported, or copied. The full cross-directory sweep with a
  // positive control is Wave 1B's duplicateApplyPurity.test.js; this is a
  // narrow self-check scoped to this module's own source only.
  // -------------------------------------------------------------------
  describe("C-8 -- this module's own source never imports or copies atsLookup's rule", () => {
    // Matches the repo's own precedent (statusVocabularySweep.test.js):
    // strip comments before scanning, so documentation that explains what
    // NOT to do (which necessarily names the forbidden module/regex) isn't
    // itself flagged as a violation. The full cross-directory sweep with
    // its own positive control lives in Wave 1B's
    // duplicateApplyPurity.test.js; this is a narrower self-check of only
    // this module's own CODE (not its comments).
    const sourcePath = fileURLToPath(new URL("./companyIdentity.js", import.meta.url));
    const rawSource = readFileSync(sourcePath, "utf8");
    const codeOnly = rawSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    it("contains no import specifier referencing atsLookup, outside comments", () => {
      expect(codeOnly).not.toMatch(/atsLookup/);
    });

    it("does not contain the incumbent's unanchored word-boundary suffix regex, outside comments", () => {
      expect(codeOnly).not.toContain("\\b(inc|llc|ltd|corp|co|company|technologies|labs|the)\\b");
    });

    it("positive control -- this sweep can actually fire", () => {
      const plantedViolation = "import { normalizeCompanyKey } from '@/lib/scrape/atsLookup';";
      const strippedPlant = plantedViolation.replace(/^\s*\/\/.*$/gm, "");
      expect(strippedPlant).toMatch(/atsLookup/);
    });
  });

  // -------------------------------------------------------------------
  // The pipeline reorder (whitespace/comma collapse moved before the
  // suffix strip, for the ReDoS fix) must not silently change the key for
  // real company names. Verified against the M1 corpus this checkout
  // actually ships (lib/greenhouse/companies.js + lib/lever/companies.js +
  // lib/ashby/companies.js -- 1d's own M1 measurement: 351 names, 346
  // unique).
  // -------------------------------------------------------------------
  describe("the ReDoS-fix reorder does not change real-world keys (M1 corpus)", () => {
    // The AC-ORDERED pipeline (collapse LAST), transcribed verbatim from
    // AC §1.2, kept ONLY as a comparison oracle for this equivalence
    // check -- never imported by the shipped module.
    function acOrderedKey(name) {
      if (typeof name !== "string" || name.length > COMPANY_NAME_MAX_LENGTH) return "";
      const raw = name;
      let s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
      s = s.replace(/&/g, " and ");
      s = s.replace(/[\s,]+(inc|llc|ltd|corp|corporation|incorporated|limited|plc|gmbh|sa|nv|bv|ab|oy|pty|pte)\.?$/, "");
      s = s.replace(/[^a-z0-9]+/g, " ").trim();
      if (s) return "a:" + s;
      if (/[\p{L}\p{N}]/u.test(raw)) {
        return "r:" + raw.trim().replace(/\s+/g, " ").normalize("NFKC").toLowerCase();
      }
      return "";
    }

    it("agrees with the AC-ordered pipeline on every name in the M1 corpus (351 rows, 346 unique)", () => {
      const names = [
        ...GREENHOUSE_COMPANIES.map((c) => c.name),
        ...LEVER_COMPANIES.map((c) => c.name),
        ...ASHBY_COMPANIES.map((c) => c.name),
      ];
      expect(names.length).toBe(351);
      const mismatches = [];
      for (const name of names) {
        const shipped = companyIdentityKey(name);
        const oracle = acOrderedKey(name);
        if (shipped !== oracle) mismatches.push({ name, shipped, oracle });
      }
      expect(mismatches).toEqual([]);
    });

    it("agrees with the AC-ordered pipeline on the C-5 constructed multi-suffix rows", () => {
      const rows = ["Acme Inc. Ltd", "Acme Corp Inc", "Acme Corp Corp", "Acme Ltd Ltd Ltd", "Acme Pte Ltd", "Acme Ltd"];
      for (const name of rows) {
        expect(companyIdentityKey(name)).toBe(acOrderedKey(name));
      }
    });

    // NOT a universal claim. Verified by direct measurement: the reorder
    // is NOT semantics-preserving over the AC's full "trailing-noise"
    // list -- specifically a trailing comma immediately after the suffix
    // token. This is a documented, deliberate side effect of the ReDoS
    // fix (collapsing the comma before the anchor lets the anchor see the
    // suffix it previously could not), not a new merge hazard: both
    // spellings ARE the same company. Pinned here rather than silently
    // assumed away by the equivalence tests above.
    it("[known side effect of the reorder] 'Acme Ltd,' now groups with 'Acme Ltd' -- the AC-ordered pipeline could not see past the trailing comma", () => {
      const shipped = companyIdentityKey("Acme Ltd,");
      const oracle = acOrderedKey("Acme Ltd,");
      expect(shipped).toBe("a:acme");
      expect(oracle).toBe("a:acme ltd");
      expect(shipped).not.toBe(oracle);
      expect(shipped).toBe(companyIdentityKey("Acme Ltd"));
    });

    it("the other four AC trailing-noise brittleness rows are unaffected by the reorder (still accepted misses)", () => {
      const stillMissing = ["Acme Ltd (UK)", "Acme Ltd​", "Acme S.A.", "Acme Pte Ltd"];
      for (const name of stillMissing) {
        expect(companyIdentityKey(name)).toBe(acOrderedKey(name));
        expect(companyIdentityKey(name)).not.toBe("a:acme");
      }
    });
  });

  // -------------------------------------------------------------------
  // Purity / totality (C-19's per-module slice): no throw on any shape,
  // deterministic, no ambient state.
  // -------------------------------------------------------------------
  describe("purity", () => {
    it("is deterministic", () => {
      const name = "Globex Corporation";
      expect(companyIdentityKey(name)).toBe(companyIdentityKey(name));
    });

    it("never throws, for any input shape", () => {
      const shapes = [null, undefined, 0, 1, -1, NaN, Infinity, true, false, {}, [], () => {}, Symbol("x"), new Date()];
      for (const shape of shapes) {
        expect(() => companyIdentityKey(shape)).not.toThrow();
      }
    });

    it("an empty key never groups and never counts -- '' is only ever equal to itself, and equality alone is not a match", () => {
      // Restated as a contract check on THIS module's return values: the
      // consuming rule is "equal AND non-empty" (AC §1.2), so a caller
      // that forgets the non-empty half would wrongly treat two blank
      // company fields as a match. This module's obligation is only to
      // make sure "" is the answer for blank/unusable input -- never a
      // synthesized non-empty placeholder.
      expect(companyIdentityKey("")).toBe("");
      expect(companyIdentityKey("   ")).toBe("");
    });
  });
});
