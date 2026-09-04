// Node environment (the repo default): nothing here touches the DOM. The
// jsdom half of chunk A2 -- the live region, the always-mounted `chatError`
// node, and the "was the composer ENABLED when focus() ran" check -- lives in
// app/components/ChatPanel.gaps.test.js, because only a real element can
// answer those.
//
// WHAT THIS FILE IS FOR (chunk A2, "the refusal experience"). BEFORE A2 a
// size-refused send produced ONE of two constants, chosen by whether the tray
// was empty -- the pre-`fetch` size gate in `runChatRequest` and
// `readChatResponse`'s `status === 413` branch, both in `lib/chat/chatbot.js`.
// (Those two SITES are still the two emitters; only the constants changed.)
// Both of the old ones named a
// control ("Remove an attachment", "Try asking about one specific company or
// role") that is either absent from the panel or provably unable to shrink the
// body, and the only affordance the panel then offers is Resend, which rebuilds
// a byte-identical body. A2 replaces the two constants with a set selected by
// the MEASURED largest body section, restores the user's text, and moves focus
// back to the composer.
//
// NAMESPACE IMPORT, deliberately (same reason chatbot.response.test.js:49-53
// gives): every export this file asserts on is one A2 must ADD. A named import
// of a missing export can fail at module-link time, which would make the whole
// file fail for the wrong reason -- a broken import rather than absent
// behaviour. Through the namespace a missing export is plainly `undefined` and
// each assertion fails on its own terms.
//
// HOW THE FIXTURES ARE SIZED (measured, not guessed -- run against
// lib/chat/chatbot.js at 712 lines, MAX_REQUEST_BYTES 4,500,000). Each helper
// below drives exactly one wire section, and the serialized cost of that
// section is the helper's `n` plus a fixed, tiny scaffolding constant:
//
//     attachedFiles   n + 57      pinnedContext  n + 42
//     messages        n + 82      resumeText     n +  2
//     applications    60 rows x n + ~9,231
//
// so a single helper at 4.7 MB is the largest section by three orders of
// magnitude, and there is no ambiguity about which one A2 must name. Measured
// end to end by reading the body off a stubbed `fetch` for a scaled-down
// (under-cap) variant of every fixture here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as chatbot from "./chatbot.js";

const CAP = chatbot.MAX_REQUEST_BYTES;

let savedFetch;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  callOrder.length = 0;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  // This repo's vitest config sets neither `clearMocks` nor `restoreMocks`,
  // and `restoreAllMocks` does not reset a bare `vi.fn()`. Every spy in this
  // file is created fresh per harness, and the one shared piece of mutable
  // state (`callOrder`) is emptied in `beforeEach` above rather than relied on
  // to be empty.
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// One shared, ordered log of the events AC-31a and AC-35 are about. It records
// ORDER, which is the whole point: a spy that merely fired proves nothing about
// whether the composer was usable at the moment it fired.
const callOrder = [];

function fakeResponse({ status, body }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: vi.fn(async () => body),
    json: vi.fn(async () => JSON.parse(body)),
  };
}
const RESPONSE_413 = () => fakeResponse({ status: 413, body: "Request Entity Too Large" });
const RESPONSE_OK = (reply = "ok") =>
  fakeResponse({ status: 200, body: JSON.stringify({ reply }) });

// Mirrors a React render snapshot, exactly as chatbot.request.test.js:118-138
// does -- state lives in `state`, handlers are rebuilt from it on every call.
// TWO differences from that file, both required by A2:
//
//   1. `chatInputRef.current` is a COMPOSER DOUBLE, not `null`
//      (chatbot.request.test.js:112). A2's focus restore reads it.
//   2. `setChatSending`, `setChatError` and `focus` all push onto `callOrder`.
function makeHarness(initial = {}) {
  const state = {
    messages: initial.messages || [],
    attached: initial.attached || [],
    input: initial.input || "",
    pinned: initial.pinned === undefined ? null : initial.pinned,
    error: "",
    sending: false,
  };
  const composer = {
    value: initial.liveComposerValue === undefined ? "" : initial.liveComposerValue,
    disabled: false,
    focus: vi.fn(() => { callOrder.push("focus"); }),
    setSelectionRange: vi.fn(),
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
      callOrder.push(state.error ? "setChatError(text)" : "setChatError('')");
    }),
    setChatInput: vi.fn((next) => {
      state.input = typeof next === "function" ? next(state.input) : next;
    }),
    setChatSending: vi.fn((next) => {
      state.sending = typeof next === "function" ? next(state.sending) : next;
      callOrder.push(`setChatSending(${state.sending})`);
    }),
    setChatPinnedContext: vi.fn((next) => {
      state.pinned = typeof next === "function" ? next(state.pinned) : next;
    }),
  };
  function handlers() {
    return chatbot.createChatHandlers({
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
      chatInputRef: { current: composer },
      resumeFile: initial.resumeFile === undefined ? null : initial.resumeFile,
      applicationData: initial.applicationData || [],
      applicationStages: {},
      mainTab: "jobs",
      // Overridable (default unchanged) so §3.2's "the measured object is the
      // object that was serialized" can be separated from "the sum of the five
      // sections": `section` is a real body field that belongs to NO section,
      // so it is the only lever that moves `bodyBytes` without moving the
      // section sum. See the AC-52 case that uses it.
      activeSection: initial.activeSection === undefined ? null : initial.activeSection,
      isDocxResume: () => false,
      isTextResume: () => false,
      buildTemplateLinesForUpload: initial.buildTemplateLinesForUpload || (async () => []),
    });
  }
  return { state, spies, composer, handlers };
}

// One helper per wire section. Each drives that section and nothing else.
const bigAttachment = (n) => ({
  name: "scan.png", kind: "binary", mimeType: "image/png",
  dataB64: "A".repeat(n), previewUrl: null,
});
const smallAttachment = () => ({
  name: "bullet.png", kind: "binary", mimeType: "image/png",
  dataB64: "A".repeat(40), previewUrl: null,
});
const bigPinned = (n) => ({ label: "Senior PM at Acme", content: "c".repeat(n) });
const bigThread = (n) => [{ role: "assistant", content: "t".repeat(n) }];
// SCOPE NOTE, so nobody reads these as covering more than they do. This stub
// resolves as a MICROTASK. In a real browser `buildTemplateLinesForUpload`
// reads a Blob and yields to the MACROTASK queue, and only a macrotask forces
// React to commit the `chatSending` render -- which is what makes the
// résumé-present fixture the one where the composer is rendered disabled and
// focus is lost. NONE OF THAT EXISTS HERE: this file has no React and no DOM,
// so `resumeFile` set means only "the `resumeText` branch of `runChatRequest`
// runs and that section can dominate". The render-level classification, and
// the disabled-at-focus-time check that depends on it, are asserted in
// app/components/ChatPanel.gaps.test.js against a real `File`. Do not
// "upgrade" this to a macrotask: the focus describe below runs on fake timers,
// where a `setTimeout`-based stub would never resolve.
const bigResume = (n) => ({
  resumeFile: { name: "resume.docx" },
  buildTemplateLinesForUpload: async () => ["r".repeat(n)],
});
// `company` is the one per-application field projectApplicationsForRequest
// never bounds (lib/chat/applicationContext.js:366), so 60 rows is enough to
// dominate -- no 30,000-row allocation needed.
const bigApplications = (rows, nameLen) =>
  Array.from({ length: rows }, (_, i) => ({
    id: `app-${i}`,
    positions: { company: "C".repeat(nameLen), title: `Role ${i}` },
    status: "applied",
    applied_at: "2024-01-01",
  }));

const QUESTION = "please review this";

// Drive one refusal end to end through the REAL handler chain and hand back
// what the user would read.
async function refuse(initial) {
  globalThis.fetch = vi.fn(async () => RESPONSE_OK("should never be reached"));
  const h = makeHarness({ input: QUESTION, ...initial });
  await h.handlers().sendChatMessage();
  return h;
}

// The five over-cap fixtures, one per section. Named so a failure message says
// which section was meant to dominate.
const DOMINANT = {
  attachedFiles: () => ({ attached: [bigAttachment(4_700_000)] }),
  pinnedContext: () => ({ pinned: bigPinned(4_700_000) }),
  messages: () => ({ messages: bigThread(4_700_000) }),
  resumeText: () => bigResume(4_700_000),
  applications: () => ({ applicationData: bigApplications(60, 80_000) }),
};

function constantFor(section) {
  return {
    attachedFiles: chatbot.TOO_BIG_ATTACHMENTS_MESSAGE,
    pinnedContext: chatbot.TOO_BIG_PINNED_CONTEXT_MESSAGE,
    messages: chatbot.TOO_BIG_TRANSCRIPT_MESSAGE,
    resumeText: chatbot.TOO_BIG_RESUME_MESSAGE,
    applications: chatbot.TOO_BIG_APPLICATIONS_MESSAGE,
  }[section];
}

// `expect(str).not.toContain(undefined)` PASSES VACUOUSLY -- it is green while
// the export it names does not exist, which is the "absence satisfied by a dead
// feature" trap in its purest form. Every negative-containment assertion in
// this file goes through here first.
function definedSegment(value, name) {
  expect(typeof value, `${name} must exist before an absence assertion about it means anything`)
    .toBe("string");
  return value;
}

function everySegment() {
  return [
    chatbot.TOO_BIG_ATTACHMENTS_MESSAGE,
    chatbot.TOO_BIG_PINNED_CONTEXT_MESSAGE,
    chatbot.TOO_BIG_TRANSCRIPT_MESSAGE,
    chatbot.TOO_BIG_RESUME_MESSAGE,
    chatbot.TOO_BIG_APPLICATIONS_MESSAGE,
    chatbot.TOO_BIG_ATTACHMENT_SECONDARY,
  ];
}

// ---------------------------------------------------------------------------
// AC-24 -- the vocabulary is a set of EXPORTED segments
// ---------------------------------------------------------------------------

describe("AC-24: the refusal is a composition of exported segments", () => {
  it("exports one primary constant per body section, plus the secondary and the AC-52 template", () => {
    for (const [name, value] of Object.entries({
      TOO_BIG_ATTACHMENTS_MESSAGE: chatbot.TOO_BIG_ATTACHMENTS_MESSAGE,
      TOO_BIG_PINNED_CONTEXT_MESSAGE: chatbot.TOO_BIG_PINNED_CONTEXT_MESSAGE,
      TOO_BIG_TRANSCRIPT_MESSAGE: chatbot.TOO_BIG_TRANSCRIPT_MESSAGE,
      TOO_BIG_RESUME_MESSAGE: chatbot.TOO_BIG_RESUME_MESSAGE,
      TOO_BIG_APPLICATIONS_MESSAGE: chatbot.TOO_BIG_APPLICATIONS_MESSAGE,
      TOO_BIG_ATTACHMENT_SECONDARY: chatbot.TOO_BIG_ATTACHMENT_SECONDARY,
    })) {
      expect(typeof value, `${name} must be an exported string`).toBe("string");
      expect(value.length, `${name} must not be empty`).toBeGreaterThan(0);
    }
    // AC-52's is a TEMPLATE over one numeric slot, not a bare string -- that
    // is what keeps it identity-checkable as `template(measuredValue)`.
    expect(typeof chatbot.TOO_BIG_MULTIPLE_MESSAGE).toBe("function");
    expect(typeof chatbot.TOO_BIG_MULTIPLE_MESSAGE("6.8")).toBe("string");
  });

  it("the five primaries are all DISTINCT -- a set, not one string wearing five names", () => {
    const primaries = everySegment().slice(0, 5);
    expect(new Set(primaries).size).toBe(5);
  });

  it("BODY_SECTION_ORDER names five keys that really exist on the wire body", async () => {
    expect(Array.isArray(chatbot.BODY_SECTION_ORDER)).toBe(true);
    expect(chatbot.BODY_SECTION_ORDER).toHaveLength(5);
    expect(new Set(chatbot.BODY_SECTION_ORDER).size).toBe(5);

    // POSITIVE CONTROL, and the thing that makes the list non-arbitrary: send
    // a request that actually succeeds and confirm every declared section key
    // is a key of the body `runChatRequest` serialized. A renamed or invented
    // section key goes red here rather than silently measuring `undefined`.
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("fine"));
    const h = makeHarness({ input: QUESTION, attached: [smallAttachment()], pinned: bigPinned(10) });
    await h.handlers().sendChatMessage();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    for (const key of chatbot.BODY_SECTION_ORDER) {
      expect(Object.prototype.hasOwnProperty.call(body, key), `wire body has no "${key}"`).toBe(true);
    }
  });

  it("BODY_SECTION_ORDER's ARRANGEMENT is pinned, not just its membership", () => {
    // The tie-break case below is written against `BODY_SECTION_ORDER`'s
    // POSITIONS (`const [first, second, third] = ...`), which is the right way
    // to pin the order's ROLE -- but it means the array's actual contents are
    // pinned by nothing except membership and length, and REVERSING the
    // exported constant changes no test. That is not a cosmetic gap: this
    // array is what decides, on a tie, WHICH CONTROL a job-seeker is told to
    // reach for.
    expect(chatbot.BODY_SECTION_ORDER).toEqual([
      "attachedFiles",
      "pinnedContext",
      "messages",
      "resumeText",
      "applications",
    ]);

    // ...and the PROPERTY that makes that particular arrangement the right
    // one, stated independently of the literal above so the rationale is
    // checkable rather than merely asserted: the three states that name an
    // in-panel remedy (AC-27) must all sort BEFORE the two that name none
    // (AC-28). Reverse the array and a tie between, say, an attachment and the
    // résumé would tell the user "nothing in this panel can shrink it" while a
    // chip ✕ sitting in front of them would have fixed it.
    const order = chatbot.BODY_SECTION_ORDER;
    const actionable = ["attachedFiles", "pinnedContext", "messages"];
    const deadEnd = ["resumeText", "applications"];
    for (const key of [...actionable, ...deadEnd]) {
      expect(order, `BODY_SECTION_ORDER is missing ${key}`).toContain(key);
    }
    const lastActionable = Math.max(...actionable.map((k) => order.indexOf(k)));
    const firstDeadEnd = Math.min(...deadEnd.map((k) => order.indexOf(k)));
    expect(
      lastActionable,
      "a state with no in-panel remedy sorts ahead of one that has a remedy",
    ).toBeLessThan(firstDeadEnd);
  });

  it("REFUSAL_MESSAGES maps exactly BODY_SECTION_ORDER's keys to the exported primaries", () => {
    expect(chatbot.REFUSAL_MESSAGES).toBeTruthy();
    expect(Object.keys(chatbot.REFUSAL_MESSAGES).sort())
      .toEqual([...chatbot.BODY_SECTION_ORDER].sort());
    for (const key of chatbot.BODY_SECTION_ORDER) {
      expect(chatbot.REFUSAL_MESSAGES[key], `REFUSAL_MESSAGES.${key}`).toBe(constantFor(key));
    }
  });
});

// ---------------------------------------------------------------------------
// AC-25 -- identity: the primary IS the constant mapped to the largest section
// ---------------------------------------------------------------------------

describe("AC-25: the primary segment is the constant mapped to the MEASURED largest section", () => {
  // MUTATION PROOF: swap any two entries of REFUSAL_MESSAGES and exactly one
  // of these five goes red. There is no regex here to absorb the swap.
  for (const section of ["pinnedContext", "messages", "resumeText", "applications"]) {
    it(`${section} dominant, empty tray -> the message IS the ${section} constant, verbatim`, async () => {
      const h = await refuse(DOMINANT[section]());
      expect(globalThis.fetch).not.toHaveBeenCalled();          // AC-18
      expect(h.state.error).toBe(constantFor(section));
    });
  }

  it("attachedFiles dominant -> the message IS the attachments constant, with no secondary", async () => {
    const h = await refuse(DOMINANT.attachedFiles());
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // The attachments state never receives AC-29's secondary: it already says
    // "remove an attachment" once, and appending would say it twice.
    expect(h.state.error).toBe(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// measureBodySections / largestBodyContributor -- the selection primitives
// ---------------------------------------------------------------------------

describe("measureBodySections: serialized bytes per section, absent sections cost nothing", () => {
  const enc = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

  it("measures the SERIALIZED form of each section, because that is what costs wire bytes", () => {
    const payload = {
      messages: [{ role: "user", content: "héllo — em dash" }],
      resumeText: "r".repeat(1000),
      applications: [{ company: "Acme", role: "PM" }],
      pinnedContext: { label: "L", content: "c".repeat(50) },
      attachedFiles: [{ name: "a.png", mimeType: "image/png", dataB64: "AAAA" }],
      tab: "jobs",
      section: null,
      engine: "gemini",
    };
    const sizes = chatbot.measureBodySections(payload);
    expect(Object.keys(sizes).sort()).toEqual([...chatbot.BODY_SECTION_ORDER].sort());
    for (const key of chatbot.BODY_SECTION_ORDER) {
      expect(sizes[key], `size of ${key}`).toBe(enc(payload[key]));
    }
    // Non-ASCII must be counted in UTF-8 bytes, not UTF-16 code units -- the
    // same trap `attachmentCost` (`chatbot.js`) documents.
    expect(sizes.messages).toBeGreaterThan(JSON.stringify(payload.messages).length);
  });

  it("an absent section costs 0, not the 4 bytes of the literal `null`", () => {
    const sizes = chatbot.measureBodySections({
      messages: [], resumeText: "", applications: [],
      pinnedContext: null, attachedFiles: undefined,
    });
    expect(sizes.pinnedContext).toBe(0);
    expect(sizes.attachedFiles).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3.2 -- the measured object must be the object that was SERIALIZED
// ---------------------------------------------------------------------------

describe("§3.2: the sections are measured off the WIRE BODY, not off the state they were built from", () => {
  // Why this needs its own fixtures. Every other fixture in this file is
  // dominated by a field that is present, and identical, in BOTH shapes
  // (`dataB64`, `positions.company`), so measuring the raw tray entries and
  // the UNPROJECTED application map instead of the payload selects the same
  // section and no assertion moves. The two below are built so the two
  // readings DISAGREE ABOUT WHICH SECTION IS LARGEST, which is the only way
  // the difference is observable at all -- and it is a user-visible
  // difference: it decides which control the refusal tells them to use.

  it("a huge previewUrl -- which never goes on the wire -- must not make attachments the culprit", async () => {
    // `previewUrl`, `content` and `kind` are tray-only bookkeeping: the mapped
    // wire shape is {name, mimeType, dataB64}. A 5 MB blob: URL is not
    // realistic, but nothing bounds it either, and the point is structural --
    // the measurement must not see a field the request never carried.
    const h = await refuse({
      attached: [{
        name: "scan.png", kind: "binary", mimeType: "image/png",
        dataB64: "A".repeat(1000),
        previewUrl: "blob:" + "p".repeat(5_000_000),
      }],
      pinned: bigPinned(4_700_000),
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    // THIS TEST IS ABOUT CULPRIT SELECTION. The primary is the assertion; the
    // secondary is a consequence, and under AC-29 rev 5 it is the RIGHT
    // consequence for exactly the reason this fixture exists. On the wire the
    // tray is ~1,060 bytes, so `totalBytes - sizes.attachedFiles` is still
    // ~4,699,040 against a 4,500,000 cap -- emptying the entire tray would
    // free about a kilobyte and change nothing, so AC-29's condition (c)
    // fails and the message says nothing about attachments (AC-29a). That is
    // the SAME measurement the culprit selection turns on, read once: the
    // tray is tiny on the wire however you ask.
    //
    // Under the OLD criterion this read `PRIMARY + SECONDARY`, which is how a
    // fixture built to prove "the tray is negligible" ended up asserting that
    // the user be told to go empty it. Margin: 199,040 bytes clear of
    // condition (c)'s threshold, so nothing here is near a boundary.
    expect(h.state.error).toBe(chatbot.TOO_BIG_PINNED_CONTEXT_MESSAGE);
    // Stated as an absence too, because this is the exact misdiagnosis AC-17
    // exists to prevent: sending the user to the chip ✕ when removing every
    // attachment would free about a kilobyte.
    expect(h.state.error).not.toContain(
      definedSegment(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE, "TOO_BIG_ATTACHMENTS_MESSAGE"),
    );
  });

  it("an unbounded jobDescription -- which the projection caps -- must not make applications the culprit", async () => {
    // `applications` on the wire is projectApplicationsForRequest's OUTPUT:
    // jobDescription capped at MAX_JD_CHARS + 1 for the first MAX_APPLICATIONS
    // and nulled past that. 60 x 100,000 characters is ~6 MB before the
    // projection and ~46 KB after it, so the raw map and the payload disagree
    // about the largest section by two orders of magnitude.
    const h = await refuse({
      applicationData: Array.from({ length: 60 }, (_, i) => ({
        id: `app-${i}`,
        positions: { company: `C${i}`, title: `Role ${i}`, description: "d".repeat(100_000) },
        status: "applied",
        applied_at: "2024-01-01",
      })),
      pinned: bigPinned(4_700_000),
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    // Empty tray, so no AC-29 secondary: the message is the pinned-context
    // constant alone.
    expect(h.state.error).toBe(chatbot.TOO_BIG_PINNED_CONTEXT_MESSAGE);
    expect(h.state.error).not.toContain(
      definedSegment(chatbot.TOO_BIG_APPLICATIONS_MESSAGE, "TOO_BIG_APPLICATIONS_MESSAGE"),
    );
  });

  it("PAIRED POSITIVE CONTROL: the same two sections DO win when they really are largest", async () => {
    // Without this the two absences above are satisfied by an implementation
    // that can never select attachments or applications at all.
    const tray = await refuse(DOMINANT.attachedFiles());
    expect(tray.state.error).toBe(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE);
    const apps = await refuse(DOMINANT.applications());
    expect(apps.state.error).toBe(chatbot.TOO_BIG_APPLICATIONS_MESSAGE);
  });
});

describe("largestBodyContributor: strict >, ties resolved by BODY_SECTION_ORDER", () => {
  it("picks the single largest", () => {
    const sizes = { attachedFiles: 1, pinnedContext: 2, messages: 99, resumeText: 3, applications: 4 };
    expect(chatbot.largestBodyContributor(sizes)).toBe("messages");
  });

  it("a tie resolves to the EARLIER BODY_SECTION_ORDER entry, so selection is deterministic", () => {
    // MUTATION PROOF: reverse BODY_SECTION_ORDER, or relax `>` to `>=`, and
    // this goes red. Written against the exported order rather than a
    // hard-coded name, so it pins the order's ROLE and not one arrangement.
    const [first, second, third] = chatbot.BODY_SECTION_ORDER;
    const allEqual = Object.fromEntries(chatbot.BODY_SECTION_ORDER.map((k) => [k, 1000]));
    expect(chatbot.largestBodyContributor(allEqual)).toBe(first);

    const tieBetweenTwo = Object.fromEntries(chatbot.BODY_SECTION_ORDER.map((k) => [k, 0]));
    tieBetweenTwo[second] = 500;
    tieBetweenTwo[third] = 500;
    expect(chatbot.largestBodyContributor(tieBetweenTwo)).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// AC-26 -- the impossible advice is gone (with a positive control beside it)
// ---------------------------------------------------------------------------

describe("AC-26: \"Try asking about one specific company or role\" is gone everywhere", () => {
  const PHRASE = /one specific company or role/i;

  it("CANARY: the pattern really does match the sentence it is meant to find", () => {
    // A sweep that reports clean because its own pattern is broken has checked
    // nothing. Prove the pattern fires before trusting any negative below.
    expect(PHRASE.test("Try asking about one specific company or role, or send a shorter message."))
      .toBe(true);
  });

  it("appears in none of the exported segments, nor in the AC-52 template", () => {
    // `definedSegment` first: "undefined does not contain the phrase" is true
    // of every constant that does not exist yet, and proves nothing.
    for (const [i, segment] of everySegment().entries()) {
      expect(definedSegment(segment, `segment #${i}`)).not.toMatch(PHRASE);
    }
    expect(chatbot.TOO_BIG_MULTIPLE_MESSAGE("6.8")).not.toMatch(PHRASE);
  });

  it("appears in none of the five end-to-end refusals -- and each is still a real refusal", async () => {
    for (const section of Object.keys(DOMINANT)) {
      const h = await refuse(DOMINANT[section]());
      // ABSENCE...
      expect(h.state.error, section).not.toMatch(PHRASE);
      // ...PAIRED with a POSITIVE CONTROL, so a dead refusal path (empty
      // string, undefined, a silent send) cannot satisfy the absence above.
      expect(h.state.error, section).toMatch(/too large to send/i);
      expect(h.state.error, section).toMatch(/4\.5\s*MB/i);
    }
  });

  it("appears on neither branch of readChatResponse's 413 path", async () => {
    const withAttachments = await chatbot.readChatResponse(RESPONSE_413(), { hasAttachments: true });
    const without = await chatbot.readChatResponse(RESPONSE_413(), { hasAttachments: false });
    expect(withAttachments.error).not.toMatch(PHRASE);
    expect(without.error).not.toMatch(PHRASE);
    // POSITIVE CONTROLS for both absences.
    expect(withAttachments.error).toMatch(/too large to send/i);
    expect(without.error).toMatch(/too large to send/i);
  });

  it("[src] the literal is gone from lib/chat/chatbot.js itself, comments included", () => {
    // Swept by EXPLICIT RESOLVED PATH -- exactly one file, never a directory
    // walk and never a `*.test.js` suffix rule. This test file quotes the
    // banned phrase in its own name and comments; a directory sweep would
    // match itself and a suffix rule is the wrong way to exclude it.
    const target = fileURLToPath(new URL("./chatbot.js", import.meta.url));
    const src = readFileSync(target, "utf8");
    // CANARY on the real instrument, not on a literal: prove the read
    // succeeded and the file is the one we mean.
    expect(src).toMatch(/MAX_REQUEST_BYTES/);
    expect(src.length).toBeGreaterThan(10_000);
    expect(src).not.toMatch(PHRASE);
  });
});

// ---------------------------------------------------------------------------
// M-8 -- the scoped source sweep AC-24 asks for: no HAND-WRITTEN send-refusal
//        literal may survive outside the exported vocabulary
// ---------------------------------------------------------------------------

describe("M-8: every send-refusal string in chatbot.js comes from the exported vocabulary", () => {
  // Strips block comments and whole-line `//` comments before searching. Same
  // shape as lib/chat/driveSourceSweep-style sweeps
  // (lib/chat/applicationContextSourceSweep.test.js copies it verbatim). It
  // matters here for a specific reason: this file's own header quotes the
  // string "Request Entity Too Large" INSIDE DOUBLE QUOTES in a comment, so a
  // sweep that did not strip comments would report it as an unaccounted
  // literal on day one and get "fixed" by weakening.
  function stripComments(src) {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    return noBlock
      .split("\n")
      .map((line) => (line.trim().startsWith("//") ? "" : line))
      .join("\n");
  }

  // The ATTACH-TIME refusals are explicitly OUT OF SCOPE and must stay: they
  // are a different gate (the per-file and tray budgets, not the request
  // body), they land in `chatAttachError` rather than `chatError`, they are
  // AC-52's own cited prior art for interpolating a measured figure, and
  // chatbot.attachments.test.js pins them.
  //
  // Whitelisted STRUCTURALLY rather than by a list of strings. Every one of
  // them opens with the `${file.name}` interpolation, because naming the
  // rejected file is what they are for; a SEND refusal never names a file,
  // because by then the body is one thing. (M-8 as written cites "the two
  // literals in the aggregate attach gate". Measured against the file, there
  // are FOUR: the per-file size refusal (`is too large (max ...)`) and the
  // .docx-source one (`is too large to open (max ... source file)`) are two
  // more, both in `addChatAttachments` --
  // so a two-item list would have been red on day one and "fixed" by
  // widening it into uselessness. The structural rule covers all four and
  // still cannot absorb a send refusal.)
  const ATTACH_TIME_PER_FILE = /^\$\{file\.name\}/;

  // A literal "reads as a send refusal" if it talks about something being too
  // big. Deliberately broader than the exact lead clause: a hand-written
  // "Your message is too big, try trimming it" is exactly what M-8 exists to
  // catch, and it shares none of the vocabulary's wording.
  const REFUSAL_SHAPED = /too (large|big)/i;

  // Backtick, double- and single-quoted literals. Alternation order matters:
  // a template literal is consumed whole, so a quote inside one is never
  // mistaken for the start of a string.
  const LITERAL_RE = /`[^`]*`|"[^"\\\n]*"|'[^'\\\n]*'/g;

  function refusalShapedLiterals(code) {
    return (code.match(LITERAL_RE) || []).filter((l) => REFUSAL_SHAPED.test(l));
  }

  function unaccountedLiterals(code, allowed) {
    const found = [];
    for (const lit of refusalShapedLiterals(code)) {
      const body = lit.slice(1, -1);
      if (ATTACH_TIME_PER_FILE.test(body)) continue;
      // Concatenated constants arrive here one CHUNK at a time, and an
      // implementation is free to assemble them however it likes -- so the
      // test is "is this chunk part of something we export?", not "is this
      // chunk equal to a string we predicted". `${...}` slots are dropped
      // because the exported value has them already filled in.
      const needle = body.replace(/\$\{[^}]*\}/g, "").trim();
      if (!needle) continue;
      if (allowed.some((h) => h.includes(needle))) continue;
      found.push(lit);
    }
    return found;
  }

  const allowedHaystacks = () => [
    ...everySegment(),
    typeof chatbot.TOO_BIG_MULTIPLE_MESSAGE === "function"
      ? chatbot.TOO_BIG_MULTIPLE_MESSAGE("0.0")
      : "",
    // AC-56's hedged constant, listed here rather than in `everySegment()` on
    // purpose: `everySegment()` feeds `definedSegment()`, which REQUIRES a
    // string, so adding it there would turn AC-26's loop red while AC-56 is
    // still unimplemented -- a second red test for a reason that has nothing
    // to do with AC-26. The filter below drops it harmlessly until it exists.
    chatbot.TOO_BIG_APPLICATIONS_UNMEASURED_MESSAGE,
  ].filter((s) => typeof s === "string" && s.length > 0);

  it("CANARY: the sweep flags a planted hand-written refusal, and clears the real vocabulary", () => {
    // A sweep whose matcher is broken reports clean and has checked nothing.
    // Prove it FIRES before trusting the negative below.
    const planted = 'const oops = "Sorry, that is too big to send — try trimming it.";\n';
    expect(unaccountedLiterals(planted, allowedHaystacks())).toHaveLength(1);

    // ...and prove it does NOT fire on the two things it must tolerate: an
    // exported segment written out verbatim, and an attach-time literal.
    const okay =
      "const a = `" + definedSegment(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE, "S1") + "`;\n" +
      "const b = `${file.name} is too large on its own (${totalMB} MB) to attach — try a smaller file.`;\n" +
      "const c = `${file.name} is too large (max ${MAX_ATTACHMENT_SIZE_LABEL}).`;\n";
    expect(unaccountedLiterals(okay, allowedHaystacks())).toHaveLength(0);

    // ...and that the structural whitelist cannot be widened by accident into
    // covering a send refusal that merely mentions a file name later on.
    const sneaky = 'const d = `That message is too large to send, drop ${file.name} maybe.`;\n';
    expect(unaccountedLiterals(sneaky, allowedHaystacks())).toHaveLength(1);

    // ...and that the COMMENT STRIPPER works, since the real file depends on
    // it (the module header quotes "Request Entity Too Large" in a comment).
    expect(stripComments('// "Request Entity Too Large" is too large\nconst a = 1;\n'))
      .not.toMatch(REFUSAL_SHAPED);
    expect(stripComments('/* a "too big" note */\nconst a = 1;\n')).not.toMatch(REFUSAL_SHAPED);
  });

  it("[src] neither chatbot.js nor refusal.js holds a send-refusal literal outside the exported set", () => {
    // NAMED FILES, by resolved path -- never a directory walk. Two reasons,
    // both measured elsewhere in this repo: a tree walk of app/ + lib/ costs
    // ~14.6s (past vitest's 5s hook default), and it would match stale
    // `.next/` build artifacts carrying the PRE-A2 constants verbatim, i.e.
    // fail on day one for a reason no source change can fix.
    //
    // WHY THERE ARE TWO PATHS, and why this is the one test in the suite that
    // a pre-split reference implementation cannot verify.
    //
    // This sweep originally read chatbot.js alone, which was correct when the
    // vocabulary lived there. The vocabulary was then extracted to refusal.js
    // -- and the sweep KEPT PASSING, honestly: chatbot.js still holds the
    // attach-time literals, so both the non-vacuity canary and the whitelist
    // control below still fired, while the file that now actually holds the
    // send-refusal copy went completely uncovered. That is the general hazard
    // worth remembering: an extraction silently narrows any source sweep that
    // reads by resolved path, and it does so without turning anything red.
    //
    // The fix is NOT an existence check or a try/catch around the second read
    // -- "skip the file if it isn't there" is exactly the weakening this sweep
    // exists to resist, and it would re-open the hole the moment someone
    // renamed the module. Both reads are unconditional. The consequence,
    // accepted deliberately: the property asserted here is a fact about the
    // POST-SPLIT layout, so this case can only be verified against the real
    // tree. A monolithic reference implementation (everything in chatbot.js,
    // no refusal.js) will fail this one case on the missing read, and that is
    // the correct outcome rather than a reason to soften it.
    const targets = ["./chatbot.js", "./refusal.js"].map((rel) =>
      fileURLToPath(new URL(rel, import.meta.url)),
    );
    const [chatbotSrc, refusalSrc] = targets.map((t) => readFileSync(t, "utf8"));

    // Instrument canaries, PER FILE: prove each read succeeded and hit the
    // file we mean. A single combined canary would let one of the two reads
    // silently return something unexpected while the other carried the check.
    expect(chatbotSrc, "chatbot.js is not the file that was read").toMatch(/MAX_REQUEST_BYTES/);
    expect(chatbotSrc.length).toBeGreaterThan(10_000);
    expect(refusalSrc, "refusal.js is not the file that was read").toMatch(/BODY_SECTION_ORDER/);
    expect(refusalSrc, "refusal.js is not the file that was read").toMatch(/refusalMessageFor/);
    expect(refusalSrc.length).toBeGreaterThan(3_000);

    const code = stripComments(chatbotSrc) + "\n" + stripComments(refusalSrc);
    // NON-VACUITY: the sweep must actually be looking at some refusal copy. If
    // this is zero the file has been renamed, restructured, or the literal
    // matcher has stopped working, and every absence below means nothing.
    const refusalish = refusalShapedLiterals(code);
    expect(refusalish.length, "no refusal-shaped literal found at all -- the matcher is blind")
      .toBeGreaterThan(0);

    // NON-VACUITY, PER FILE, and this is the assertion that makes the repoint
    // real rather than decorative. The combined check above is satisfied by
    // chatbot.js's attach-time literals ALONE -- which is exactly how the
    // single-file version of this sweep went on reporting clean after the
    // vocabulary moved out from under it. Each file must contribute refusal
    // copy of its own for the sweep to be covering both.
    expect(
      refusalShapedLiterals(stripComments(chatbotSrc)).length,
      "chatbot.js contributed no refusal-shaped literal -- the sweep is not reading it",
    ).toBeGreaterThan(0);
    expect(
      refusalShapedLiterals(stripComments(refusalSrc)).length,
      "refusal.js contributed no refusal-shaped literal -- the vocabulary has moved again and this sweep is stale",
    ).toBeGreaterThan(0);

    // The whitelist must not be swallowing the thing being swept for. Two
    // controls on it: it exempts a real, non-empty set, and NONE of what it
    // exempts is a send refusal -- the attach-time family never uses the send
    // refusal's lead clause, so the two families cannot blur into each other.
    const attachTime = refusalish.filter((l) => ATTACH_TIME_PER_FILE.test(l.slice(1, -1)));
    expect(attachTime.length, "the attach-time whitelist matched nothing -- it has stopped working")
      .toBeGreaterThanOrEqual(2);
    for (const lit of attachTime) {
      expect(lit, `an attach-time literal is wearing the SEND refusal's wording: ${lit}`)
        .not.toMatch(/too large to send/i);
    }

    const unaccounted = unaccountedLiterals(code, allowedHaystacks());
    expect(
      unaccounted,
      `hand-written send-refusal literal(s) outside the exported vocabulary: ${JSON.stringify(unaccounted)}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-27 / AC-28 -- which states name a control, and which must not
// ---------------------------------------------------------------------------

describe("AC-27: the three states with an in-panel remedy name it by its visible label", () => {
  it("attachments -> the chip's remove affordance", async () => {
    const h = await refuse(DOMINANT.attachedFiles());
    expect(h.state.error).toMatch(/remove an attachment/i);
  });

  it("pinned context -> the ✕ beside \"Context\" (the `aria-label=\"Remove context\"` button)", async () => {
    const h = await refuse(DOMINANT.pinnedContext());
    expect(h.state.error).toContain("Context");
  });

  it("transcript -> the header \"Clear\" button (`ChatPanel.js`)", async () => {
    const h = await refuse(DOMINANT.messages());
    expect(h.state.error).toContain("Clear");
  });
});

describe("AC-28: the two states with NO in-panel remedy name no control", () => {
  // Naming one here would reintroduce exactly the defect AC-26 removes: advice
  // the user can follow that cannot reduce the body.
  const IN_PANEL_CONTROLS = [
    [/remove an attachment/i, "the chip ✕"],
    [/\bclear\b/i, "the header Clear button"],
    [/\bcontext\b/i, "the ✕ beside Context"],
  ];

  it("CANARY: these patterns do match the messages that DO name those controls", async () => {
    const attachments = await refuse(DOMINANT.attachedFiles());
    const pinned = await refuse(DOMINANT.pinnedContext());
    const transcript = await refuse(DOMINANT.messages());
    expect(attachments.state.error).toMatch(IN_PANEL_CONTROLS[0][0]);
    expect(transcript.state.error).toMatch(IN_PANEL_CONTROLS[1][0]);
    expect(pinned.state.error).toMatch(IN_PANEL_CONTROLS[2][0]);
  });

  for (const [section, cause] of [["resumeText", /resume|résumé/i], ["applications", /application/i]]) {
    it(`${section}: names no in-panel control, but still names the cause`, async () => {
      const h = await refuse(DOMINANT[section]());
      for (const [pattern, label] of IN_PANEL_CONTROLS) {
        expect(h.state.error, `${section} must not name ${label}`).not.toMatch(pattern);
      }
      // POSITIVE CONTROL for the three absences above: the message still says
      // what happened and what is actually responsible.
      expect(h.state.error).toMatch(/too large to send/i);
      expect(h.state.error).toMatch(cause);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-29 -- the dedicated secondary, appended exactly when the tray is non-empty
//          and attachments were NOT the largest contributor
// ---------------------------------------------------------------------------

describe("AC-29: the attachment secondary", () => {
  const count = (haystack, needle) =>
    (String(haystack).match(new RegExp(needle, "gi")) || []).length;

  // AC-29 rev 5 -- THE REMEDY RULE, and why every fixture below states three
  // margins rather than one.
  //
  // The secondary is appended only when ALL THREE hold:
  //   (a) the tray is non-empty,
  //   (b) attachments are not already the largest section, and
  //   (c) `totalBytes - sizes.attachedFiles <= MAX_REQUEST_BYTES` -- emptying
  //       the WHOLE tray would by itself bring the body under the cap.
  //
  // (c) is rev 5's amendment and it is the one that makes the advice true.
  // Rev 4 required only (a) and (b), so a 50 KB tray under a 4.4 MB résumé
  // earned a "you can also remove an attachment" that could not work: the
  // user deletes the file they were about to ask about, presses Send, and
  // reads the identical refusal. AC-52 does not catch it, because AC-52
  // guards only the LARGEST section and here the tray is nowhere near it.
  //
  // FIXTURE DISCIPLINE, in AC-52's boundary-precision style: every fixture
  // below is stated with its distance from each threshold it must clear, and
  // none of those distances is within scaffolding drift (the per-section
  // overheads in this file's header are tens of bytes; the smallest margin
  // used anywhere below is 50,234).
  //
  // 4,000,000-byte transcript + 1,000,000-byte attachment:
  //   over the cap by     500,200   (4,999,900 vs 4,500,000 -- a real refusal)
  //   largest wins by   3,000,025   (messages 4,000,082 vs tray 1,000,057)
  //   under (c) by        499,857   (4,000,143 vs 4,500,000 -- removing the
  //                                  tray really does close the gap)
  //   under AC-52 by    3,499,882   (so the five-way selection is reached)
  const TRANSCRIPT_PLUS_REMOVABLE_TRAY = () => ({
    messages: bigThread(4_000_000),
    attached: [bigAttachment(1_000_000)],
  });

  it("a dominant transcript with a REMOVABLE tray yields PRIMARY + SECONDARY, by identity", async () => {
    const h = await refuse(TRANSCRIPT_PLUS_REMOVABLE_TRAY());
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(
      chatbot.TOO_BIG_TRANSCRIPT_MESSAGE + chatbot.TOO_BIG_ATTACHMENT_SECONDARY,
    );
  });

  it("the composed string says \"remove an attachment\" once and \"try again\" once", async () => {
    const h = await refuse(TRANSCRIPT_PLUS_REMOVABLE_TRAY());
    expect(count(h.state.error, "remove an attachment")).toBe(1);
    expect(count(h.state.error, "try again")).toBe(1);
  });

  it("NEGATIVE CONTROL (AC-29 rev 5): a tray whose removal would NOT close the gap gets no secondary", async () => {
    // AC-29's OWN measured counter-example, byte for byte: résumé 4,400,000 +
    // transcript 150,000 + tray 50,000. Margins:
    //   over the cap by     100,291   (4,600,291 -- a real refusal fires)
    //   largest wins by   4,250,000   (résumé, so the primary is S4)
    //   FAILS (c) by         50,234   (4,550,234 vs 4,500,000 -- emptying the
    //                                  ENTIRE tray still leaves it over)
    //   under AC-52 by    4,299,709   (200,291 vs the cap -- the template does
    //                                  NOT fire, so this really is the
    //                                  five-way branch and not AC-52's)
    //
    // 50,234 bytes is the tightest margin in this file and it is deliberate:
    // it is the criterion's own arithmetic. It is still ~600x the largest
    // scaffolding term in the header table, so it is not a rounding-distance
    // fixture -- the two readings are unambiguously on opposite sides.
    const h = await refuse({
      ...bigResume(4_400_000),
      messages: bigThread(150_000),
      attached: [bigAttachment(50_000)],
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    // AC-29a: silence about attachments, as a decision. The primary already
    // names an action that closes the gap on its own; adding "you can also
    // remove an attachment" would cost the user a file and change nothing.
    expect(h.state.error).toBe(chatbot.TOO_BIG_RESUME_MESSAGE);
    expect(h.state.error).not.toContain(
      definedSegment(chatbot.TOO_BIG_ATTACHMENT_SECONDARY, "TOO_BIG_ATTACHMENT_SECONDARY"),
    );
    expect(count(h.state.error, "remove an attachment")).toBe(0);
  });

  it("PAIRED POSITIVE CONTROL: the SAME shape with a tray that DOES close the gap gets the secondary", async () => {
    // Identical in every respect except the tray size, so the only thing that
    // can move the result is condition (c). Without this pair the negative
    // above is satisfied by an implementation that never appends at all --
    // the dead-feature trap wearing a bug-fix hat. Margins:
    //   over the cap by     500,3xx   (5,000,3xx)
    //   largest wins by   3,100,000   (résumé 4,000,002 vs tray 900,057)
    //   under (c) by        399,8xx   (4,100,1xx vs 4,500,000)
    const h = await refuse({
      ...bigResume(4_000_000),
      messages: bigThread(100_000),
      attached: [bigAttachment(900_000)],
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(
      chatbot.TOO_BIG_RESUME_MESSAGE + chatbot.TOO_BIG_ATTACHMENT_SECONDARY,
    );
    expect(count(h.state.error, "remove an attachment")).toBe(1);
    expect(count(h.state.error, "try again")).toBe(1);
  });

  it("NEGATIVE CONTROL: an EMPTY tray appends nothing", async () => {
    const h = await refuse(DOMINANT.messages());
    expect(h.state.error).toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE);
    expect(h.state.error).not.toContain(
      definedSegment(chatbot.TOO_BIG_ATTACHMENT_SECONDARY, "TOO_BIG_ATTACHMENT_SECONDARY"),
    );
  });

  it("NEGATIVE CONTROL: attachments already largest -> no secondary, and still one \"try again\"", async () => {
    const h = await refuse(DOMINANT.attachedFiles());
    expect(h.state.error).toBe(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE);
    expect(count(h.state.error, "remove an attachment")).toBe(1);
    expect(count(h.state.error, "try again")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-52 -- when no single removal can bring the body under the cap
// ---------------------------------------------------------------------------

describe("AC-52: no single removal suffices", () => {
  // MEASURED FIXTURE, and the reason it is 1.7 MB and not 1.1 MB: with four
  // equal sections the useless-advice band starts above 1.5 MB each
  // (total - largest = 3s > 4.5 MB  <=>  s > 1.5 MB). Four 1.1 MB sections
  // total 4.4 MB, which is UNDER the cap -- no refusal fires at all and the
  // fixture proves nothing. At 1.7 MB x 4 the measured body is ~6,800,308
  // bytes, and removing the largest still leaves ~5.1 MB.
  const FOUR_WAY = () => ({
    attached: [bigAttachment(1_700_000)],
    pinned: bigPinned(1_700_000),
    messages: bigThread(1_700_000),
    ...bigResume(1_700_000),
  });
  // 6,800,308 / 1e6 -> "6.8". The whole band [6.75 MB, 6.85 MB) rounds here,
  // so this survives any scaffolding drift, and it is the same figure whether
  // the implementation feeds the template `bodyBytes` or the section sum
  // (6,800,185) -- both round to "6.8".
  const EXPECTED_MB = "6.8";

  it("the message IS TOO_BIG_MULTIPLE_MESSAGE(measured), and no section constant appears", async () => {
    const h = await refuse(FOUR_WAY());
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(chatbot.TOO_BIG_MULTIPLE_MESSAGE(EXPECTED_MB));
    for (const section of chatbot.BODY_SECTION_ORDER) {
      expect(h.state.error, `must not fall back to the ${section} constant`)
        .not.toContain(definedSegment(constantFor(section), `${section} constant`));
    }
  });

  it("no AC-29 secondary is appended, even though the tray is non-empty", async () => {
    // "You can also remove an attachment and try again" contradicts "no single
    // thing you can remove brings it under".
    const h = await refuse(FOUR_WAY());
    expect(h.state.error).not.toContain(
      definedSegment(chatbot.TOO_BIG_ATTACHMENT_SECONDARY, "TOO_BIG_ATTACHMENT_SECONDARY"),
    );
  });

  it("the figure quoted is the MEASURED BODY, not the sum of the five sections", async () => {
    // §9 N3 flags this as a real choice, and the fixture above deliberately
    // cannot see it: 6,800,308 (bodyBytes) and 6,800,185 (the section sum)
    // BOTH round to "6.8", so a test built on it is green under either reading
    // and pins neither. The two differ only by JSON scaffolding and by the
    // body fields that belong to no section -- `tab`, `section`, `engine` --
    // so `section` is the lever that separates them.
    //
    // MEASURED, both readings, with `section` carrying 200,000 characters:
    //   bodyBytes    -> 7,000,3xx  -> "7.0"
    //   section sum  -> 6,800,185  -> "6.8"
    // The whole band [6.95 MB, 7.05 MB) rounds to "7.0", so this survives
    // scaffolding drift; the two readings are ~0.2 MB apart, four times the
    // band's half-width.
    //
    // `bodyBytes` is the right one on the merits, not just by fiat: it is the
    // number the gate actually compared against the cap, and quoting anything
    // else tells the user their message is a size the browser never measured.
    const h = await refuse({ ...FOUR_WAY(), activeSection: "s".repeat(200_000) });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(chatbot.TOO_BIG_MULTIPLE_MESSAGE("7.0"));
    // ...and explicitly NOT the section-sum reading, so the failure message
    // says which of the two the implementation used.
    expect(h.state.error).not.toBe(chatbot.TOO_BIG_MULTIPLE_MESSAGE(EXPECTED_MB));
  });

  it("NEGATIVE CONTROL: one 4.7 MB attachment and nothing else selects the section constant", async () => {
    // total - largest is a few hundred bytes here, far under the cap, so
    // AC-52's branch must NOT fire. MUTATION PROOF: invert the condition and
    // this test and the one above swap colours.
    const h = await refuse(DOMINANT.attachedFiles());
    expect(h.state.error).toBe(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE);
  });

  it("refusalMessageFor: the branch is `total - largest > MAX_REQUEST_BYTES`, tested at the boundary", () => {
    const sizes = { attachedFiles: 1_000_000, pinnedContext: 0, messages: 0, resumeText: 0, applications: 0 };

    // total - largest exactly AT the cap: strictly-greater means NO template.
    const atBoundary = chatbot.refusalMessageFor(sizes, {
      hasAttachments: false, totalBytes: CAP + 1_000_000,
    });
    expect(atBoundary).toBe(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE);

    // One byte past it: template.
    const past = chatbot.refusalMessageFor(sizes, {
      hasAttachments: false, totalBytes: CAP + 1_000_001,
    });
    expect(past).toBe(chatbot.TOO_BIG_MULTIPLE_MESSAGE(((CAP + 1_000_001) / 1_000_000).toFixed(1)));
  });
});

// ---------------------------------------------------------------------------
// AC-53 / AC-54 / AC-55 -- the SECOND emitter (readChatResponse's 413 branch)
// ---------------------------------------------------------------------------

describe("AC-53: both emitters produce the same primary for the same largest section", () => {
  // The gate and the platform are two different emitters of the same
  // vocabulary. `readChatResponse` sees only `hasAttachments` and cannot
  // measure a body it never had, so A2 hands it the measurement lazily.
  it("the pre-fetch gate and a platform 413 name the SAME section", async () => {
    // (a) over the cap: the gate refuses.
    const gated = await refuse(DOMINANT.pinnedContext());
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // (b) UNDER the cap with the same shape, but the platform 413s anyway.
    globalThis.fetch = vi.fn(async () => RESPONSE_413());
    const h = makeHarness({ input: QUESTION, pinned: bigPinned(3_000_000) });
    await h.handlers().sendChatMessage();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    expect(h.state.error).toBe(gated.state.error);
    expect(h.state.error).toBe(chatbot.TOO_BIG_PINNED_CONTEXT_MESSAGE);
  });

  it("readChatResponse returns a supplied measurement verbatim, and calls it LAZILY (once)", async () => {
    const measure = vi.fn(() => "MEASURED PRIMARY");
    const res = RESPONSE_413();
    const result = await chatbot.readChatResponse(res, { hasAttachments: true, refusalMessage: measure });
    expect(result).toEqual({ ok: false, error: "MEASURED PRIMARY" });
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("PAIRED POSITIVE CONTROL: a 200 never asks for the measurement at all", async () => {
    // Measuring the five sections is a second full serialization of a body up
    // to 4.5 MB. Paying it on every successful send, to prepare for a branch
    // that almost never fires, is the cost this laziness exists to avoid.
    const measure = vi.fn(() => "MEASURED PRIMARY");
    const res = fakeResponse({ status: 200, body: JSON.stringify({ reply: "hi" }) });
    const result = await chatbot.readChatResponse(res, { refusalMessage: measure });
    expect(result.ok).toBe(true);
    expect(measure).not.toHaveBeenCalled();
  });

  // The two cases above cover the CONSUMER: `readChatResponse` does not call
  // the measurement on a 200. They cannot see the other half of the same cost.
  // `runChatRequest` builds the function, and an implementation that INVOKES
  // it eagerly -- right after `bodyBytes`, before the gate -- passes both of
  // them while paying a second full serialization of a body up to 4.5 MB on
  // EVERY successful send, to prepare for a branch that almost never fires.
  // That is precisely the cost §5.1's laziness exists to avoid, and it was
  // unguarded.
  //
  // Counted through `toJSON`, not through TextEncoder or a spy on the module:
  // any measurement of a section must serialize that section, whatever
  // primitive it reaches for and whether or not the internal call goes through
  // the exported binding. Same instrument the B5 bomb below uses.
  it("runChatRequest does NOT measure on the success path -- the body is serialized once", async () => {
    let serializations = 0;
    const counted = {
      toJSON() {
        serializations += 1;
        return "a short pinned posting";
      },
    };
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("fine"));
    const h = makeHarness({ input: QUESTION, pinned: { label: "Senior PM at Acme", content: counted } });
    await h.handlers().sendChatMessage();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(h.state.error).toBe("");
    expect(
      serializations,
      "the payload was serialized more than once on a SUCCESSFUL send -- the refusal measurement is not lazy",
    ).toBe(1);
  });

  it("PAIRED POSITIVE CONTROL: a REFUSED send really does measure, so the counter is not inert", async () => {
    // Without this the assertion above is satisfied by an implementation that
    // never measures at all -- which would be the dead-feature trap wearing a
    // performance hat.
    let serializations = 0;
    const counted = {
      toJSON() {
        serializations += 1;
        return "c".repeat(4_700_000);
      },
    };
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("should never be reached"));
    const h = makeHarness({ input: QUESTION, pinned: { label: "Senior PM at Acme", content: counted } });
    await h.handlers().sendChatMessage();

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(chatbot.TOO_BIG_PINNED_CONTEXT_MESSAGE);
    expect(serializations, "the refusal named a section without measuring anything").toBeGreaterThan(1);
  });
});

describe("AC-55: a 413 that arrives despite the gate passing", () => {
  it("names the measured largest section, and AC-52's branch cannot have fired", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_413());
    const h = makeHarness({ input: QUESTION, messages: bigThread(3_000_000) });
    await h.handlers().sendChatMessage();

    // The body PASSED our own gate -- so the message must not assert that our
    // measurement was exceeded. It names the largest part, which is true under
    // either side's count.
    expect(h.state.error).toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE);
    // Gate-passed means bodyBytes <= MAX_REQUEST_BYTES, so total - largest is
    // necessarily below it too: AC-52's template is unreachable on this path.
    expect(h.state.error).not.toBe(chatbot.TOO_BIG_MULTIPLE_MESSAGE("3.0"));
    expect(chatbot.BODY_SECTION_ORDER.map(constantFor)).toContain(h.state.error);
  });
});

// ---------------------------------------------------------------------------
// AC-56 -- the path that COULD NOT MEASURE must not make the measured claim
// ---------------------------------------------------------------------------

describe("AC-56: the unmeasured 413 hedges its cause instead of asserting the measured one", () => {
  // RED ON PURPOSE at the time of writing: TOO_BIG_APPLICATIONS_UNMEASURED_MESSAGE
  // does not exist yet. This is a hand-off to the implementer, and the name is
  // the contract -- the same way §5.4a's vocabulary became one.
  //
  // WHY TWO CONSTANTS RATHER THAN ONE. TOO_BIG_APPLICATIONS_MESSAGE makes a
  // FLAT claim: "most of it IS your saved application history". On the gate's
  // path that claim is EARNED -- we serialized the five sections and counted,
  // and applications really was the largest. On this path it is UNEARNED by
  // construction: `readChatResponse` has no body, measured nothing, and was
  // handed no measurement; all it knows is that the platform said 413 and the
  // tray was empty. AC-55 already concedes that our count and the platform's
  // can legitimately disagree, so a flat causal claim here asserts something
  // nobody established.
  //
  // One shared constant forces a single wording to be wrong on one of the two
  // paths: hedge it and the measured path -- the common one, where we did the
  // work -- goes vague; leave it flat and the unmeasured path lies. Two
  // constants is the only shape accurate on both, and a distinct constant is
  // still checked by identity, so AC-25's property survives intact. (The
  // pre-A2 wording already hedged with "most likely"; this restores that on
  // the one path that still needs it.)
  it("names its own exported constant, whose claim is hedged rather than flat", async () => {
    const hedged = chatbot.TOO_BIG_APPLICATIONS_UNMEASURED_MESSAGE;
    expect(typeof hedged, "AC-56 requires a DISTINCT exported constant for the unmeasured path")
      .toBe("string");
    expect(hedged.length).toBeGreaterThan(0);

    // The two constants are genuinely different objects, not one aliased
    // twice -- an alias would satisfy an identity check while reintroducing
    // the single-wording problem.
    expect(hedged).not.toBe(definedSegment(chatbot.TOO_BIG_APPLICATIONS_MESSAGE, "measured constant"));

    // ...and the difference is the one AC-56 is about: hedged vs flat.
    expect(hedged, "the unmeasured constant must hedge its cause").toMatch(/most likely/i);
    expect(chatbot.TOO_BIG_APPLICATIONS_MESSAGE, "the measured constant keeps its flat claim")
      .toMatch(/most of it is/i);
    expect(hedged, "a hedged constant must not also make the flat claim").not.toMatch(/most of it is/i);
  });

  it("a 413 with NO measurement and an empty tray emits the hedged constant, by identity", async () => {
    const result = await chatbot.readChatResponse(RESPONSE_413(), { hasAttachments: false });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(chatbot.TOO_BIG_APPLICATIONS_UNMEASURED_MESSAGE);
    // THE NEGATIVE, paired with the identity above: the path that could not
    // measure must never emit the constant that says it did.
    expect(result.error).not.toBe(
      definedSegment(chatbot.TOO_BIG_APPLICATIONS_MESSAGE, "TOO_BIG_APPLICATIONS_MESSAGE"),
    );
    // ...and it is still a real refusal, so the negative above cannot be
    // satisfied by an empty or missing message.
    expect(result.error).toMatch(/too large to send/i);
    expect(result.error).toMatch(/4\.5\s*MB/i);
  });

  it("PAIRED POSITIVE CONTROL: the MEASURED path still emits the flat constant", async () => {
    // AC-56 is scoped to the unmeasured branch. Swapping BOTH paths to the
    // hedged wording would satisfy the case above while making the good path
    // vaguer for no reason -- which is the failure mode the ruling rejects.
    // Driven end to end so this is the real selection, not a hand-built call.
    const gated = await refuse(DOMINANT.applications());
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(gated.state.error).toBe(chatbot.TOO_BIG_APPLICATIONS_MESSAGE);

    // ...and through the second emitter with a measurement supplied, which is
    // the other half of AC-53's identity: still the measured constant.
    globalThis.fetch = vi.fn(async () => RESPONSE_413());
    const h = makeHarness({
      input: QUESTION,
      applicationData: bigApplications(60, 55_000),
    });
    await h.handlers().sendChatMessage();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(h.state.error).toBe(chatbot.TOO_BIG_APPLICATIONS_MESSAGE);
  });

  it("AC-54's attachments default is untouched by AC-56", async () => {
    // AC-56 changes ONE branch. The `hasAttachments = true` default and the
    // attachments side of the fallback are explicitly required to survive.
    const withOptions = await chatbot.readChatResponse(RESPONSE_413(), { hasAttachments: true });
    expect(withOptions.error).toBe(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE);
    const bare = await chatbot.readChatResponse(RESPONSE_413());
    expect(bare.error).toBe(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// B5 -- a measurement that throws must never put a raw JS error in the panel
// ---------------------------------------------------------------------------

describe("B5: the measurement is guarded; a raw JS error never reaches the user", () => {
  it("a payload whose second serialization throws still yields an exported constant", async () => {
    // `JSON.stringify` on a multi-MB payload can throw (RangeError, allocation
    // failure). This bomb reproduces that precisely: the FIRST stringify --
    // `const requestBody = JSON.stringify(payload)` in `runChatRequest`, the
    // one that builds the real request body -- succeeds, so
    // the size gate fires normally; the SECOND -- the per-section measurement
    // the refusal builder needs -- throws. Without a guard the RangeError
    // escapes into `runChatRequest`'s `catch (err)` and prints a raw JS message into the chat
    // window: the exact leak class commit af9ac29 exists to close.
    let calls = 0;
    const bomb = {
      toJSON() {
        calls += 1;
        if (calls > 1) throw new RangeError("Invalid string length");
        return "c".repeat(4_700_000);
      },
    };
    const h = await refuse({ pinned: { label: "Senior PM at Acme", content: bomb } });

    expect(h.state.error).not.toMatch(/RangeError/i);
    expect(h.state.error).not.toMatch(/Invalid string length/i);

    // ...and what the user gets instead is a real, exported refusal.
    //
    // WHY MEMBERSHIP IS STILL RIGHT FOR HALF OF THIS, AND WHY IT IS NOT THE
    // WHOLE ASSERTION ANY MORE.
    //
    // Two implementations are both conformant here and they land on DIFFERENT
    // constants: one that re-serializes to measure and catches the throw ends
    // on the guard's fallback; one that never re-serializes -- or that guards
    // per section, leaving the bombed section measuring 0 -- ends on a
    // measured section constant. Pinning either single value would fail the
    // other, so a set is the honest shape for the property "nothing raw
    // escaped; what reached the panel is an EXPORT".
    //
    // But membership over five-or-six constants is weak on its own, and it
    // was concealing a real defect, so it no longer stands alone. `calls > 1`
    // PROVES this run is one where the second serialization was attempted and
    // threw -- so whatever the implementation does next, it does not know
    // which section was largest. TOO_BIG_APPLICATIONS_MESSAGE asserts "most
    // of it IS your saved application history", a MEASURED claim, and
    // emitting it here makes AC-56's guarantee false on the path that most
    // needs it. AC-56 is not a rule about one call site: it is the rule that
    // a path which could not measure must not make the measured claim, and
    // the hedged constant exists precisely for this.
    const acceptable = [
      // The five primaries. (The old list also named
      // TOO_BIG_APPLICATIONS_MESSAGE separately; that is already the
      // `applications` entry, so it was a duplicate rather than a sixth
      // option -- the set was narrower than it looked.)
      ...chatbot.BODY_SECTION_ORDER.map(constantFor),
      // AC-56's hedged constant: the correct answer for a failed measurement
      // with an empty tray, and the entry whose absence blocked that fix.
      chatbot.TOO_BIG_APPLICATIONS_UNMEASURED_MESSAGE,
    ];
    // A `toContain` over a set that holds `undefined` passes vacuously the
    // moment the emitted error is also undefined -- gate every entry first.
    acceptable.forEach((c, i) => definedSegment(c, `acceptable[${i}]`));
    expect(acceptable).toContain(h.state.error);
    expect(h.state.error).toMatch(/too large to send/i);

    // The sharp half, and the reason this case is no longer just a membership
    // check. First prove the fixture did what it claims -- a bomb that never
    // detonated would make everything below vacuous.
    expect(
      calls,
      "the bomb never forced a SECOND serialization -- this fixture is not exercising the guard at all",
    ).toBeGreaterThan(1);
    expect(
      h.state.error,
      "the measurement THREW, so nothing on this path established that applications was the largest section: the flat claim is unearned (AC-56)",
    ).not.toBe(definedSegment(chatbot.TOO_BIG_APPLICATIONS_MESSAGE, "TOO_BIG_APPLICATIONS_MESSAGE"));
  });
});

// ---------------------------------------------------------------------------
// AC-17 -- the attach-time budget and the send-time gate must not disagree
//          in a way that leaves the user with unusable advice
// ---------------------------------------------------------------------------

describe("AC-17: a tray the attach gate ACCEPTED can still overflow the body", () => {
  it("the refusal then names a contributor the user can actually act on", async () => {
    // MAX_ATTACHMENT_PAYLOAD_BYTES is 4,000,000 and the aggregate attach gate
    // accepts a tray up to exactly that (the `runningTotal + cost >
    // MAX_ATTACHMENT_PAYLOAD_BYTES` gate in `addChatAttachments`). Add 600 KB of
    // pinned context -- itself perfectly legal -- and the assembled body is
    // ~4.6 MB, over MAX_REQUEST_BYTES. The two gates disagree; AC-17 requires
    // that what the user is then told is actionable.
    const h = await refuse({
      attached: [bigAttachment(chatbot.MAX_ATTACHMENT_PAYLOAD_BYTES)],
      pinned: bigPinned(600_000),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(chatbot.TOO_BIG_ATTACHMENTS_MESSAGE);
    // The named remedy exists in the panel: the chip's ✕ (each `<Chip onDelete>`
    // rendered from `chatAttachedFiles.map` in `ChatPanel.js`).
    expect(h.state.error).toMatch(/remove an attachment/i);
  });
});

// ---------------------------------------------------------------------------
// AC-30 / AC-36 -- the question survives the refusal
// ---------------------------------------------------------------------------

describe("AC-30 / AC-36: a refused send puts the user's text back in the composer", () => {
  it("after a pre-fetch refusal, the composer holds the trimmed question again", async () => {
    const h = await refuse({ ...DOMINANT.messages(), input: `  ${QUESTION}  ` });
    expect(globalThis.fetch).not.toHaveBeenCalled();   // AC-18
    expect(h.state.input).toBe(QUESTION);
  });

  it("NEGATIVE CONTROL: a refusal reached through resendUserMessage does NOT overwrite the composer", async () => {
    // `resendUserMessage` shares `runChatRequest`'s gate, but the user may have
    // typed something new since the failed turn. Restoring there would destroy
    // a draft they are in the middle of.
    //
    // THE FIXTURE IS THE WHOLE TEST, and the first attempt at it covered
    // nothing. `resendUserMessage(index)` does `chatMessages.slice(0, index)`,
    // so everything at or below `index` is DISCARDED and only
    // `chatMessages[index].content` is carried into the new body. Putting the
    // oversized turn *below* the resent index therefore sliced the bulk away:
    // the body was ~179 bytes, the gate never fired, `fetch` WAS called, and
    // the "composer unchanged" assertion below passed vacuously for every
    // implementation -- including one that lifts the restore out of
    // `sendChatMessage` into `runChatRequest` (U-M3), which is exactly the
    // scoping defect this control exists to catch.
    //
    // So the RESENT TURN ITSELF is oversized here, which is the only place the
    // content can sit and still be carried by the resend.
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("never reached"));
    const h = makeHarness({
      input: "a different half-typed question",
      messages: [
        { role: "user", content: "q".repeat(4_700_000) },
        { role: "assistant", content: "here is my answer" },
        { role: "user", content: "a follow-up they sent afterwards" },
      ],
    });
    await h.handlers().resendUserMessage(0);

    // POSITIVE CONTROLS: a refusal really did fire on this path. Without
    // these the assertion below is satisfied by "nothing happened at all",
    // which is how the previous fixture read as green-by-accident.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE);

    // ...and the composer is untouched. `setChatInput` is asserted NEVER to
    // have been called, not merely to have left the value equal: the restore
    // belongs to `sendChatMessage` alone, and `runChatRequest` must not write
    // to the composer on any path.
    expect(h.state.input).toBe("a different half-typed question");
    expect(h.spies.setChatInput).not.toHaveBeenCalled();
  });

  // THE GUARD NOW SERVES TWO PURPOSES, and the second one arrived with rev 6
  // rather than being designed for. Because the composer is no longer disabled
  // while a send is in flight (AC-31 rev 6), a user CAN type into it mid-send
  // -- which was impossible before. `!live || live === text` already handles
  // that exactly right: it restores only when the composer is empty or still
  // holds the original text, so a genuinely different draft is left alone. No
  // new logic was needed, and the NEGATIVE CONTROL two cases below is already
  // the test for it; it has simply stopped being hypothetical.
  //
  // THE GUARD IS `!live || live === text`, NOT `!live`, and the reason is a
  // measurement disagreement rather than a preference. Two independent probes
  // of this repo disagreed about whether React has COMMITTED
  // `setChatInput("")` (`sendChatMessage`, `chatbot.js`) by the time the restore reads
  // `chatInputRef.current.value`. Under one reading the live value is `""`;
  // under the other it is still the text the user submitted. A guard of `!live`
  // is correct under only the first, and which one holds is not something this
  // chunk should be betting on -- so the guard must restore under BOTH, and
  // the two cases below are that pair. Mutate the guard back to `!live` and
  // the second one alone goes red; that asymmetry is the point of writing two.
  it("restores when the live composer value is EMPTY", async () => {
    const h = await refuse({ ...bigResume(4_700_000), liveComposerValue: "" });
    expect(h.state.input).toBe(QUESTION);
  });

  it("restores when the live composer value is STILL THE SUBMITTED TEXT (React had not committed the clear)", async () => {
    const h = await refuse({ ...bigResume(4_700_000), liveComposerValue: QUESTION });
    expect(h.state.input).toBe(QUESTION);
  });

  it("NEGATIVE CONTROL: a DIFFERENT non-empty live value suppresses the restore", async () => {
    // With a résumé uploaded there is a real await before the gate
    // (`runChatRequest`'s `resumeFile` branch), so the user can start typing during it. The
    // closure's `chatInput` is stale by then; only the live ref value is the
    // truth, and a value that is neither empty nor the submitted text is a
    // draft that must not be overwritten.
    const h = await refuse({ ...bigResume(4_700_000), liveComposerValue: "typed while it was thinking" });
    expect(h.state.input).toBe("");
    expect(h.spies.setChatInput).not.toHaveBeenCalledWith(QUESTION);
  });

  it("a SUCCESSFUL send leaves the composer empty -- the restore is scoped to the refusal", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("here you go"));
    const h = makeHarness({ input: QUESTION });
    await h.handlers().sendChatMessage();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(h.state.input).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC-31 / AC-31a / AC-32 / AC-35 -- focus, and WHEN it happens
// ---------------------------------------------------------------------------

describe("AC-31 / AC-32 / AC-31a / AC-35: the composer gets focus back", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  // The restore is DEFERRED on purpose (AC-31a): at the instant the `finally`
  // runs, React has only QUEUED `setChatSending(false)`, so the composer is
  // still `disabled` in the DOM and a synchronous `focus()` is ignored by the
  // browser. `FOCUS_RESTORE_DELAY_MS` is exported so this file advances timers
  // by exactly the production value rather than a drifting copy -- the idiom
  // AttachmentPanel.js:33 established for `UNDO_WINDOW_MS`.
  async function settleFocus() {
    const delay = chatbot.FOCUS_RESTORE_DELAY_MS;
    expect(typeof delay, "FOCUS_RESTORE_DELAY_MS must be exported for this test to be exact").toBe("number");
    await vi.advanceTimersByTimeAsync(delay);
  }

  // AC-31/AC-35 rev 6 -- WHY THESE ARE ABSENCES NOW, AND WHY THE OLD SHAPE
  // WAS A DEFECT THIS SUITE FAITHFULLY ENCODED.
  //
  // Rev 3 required the focus call "exactly once, from the `finally`", so it
  // fired on the refused path too. Screen readers CANCEL in-progress speech on
  // a focus change; the refusal is ~38 words, 6-9 seconds of synthesized
  // speech, and the restore fires 80 ms in. A screen-reader user therefore
  // heard about one syllable of why their message failed and then the
  // composer's label -- the pre-A2 experience, reintroduced by A2's own focus
  // half.
  //
  // AC-35's old rationale ("set chatError BEFORE moving focus, so the
  // announcement is not cut off") is UNSOUND, and that is worth stating
  // plainly because the sequencing test below looked like real protection:
  // ordering two synchronous calls cannot protect an ASYNCHRONOUS utterance
  // that is still being spoken seconds after both have returned. Only not
  // moving focus can.
  //
  // Rev 6's requirement: on a send refused before `fetch` there is NO focus
  // call at all, because the composer is never disabled on that path -- so
  // focus never leaves it and nothing has to give it back. Every assertion
  // below is therefore an absence, and every absence is paired with a control
  // proving the refusal really happened and the question really came back;
  // otherwise a composer that never works at all satisfies them.
  it("AC-31/AC-32 rev 6 (no résumé): a refused send makes NO focus call", async () => {
    const h = await refuse(DOMINANT.messages());
    await settleFocus();

    expect(h.composer.focus, "focus moved on a refused send -- that cancels the announcement").not.toHaveBeenCalled();
    expect(h.composer.setSelectionRange).not.toHaveBeenCalled();

    // PAIRED POSITIVE CONTROLS. Without these the absences above are satisfied
    // by a send that never refused, a handler that never ran, or a composer
    // double that was never wired up.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE);
    expect(h.state.input, "AC-30: the question must still come back").toBe(QUESTION);
  });

  it("AC-32 rev 6 (with a résumé uploaded): still no focus call", async () => {
    // AC-32 requires AC-31 to hold with `resumeFile` set AND absent, and rev 6
    // restates it so it cannot be satisfied by the no-résumé fixture's
    // accidental commit-coalescing. At THIS level the fixture difference is
    // only that the resumeText branch runs; the render-level difference lives
    // in app/components/ChatPanel.gaps.test.js. See the scope note on
    // `bigResume` above.
    const h = await refuse(bigResume(4_700_000));
    await settleFocus();

    expect(h.composer.focus).not.toHaveBeenCalled();
    expect(h.composer.setSelectionRange).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.state.error).toBe(chatbot.TOO_BIG_RESUME_MESSAGE);
    expect(h.state.input).toBe(QUESTION);
  });

  it("AC-31a (node half), MOOT on the refused path but still pinned where it applies", async () => {
    // AC-31a is KEPT, not deleted: it governs anywhere a focus call still
    // legitimately happens -- i.e. a path that really did disable something.
    // On the refused path rev 6 removes the call entirely, so the criterion
    // has nothing to constrain there, and asserting an ordering between two
    // events one of which never occurs would be a test that cannot fail.
    //
    // So it is re-pointed at the SUCCESSFUL send, where the restore survives
    // and the ordering is still the real requirement: `focus()` on a
    // still-disabled element is ignored in jsdom AND in a browser (AC.md rev 4
    // fact 2), so focusing before the re-enable does nothing anywhere.
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("here you go"));
    const h = makeHarness({ input: QUESTION });
    await h.handlers().sendChatMessage();
    await settleFocus();

    const enabled = callOrder.indexOf("setChatSending(false)");
    const focused = callOrder.indexOf("focus");
    expect(enabled, `no setChatSending(false) in ${JSON.stringify(callOrder)}`).toBeGreaterThanOrEqual(0);
    expect(focused, `no focus in ${JSON.stringify(callOrder)}`).toBeGreaterThanOrEqual(0);
    expect(enabled).toBeLessThan(focused);
    expect(h.composer.focus).toHaveBeenCalledTimes(1);
  });

  it("AC-35 rev 6: NO focus event occurs after chatError is set, so the announcement completes", async () => {
    // The old form asserted `setChatError` came BEFORE `focus`. That ordering
    // was never protection -- see the block comment above -- and it PASSED
    // while the defect shipped. The checkable requirement is the absence of a
    // focus event anywhere in the refused path, which is what lets a 6-9
    // second utterance finish.
    //
    // THE ABSENCE IS SCOPED TO THIS HARNESS'S OWN SPY, NOT TO `callOrder`, and
    // that is not a style choice. `callOrder` is module-global mutable state
    // that every harness in this file writes to; a deferred focus callback
    // armed by an EARLIER test can land inside this one's timer advance and
    // push "focus" into it. Measured: asserting `callOrder` holds no "focus"
    // fails in a full-file run and PASSES when this test is run alone, which
    // is the signature of leakage rather than of the behaviour under test. An
    // absence assertion read off shared state is exactly the kind that fails
    // correct code, so it reads the per-test spy instead. `callOrder` stays
    // for the ORDERING assertions above, where a stray extra entry is
    // harmless.
    const h = await refuse(DOMINANT.messages());
    await settleFocus();

    expect(
      h.composer.focus,
      "focus fired during a refusal, cancelling a 6-9 second announcement",
    ).not.toHaveBeenCalled();

    // PAIRED POSITIVE CONTROL: an announcement really was made, so "no focus
    // event after chatError is set" is not vacuously true because no error was
    // ever set.
    expect(callOrder, `the refusal was never announced: ${JSON.stringify(callOrder)}`)
      .toContain("setChatError(text)");
    expect(h.state.error).toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE);
  });

  it("the user's own caret is left alone on a refused send -- nothing repositions it", async () => {
    // WHAT REPLACED THE OLD CARET COVERAGE, stated rather than quietly
    // dropped. The old case asserted the deferred restore put the caret at the
    // end of the restored text. That behaviour existed only because focus was
    // being taken and given back; rev 6 never takes it, so there is no caret
    // to restore -- the composer keeps the selection the USER left in it,
    // which is strictly better than forcing it to the end. Caret-at-end is
    // still exercised on the paths that do restore (see the successful-send
    // case below and `askAiAbout`'s own callers).
    const h = await refuse({ ...DOMINANT.messages(), input: QUESTION });
    h.composer.value = QUESTION;
    await settleFocus();

    expect(h.composer.setSelectionRange).not.toHaveBeenCalled();
    // PAIRED POSITIVE CONTROL: the restore really did happen, so this is not
    // "nothing occurred at all".
    expect(h.state.input).toBe(QUESTION);
  });

  it("AC-31: the call comes from the `finally`, so a SUCCESSFUL send restores focus too", async () => {
    // This is the assertion that pins the call SITE. Put the restore in the
    // catch instead and it stays green for every refusal test above while
    // going red here. (In the node environment the `ifLost` guard degrades to
    // an unconditional restore -- there is no `document` -- so "was focus
    // actually lost" is the jsdom file's job, not this one.)
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("here you go"));
    const h = makeHarness({ input: QUESTION });
    await h.handlers().sendChatMessage();
    await settleFocus();
    expect(h.composer.focus).toHaveBeenCalledTimes(1);
  });

  // THE DEFERRAL COVERAGE, AND WHERE IT WENT UNDER REV 6.
  //
  // Both cases below used to drive the REFUSED path. Rev 6 removes the focus
  // call there, so driving them that way would leave the zero-deferral mutants
  // -- the only thing these two ever killed -- alive with nothing replacing
  // them. The deferral MECHANISM is not gone, only its use on one path: the
  // successful send still restores focus, still through
  // `focusComposerEnd`/`FOCUS_RESTORE_DELAY_MS`, so both cases are re-pointed
  // there and kill exactly what they killed before. Verified by mutation: a
  // 0 ms deferral still reddens the second one.
  async function refusalFreeSendWithRestore() {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("here you go"));
    const h = makeHarness({ input: QUESTION });
    await h.handlers().sendChatMessage();
    return h;
  }

  it("the restore is DEFERRED: nothing has focused the composer before the delay elapses", async () => {
    const h = await refusalFreeSendWithRestore();
    expect(h.composer.focus).not.toHaveBeenCalled();
    await settleFocus();
    expect(h.composer.focus).toHaveBeenCalledTimes(1);
  });

  it("the deferral really is FOCUS_RESTORE_DELAY_MS long, not a 0 ms macrotask", async () => {
    // The case above cannot tell 80 ms from 0 ms: under fake timers a
    // `setTimeout(fn, 0)` is equally un-run until the clock is advanced, so a
    // shortened deferral passes it. That mattered, because the deferral is
    // LOAD-BEARING (AC-31a): `setChatSending(false)` is a QUEUED React update,
    // so the composer is still `disabled` in the DOM one macrotask later and a
    // real browser IGNORES focus() on it. A 0 ms deferral is therefore inert
    // in production while green in a naive spy test.
    //
    // Until now the only thing that failed a 0 ms deferral was an INCIDENTAL
    // `activeElement` assertion inside ChatPanel.gaps.test.js's coupling
    // case -- the same line that raced the timer and failed correct code under
    // load (B3). That line has been made deterministic, so the deferral needs
    // its own pin, and this is it: fake timers, no render, no scheduler.
    const delay = chatbot.FOCUS_RESTORE_DELAY_MS;
    expect(typeof delay).toBe("number");
    // Pinned as a positive number FIRST, so shortening the exported constant
    // itself (rather than the call site) cannot turn the boundary walk below
    // into a no-op.
    expect(delay).toBeGreaterThan(0);

    const h = await refusalFreeSendWithRestore();
    // One tick short of the deferral: still nothing.
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(h.composer.focus, `focus fired before ${delay}ms had elapsed`).not.toHaveBeenCalled();
    // The tick that completes it: exactly one restore.
    await vi.advanceTimersByTimeAsync(1);
    expect(h.composer.focus).toHaveBeenCalledTimes(1);
  });

  it("a missing composer ref is survivable -- no throw, and the refusal still lands", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_OK("never reached"));
    const h = makeHarness({ input: QUESTION, ...DOMINANT.messages() });
    // Reproduce chatbot.request.test.js:112's `{ current: null }` world.
    const handlers = chatbot.createChatHandlers({
      chatInput: QUESTION,
      chatMessages: bigThread(4_700_000),
      chatSending: false,
      chatPinnedContext: null,
      chatAttachedFiles: [],
      chatSize: { width: 380, height: 520 },
      setChatInput: h.spies.setChatInput,
      setChatMessages: h.spies.setChatMessages,
      setChatSending: h.spies.setChatSending,
      setChatError: h.spies.setChatError,
      setChatOpen: vi.fn(),
      setChatPinnedContext: vi.fn(),
      setChatAttachedFiles: vi.fn(),
      setChatAttachError: vi.fn(),
      setChatSize: vi.fn(),
      setChatResizing: vi.fn(),
      chatInputRef: { current: null },
      resumeFile: null,
      applicationData: [],
      applicationStages: {},
      mainTab: "jobs",
      activeSection: null,
      isDocxResume: () => false,
      isTextResume: () => false,
      buildTemplateLinesForUpload: async () => [],
    });
    await handlers.sendChatMessage();
    await vi.advanceTimersByTimeAsync(chatbot.FOCUS_RESTORE_DELAY_MS ?? 80);
    expect(h.state.error).toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// AC-57 -- the platform's ceiling is a number we do not have, so the
//          attachment secondary is WITHHELD on the 413 path
// ---------------------------------------------------------------------------

describe("AC-57: a platform 413 withholds the attachment secondary", () => {
  // WHY THIS CASE EXISTS AT ALL. AC-57 shipped implemented and completely
  // unpinned: `runChatRequest` hands `readChatResponse` a
  // `refusalMessage: () => buildRefusal(false)`, and flipping that single
  // argument to `true` passed every test in this chunk. It is not a no-op --
  // with 413-shaped arguments (a non-empty tray, attachments NOT the largest
  // section, a body our own gate measured UNDER MAX_REQUEST_BYTES) `true`
  // appends TOO_BIG_ATTACHMENT_SECONDARY, i.e. "you can also remove an
  // attachment and try again": a promise that removing the tray crosses a
  // ceiling whose value we do not have, which is exactly the unprovable
  // promise AC-57 and THE REMEDY RULE exist to forbid.
  //
  // The two halves below are the SAME fixture shape at two scales, which is
  // the point: the secondary's machinery is provably alive (the gate half
  // emits it), so the 413 half's absence is a decision rather than a dead
  // feature.
  //
  //   transcript largest, tray second, removing the tray closes the gap
  //     over-cap  (gate, overOurCap === true)  -> primary + secondary
  //     under-cap (413,  overOurCap === false) -> primary ALONE
  //
  // Sizing, so nobody has to re-derive it: with messages 2.4 MB and the tray
  // 2.3 MB the body is ~4.7 MB (over the 4,500,000 cap, so the gate fires),
  // `messages` is the largest section, AC-52's branch cannot fire
  // (total - largest = 2.3 MB, nowhere near the cap), and
  // total - attachedFiles = 2.4 MB <= the cap, so AC-29's BUG-2 guard is
  // satisfied and the secondary IS earned there. Halving both keeps every one
  // of those relations and puts the body UNDER the cap, which is the
  // precondition for reaching `fetch` at all.
  const TRANSCRIPT_OVER = 2_400_000;
  const TRAY_OVER = 2_300_000;
  const TRANSCRIPT_UNDER = 1_200_000;
  const TRAY_UNDER = 1_150_000;

  it("PAIRED POSITIVE CONTROL: the same shape through the pre-fetch gate DOES get the secondary", async () => {
    const h = await refuse({
      messages: bigThread(TRANSCRIPT_OVER),
      attached: [bigAttachment(TRAY_OVER)],
    });

    expect(globalThis.fetch, "the gate half must refuse BEFORE fetch").not.toHaveBeenCalled();
    expect(h.state.error).toBe(
      chatbot.TOO_BIG_TRANSCRIPT_MESSAGE + chatbot.TOO_BIG_ATTACHMENT_SECONDARY,
    );
  });

  it("a 413 on the SAME shape emits the primary ALONE -- no attachment secondary", async () => {
    globalThis.fetch = vi.fn(async () => RESPONSE_413());
    const h = makeHarness({
      input: QUESTION,
      messages: bigThread(TRANSCRIPT_UNDER),
      attached: [bigAttachment(TRAY_UNDER)],
    });
    await h.handlers().sendChatMessage();

    // POSITIVE CONTROLS FIRST, because everything below this line is an
    // absence. The request really did go out (so this is the 413 emitter and
    // not the gate), and a real refusal really did reach the user.
    expect(globalThis.fetch, "the body did not reach fetch -- this is the GATE path, not the 413 one")
      .toHaveBeenCalledTimes(1);
    expect(h.state.error).toBeTruthy();

    // AC-53: the PRIMARY is unaffected -- which section is largest is a fact
    // about a body we did measure, and both emitters still name it.
    expect(h.state.error).toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE);

    // ...and AC-57 itself: the secondary is withheld. Routed through
    // definedSegment so this cannot pass vacuously against a missing export.
    const secondary = definedSegment(chatbot.TOO_BIG_ATTACHMENT_SECONDARY, "TOO_BIG_ATTACHMENT_SECONDARY");
    expect(h.state.error).not.toContain(secondary);
    expect(h.state.error.endsWith(secondary)).toBe(false);
    expect(h.state.error).not.toMatch(/remove an attachment/i);
  });

  it("the tray really was non-empty and removable -- the withholding is a DECISION, not an empty branch", () => {
    // Without this the case above is satisfied by a fixture where the
    // secondary could never have applied anyway (empty tray, or a tray whose
    // removal would not close the gap), which is AC-29's own NEGATIVE CONTROL
    // wearing AC-57's name. Asserted against `refusalMessageFor` directly, at
    // exactly the two `overOurCap` values the two emitters pass.
    const sizes = {
      attachedFiles: TRAY_UNDER,
      pinnedContext: 0,
      messages: TRANSCRIPT_UNDER,
      resumeText: 0,
      applications: 0,
    };
    const totalBytes = TRAY_UNDER + TRANSCRIPT_UNDER;
    const asGate = chatbot.refusalMessageFor(sizes, { hasAttachments: true, totalBytes, overOurCap: true });
    const as413 = chatbot.refusalMessageFor(sizes, { hasAttachments: true, totalBytes, overOurCap: false });

    expect(asGate, "the secondary is unreachable on this fixture -- AC-57's absence proves nothing here")
      .toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE + chatbot.TOO_BIG_ATTACHMENT_SECONDARY);
    expect(as413).toBe(chatbot.TOO_BIG_TRANSCRIPT_MESSAGE);
    expect(asGate).not.toBe(as413);
  });
});

// ---------------------------------------------------------------------------
// The line-budget ceiling three module headers cite -- which, until this
// describe existed, did not
// ---------------------------------------------------------------------------

describe("lib/chat's line budget: the ceiling A2's module headers cite", () => {
  // CANARY ON THE CLAIM, not on the code. `lib/chat/refusal.js`,
  // `lib/chat/composerFocus.js` and `lib/chat/chatbot.js` each justify A2's
  // extraction with "the line-budget ceiling test forbids trimming comments
  // to make room". That phrase occurred in exactly three places repo-wide --
  // those three files, all written by A2's own diff -- and named no test that
  // existed. The convention is real and is enforced three other ways
  // (docs/REGRESSION.md's manual "every one is under 1000 lines" step,
  // app/api/copilot/answer/route.wiring.test.js's executable per-file band,
  // and AttachmentPanel.js's 900-line ceiling), and NONE of them covered
  // lib/chat. This describe is the test those three headers were citing.
  //
  // Shape copied deliberately from route.wiring.test.js's
  // `describe("route.js's own line count (the whole point of this split)")`
  // rather than invented: same `src.split(/\r?\n/).length` count, same
  // upper-band + lower-bound + hard-ceiling structure, same reason for the
  // lower bound.
  const readLines = (rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    // Instrument canary: prove the read landed on a real module before any
    // number derived from it is trusted. An empty or missing read would make
    // every upper bound below pass vacuously.
    expect(src.length, `${rel} read as empty -- every line-count assertion below would be vacuous`)
      .toBeGreaterThan(500);
    return src.split(/\r?\n/).length;
  };

  it("chatbot.js stays within the band A2's extraction actually landed in", () => {
    const lines = readLines("./chatbot.js");

    // WHY 900 AND WHY 700. MEASURED on this tree: this counter reports
    // chatbot.js at 841 (840 newline-terminated lines plus the empty tail
    // `split` yields; route.wiring.test.js counts the same way, so the two
    // numbers are comparable). It was 712 before A2 -- the extraction did NOT
    // shrink this file, it grew by 128; what it bought was landing here
    // rather than well past 1,000.
    //
    // 900 gives 59 lines of headroom, ~7%: enough that ordinary maintenance
    // -- a new comment block, one more guard -- does not trip it, and tight
    // enough that a second feature's worth of code cannot be added here
    // without a deliberate decision. It is the same absolute ceiling
    // AttachmentPanel.js carries, chosen for the same reason. PROVEN TO FAIL
    // (scratchpad, padded copy, repo tree untouched): the upper bound first
    // goes red at 901 lines, i.e. after 60 added lines.
    expect(lines).toBeLessThanOrEqual(900);

    // The lower bound is not symmetry. It is what makes the three module
    // headers' claim TRUE: they say this ceiling "forbids trimming comments
    // to make room", and an upper bound alone cannot forbid anything of the
    // kind -- deleting the M-8 rationale, the `overOurCap` derivation, or the
    // AC-31 rev-6 focus history would satisfy it perfectly. Hitting a small
    // number by deleting load-bearing prose fails here instead. Same
    // reasoning as route.wiring.test.js's `> 600`. PROVEN TO FAIL: stripping
    // this file's comment-only lines takes it to 505, and the bound first
    // goes red after 141 of them are removed.
    expect(lines).toBeGreaterThan(700);
  });

  it("every module A2 extracted is under this project's hard 1000-line ceiling", () => {
    for (const rel of ["./chatbot.js", "./refusal.js", "./composerFocus.js", "./chatLimits.js"]) {
      expect(readLines(rel), `${rel} is over this project's hard 1000-line ceiling`).toBeLessThan(1000);
    }
  });
});
