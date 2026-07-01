import { describe, it, expect } from "vitest";
import { localChatReply, topTerms } from "./localAssistant.js";

const POSTING = [
  "We're hiring a Senior Backend Engineer.",
  "You'll design scalable APIs in Node.js and TypeScript, work with PostgreSQL and AWS,",
  "and own our Kubernetes-based deployment pipeline. Experience with GraphQL is a plus.",
].join("\n");

const RESUME = [
  "Software Engineer",
  "Built REST APIs with Node.js and TypeScript.",
  "Deployed services and improved reliability.",
].join("\n");

function userMsg(content) {
  return { messages: [{ role: "user", content }] };
}

describe("topTerms", () => {
  it("pulls salient real skills from text", () => {
    const terms = topTerms(POSTING).map((t) => t.toLowerCase());
    expect(terms.some((t) => t.includes("node"))).toBe(true);
    expect(topTerms("")).toEqual([]);
  });
});

describe("localChatReply intents", () => {
  it("describes its capabilities for greetings/help", () => {
    expect(localChatReply(userMsg("hi"))).toMatch(/offline assistant/i);
    expect(localChatReply(userMsg("what can you do?"))).toMatch(/analyze a job posting/i);
  });

  it("reviews the resume when one is uploaded, prompts to upload otherwise", () => {
    const withResume = localChatReply({ ...userMsg("can you review my resume?"), resumeText: RESUME });
    expect(withResume).toMatch(/strongest on|action verb/i);
    const noResume = localChatReply(userMsg("please give resume feedback"));
    expect(noResume).toMatch(/upload your resume/i);
  });

  it("summarizes tracked applications", () => {
    const apps = [
      { company: "Acme", status: "applied", stages: [{ name: "Phone screen", scheduledAt: "2026-07-10" }] },
      { company: "Globex", status: "applied", stages: [] },
      { company: "Initech", status: "interviewing", stages: [] },
    ];
    const reply = localChatReply({ ...userMsg("how many applications do I have?"), applications: apps });
    expect(reply).toMatch(/tracking 3 applications/i);
    expect(reply).toMatch(/2 applied/);
    expect(reply).toMatch(/Acme.*Phone screen/);
  });

  it("gives interview prep guidance", () => {
    expect(localChatReply(userMsg("help me prepare for my interview"))).toMatch(/STAR/);
  });

  it("gives cover letter guidance", () => {
    expect(localChatReply(userMsg("any tips for my cover letter?"))).toMatch(/three short paragraphs/i);
  });

  it("analyzes a pinned posting and flags resume gaps", () => {
    const reply = localChatReply({
      ...userMsg("I need help with this job: what should I emphasize?"),
      pinnedContext: { label: "Senior Backend Engineer", content: POSTING },
      resumeText: RESUME,
    });
    expect(reply).toMatch(/this posting leans most on/i);
    // Resume lacks these, so they should be flagged as gaps.
    expect(reply).toMatch(/doesn't clearly mention/i);
    expect(reply.toLowerCase()).toMatch(/postgresql|aws|kubernetes/);
  });

  it("prompts to pin a posting when a posting question has no subject", () => {
    expect(localChatReply(userMsg("what skills should I tailor for?"))).toMatch(/pin a posting|paste the description/i);
  });

  it("falls back honestly when nothing matches", () => {
    const reply = localChatReply(userMsg("tell me a joke"));
    expect(reply).toMatch(/offline assistant/i);
  });
});
