// N102 AC-5 (client half) + AC-7 -- the request body carries the as-me flag,
// read off the WIRE, never off an intermediate value.
//
// Instrument: the SAME harness lib/chat/chatbot.request.test.js uses --
// `createChatHandlers` driven with `globalThis.fetch` stubbed, the body read
// from `fetch.mock.calls[0][1].body` and JSON-parsed. This is the real
// production request shaper, not a hand-built payload.
//
// HOW THE FLAG IS SET: the client reads the preference through the store
// (`readAnswerAsMe()` from app/settings/answerAsMe). The store reads
// localStorage key "chatAnswerAsMe". So these tests set the flag by seeding a
// fake localStorage with that key -- the SAME path the real toggle writes --
// rather than importing the store, so this file loads and reports clean
// per-assertion reds at HEAD (where chatbot.js does not read the flag yet).
// The key literal is the design contract (N102.design §2, D1); the store's own
// test (app/settings/answerAsMe.test.js) pins `ANSWER_AS_ME_STORAGE_KEY ===
// "chatAnswerAsMe"`, so if the implementer picks a different key BOTH files
// go red -- one source of truth.
//
// RED-ON-HEAD: chatbot.js's payload (chatbot.js:609-625) has no `answerAsMe`
// field today, so `body.answerAsMe` is `undefined` -- `toBe(true)` and
// `toBe(false)` both red. The AC-7 byte-identity block is a GUARD (vacuous on
// HEAD, where both runs omit the field and are already identical); it becomes a
// real voice-only guard on the built diff. Disclosed as such.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChatHandlers } from "./chatbot.js";

// The design's storage key (N102.design §2). Deliberately a literal here, not
// an import of the store, for the reason in the header.
const ANSWER_AS_ME_KEY = "chatAnswerAsMe";

function installStorage(seed = {}) {
  const store = { ...seed };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  return store;
}

let savedFetch;
beforeEach(() => {
  savedFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

function fakeResponse({ status, body, contentType }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => (contentType === undefined ? null : contentType) },
    text: vi.fn(async () => body),
    json: vi.fn(async () => JSON.parse(body)),
  };
}
const RESPONSE_OK = (reply = "ok") =>
  fakeResponse({ status: 200, body: JSON.stringify({ reply }), contentType: "application/json" });

// Trimmed copy of chatbot.request.test.js's harness -- only the deps a plain
// text send needs.
function makeHarness(initial = {}) {
  const state = {
    messages: initial.messages || [],
    attached: initial.attached || [],
    input: initial.input || "",
    pinned: initial.pinned === undefined ? null : initial.pinned,
    error: "",
    sending: false,
  };
  const spies = {
    setChatMessages: vi.fn((next) => {
      state.messages = typeof next === "function" ? next(state.messages) : next;
    }),
    setChatAttachedFiles: vi.fn((next) => {
      state.attached = typeof next === "function" ? next(state.attached) : next;
    }),
    setChatError: vi.fn((next) => {
      state.error = typeof next === "function" ? next(state.error) : next;
    }),
    setChatInput: vi.fn((next) => {
      state.input = typeof next === "function" ? next(state.input) : next;
    }),
    setChatSending: vi.fn((next) => {
      state.sending = typeof next === "function" ? next(state.sending) : next;
    }),
    setChatPinnedContext: vi.fn((next) => {
      state.pinned = typeof next === "function" ? next(state.pinned) : next;
    }),
  };
  function handlers() {
    return createChatHandlers({
      chatInput: state.input,
      chatMessages: state.messages,
      chatSending: state.sending,
      chatPinnedContext: state.pinned,
      chatAttachedFiles: state.attached,
      chatSize: { width: 380, height: 520 },
      setChatInput: spies.setChatInput,
      setChatMessages: spies.setChatMessages,
      setChatSending: spies.setChatSending,
      setChatError: spies.setChatError,
      setChatOpen: vi.fn(),
      setChatPinnedContext: spies.setChatPinnedContext,
      setChatAttachedFiles: spies.setChatAttachedFiles,
      setChatAttachError: vi.fn(),
      setChatSize: vi.fn(),
      setChatResizing: vi.fn(),
      chatInputRef: { current: null },
      resumeFile: null,
      applicationData: initial.applicationData || [],
      applicationStages: {},
      mainTab: "jobs",
      activeSection: null,
      isDocxResume: () => false,
      isTextResume: () => false,
      buildTemplateLinesForUpload: async () => [],
    });
  }
  return { state, spies, handlers };
}

function sentBody(callIndex = 0) {
  return JSON.parse(globalThis.fetch.mock.calls[callIndex][1].body);
}

describe("runChatRequest: the answer-as-me flag on the wire (AC-5 client)", () => {
  it("carries answerAsMe=true when the stored preference is ON", async () => {
    installStorage({ [ANSWER_AS_ME_KEY]: "true" });
    globalThis.fetch = vi.fn(async () => RESPONSE_OK());
    const { handlers } = makeHarness({ input: "draft a reply to the recruiter" });

    await handlers().sendChatMessage();

    const body = sentBody();
    expect(body.answerAsMe).toBe(true);
  });

  it("carries answerAsMe=false when the preference is OFF (unset store)", async () => {
    installStorage();
    globalThis.fetch = vi.fn(async () => RESPONSE_OK());
    const { handlers } = makeHarness({ input: "draft a reply to the recruiter" });

    await handlers().sendChatMessage();

    const body = sentBody();
    // Present in BOTH states (not omitted when off) -- AC-5 note, so the
    // fetch-spy asserts a value directly rather than present-vs-absent.
    expect(body.answerAsMe).toBe(false);
  });

  it("carries answerAsMe=false when the stored value is GARBAGE (fail-safe)", async () => {
    // A corrupt/legacy value must not turn the voice on client-side either.
    installStorage({ [ANSWER_AS_ME_KEY]: "1" });
    globalThis.fetch = vi.fn(async () => RESPONSE_OK());
    const { handlers } = makeHarness({ input: "help" });

    await handlers().sendChatMessage();

    expect(sentBody().answerAsMe).toBe(false);
  });
});

describe("runChatRequest: the flag changes VOICE ONLY (AC-7 guard)", () => {
  it("every other request field is byte-identical ON vs OFF", async () => {
    // GUARD: vacuous on HEAD (both runs omit the field and are identical). On
    // the built diff it proves the toggle adds nothing but the one flag -- no
    // context added or dropped, no cap change, same keys.
    const pinned = { label: "Senior Engineer at Acme", content: "Job description here." };
    const applicationData = [
      { id: "a1", positions: { company: "Acme", title: "Senior Engineer" }, status: "applied" },
    ];

    installStorage();
    globalThis.fetch = vi.fn(async () => RESPONSE_OK());
    const off = makeHarness({ input: "how do I match this?", pinned, applicationData });
    await off.handlers().sendChatMessage();
    const offBody = sentBody();

    installStorage({ [ANSWER_AS_ME_KEY]: "true" });
    globalThis.fetch = vi.fn(async () => RESPONSE_OK());
    const on = makeHarness({ input: "how do I match this?", pinned, applicationData });
    await on.handlers().sendChatMessage();
    const onBody = sentBody();

    // The one field differs...
    expect(offBody.answerAsMe).toBe(false);
    expect(onBody.answerAsMe).toBe(true);

    // ...and nothing else does. Same key set, same value for every other key.
    expect(Object.keys(onBody).sort()).toEqual(Object.keys(offBody).sort());
    for (const key of Object.keys(offBody)) {
      if (key === "answerAsMe") continue;
      expect(onBody[key]).toEqual(offBody[key]);
    }
    // Spell out the ones AC-7 enumerates, so a regression on any is legible.
    for (const key of ["messages", "resumeText", "applications", "pinnedContext", "attachedFiles", "tab", "section", "engine"]) {
      expect(onBody[key]).toEqual(offBody[key]);
    }
  });
});
