import { describe, it, expect, vi, beforeEach } from "vitest";

// N68 L5(ii): the tailor route must run the cover letter and the hiring email
// CONCURRENTLY (both after the résumé), never one strictly after the other, and
// never the résumé concurrently with either (the cover letter and email are
// grounded in the tailored résumé — parallelizing the résumé away is a QUALITY
// regression, AC §5).
//
// INSTRUMENT — initiation order, NOT wall-clock. jsdom/node does no layout and
// cannot prove a true race (backlog N74). Every concurrency assertion here
// proves INITIATION ORDER: which engine methods have been INVOKED at a point in
// time, before any of their deferred results has resolved. That is a pure
// call-count-at-a-point-in-time assertion, squarely inside the runner's power,
// and it is explicitly NOT the mid-flight edit race N74 says cannot be proven
// here. This file proves INITIATION, not parallel execution of the provider
// work itself — stated plainly so a later seat does not over-read it.
//
// REACHABILITY — every test drives the real production entry point `POST` with
// a real FormData request, exactly as the Next.js runtime does. The engine is
// reached through the route's own injected seam `getEngine(engineName)` (a fake
// engine registered via the PUBLIC `registerEngine` contract, the same seam the
// shipped route.test.js already uses). No route-internal function is called
// directly and nothing is exported to make a test reach it.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/config/env";
import { registerEngine } from "@/lib/llm/engines";
import { POST } from "./route.js";

function fakeSupabase(userId) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
  };
}

function signedOut() {
  createClient.mockResolvedValue(fakeSupabase(null));
}

function textFile(name, content, type = "text/plain") {
  const f = new File([content], name, { type });
  f.text = async () => content;
  return f;
}

// A request that exercises BOTH the cover-letter block (a cover file + template
// lines) and the hiring-email block (any engine whose tailorHiringEmail is a
// function), routed to the named fake engine.
function requestFor(engineName) {
  const fd = new FormData();
  fd.append("jobPosting", "We need a payments engineer to rebuild our settlement pipeline.");
  fd.append("resume", textFile("resume.txt", "Jane Doe\nSoftware Engineer\nBuilt things."));
  fd.append("templateLines", JSON.stringify(["Jane Doe", "Software Engineer", "Built things."]));
  fd.append("engine", engineName);
  fd.append(
    "coverLetterTemplateLines",
    JSON.stringify(["Dear Hiring Manager,", "I am excited.", "Sincerely, Jane"]),
  );
  fd.append("coverLetter", textFile("cover.txt", "Dear Hiring Manager,\nI am excited.\nSincerely, Jane"));
  return { formData: async () => fd };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// One real macrotask boundary drains the entire pending microtask chain; a few
// of them let the route advance through its awaited setup (formData, auth,
// résumé read) up to the next unresolved deferred we control. Never used to
// "wait for" a real duration — only to let already-schedulable continuations run.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function flush() {
  // Four boundaries is ample slack to let the route advance through its awaited
  // setup up to the next deferred we control; unrolled (not a loop) so no lint
  // suppression is needed.
  await tick();
  await tick();
  await tick();
  await tick();
}

const RESUME_RESULT = {
  result: "TAILORED-RESUME-SENTINEL Jane Doe\nTAILORED-RESUME-SENTINEL Payments Engineer",
  resultLines: ["TAILORED-RESUME-SENTINEL Jane Doe", "TAILORED-RESUME-SENTINEL Payments Engineer"],
  jobTitle: "Payments Engineer",
  companyName: "Acme",
  docxB64: "",
  report: null,
  warnings: [],
  degraded: false,
};

function coverOk(warnings = []) {
  return { result: "COVER BODY", resultLines: ["COVER BODY"], docxB64: "", report: null, warnings };
}

function emailOk(warnings = []) {
  return { subject: "Application for Payments Engineer", bodyLines: ["Dear Hiring Committee,"], warnings };
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerEnv.mockReturnValue({ resumeEngine: "gemini", geminiModel: "gemini-2.5-flash" });
});

describe("POST /api/tailor runs the cover letter and hiring email concurrently (N68 L5)", () => {
  // GUARD (passes on HEAD). Forbids the dangerous over-correction: running the
  // résumé concurrently with the cover letter / email. If a build ever issues
  // either before the résumé deferred resolves, the cover/email would be
  // grounded in an unresolved (empty) résumé — the exact ungrounded-output
  // failure this app exists to prevent. Its control is the résumé-parallelized
  // mutant (see tests.r1.md), which makes this fail.
  it("invokes neither the cover letter nor the hiring email until the résumé has resolved", async () => {
    signedOut();
    const calls = [];
    const dResume = deferred();
    registerEngine({
      name: "l5-guard-resume-first",
      isConfigured: () => true,
      async tailorResume() {
        calls.push("resume");
        return dResume.promise;
      },
      async tailorCoverLetter() {
        calls.push("cover");
        return coverOk();
      },
      async tailorHiringEmail() {
        calls.push("email");
        return emailOk();
      },
    });

    const postPromise = POST(requestFor("l5-guard-resume-first"));
    await flush();

    // The résumé call is in flight; the cover letter and email must NOT be.
    expect(calls).toContain("resume");
    expect(calls).not.toContain("cover");
    expect(calls).not.toContain("email");

    dResume.resolve(RESUME_RESULT);
    const res = await postPromise;
    expect(res.status).toBe(200);
  });

  // THE RED TEST on HEAD. Today the route awaits the cover letter (route.js:450)
  // strictly before it even reaches the hiring-email call (route.js:517), so
  // after the résumé resolves only the cover letter is in flight — the email is
  // not invoked until the cover letter resolves. This assertion therefore FAILS
  // on HEAD and PASSES only when both are issued together after the résumé.
  // Its control is the SERIAL mutant (revert to sequential await), which must
  // make it fail again on the reference tree.
  it("issues the cover letter and the hiring email concurrently — both in flight before either resolves", async () => {
    signedOut();
    const calls = [];
    const dResume = deferred();
    const dCover = deferred();
    const dEmail = deferred();
    registerEngine({
      name: "l5-concurrent",
      isConfigured: () => true,
      async tailorResume() {
        calls.push("resume");
        return dResume.promise;
      },
      async tailorCoverLetter() {
        calls.push("cover");
        return dCover.promise;
      },
      async tailorHiringEmail() {
        calls.push("email");
        return dEmail.promise;
      },
    });

    const postPromise = POST(requestFor("l5-concurrent"));
    await flush();
    expect(calls).toEqual(["resume"]);

    // Résumé resolves; let the route advance. Neither the cover nor the email
    // deferred is resolved here, so any call recorded now was INITIATED while
    // both are still in flight — the initiation-order property.
    dResume.resolve(RESUME_RESULT);
    await flush();

    expect(calls).toContain("cover");
    expect(calls).toContain("email");

    dCover.resolve(coverOk());
    dEmail.resolve(emailOk());
    const res = await postPromise;
    expect(res.status).toBe(200);
  });

  // GUARD (passes on HEAD): both documents must be grounded in the TAILORED
  // résumé the route just produced, not in an empty/unresolved one. Asserts on
  // the CONTENT handed to each engine call, not merely on a 200. Control: the
  // résumé-parallelized mutant delivers an empty tailoredResume here.
  it("grounds both the cover letter and the hiring email in the tailored résumé's content", async () => {
    signedOut();
    let coverArgs = null;
    let emailArgs = null;
    registerEngine({
      name: "l5-grounding",
      isConfigured: () => true,
      async tailorResume() {
        return RESUME_RESULT;
      },
      async tailorCoverLetter(opts) {
        coverArgs = opts;
        return coverOk();
      },
      async tailorHiringEmail(opts) {
        emailArgs = opts;
        return emailOk();
      },
    });

    const res = await POST(requestFor("l5-grounding"));
    expect(res.status).toBe(200);

    expect(coverArgs).toBeTruthy();
    expect(emailArgs).toBeTruthy();
    // pickTailoredResume(tailoredResumeLines=[], result) => the résumé result's
    // own text; both calls must receive it, sentinel and all.
    expect(coverArgs.tailoredResume.result).toContain("TAILORED-RESUME-SENTINEL");
    expect(emailArgs.tailoredResume.result).toContain("TAILORED-RESUME-SENTINEL");
  });

  // GUARD (passes on HEAD): with two tasks running together, warnings can
  // interleave or be mis-attributed. Pin the fixed résumé -> cover -> email
  // order and the per-document attribution prefixes. Control: a mutant that
  // feeds the outcomes into the aggregator in the wrong order, or swaps the
  // prefixes, changes this array.
  it("preserves warning order and per-document attribution (résumé, then cover, then email)", async () => {
    signedOut();
    registerEngine({
      name: "l5-warning-order",
      isConfigured: () => true,
      async tailorResume() {
        return { ...RESUME_RESULT, warnings: ["RESUME-WARN"] };
      },
      async tailorCoverLetter() {
        return coverOk(["COVER-WARN"]);
      },
      async tailorHiringEmail() {
        return emailOk(["EMAIL-WARN"]);
      },
    });

    const res = await POST(requestFor("l5-warning-order"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warnings).toEqual([
      "RESUME-WARN",
      "Cover letter: COVER-WARN",
      "Hiring email: EMAIL-WARN",
    ]);
  });

  // GUARD (passes on HEAD): per-artifact error isolation. A failed hiring email
  // must not fail the cover letter or the request. Control: a mutant that runs a
  // raw Promise.all WITHOUT keeping each task's own try/catch lets the rejection
  // escape and the whole request 500s — this test then fails.
  it("isolates a hiring-email failure — a throwing email still returns the cover letter and a 200", async () => {
    signedOut();
    registerEngine({
      name: "l5-email-throws",
      isConfigured: () => true,
      async tailorResume() {
        return RESUME_RESULT;
      },
      async tailorCoverLetter() {
        return coverOk();
      },
      async tailorHiringEmail() {
        throw new Error("email engine boom");
      },
    });

    const res = await POST(requestFor("l5-email-throws"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.coverLetterResult).toBe("COVER BODY");
    expect(data.emailError).toContain("Hiring-team email generation failed");
    expect(data.emailResultLines).toEqual([]);
  });

  // GUARD (passes on HEAD): the mirror of the above — a failed cover letter must
  // not fail the hiring email or the request.
  it("isolates a cover-letter failure — a throwing cover letter still returns the hiring email and a 200", async () => {
    signedOut();
    registerEngine({
      name: "l5-cover-throws",
      isConfigured: () => true,
      async tailorResume() {
        return RESUME_RESULT;
      },
      async tailorCoverLetter() {
        throw new Error("cover engine boom");
      },
      async tailorHiringEmail() {
        return emailOk();
      },
    });

    const res = await POST(requestFor("l5-cover-throws"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.coverLetterError).toContain("Cover letter generation failed");
    expect(data.emailSubject).toBe("Application for Payments Engineer");
    expect(data.emailResultLines).toEqual(["Dear Hiring Committee,"]);
  });
});
