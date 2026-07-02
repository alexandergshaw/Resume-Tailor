import { describe, it, expect } from "vitest";
import { extractiveAnswer, qaTopicOf } from "./extractiveQa.js";

const POSTING = [
  "Senior Backend Engineer at Initech.",
  "This is a full-time, hybrid role based in Omaha, NE with two days per week in office.",
  "You will design scalable APIs in Node.js and TypeScript with PostgreSQL.",
  "Requires a bachelor's degree in Computer Science or equivalent experience.",
  "5+ years of backend experience required.",
  "The salary range for this position is $140,000 - $165,000 per year plus bonus.",
  "We offer health insurance, a 401(k) match, and 20 days of PTO.",
].join(" ");

describe("qaTopicOf", () => {
  it("detects question topics", () => {
    expect(qaTopicOf("what does it pay?").id).toBe("salary");
    expect(qaTopicOf("is this remote?").id).toBe("remote");
    expect(qaTopicOf("do I need a degree?").id).toBe("degree");
    expect(qaTopicOf("how many years of experience do they want?").id).toBe("experience");
  });

  it("does not hijack negotiation coaching as a salary lookup", () => {
    expect(qaTopicOf("how should I negotiate salary?")).toBeNull();
    expect(qaTopicOf("should I counter their offer?")).toBeNull();
  });
});

describe("extractiveAnswer", () => {
  it("quotes the posting's salary sentence for pay questions", () => {
    const out = extractiveAnswer("what does it pay?", POSTING);
    expect(out.type).toBe("answer");
    expect(out.text).toContain("$140,000 - $165,000");
    expect(out.text).toMatch(/^From the posting:/);
  });

  it("answers remote/degree/experience/benefits questions with evidence sentences", () => {
    expect(extractiveAnswer("is it remote?", POSTING).text).toContain("hybrid");
    expect(extractiveAnswer("does it require a degree?", POSTING).text).toContain("bachelor's degree");
    expect(extractiveAnswer("how many years of experience do I need?", POSTING).text).toContain("5+ years");
    expect(extractiveAnswer("what are the benefits?", POSTING).text).toContain("401(k)");
  });

  it("returns an honest not-found when the topic is asked but absent", () => {
    const noSalary = POSTING.replace(/The salary range[^.]+\./, "");
    const out = extractiveAnswer("what does it pay?", noSalary);
    expect(out.type).toBe("not-found");
    expect(out.topic).toBe("salary");
  });

  it("answers generic subject questions only with real term overlap", () => {
    const out = extractiveAnswer("what will I design in this role?", POSTING);
    expect(out.type).toBe("answer");
    expect(out.text).toContain("design scalable APIs");
    // No overlap with the posting → refuses rather than quoting something random.
    expect(extractiveAnswer("does it allow pet iguanas?", POSTING)).toBeNull();
  });

  it("returns null for non-questions and empty inputs", () => {
    expect(extractiveAnswer("review my resume please", POSTING)).toBeNull();
    expect(extractiveAnswer("", POSTING)).toBeNull();
    expect(extractiveAnswer("is it remote?", "")).toBeNull();
  });
});
