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
    expect(localChatReply(userMsg("what can you do?"))).toMatch(/job posting/i);
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

  it("predicts likely questions from the pinned posting during interview prep", () => {
    const reply = localChatReply({
      ...userMsg("help me prep for the interview"),
      pinnedContext: { label: "Backend Engineer", content: POSTING },
    });
    expect(reply).toMatch(/expect questions like/i);
    expect(reply.toLowerCase()).toMatch(/node|kubernetes|postgresql|api/);
    expect(reply).toMatch(/STAR/); // general guidance still included
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

  it("falls back honestly when nothing matches and there's no context", () => {
    const reply = localChatReply(userMsg("tell me a joke"));
    expect(reply).toMatch(/offline assistant/i);
  });

  it("answers posting questions from the posting itself, not with generic coaching", () => {
    const posting = `${POSTING}\nThis is a hybrid role. The salary range is $150,000 per year.`;
    const pay = localChatReply({
      ...userMsg("what does it pay?"),
      pinnedContext: { label: "Backend Engineer", content: posting },
    });
    expect(pay).toMatch(/^From the posting:/);
    expect(pay).toContain("$150,000");
    const remote = localChatReply({
      ...userMsg("is it remote?"),
      pinnedContext: { label: "Backend Engineer", content: posting },
    });
    expect(remote).toContain("hybrid");
  });

  it("admits when the posting lacks the asked fact, with negotiation help for salary", () => {
    const reply = localChatReply({
      ...userMsg("what does it pay?"),
      pinnedContext: { label: "Backend Engineer", content: POSTING },
    });
    expect(reply).toMatch(/doesn't mention compensation/i);
    expect(reply).toMatch(/range|offer|negotiat|total comp/i); // salary tail appended
  });

  it("summarizes the pinned posting on request", () => {
    const reply = localChatReply({
      ...userMsg("can you summarize this posting?"),
      pinnedContext: { label: "Backend", content: POSTING },
    });
    expect(reply).toMatch(/gist/i);
    expect(reply.toLowerCase()).toMatch(/node|api|engineer|kubernetes/);
  });

  it("estimates fit between the posting and the resume", () => {
    const reply = localChatReply({
      ...userMsg("am I a good fit for this role?"),
      pinnedContext: { label: "Backend", content: POSTING },
      resumeText: RESUME,
    });
    expect(reply).toMatch(/\b(strong|reasonable|stretch)\b/i);
    expect(reply.toLowerCase()).toMatch(/node/); // a matched skill
    expect(reply).toMatch(/doesn't clearly show/i); // gaps flagged
  });

  it("gives salary / negotiation guidance", () => {
    expect(localChatReply(userMsg("how much should I ask for in salary?"))).toMatch(
      /range|total comp|levels\.fyi|offer|negotiat/i,
    );
  });

  it("shortens the previous answer on a brief follow-up", () => {
    const reply = localChatReply({
      messages: [
        { role: "user", content: "cover letter tips?" },
        {
          role: "assistant",
          content:
            "Keep it to three short paragraphs. Lead with why this role. Prove it with one story. End confidently.",
        },
        { role: "user", content: "make it shorter" },
      ],
    });
    expect(reply).toMatch(/^In short:/);
  });

  it("adds complementary tips on 'tell me more'", () => {
    const reply = localChatReply({
      messages: [
        { role: "user", content: "resume tips" },
        { role: "assistant", content: "Start bullets with strong verbs." },
        { role: "user", content: "tell me more" },
      ],
    });
    expect(reply).toMatch(/quantify|tailor|requirement|mirror/i);
  });

  it("routes 'more about X' to the topic, not the follow-up handler", () => {
    const reply = localChatReply({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Hello." },
        { role: "user", content: "tell me more about negotiating salary" },
      ],
    });
    expect(reply).toMatch(/range|total comp|offer|negotiat/i);
  });

  it("uses the resume as a grounded fallback instead of a canned blurb", () => {
    const reply = localChatReply({ ...userMsg("hmm ok"), resumeText: RESUME });
    expect(reply).toMatch(/strongest on|action verb/i);
    expect(reply).not.toMatch(/offline assistant/i);
  });
});

describe("conversation memory (continuation and non-repetition)", () => {
  const WEAK_RESUME = [
    "EXPERIENCE",
    "Software Engineer, Acme Corp",
    "Jan 2020 – Present",
    "- Responsible for maintaining the reporting dashboards for stakeholders",
    "- Worked on internal tooling for various engineering teams",
    "- Helped with the migration of legacy services to the cloud",
    "- Involved in planning meetings and roadmap discussions with the team",
  ].join("\n");

  function pinned(content = POSTING) {
    return { label: "Backend Engineer", content };
  }

  it("'tell me more' continues the posting analysis with the NEXT tier of terms", () => {
    const first = localChatReply({
      messages: [{ role: "user", content: "what does this posting emphasize?" }],
      pinnedContext: pinned(),
    });
    const more = localChatReply({
      messages: [
        { role: "user", content: "what does this posting emphasize?" },
        { role: "assistant", content: first },
        { role: "user", content: "tell me more" },
      ],
      pinnedContext: pinned(),
    });
    expect(more).not.toBe(first);
    expect(more).toMatch(/also mentions|every significant term/i);
  });

  it("repeating a resume review surfaces the NEXT flagged bullets, not the same ones", () => {
    const ask = { role: "user", content: "review my resume" };
    const first = localChatReply({ messages: [ask], resumeText: WEAK_RESUME });
    const second = localChatReply({
      messages: [ask, { role: "assistant", content: first }, ask],
      resumeText: WEAK_RESUME,
    });
    expect(second).not.toBe(first);
    expect(second).toMatch(/continuing down the list|covers every bullet/i);
    // The first review's opening bullet isn't re-critiqued.
    const firstBullet = first.match(/"([^"]+)"/)?.[1];
    if (firstBullet) expect(second).not.toContain(firstBullet);
  });

  it("'more' after an applications summary gives the per-application breakdown", () => {
    const apps = [
      { company: "Acme", role: "Backend Engineer", status: "applied", stages: [] },
      { company: "Globex", status: "interviewing", stages: [] },
    ];
    const first = localChatReply({
      messages: [{ role: "user", content: "how many applications do I have?" }],
      applications: apps,
    });
    const more = localChatReply({
      messages: [
        { role: "user", content: "how many applications do I have?" },
        { role: "assistant", content: first },
        { role: "user", content: "more" },
      ],
      applications: apps,
    });
    expect(more).toMatch(/here's each one/i);
    expect(more).toContain("Acme");
    expect(more).toContain("Globex");
  });

  it("chained 'more' keeps going deeper until it honestly runs out", () => {
    const ask = { role: "user", content: "help me prep for the interview" };
    const msgs = [ask];
    const replies = [];
    for (let i = 0; i < 4; i += 1) {
      const reply = localChatReply({ messages: msgs, pinnedContext: pinned() });
      replies.push(reply);
      msgs.push({ role: "assistant", content: reply }, { role: "user", content: "tell me more" });
    }
    // No two consecutive replies identical; eventually admits exhaustion.
    for (let i = 1; i < replies.length; i += 1) expect(replies[i]).not.toBe(replies[i - 1]);
    expect(replies[replies.length - 1]).toMatch(/exhausts|questions to ask|beyond rehearsal/i);
  });

  it("still gives generic tips on 'more' when there was no prior topic", () => {
    const reply = localChatReply({
      messages: [
        { role: "user", content: "ok" },
        { role: "assistant", content: "Hello." },
        { role: "user", content: "tell me more" },
      ],
    });
    expect(reply).toMatch(/quantify|tailor|requirement|mirror/i);
  });

  it("is deterministic: the same conversation yields the same reply", () => {
    const convo = {
      messages: [
        { role: "user", content: "review my resume" },
        { role: "assistant", content: "..." },
        { role: "user", content: "tell me more" },
      ],
      resumeText: WEAK_RESUME,
    };
    expect(localChatReply(convo)).toBe(localChatReply(convo));
  });
});
