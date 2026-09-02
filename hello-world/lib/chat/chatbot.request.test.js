// Node environment (the repo default): `runChatRequest` touches no DOM. It
// reads `globalThis.fetch`, which is stubbed here, and every piece of state it
// needs arrives through `createChatHandlers`' deps.
//
// Three things are pinned here, all of them about the loop a user gets stuck
// in after the first 413:
//
//   1. A SUCCESSFUL send clears the attachment tray. A FAILED send does not --
//      the user's file is never destroyed by a failure. Today neither happens:
//      `runChatRequest` never touches `chatAttachedFiles` at all, so every
//      retry re-uploads the same multi-megabyte payload and re-fails until the
//      page is reloaded.
//
//   2. A retry must not GROW the request. `chatbot.js:208` commits
//      `nextMessages` to state BEFORE the fetch, and `sendChatMessage` (:280)
//      hands that transcript back in as `baseMessages` next time -- so the
//      failed turn is still in the thread and the second attempt is strictly
//      larger than the first. A user sitting just under the limit crosses it
//      by retrying. The failed turn is marked and its slot re-used.
//
//   3. `resendUserMessage`'s existing `slice(0, index)` at :290 keeps working.
//      Its base already excludes the turn being resent, so the trailing-failed
//      rule must be a no-op for it.
//
// The user-facing message is asserted here end-to-end (it is what lands in
// `setChatError`); its classification is unit-tested in chatbot.response.test.js.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChatHandlers } from "./chatbot.js";

let savedFetch;

beforeEach(() => {
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
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

const RESPONSE_413 = () =>
  fakeResponse({ status: 413, body: "Request Entity Too Large", contentType: undefined });

const RESPONSE_OK = (reply = "Sure -- here's a tighter version of that bullet.") =>
  fakeResponse({ status: 200, body: JSON.stringify({ reply }), contentType: "application/json" });

function attachment(name, base64Chars) {
  return { name, kind: "binary", mimeType: "image/png", dataB64: "A".repeat(base64Chars), previewUrl: null };
}

// Mirrors a React render snapshot: state lives in `state`, and handlers are
// rebuilt from it on every call.
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
      // `in`, not `=== undefined`: a test that deliberately passes
      // `applicationStages: undefined` (m11) needs that exact value to reach
      // `createChatHandlers`, not get silently replaced by the default.
      applicationStages: "applicationStages" in initial ? initial.applicationStages : {},
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

describe("runChatRequest: the attachment tray after a send", () => {
  it("PAIRED POSITIVE CONTROL: a successful send fetches exactly once, with the binary intact, then clears the tray", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Looks good."));
    const { state, handlers } = makeHarness({
      input: "Does this bullet land?",
      attached: [attachment("bullet.png", 40)],
    });

    await handlers().sendChatMessage();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = sentBody();
    expect(body.attachedFiles).toHaveLength(1);
    expect(body.attachedFiles[0].name).toBe("bullet.png");
    expect(body.attachedFiles[0].dataB64).toBe("A".repeat(40));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toBe("Does this bullet land?");

    // The turn succeeded, so the files have been delivered -- the tray empties.
    expect(state.attached).toEqual([]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toEqual({ role: "assistant", content: "Looks good." });
    expect(state.error).toBe("");
  });

  it("ABSENCE: a FAILED send never destroys the user's attachment", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_413());
    const { state, handlers } = makeHarness({
      input: "Does this bullet land?",
      attached: [attachment("bullet.png", 40)],
    });

    await handlers().sendChatMessage();

    expect(state.attached).toHaveLength(1);
    expect(state.attached[0].name).toBe("bullet.png");
    expect(state.attached[0].dataB64).toBe("A".repeat(40));
  });
});

describe("runChatRequest: what the user reads when it fails", () => {
  it("a 413 never surfaces the SyntaxError, and does surface the remedy", async () => {
    const response = RESPONSE_413();
    globalThis.fetch = vi.fn(async () => response);
    const { state, handlers } = makeHarness({ input: "help me with this posting" });

    await handlers().sendChatMessage();

    // The body was read once, as text. `.json()` -- the line that produced
    // the reported error -- was never called.
    expect(response.json).toHaveBeenCalledTimes(0);
    expect(response.text).toHaveBeenCalledTimes(1);

    // ABSENCE: the reported string.
    expect(state.error).not.toMatch(/is not valid JSON/i);
    expect(state.error).not.toMatch(/Unexpected token/i);
    // PAIRED POSITIVE CONTROL: what it says instead.
    expect(state.error).toMatch(/too (big|large)/i);
    expect(state.error).toMatch(/4\.5\s*MB/i);
    expect(state.error).toMatch(/(remove|detach|fewer|smaller)/i);
  });

  it("a fetch that never returns says to check the connection", async () => {
    // Prior art: app/hooks/useScreenshots.js:159-171. A bare "Failed to
    // fetch" TypeError means no response arrived at all, so there is no
    // status to classify -- it needs its own branch.
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { state, handlers } = makeHarness({ input: "help me with this posting" });

    await handlers().sendChatMessage();

    expect(state.error).not.toMatch(/Failed to fetch/);
    expect(state.error).toMatch(/(connection|internet|offline)/i);
  });

  it("the route's own JSON error still reaches the user verbatim", async () => {
    globalThis.fetch = vi.fn(async () =>
      fakeResponse({
        status: 502,
        body: JSON.stringify({ error: "Empty response from Gemini." }),
        contentType: "application/json",
      }),
    );
    const { state, handlers } = makeHarness({ input: "help me with this posting" });

    await handlers().sendChatMessage();

    expect(state.error).toBe("Empty response from Gemini.");
  });
});

describe("runChatRequest: a retry must not grow the request", () => {
  it("marks the failed turn and re-uses its slot instead of appending a second one", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_413());
    const harness = makeHarness({ input: "review my resume for this role" });

    await harness.handlers().sendChatMessage();

    // The failed turn STAYS in the thread (Resend needs it) and is marked.
    expect(harness.state.messages).toHaveLength(1);
    expect(harness.state.messages[0].role).toBe("user");
    expect(harness.state.messages[0].content).toBe("review my resume for this role");
    expect(harness.state.messages[0].failed).toBe(true);

    // Now the user shortens the message and sends again; this time it works.
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Here you go."));
    harness.state.input = "review my resume";

    await harness.handlers().sendChatMessage();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // ABSENCE OF GROWTH: the transcript sent is ONE turn, not two. The failed
    // turn's slot was re-used, not appended to.
    const body = sentBody();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toBe("review my resume");

    // And the thread settles with no orphaned failed turn.
    expect(harness.state.messages).toHaveLength(2);
    expect(harness.state.messages[0].content).toBe("review my resume");
    expect(harness.state.messages[0].failed).toBeFalsy();
    expect(harness.state.messages[1]).toEqual({ role: "assistant", content: "Here you go." });
  });

  it("PAIRED POSITIVE CONTROL: a trailing UNFAILED user turn is never dropped", async () => {
    // The rule is "drop trailing FAILED turns", not "drop trailing USER
    // turns". A fixture ending in an assistant turn cannot tell those two
    // apart -- both leave the transcript alone -- so the fixture has to end in
    // an unfailed user turn, and that turn has to survive into the body.
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Second answer."));
    const { state, handlers } = makeHarness({
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "unanswered but sent" },
      ],
      input: "second question",
    });

    await handlers().sendChatMessage();

    const body = sentBody();
    expect(body.messages).toHaveLength(4);
    expect(body.messages.map((m) => m.content)).toEqual([
      "first question",
      "first answer",
      "unanswered but sent",
      "second question",
    ]);
    expect(state.messages).toHaveLength(5);
  });

  it("resendUserMessage's slice(0, index) is undisturbed by the failed-turn rule", async () => {
    // The resent turn is turn 0, MID-thread, while a failed turn sits at the
    // end. Resending the last (and only failed) turn would not test anything:
    // `slice(0, index)` and "drop trailing failed turns" produce the same
    // array there, so deleting the slice entirely would still pass. Here they
    // diverge -- the slice must cut everything after turn 0, including the two
    // healthy turns the failed-turn rule would keep.
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Retried answer."));
    const { state, handlers } = makeHarness({
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second question" },
        { role: "assistant", content: "second answer" },
        { role: "user", content: "third question", failed: true },
      ],
    });

    await handlers().resendUserMessage(0);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = sentBody();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toBe("first question");

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].content).toBe("first question");
    expect(state.messages[1]).toEqual({ role: "assistant", content: "Retried answer." });
  });
});

describe("runChatRequest: collateral the fix must not break", () => {
  it("keeps mimeType on every attachment in the request body", async () => {
    // Without it `route.js:251-259` cannot build the inline part and the model
    // never sees the file -- a PDF resume silently becomes invisible. The
    // success test above checks `name` and `dataB64`; this checks the field
    // that decides whether the attachment is readable at all.
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Read it."));
    const { handlers } = makeHarness({
      input: "what does this say?",
      attached: [
        { name: "resume.pdf", kind: "binary", mimeType: "application/pdf", dataB64: "AAAA" },
        { name: "shot.png", kind: "binary", mimeType: "image/png", dataB64: "BBBB" },
      ],
    });

    await handlers().sendChatMessage();

    const body = sentBody();
    expect(body.attachedFiles).toHaveLength(2);
    expect(body.attachedFiles[0].mimeType).toBe("application/pdf");
    expect(body.attachedFiles[1].mimeType).toBe("image/png");
  });

  it("clearing the tray on success does NOT also clear the pinned context", async () => {
    // The pinned posting is what the next question is about. Emptying it
    // alongside the tray would silently unpin the job the user is working on.
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Sure."));
    const pinned = { label: "Senior Engineer at Acme", content: "Job description...", sourceJobId: "j1" };
    const { state, spies, handlers } = makeHarness({
      input: "how do I match this?",
      attached: [attachment("shot.png", 40)],
      pinned,
    });

    await handlers().sendChatMessage();

    expect(state.attached).toEqual([]);
    expect(spies.setChatPinnedContext).not.toHaveBeenCalled();
    expect(state.pinned).toBe(pinned);
  });
});

describe("runChatRequest: M2 -- a file attached mid-flight survives a successful send", () => {
  it("does not destroy an attachment added while chatSending was true", async () => {
    // Nothing in ChatPanel disables the `+ File` button or the drop handler
    // while "Thinking…" is showing, so a user can attach a NEW file after
    // the request has already gone out. A wholesale `setChatAttachedFiles([])`
    // on success would silently delete it.
    let resolveFetch;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const sentImage = attachment("bullet.png", 40);
    const { state, handlers } = makeHarness({ input: "review this", attached: [sentImage] });

    const pending = handlers().sendChatMessage();
    // Mirrors addChatAttachments' own `setChatAttachedFiles((prev) => [...prev, ...accepted])`.
    const midFlightImage = attachment("mid-flight.png", 20);
    state.attached = [...state.attached, midFlightImage];

    resolveFetch(RESPONSE_OK("Looks good."));
    await pending;

    // The file that was actually sent is gone; the one attached mid-flight
    // (never sent, so the assistant never saw it) is still in the tray.
    expect(state.attached).toHaveLength(1);
    expect(state.attached[0].name).toBe("mid-flight.png");
  });

  it("PAIRED POSITIVE CONTROL: no mid-flight attach still clears the tray exactly as before", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Looks good."));
    const { state, handlers } = makeHarness({ input: "review this", attached: [attachment("bullet.png", 40)] });

    await handlers().sendChatMessage();

    expect(state.attached).toEqual([]);
  });
});

describe("runChatRequest: M6 -- preview blob URLs are revoked, not just dropped", () => {
  let originalRevoke;
  beforeEach(() => {
    // Node has no `URL.revokeObjectURL` -- stub one so the calls are
    // observable. `revokeAttachmentPreview`'s own `typeof` guard (chatbot.js)
    // is what keeps this safe to omit in a real node test environment; here
    // we supply it deliberately so the CALL itself can be pinned.
    originalRevoke = globalThis.URL.revokeObjectURL;
    globalThis.URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    if (originalRevoke) globalThis.URL.revokeObjectURL = originalRevoke;
    else delete globalThis.URL.revokeObjectURL;
  });

  it("revokes the preview URL of every attachment cleared on a successful send", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Looks good."));
    const sentImage = { name: "bullet.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA", previewUrl: "blob:sent-1" };
    const { state, handlers } = makeHarness({ input: "review this", attached: [sentImage] });

    await handlers().sendChatMessage();

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:sent-1");
    expect(state.attached).toEqual([]);
  });

  it("M2 + M6 together: a mid-flight attachment's preview URL is left un-revoked", async () => {
    let resolveFetch;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const sentImage = { name: "bullet.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA", previewUrl: "blob:sent-1" };
    const midFlightImage = { name: "mid-flight.png", kind: "binary", mimeType: "image/png", dataB64: "BBBB", previewUrl: "blob:mid-flight-1" };
    const { state, handlers } = makeHarness({ input: "review this", attached: [sentImage] });

    const pending = handlers().sendChatMessage();
    state.attached = [...state.attached, midFlightImage];
    resolveFetch(RESPONSE_OK("Looks good."));
    await pending;

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:sent-1");
    expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:mid-flight-1");
    expect(state.attached).toEqual([midFlightImage]);
  });

  it("a FAILED send never revokes anything -- the tray (and its previews) survive intact", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_413());
    const sentImage = { name: "bullet.png", kind: "binary", mimeType: "image/png", dataB64: "AAAA", previewUrl: "blob:sent-1" };
    const { state, handlers } = makeHarness({ input: "review this", attached: [sentImage] });

    await handlers().sendChatMessage();

    expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(state.attached).toHaveLength(1);
  });
});

describe("runChatRequest: M4 -- measuring the request body before sending", () => {
  // A realistic "lots of saved application history" application: full job
  // description and tailored resume, unbounded, exactly what
  // `applicationsContext` (chatbot.js) serializes for EVERY tracked
  // application on EVERY send.
  function heavyApplication(i) {
    return {
      id: `app-${i}`,
      positions: { company: `Company ${i}`, title: `Role ${i}`, description: "d".repeat(20_000) },
      generated_resumes: { content: "r".repeat(20_000) },
      status: "applied",
      applied_at: "2024-01-01",
    };
  }

  it("zero attachments, huge application history: refuses BEFORE fetch, names the real cause", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("should never be reached"));
    // 200 applications * ~40,000 chars each is comfortably over the 4.5 MB cap.
    const applicationData = Array.from({ length: 200 }, (_, i) => heavyApplication(i));
    const { state, handlers } = makeHarness({ input: "how am I doing overall?", applicationData });

    await handlers().sendChatMessage();

    // MEASURED, not trimmed: no attachments existed to remove, and no
    // application was silently dropped to make the request fit -- the send
    // is refused up front instead.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(state.error).not.toMatch(/remove an attachment/i);
    expect(state.error).toMatch(/application/i);
    expect(state.error).toMatch(/(company|role|specific)/i);
    expect(state.error).toMatch(/too (big|large)/i);
  });

  it("WITH attachments, huge application history: the remedy still mentions removing an attachment", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("should never be reached"));
    const applicationData = Array.from({ length: 200 }, (_, i) => heavyApplication(i));
    const { state, handlers } = makeHarness({
      input: "how am I doing overall?",
      applicationData,
      attached: [attachment("bullet.png", 40)],
    });

    await handlers().sendChatMessage();

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(state.error).toMatch(/(remove|detach|fewer|smaller)/i);
    expect(state.error).toMatch(/attach/i);
  });

  it("PAIRED POSITIVE CONTROL: a normal-sized request with modest application history still sends", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Here's how you're doing."));
    const applicationData = Array.from({ length: 3 }, (_, i) => heavyApplication(i));
    const { state, handlers } = makeHarness({ input: "how am I doing overall?", applicationData });

    await handlers().sendChatMessage();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = sentBody();
    // Not trimmed: every application's full text is still in the body.
    expect(body.applications).toHaveLength(3);
    expect(body.applications[0].jobDescription).toBe("d".repeat(20_000));
    expect(body.applications[0].tailoredResume).toBe("r".repeat(20_000));
    expect(state.error).toBe("");
  });
});

describe("runChatRequest: m2 (minor) -- em dash, not ASCII double-hyphen, in user-facing copy", () => {
  it("the network-unreachable message uses a real em dash", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { state, handlers } = makeHarness({ input: "help me with this posting" });

    await handlers().sendChatMessage();

    expect(state.error).toContain("—");
    expect(state.error).not.toContain("--");
  });
});

describe("runChatRequest: m11 -- a missing applicationStages map does not crash the send", () => {
  it("sends successfully even when applicationStages is undefined", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Here you go."));
    const { state, handlers } = makeHarness({
      input: "how is this application going?",
      applicationData: [
        { id: "app-1", positions: { company: "Acme", title: "Engineer" }, status: "applied" },
      ],
      applicationStages: undefined,
    });

    await handlers().sendChatMessage();

    // No raw TypeError leaking into the chat as a "failed" turn.
    expect(state.error).toBe("");
    expect(state.messages[state.messages.length - 1]).toEqual({ role: "assistant", content: "Here you go." });
  });
});
