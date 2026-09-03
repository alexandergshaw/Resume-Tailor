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
import { createChatHandlers, MAX_REQUEST_BYTES } from "./chatbot.js";
import { localChatReply } from "./localAssistant.js";

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
    // Without it `route.js:213-223` cannot build the inline part and the model
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

  // A user with a very long tracked history whose applications carry no saved
  // documents -- the shape that still crosses the cap once the per-application
  // document text is bounded. Only the first 25 carry documents: past the
  // rendered slice the bound nulls them anyway, so 30,000 rows of 40,000
  // characters each would allocate ~2.4 GB to serialize bytes that are
  // identical either way.
  function bareApplication(i) {
    return {
      id: `app-${i}`,
      positions: { company: `Company ${i}`, title: `Role ${i}` },
      status: "applied",
      applied_at: "2024-01-01",
    };
  }
  function bulkApplications(n) {
    return Array.from({ length: n }, (_, i) => (i < 25 ? heavyApplication(i) : bareApplication(i)));
  }

  it("zero attachments, huge application history: refuses BEFORE fetch, names the real cause", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("should never be reached"));
    // 30,000 tracked applications. Past the first 25 each one costs ~170 bytes
    // on the wire whether or not it carries documents, so the assembled body is
    // ~5.17 MB -- 15% clear of the 4.5 MB cap, not sitting on a knife edge.
    // (The cap is crossed at ~26,086 for this shape.)
    //
    // Say plainly what this fixture is: 30,000 applications is NOT a
    // job-seeker. It is the smallest fixture that still exercises the
    // measure-don't-trim gate once the document text is bounded. The gate's
    // coverage survives; its domain plausibility does not.
    const applicationData = bulkApplications(30_000);
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
    const applicationData = bulkApplications(30_000);
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
    // BOUNDED, not trimmed. Every application is still on the wire -- none is
    // dropped, none is reordered -- but the two fields no consumer reads in
    // full are cut to MAX_JD_CHARS + 1 / MAX_TAILORED_CHARS + 1 characters.
    //
    // The "+ 1" is the whole trick and is not an off-by-one: route.js's
    // `truncate` appends "…" only when `value.length > max`, so a client that
    // pre-sliced to exactly 1500 would produce a rendered block one character
    // short AND missing its ellipsis. See lib/chat/applicationContext.test.js
    // for that boundary proved directly.
    expect(body.applications).toHaveLength(3);
    expect(body.applications[0].jobDescription).toBe("d".repeat(1501));
    expect(body.applications[0].tailoredResume).toBe("r".repeat(2001));
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

// ---------------------------------------------------------------------------
// The user this whole change exists for: months of tracked applications, and
// every message refused -- including "hi".
//
// These run at the `runChatRequest` layer on purpose.
// lib/chat/applicationContext.test.js proves the projection is lossless;
// nothing there proves `runChatRequest` actually applies it, or that a bounded
// body then gets sent.
// ---------------------------------------------------------------------------

// Multibyte on purpose. `"d".repeat(40_000)` has a UTF-8 byte length equal to
// its `.length`, so a byte-based bound and a code-unit one are
// indistinguishable against it -- while on a realistic accented posting a byte
// bound silently drops hundreds of characters and the trailing ellipsis. A
// resume tool sees accents, em dashes and bullets constantly.
const ACCENTED_JD_LINE = "Résumé — led “growth” • €1.2M ARR · naïve café über Zurück ";
const ACCENTED_RESUME_LINE = "Alex Shaw — Ingénieur données · piloté 4 équipes • €4M ARR ↑ naïve→robuste ";

function multibyte(n, line) {
  let out = "";
  while (out.length < n) out += line;
  return out.slice(0, n);
}

function utf8Length(value) {
  return new TextEncoder().encode(value).length;
}

// One shared instance of each document string, referenced by every fixture
// application: 5,000 applications then cost 5,000 pointers, not 52 million
// characters, and only the serialization is large.
function documentedApplication(i, description, content) {
  return {
    id: `app-${String(i).padStart(4, "0")}`,
    positions: {
      company: `Company ${String(i).padStart(4, "0")}`,
      title: `Rôle ${String(i).padStart(4, "0")}`,
      description,
      url: null,
    },
    generated_resumes: { content },
    status: "applied",
    applied_at: "2024-01-01",
  };
}

// The PRE-FIX wire shape, reproduced from chatbot.js's own map. AC-1 says "the
// pre-fix code refuses this fixture", which has no expression in a post-fix
// tree -- so the negative control is kept alive by measuring the unprojected
// body for the SAME fixture. Without it, AC-2's "it sends" is satisfied by a
// fixture that was never broken in the first place, and the pair loses all its
// discriminating power. This is a re-expression of AC-1, not AC-1 itself.
//
// UNPINNED HAND-COPY, and why that is safe here rather than a latent trap.
// Nothing ties this function to `chatbot.js`'s real map, and it already
// differs from it in one visible way: it hard-codes `stages: []` instead of
// mapping `applicationStages?.[app.id] || []`. That divergence is inert for
// every fixture below -- they are all built by `documentedApplication`, which
// carries no stages, and `makeHarness` defaults `applicationStages` to `{}`,
// so the REAL map also produces `stages: []` for them. The copy is byte-equal
// to the real map on this input.
//
// More importantly the drift is one-way safe by construction: every assertion
// using this function is `expect(bytes).toBeGreaterThan(MAX_REQUEST_BYTES)`
// (or a ratio against it). Omitting a field can only make the pre-fix body
// SMALLER, so any future drift makes the control HARDER to satisfy, never
// falsely green. A copy that over-counted would be the dangerous direction --
// so if you edit this, only ever DROP fields from `chatbot.js`'s map, never
// add ones it does not produce, and never make this function read a field the
// real map bounds.
function unprojectedApplications(applicationData) {
  return (applicationData || []).map((app) => {
    const pos = app.positions || {};
    const resume = app.generated_resumes;
    return {
      company: pos.company || null,
      role: pos.title || null,
      status: app.status || null,
      appliedAt: app.applied_at || null,
      applicationUrl: app.application_url || pos.url || null,
      jobDescription: pos.description || null,
      tailoredResume: resume?.content || null,
      stages: [],
    };
  });
}

describe("runChatRequest: AC-1..AC-4 -- the blocked user sends again", () => {
  const HUGE_JD = multibyte(40_000, ACCENTED_JD_LINE);
  const HUGE_RESUME = multibyte(20_000, ACCENTED_RESUME_LINE);
  const buildFixture = () =>
    Array.from({ length: 75 }, (_, i) => documentedApplication(i, HUGE_JD, HUGE_RESUME));

  it("[AC-1] NEGATIVE CONTROL: the same fixture, serialized the pre-fix way, is over the platform cap", () => {
    const bytes = utf8Length(JSON.stringify(unprojectedApplications(buildFixture())));
    expect(bytes).toBeGreaterThan(MAX_REQUEST_BYTES);
    // And the fixture really is multibyte, or the bound asserted below could
    // be a byte bound and every assertion here would still pass.
    expect(utf8Length(HUGE_JD)).toBeGreaterThan(HUGE_JD.length);
    expect(utf8Length(HUGE_RESUME)).toBeGreaterThan(HUGE_RESUME.length);
  });

  it("[AC-2/3/4] 75 documented applications, no attachments: it sends, answers, and reports no error", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("You're interviewing at three of them."));
    const { state, handlers } = makeHarness({ input: "hi", applicationData: buildFixture() });

    await handlers().sendChatMessage();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(state.messages[state.messages.length - 1]).toEqual({
      role: "assistant",
      content: "You're interviewing at three of them.",
    });
    expect(state.error).toBe("");
  });

  it("[AC-6/AC-8] the bound on the wire is CODE UNITS, ellipsis-preserving, and drops no application", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("ok"));
    const { handlers } = makeHarness({ input: "how am I doing?", applicationData: buildFixture() });

    await handlers().sendChatMessage();

    const body = sentBody();
    // No application is dropped -- that is the difference between a bound and
    // a trim, and it is what keeps "how many applications do I have?" honest.
    expect(body.applications).toHaveLength(75);
    expect(body.applications[0].jobDescription).toBe(HUGE_JD.slice(0, 1501));
    expect(body.applications[0].jobDescription).toHaveLength(1501);
    expect(body.applications[0].tailoredResume).toBe(HUGE_RESUME.slice(0, 2001));
    // A byte-based bound would have kept ~1,300 characters here instead.
    expect(utf8Length(body.applications[0].jobDescription)).toBeGreaterThan(1501);
    // Past the rendered slice the documents are gone entirely...
    expect(body.applications[74].jobDescription).toBe(null);
    // ...but the application, and everything the offline assistant reads about
    // it, is still there.
    expect(body.applications[74].company).toBe("Company 0074");
    expect(body.applications[74].role).toBe("Rôle 0074");
    expect(body.applications[74].status).toBe("applied");
    expect(body.applications[74].appliedAt).toBe("2024-01-01");
  });
});

describe("runChatRequest: AC-15 -- five thousand documented applications", () => {
  it("is refused in its pre-fix shape, sends comfortably after the bound, and still counts 5,000", async () => {
    const jd = multibyte(4_500, ACCENTED_JD_LINE);
    const resume = multibyte(6_000, ACCENTED_RESUME_LINE);
    const applicationData = Array.from({ length: 5_000 }, (_, i) => documentedApplication(i, jd, resume));

    // Pre-fix shape: far over the cap.
    const preFixBytes = utf8Length(JSON.stringify(unprojectedApplications(applicationData)));
    expect(preFixBytes).toBeGreaterThan(MAX_REQUEST_BYTES);

    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Here's the pipeline."));
    const { state, handlers } = makeHarness({ input: "how am I doing overall?", applicationData });

    await handlers().sendChatMessage();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(state.error).toBe("");
    // AC-15 quotes "under 1,000,000 bytes", and that literal is NOT asserted
    // here: it is fixture-specific and, with these labels, the bounded body
    // measures just over it. What the design actually buys is a RATIO -- the
    // document text stops scaling with history -- so that is what is pinned,
    // along with the only threshold that is really the product's: the cap.
    const postFixBytes = utf8Length(globalThis.fetch.mock.calls[0][1].body);
    expect(postFixBytes).toBeLessThan(MAX_REQUEST_BYTES);
    expect(postFixBytes * 20).toBeLessThan(preFixBytes);

    // PAIRED POSITIVE CONTROL, and the point of the whole design: the offline
    // assistant, reading the bounded body, still knows about all 5,000. A
    // bound that shrank the payload by dropping applications would answer
    // "25" here -- trust-destroying in a tracking product.
    const reply = localChatReply({
      messages: [{ role: "user", content: "how many applications do I have?" }],
      applications: sentBody().applications,
    });
    expect(reply).toContain("You're tracking 5000 applications");
  });
});

describe("runChatRequest: AC-16 -- the document cost stops growing past the rendered slice", () => {
  // Every application carries the SAME document text and, note, FIXED-WIDTH
  // company/role strings. That padding is what makes the identity below exact
  // rather than approximate: with AC-16's own `Company ${i}` labels the
  // per-application cost grows with the decimal width of the index, so
  // `body(200) - body(60) === 140 x cost` is arithmetically FALSE and the
  // criterion as literally written cannot be asserted. The property it is
  // reaching for -- the heavy fields stop contributing past the rendered
  // slice -- is what is pinned here.
  const jd = multibyte(3_000, ACCENTED_JD_LINE);
  const resume = multibyte(3_000, ACCENTED_RESUME_LINE);

  async function bodyLengthFor(n) {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("ok"));
    const applicationData = Array.from({ length: n }, (_, i) => documentedApplication(i, jd, resume));
    const { handlers } = makeHarness({ input: "how am I doing overall?", applicationData });
    await handlers().sendChatMessage();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    return globalThis.fetch.mock.calls[0][1].body.length;
  }

  it("body(200) - body(60) equals 140 times the cost of ONE document-free application", async () => {
    const at60 = await bodyLengthFor(60);
    const at61 = await bodyLengthFor(61);
    const at200 = await bodyLengthFor(200);

    const costOfOnePastTheSlice = at61 - at60;
    expect(at200 - at60).toBe(140 * costOfOnePastTheSlice);
    // PAIRED POSITIVE CONTROL: that per-application cost is the cost of a
    // record with NO document text -- a couple of hundred characters, not the
    // ~6,000 this fixture's documents occupy. Without it the identity above is
    // also satisfied by a body that grew linearly in the documents.
    expect(costOfOnePastTheSlice).toBeLessThan(500);
    expect(costOfOnePastTheSlice).toBeGreaterThan(50);
  });
});

describe("runChatRequest: AC-19, AC-22, AC-23 -- the ordinary states still work", () => {
  it("[AC-19] zero tracked applications put an empty array on the wire", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Sure."));
    const { handlers } = makeHarness({ input: "hi", applicationData: [] });

    await handlers().sendChatMessage();

    expect(sentBody().applications).toEqual([]);
  });

  it("[AC-22] three applications: one fetch, all three on the wire, in order", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Sure."));
    const jd = multibyte(120, ACCENTED_JD_LINE);
    const applicationData = Array.from({ length: 3 }, (_, i) => documentedApplication(i, jd, "short resume"));
    const { handlers } = makeHarness({ input: "how am I doing?", applicationData });

    await handlers().sendChatMessage();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = sentBody();
    expect(body.applications.map((a) => a.company)).toEqual(["Company 0000", "Company 0001", "Company 0002"]);
    // Under the cap, so nothing is cut at all: identity, not truncation.
    expect(body.applications[0].jobDescription).toBe(jd);
    expect(body.applications[0].tailoredResume).toBe("short resume");
  });

  it("[AC-23] attachments still arrive with name, mimeType and dataB64 intact alongside a long history", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("Sure."));
    const jd = multibyte(4_000, ACCENTED_JD_LINE);
    const applicationData = Array.from({ length: 40 }, (_, i) => documentedApplication(i, jd, "resume"));
    const { handlers } = makeHarness({
      input: "does this bullet land?",
      applicationData,
      attached: [attachment("bullet.png", 40)],
    });

    await handlers().sendChatMessage();

    const body = sentBody();
    expect(body.attachedFiles).toEqual([
      { name: "bullet.png", mimeType: "image/png", dataB64: "A".repeat(40) },
    ]);
    expect(body.applications).toHaveLength(40);
  });
});
