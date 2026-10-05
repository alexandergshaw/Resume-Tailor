// N103 Step 7 (4b) -- askAiAbout must thread an optional `documentScope` descriptor
// ({ jobId, scope }) into the pinned context, so selectChatReviewDocument (S2) can
// tell a resume pin from a hypothetical pin on the SAME job id. askAiAbout is the
// ONLY writer of chatPinnedContext, so without this the chat review can never
// distinguish the two documents (AC-2).
//
// RED on HEAD: askAiAbout's signature is `{ label, content, prompt, sourceJobId,
// posting }` and setChatPinnedContext is called WITHOUT a documentScope field. The
// positive assertion fails; the two controls guard a fix that over-fires (invents a
// scope) or drops the existing contract.
//
// Node env: createChatHandlers and its imports are pure; askAiAbout touches only the
// injected setters and a null-guarded composer ref.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChatHandlers } from "./chatbot.js";

let setChatPinnedContext;
let deps;

beforeEach(() => {
  setChatPinnedContext = vi.fn();
  deps = {
    setChatPinnedContext,
    setChatError: vi.fn(),
    setChatInput: vi.fn(),
    setChatOpen: vi.fn(),
    chatInputRef: { current: null },
  };
});

const askAiAbout = (arg) => createChatHandlers(deps).askAiAbout(arg);
const pinnedArg = () => setChatPinnedContext.mock.calls[0][0];

describe("askAiAbout -- forwards the documentScope descriptor (S7 wiring)", () => {
  it("threads { jobId, scope } through to setChatPinnedContext", () => {
    askAiAbout({ label: "Acme · Staff Engineer — Resume", content: "…", sourceJobId: "job-1", documentScope: { jobId: "job-1", scope: "resume" } });
    expect(setChatPinnedContext).toHaveBeenCalledTimes(1);
    // RED on HEAD: today's pinned-context object has no `documentScope` key.
    expect(pinnedArg().documentScope).toEqual({ jobId: "job-1", scope: "resume" });
  });

  it("CONTROL: still sets label / content / sourceJobId (the pre-existing contract is intact)", () => {
    askAiAbout({ label: "Acme · Staff Engineer — Resume", content: "the resume", sourceJobId: "job-1", documentScope: { jobId: "job-1", scope: "resume" } });
    expect(pinnedArg()).toMatchObject({ label: "Acme · Staff Engineer — Resume", content: "the resume", sourceJobId: "job-1" });
  });

  it("CONTROL: a caller that passes no documentScope yields a null/absent scope (safe default)", () => {
    // Guards a fix that hardwires a non-null documentScope regardless of the caller,
    // which would misattribute an unscoped pin to a specific document.
    askAiAbout({ label: "My resume", content: "resume text" });
    expect(pinnedArg().documentScope == null).toBe(true);
  });
});
