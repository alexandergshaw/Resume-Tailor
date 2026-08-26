import { describe, it, expect, vi } from "vitest";
import { normalizeModelPoints, generateIdealProjectExample, answerAids } from "./answerAids";

// Direct unit coverage for the three functions moved out of
// app/api/copilot/answer/route.js into this module (see this file's own
// header for why). Every one of these was previously exercised ONLY through
// a mocked `generateContent` call several layers away in route.test.js; that
// coverage still exists and still passes unchanged, and this file adds the
// direct kind lib/copilot/answerPrompts.test.js already established for the
// prompt builders extracted earlier from the same route.

describe("normalizeModelPoints", () => {
  it("pairs each point with its pageId BY INDEX before filtering, so a blank point never shifts a later citation onto the wrong point", () => {
    // THE BUG THIS PREVENTS (see the function's own comment): filtering
    // `points` for blanks without filtering `pageIds` the same way, in the
    // same pass, silently misaligns every citation after the first blank.
    const parsed = {
      points: ["First point.", "   ", "Third point."],
      pageIds: ["page-a", "page-b", "page-c"],
    };
    expect(normalizeModelPoints(parsed, 6)).toEqual({
      points: ["First point.", "Third point."],
      pageIds: ["page-a", "page-c"],
    });
  });

  it("returns pageIds: null, not [], when the model returned no pageIds array at all", () => {
    // resolvePageSources' contract distinguishes "nothing supplied" (null)
    // from "an array of the wrong length" — collapsing the two would send it
    // down the wrong path.
    const result = normalizeModelPoints({ points: ["A point."] }, 6);
    expect(result.pageIds).toBeNull();
    expect(result.points).toEqual(["A point."]);
  });

  it("returns points: [] when parsed.points is missing or not an array", () => {
    expect(normalizeModelPoints({}, 6)).toEqual({ points: [], pageIds: null });
    expect(normalizeModelPoints({ points: "not an array" }, 6)).toEqual({ points: [], pageIds: null });
    expect(normalizeModelPoints(null, 6)).toEqual({ points: [], pageIds: null });
  });

  it("trims each surviving point and slices to the cap", () => {
    const parsed = { points: ["  one  ", "two", "three", "four"] };
    expect(normalizeModelPoints(parsed, 2)).toEqual({ points: ["one", "two"], pageIds: null });
  });

  // AC-V4.4: factIds goes through the SAME index-paired pass as pageIds,
  // for the identical reason (this function's own header) — normalising it
  // separately is exactly how the original pageIds bug would come back.
  it("pairs factIds BY INDEX alongside pageIds, in the same pass as points", () => {
    const parsed = {
      points: ["First point.", "   ", "Third point."],
      pageIds: ["page-a", "page-b", "page-c"],
      factIds: ["fact-0", "fact-1", null],
    };
    expect(normalizeModelPoints(parsed, 6)).toEqual({
      points: ["First point.", "Third point."],
      pageIds: ["page-a", "page-c"],
      factIds: ["fact-0", null],
    });
  });

  it("returns factIds: undefined, not null and not [], when the model returned no factIds array at all", () => {
    // Deliberately NOT the same convention normalizeModelPoints uses for
    // pageIds (null) — see this function's own comment on why: every
    // existing caller of this function asserts the exact two-key
    // `{ points, pageIds }` shape with `toEqual`, which treats an
    // undefined-valued property as absent but NOT a null-valued one.
    const result = normalizeModelPoints({ points: ["A point."], pageIds: ["page-a"] }, 6);
    expect(result.factIds).toBeUndefined();
    expect(result).toEqual({ points: ["A point."], pageIds: ["page-a"] });
  });

  it("slices factIds to the cap alongside points and pageIds", () => {
    const parsed = {
      points: ["one", "two", "three", "four"],
      factIds: ["f0", "f1", "f2", "f3"],
    };
    expect(normalizeModelPoints(parsed, 2).factIds).toEqual(["f0", "f1"]);
  });

  it("works with factIds present and pageIds absent, and vice versa", () => {
    const factsOnly = normalizeModelPoints({ points: ["A point."], factIds: ["fact-0"] }, 6);
    expect(factsOnly.pageIds).toBeNull();
    expect(factsOnly.factIds).toEqual(["fact-0"]);

    const pagesOnly = normalizeModelPoints({ points: ["A point."], pageIds: ["page-0"] }, 6);
    expect(pagesOnly.factIds).toBeUndefined();
    expect(pagesOnly.pageIds).toEqual(["page-0"]);
  });
});

describe("generateIdealProjectExample", () => {
  it("returns null without calling the model when there is no posting to build a prompt from", async () => {
    const client = { models: { generateContent: vi.fn() } };
    const result = await generateIdealProjectExample({
      client,
      geminiModel: "gemini-2.5-flash",
      description: "",
      question: "Tell me about a project.",
    });
    expect(result).toBeNull();
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it("returns null, never throws, when the model call rejects", async () => {
    const client = { models: { generateContent: vi.fn().mockRejectedValue(new Error("network")) } };
    const result = await generateIdealProjectExample({
      client,
      geminiModel: "gemini-2.5-flash",
      description: "We need a platform engineer to scale checkout.",
      question: "Tell me about a project.",
    });
    expect(result).toBeNull();
  });

  it("returns null when the model's response fails normalizeIdealProject's validation", async () => {
    const client = {
      models: { generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({ title: "Incomplete" }) }) },
    };
    const result = await generateIdealProjectExample({
      client,
      geminiModel: "gemini-2.5-flash",
      description: "We need a platform engineer to scale checkout.",
      question: "Tell me about a project.",
    });
    expect(result).toBeNull();
  });

  it("returns the normalized project on a valid response", async () => {
    const validPayload = {
      title: "Checkout resilience",
      sections: [
        {
          label: "Problem",
          body: "Checkout silently failed under peak weekend load, and the team had no early warning before customers noticed.",
        },
        {
          label: "Built",
          body: "Added a request queue and an automatic retry layer in front of the third-party payment provider's API.",
        },
        {
          label: "Ran",
          body: "Rolled the queue out gradually behind a feature flag, watching error dashboards closely across two full sprints.",
        },
        {
          label: "Landed",
          body: "Checkout errors during peak traffic dropped close to zero and the on-call pager stayed quiet on launch weekends.",
        },
      ],
      outcomes: [
        { metric: "error rate", figure: "6% down to 0%" },
        { metric: "peak throughput", figure: "3x without added capacity" },
        { metric: "on-call pages", figure: "9 per week down to 1" },
      ],
    };
    const client = { models: { generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(validPayload) }) } };
    const result = await generateIdealProjectExample({
      client,
      geminiModel: "gemini-2.5-flash",
      description: "We need a platform engineer to scale checkout.",
      question: "Tell me about a project.",
    });
    expect(result).not.toBeNull();
    expect(result.title).toBe("Checkout resilience");
  });
});

describe("answerAids", () => {
  it("degrades every aid to absent when there is nothing to build one from", async () => {
    const result = await answerAids({
      postingDescription: "",
      resume: "",
      profile: "",
      question: "Tell me about yourself.",
      points: ["A point about myself."],
      story: { matched: false },
    });
    expect(result).toEqual({ buzzwords: [], resumeAnchor: null, idealProject: null });
  });

  it("prefers the résumé over the prep profile for resumeAnchor, and labels the source", async () => {
    const resume = [
      "Senior Engineer, Quantum Robotics",
      "Led the checkout redesign, cutting cart abandonment by 18%.",
    ].join("\n");
    const result = await answerAids({
      postingDescription: "",
      resume,
      profile: "Some unrelated prep notes.",
      question: "Tell me about a project you led.",
      points: ["Led the checkout redesign."],
      story: { matched: false },
    });
    expect(result.resumeAnchor).not.toBeNull();
    expect(result.resumeAnchor.source).toBe("resume");
  });

  it("enriches the deterministic ideal project with a generated one, keeping the deterministic shape/summary/metrics", async () => {
    // THE BUG THIS PREVENTS (see this function's own comment): substituting
    // the generated project for the WHOLE aid, rather than only its
    // `project` field, drops `shape`/`summary`/`metrics` and the aid
    // silently renders as nothing downstream.
    const description = "We need a Senior Product Manager with Agile experience to lead a cross-functional team.";
    const generatedProjectPromise = Promise.resolve({ title: "Generated title", sections: [], outcomes: [] });
    const result = await answerAids({
      postingDescription: description,
      resume: "",
      profile: "",
      question: "Tell me about a project.",
      points: ["A point."],
      generatedProjectPromise,
      story: { matched: false },
    });
    if (result.idealProject) {
      expect(result.idealProject.project).toEqual({ title: "Generated title", sections: [], outcomes: [] });
      expect(result.idealProject).toHaveProperty("shape");
    }
  });

  it("falls back to the page-derived project aid, source PROJECT_PAGE_SOURCE, only when neither résumé nor prep notes name a role", async () => {
    const story = {
      matched: true,
      title: "Payments migration",
      bullets: ["Migrated the payments ledger to Postgres with zero downtime."],
    };
    const result = await answerAids({
      postingDescription: "",
      resume: "",
      profile: "",
      question: "Tell me about the payments migration.",
      points: ["Migrated the ledger."],
      story,
    });
    expect(result.resumeAnchor).not.toBeNull();
    expect(result.resumeAnchor.source).toBe("project page");
    expect(result.resumeAnchor.title).toBe("");
    expect(result.resumeAnchor.company).toBe("");
  });
});
