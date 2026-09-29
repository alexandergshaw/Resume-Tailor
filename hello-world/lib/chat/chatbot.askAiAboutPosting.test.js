// N65 step 3 — chatbot.js's askAiAbout must thread the POSTING descriptor into
// the pinned context.
//
// The ChatPanel "Estimate salary" affordance (shipped step 2) reads
// `chatPinnedContext.posting`. askAiAbout is the ONLY writer of chatPinnedContext
// (lib/chat/chatbot.js), so unless it forwards a `posting` arg into
// setChatPinnedContext the affordance can never appear in the real app.
//
// RED on HEAD: askAiAbout's signature is `{ label, content, prompt, sourceJobId }`
// and it calls setChatPinnedContext WITHOUT a `posting` field. The positive
// assertion below fails; the two controls are green both before and after and
// exist to catch a fix that over-fires (injects a posting when none was passed)
// or drops the existing contract.
//
// Node env: createChatHandlers and its imports are pure; askAiAbout touches only
// the injected setters and a null-guarded composer ref.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChatHandlers } from "./chatbot.js";

const POSTING = { title: "Senior Platform Engineer", company: "Acme", location: "Remote (US)", salaryStated: false };

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

function askAiAbout(arg) {
  return createChatHandlers(deps).askAiAbout(arg);
}

const pinnedArg = () => setChatPinnedContext.mock.calls[0][0];

describe("askAiAbout — forwards the posting descriptor (step 3 wiring)", () => {
  it("threads `posting` through to setChatPinnedContext", () => {
    askAiAbout({ label: "Senior Platform Engineer · Acme", content: "…", posting: POSTING });
    expect(setChatPinnedContext).toHaveBeenCalledTimes(1);
    // RED on HEAD: today's pinned context object has no `posting` key.
    expect(pinnedArg().posting).toEqual(POSTING);
  });

  it("CONTROL: still sets label / content / sourceJobId (the pre-existing contract is intact)", () => {
    // GREEN on HEAD and after — guards a fix that rebuilds the object and drops
    // the fields the pinned bar and the sourceJobId effect (app/page.js) read.
    askAiAbout({ label: "Senior Platform Engineer · Acme", content: "the JD", sourceJobId: "url-1", posting: POSTING });
    expect(pinnedArg()).toMatchObject({ label: "Senior Platform Engineer · Acme", content: "the JD", sourceJobId: "url-1" });
  });

  it("CONTROL: a caller that passes no posting yields a null/absent posting (safe default — no accidental affordance)", () => {
    // GREEN both before and after. Its job is to fail a build that hardwires a
    // non-null posting regardless of the caller — which would light the
    // "Estimate salary" button on resume/cover-letter/material subjects.
    askAiAbout({ label: "My resume", content: "resume text" });
    expect(pinnedArg().posting == null).toBe(true);
  });
});
