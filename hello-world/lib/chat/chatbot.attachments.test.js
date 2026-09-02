// @vitest-environment jsdom
//
// jsdom, not node, for exactly one reason: `readFileAsBase64` inside
// `createChatHandlers` uses `FileReader`, which node has no implementation of.
// Everything else here is plain function calls against setter spies.
//
// What this file pins: the attach-time gate at lib/chat/chatbot.js:128, today
//
//     if (file.size > 5 * 1024 * 1024) { ... "(max 5 MB)" }
//
// which sits ~55% ABOVE the transport limit the request will actually hit
// (5 MiB -> 6,990,508 base64 chars vs a 4,500,000-byte platform cap), and
// which is also per-file only: three files that each pass can jointly bust
// the budget with nothing to stop them.
//
// The budget arithmetic is asserted on its own in chatbot.response.test.js;
// this file asserts the GATE behaves as that arithmetic says it should:
//   per file   -> file.size <= MAX_BINARY_ATTACHMENT_BYTES (3,000,000)
//   aggregate  -> sum of transmitted payload bytes across the tray plus the
//                 batch <= MAX_ATTACHMENT_PAYLOAD_BYTES (4,000,000), where a
//                 binary file costs base64Length(size) and a text file costs
//                 its own length.
//
// The bulk case matters more than the manual one: ExperienceTab.js:471 calls
// `addChatAttachments(files)` with N files the user never individually chose
// (the "Ask AI" action on saved experience attachments). A silently dropped
// file there is invisible, so every refused file must be named.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChatHandlers } from "./chatbot.js";
import * as chatbot from "./chatbot.js";

// jsdom implements no URL.createObjectURL (used for image chip previews).
// Same stub idiom as lib/document/download.test.js.
let savedCreateObjectURL;
beforeEach(() => {
  savedCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = vi.fn(() => "blob:fake");
});
afterEach(() => {
  if (savedCreateObjectURL) URL.createObjectURL = savedCreateObjectURL;
  else delete URL.createObjectURL;
  vi.restoreAllMocks();
});

// A stand-in for the host component's render snapshot. `createChatHandlers`
// closes over `chatAttachedFiles` by value, so handlers are rebuilt from the
// current state on every call -- exactly what a React re-render does.
function makeHarness(initialAttached = [], options = {}) {
  // `.docx` is THE file type in a resume tool, and it is a ZIP: `file.size` is
  // the COMPRESSED size, so the per-file gate cannot see how much text comes
  // out of it. `buildTemplateLinesForUpload` is what turns it into text, so it
  // is injectable here -- that is the only way a test can express "a 300 KB
  // .docx that extracts to 4.5 MB".
  const extractLines = options.buildTemplateLinesForUpload || (async () => ["stub"]);
  const state = {
    attached: initialAttached,
    attachError: "",
    opened: false,
  };
  const spies = {
    setChatAttachedFiles: vi.fn((next) => {
      state.attached = typeof next === "function" ? next(state.attached) : next;
    }),
    setChatAttachError: vi.fn((next) => {
      state.attachError = typeof next === "function" ? next(state.attachError) : next;
    }),
    setChatOpen: vi.fn((next) => {
      state.opened = typeof next === "function" ? next(state.opened) : next;
    }),
  };
  function handlers() {
    return createChatHandlers({
      chatInput: "",
      chatMessages: [],
      chatSending: false,
      chatPinnedContext: null,
      chatAttachedFiles: state.attached,
      chatSize: { width: 380, height: 520 },
      setChatInput: vi.fn(),
      setChatMessages: vi.fn(),
      setChatSending: vi.fn(),
      setChatError: vi.fn(),
      setChatOpen: spies.setChatOpen,
      setChatPinnedContext: vi.fn(),
      setChatAttachedFiles: spies.setChatAttachedFiles,
      setChatAttachError: spies.setChatAttachError,
      setChatSize: vi.fn(),
      setChatResizing: vi.fn(),
      chatInputRef: { current: null },
      resumeFile: null,
      applicationData: [],
      applicationStages: {},
      mainTab: "jobs",
      activeSection: null,
      // The real implementations live in lib/document/docx and drag in
      // mammoth; the handler factory takes them as deps precisely so a test
      // can supply cheap ones.
      isDocxResume: (f) => /\.docx$/i.test(f?.name || ""),
      isTextResume: (f) => /\.(txt|md)$/i.test(f?.name || ""),
      buildTemplateLinesForUpload: extractLines,
    });
  }
  return { state, spies, handlers };
}

function imageFile(name, byteCount) {
  return new File([new Uint8Array(byteCount)], name, { type: "image/png" });
}

function textFile(name, charCount) {
  return new File(["a".repeat(charCount)], name, { type: "text/plain" });
}

// A tray entry as `addChatAttachments` itself would have produced it, seeded
// directly so a large tray costs a string allocation instead of a real read.
function seededBinary(name, base64Chars) {
  return { name, kind: "binary", mimeType: "image/png", dataB64: "A".repeat(base64Chars), previewUrl: null };
}

function seededText(name, chars) {
  return { name, kind: "text", content: "a".repeat(chars) };
}

describe("addChatAttachments: the per-file gate", () => {
  it("refuses a file over the derived cap, names it, and quotes the REAL limit", async () => {
    const { state, spies, handlers } = makeHarness();
    // 4,000,000 bytes: comfortably under the old 5 MiB gate, which is the
    // whole point -- this file is accepted today and then 413s.
    const file = imageFile("portfolio-scan.png", 4_000_000);
    expect(file.size).toBeLessThan(5 * 1024 * 1024);

    await handlers().addChatAttachments([file]);

    // ABSENCE: it is not attached, and nothing was appended to the tray.
    // (`toHaveLength(0)`, not `toEqual([])`: a failing deep-equal here would
    // print a multi-megabyte base64 diff.)
    expect(state.attached).toHaveLength(0);
    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(0);

    // The refusal names the file...
    expect(state.attachError).toContain("portfolio-scan.png");
    // ...and states the limit that is actually true.
    expect(state.attachError).toContain(chatbot.MAX_ATTACHMENT_SIZE_LABEL);
    // `(^|\s)` not `\b`: `\b` matches between "." and "5", so `/\b5\s*MB\b/`
    // would also reject a message quoting the good label "2.5 MB".
    expect(state.attachError).not.toMatch(/(^|\s)5\s*MB\b/i);
  });

  it("PAIRED POSITIVE CONTROL: a small image is accepted with its bytes intact", async () => {
    const { state, spies, handlers } = makeHarness();
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "tiny.png", { type: "image/png" });

    await handlers().addChatAttachments([file]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(state.attached).toHaveLength(1);
    expect(state.attached[0].name).toBe("tiny.png");
    expect(state.attached[0].kind).toBe("binary");
    expect(state.attached[0].mimeType).toBe("image/png");
    // base64 of bytes 01 02 03 04 05 -- unchanged, not re-encoded or trimmed.
    expect(state.attached[0].dataB64).toBe("AQIDBAU=");
    expect(state.attached[0].dataB64.length).toBe(chatbot.base64Length(5));
    expect(state.attachError).toBe("");
  });

  it("accepts a file at exactly the cap (the boundary is inclusive)", async () => {
    const { state, handlers } = makeHarness();
    const file = textFile("long-notes.txt", chatbot.MAX_BINARY_ATTACHMENT_BYTES);
    expect(file.size).toBe(3_000_000);

    await handlers().addChatAttachments([file]);

    expect(state.attachError).toBe("");
    expect(state.attached).toHaveLength(1);
    expect(state.attached[0].kind).toBe("text");
  });

  it("applies the same per-file cap to text attachments", async () => {
    const { state, spies, handlers } = makeHarness();
    const file = textFile("scraped-postings.txt", 3_500_000);

    await handlers().addChatAttachments([file]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(0);
    expect(state.attached).toHaveLength(0);
    expect(state.attachError).toContain("scraped-postings.txt");
    expect(state.attachError).toContain(chatbot.MAX_ATTACHMENT_SIZE_LABEL);
  });
});

describe("addChatAttachments: the running aggregate across the tray", () => {
  it("refuses a third file that each-alone fits but jointly busts the budget", async () => {
    // Two 1,400,000-byte images already attached:
    //   base64Length(1_400_000) = 1,866,668 each  ->  3,733,336 total
    //   3,733,336 <= 4,000,000, so this tray is legitimately reachable.
    // A third costs another 1,866,668 -> 5,600,004 > 4,000,000.
    const tray = [
      seededBinary("shot-1.png", chatbot.base64Length(1_400_000)),
      seededBinary("shot-2.png", chatbot.base64Length(1_400_000)),
    ];
    expect(tray[0].dataB64.length + tray[1].dataB64.length).toBe(3_733_336);

    const { state, spies, handlers } = makeHarness(tray);
    await handlers().addChatAttachments([imageFile("shot-3.png", 1_400_000)]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(0);
    expect(state.attached).toHaveLength(2);
    expect(state.attachError).toContain("shot-3.png");
    // The message must not claim THIS file is oversized -- it isn't; the tray
    // is full. It has to point at the tray.
    expect(state.attachError).toMatch(/(total|together|already|remove|combined)/i);
  });

  it("PAIRED POSITIVE CONTROL: the second 1.4 MB image still fits and is accepted", async () => {
    const tray = [seededBinary("shot-1.png", chatbot.base64Length(1_400_000))];
    const { state, spies, handlers } = makeHarness(tray);

    await handlers().addChatAttachments([imageFile("shot-2.png", 1_400_000)]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(state.attached).toHaveLength(2);
    expect(state.attached[1].name).toBe("shot-2.png");
    expect(state.attached[1].dataB64.length).toBe(chatbot.base64Length(1_400_000));
    expect(state.attachError).toBe("");
  });

  it("the aggregate boundary is exact: 4,000,000 fits, 4,000,004 does not", async () => {
    // Tray holds 3,999,996 base64 chars. A 3-byte file costs
    // base64Length(3) = 4  ->  4,000,000 exactly. Accepted.
    const accept = makeHarness([seededBinary("bulk.png", 3_999_996)]);
    await accept.handlers().addChatAttachments([
      new File([new Uint8Array([9, 9, 9])], "three-bytes.png", { type: "image/png" }),
    ]);
    expect(accept.state.attachError).toBe("");
    expect(accept.state.attached).toHaveLength(2);

    // A 4-byte file costs base64Length(4) = 8  ->  4,000,004. Refused.
    const refuse = makeHarness([seededBinary("bulk.png", 3_999_996)]);
    await refuse.handlers().addChatAttachments([
      new File([new Uint8Array([9, 9, 9, 9])], "four-bytes.png", { type: "image/png" }),
    ]);
    expect(refuse.state.attached).toHaveLength(1);
    expect(refuse.state.attachError).toContain("four-bytes.png");
  });

  it("counts text entries already in the tray toward the same budget", async () => {
    // A text attachment travels as `content`, not base64, so it costs its own
    // length. 3,999,996 + base64Length(4) = 4,000,004 > 4,000,000.
    const { state, handlers } = makeHarness([seededText("job-descriptions.txt", 3_999_996)]);

    await handlers().addChatAttachments([
      new File([new Uint8Array([9, 9, 9, 9])], "four-bytes.png", { type: "image/png" }),
    ]);

    expect(state.attached).toHaveLength(1);
    expect(state.attachError).toContain("four-bytes.png");
  });

  it("counts files accepted EARLIER IN THE SAME BATCH, not just the prior tray", async () => {
    // One call, two files, empty tray. 2,000,000 bytes each ->
    // base64Length(2_000_000) = 2,666,668. First fits (2,666,668). Second
    // would make 5,333,336 > 4,000,000, so it must be refused -- a gate that
    // only reads the snapshot `chatAttachedFiles` lets both through.
    const { state, handlers } = makeHarness();
    expect(chatbot.base64Length(2_000_000)).toBe(2_666_668);

    await handlers().addChatAttachments([
      imageFile("first.png", 2_000_000),
      imageFile("second.png", 2_000_000),
    ]);

    expect(state.attached).toHaveLength(1);
    expect(state.attached[0].name).toBe("first.png");
    expect(state.attachError).toContain("second.png");
  });
});

describe("addChatAttachments: text and .docx, which do NOT travel as base64", () => {
  // A text attachment is sent as `content`, not `dataB64`, so it costs its own
  // length -- charging it base64 would refuse files that fit. And a `.docx` is
  // a ZIP: `file.size` is the COMPRESSED size, so the per-file gate is blind
  // to it. A 300 KB resume that extracts to 4.5 MB of text sails through the
  // per-file gate; only the aggregate, applied to the EXTRACTED content,
  // stops it. In a resume tool, .docx is the file type that matters most.

  it("an incoming .txt is charged against the same budget as everything else", async () => {
    // Tray holds 3,000,000. A 1,200,000-char .txt costs 1,200,000
    // -> 4,200,000 > 4,000,000. It passes the per-file gate (1.2 MB < 2.8 MB),
    // so only the aggregate can refuse it.
    const { state, spies, handlers } = makeHarness([seededBinary("scan.png", 3_000_000)]);

    await handlers().addChatAttachments([textFile("pasted-postings.txt", 1_200_000)]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(0);
    expect(state.attached).toHaveLength(1);
    // Never dropped silently -- the user is told which file did not make it.
    expect(state.attachError).toContain("pasted-postings.txt");
    expect(state.attachError).toMatch(/(total|together|already|remove|combined)/i);
  });

  it("PAIRED POSITIVE CONTROL: a .txt is costed by its LENGTH, not by its base64 length", async () => {
    // 900,000 chars of text cost 900,000 -> 3,900,000 <= 4,000,000: accepted.
    // Costed as base64 it would be base64Length(900_000) = 1,200,000
    // -> 4,200,000 and refused. This is the assertion that pins the cost model.
    expect(chatbot.base64Length(900_000)).toBe(1_200_000);
    const { state, spies, handlers } = makeHarness([seededBinary("scan.png", 3_000_000)]);

    await handlers().addChatAttachments([textFile("pasted-postings.txt", 900_000)]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(state.attached).toHaveLength(2);
    expect(state.attached[1].name).toBe("pasted-postings.txt");
    expect(state.attached[1].kind).toBe("text");
    expect(state.attached[1].content.length).toBe(900_000);
    expect(state.attachError).toBe("");
  });

  it("a small .docx whose EXTRACTED text busts the budget is refused, and named", async () => {
    // 300 KB on disk -- a completely ordinary resume file size, and far under
    // the 2.8 MB per-file cap -- that unzips to 4.5 MB of text.
    const { state, spies, handlers } = makeHarness([], {
      buildTemplateLinesForUpload: async () => ["a".repeat(4_500_000)],
    });
    const docx = new File([new Uint8Array(300_000)], "master-resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    // Literal, not the constant: this is a premise of the fixture, and it must
    // not be what fails while the constant is still missing -- the behavioural
    // assertions below are the point of the test.
    expect(docx.size).toBeLessThan(3_000_000);

    await handlers().addChatAttachments([docx]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(0);
    expect(state.attached).toHaveLength(0);
    expect(state.attachError).toContain("master-resume.docx");
    expect(state.attachError).toMatch(/(too (big|large)|too much|total|together|remove)/i);
  });

  it("PAIRED POSITIVE CONTROL: an ordinary .docx is still accepted, as text", async () => {
    const { state, spies, handlers } = makeHarness([], {
      buildTemplateLinesForUpload: async () => ["Alex Shaw", "Senior Engineer", "a".repeat(20_000)],
    });
    const docx = new File([new Uint8Array(40_000)], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await handlers().addChatAttachments([docx]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(state.attached).toHaveLength(1);
    expect(state.attached[0].name).toBe("resume.docx");
    expect(state.attached[0].kind).toBe("text");
    expect(state.attached[0].content).toContain("Senior Engineer");
    expect(state.attachError).toBe("");
  });
});

describe("addChatAttachments: M1 -- the .docx source-file ceiling", () => {
  it("refuses an oversized .docx BEFORE extraction ever starts", async () => {
    // A 26 MB .docx -- e.g. a 100 MB graphics-heavy resume, or a
    // decompression bomb -- must never reach JSZip.loadAsync at all.
    // buildTemplateLinesForUpload stands in for that extraction step here;
    // a spy that is never called proves the gate ran first.
    const extractLines = vi.fn(async () => ["should never run"]);
    const { state, spies, handlers } = makeHarness([], { buildTemplateLinesForUpload: extractLines });
    const hugeDocx = new File([new Uint8Array(26 * 1024 * 1024)], "graphics-heavy-resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await handlers().addChatAttachments([hugeDocx]);

    expect(extractLines).not.toHaveBeenCalled();
    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(0);
    expect(state.attached).toHaveLength(0);
    expect(state.attachError).toContain("graphics-heavy-resume.docx");
    expect(state.attachError).toContain(chatbot.MAX_DOCX_SOURCE_LABEL);
  });

  it("PAIRED POSITIVE CONTROL: a .docx just under the ceiling still extracts normally", async () => {
    const extractLines = vi.fn(async () => ["Alex Shaw", "Senior Engineer"]);
    const { state, spies, handlers } = makeHarness([], { buildTemplateLinesForUpload: extractLines });
    const docx = new File([new Uint8Array(chatbot.MAX_DOCX_SOURCE_BYTES)], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await handlers().addChatAttachments([docx]);

    expect(extractLines).toHaveBeenCalledTimes(1);
    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(state.attached).toHaveLength(1);
    expect(state.attachError).toBe("");
  });
});

describe("addChatAttachments: m3 -- the empty-tray refusal names no nonexistent file to remove", () => {
  it("a single oversized .docx in an EMPTY tray gets 'too large on its own', not 'remove one'", async () => {
    // The M1 case exactly: one file, nothing else attached, nothing to
    // remove. "remove one and try again" would be impossible advice.
    const { state, handlers } = makeHarness([], {
      buildTemplateLinesForUpload: async () => ["a".repeat(4_500_000)],
    });
    const docx = new File([new Uint8Array(300_000)], "master-resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await handlers().addChatAttachments([docx]);

    expect(state.attached).toHaveLength(0);
    expect(state.attachError).toContain("master-resume.docx");
    expect(state.attachError).not.toMatch(/remove one/i);
    expect(state.attachError).toMatch(/too large/i);
    // States the actual total, not just a canned phrase.
    expect(state.attachError).toMatch(/4\.5\s*MB/);
  });

  it("PAIRED POSITIVE CONTROL: a third file busting a NON-empty tray still says 'remove one'", async () => {
    const tray = [
      seededBinary("shot-1.png", chatbot.base64Length(1_400_000)),
      seededBinary("shot-2.png", chatbot.base64Length(1_400_000)),
    ];
    const { state, handlers } = makeHarness(tray);

    await handlers().addChatAttachments([imageFile("shot-3.png", 1_400_000)]);

    expect(state.attachError).toContain("shot-3.png");
    expect(state.attachError).toMatch(/remove one/i);
  });
});

describe("addChatAttachments: m4 (minor) -- text attachments are costed in UTF-8 bytes", () => {
  it("a text file of multi-byte characters costs more than its UTF-16 .length would suggest", async () => {
    // Each "é" is 1 UTF-16 code unit but 2 UTF-8 bytes. Chosen so the numbers
    // land exactly on a boundary that only the OLD (.length) vs NEW
    // (TextEncoder byte count) cost model disagree on:
    //   - tray already holds 1,500,000 bytes of plain ASCII text.
    //   - the incoming file is 1,500,000 "é" characters: file.size (its true
    //     UTF-8 byte size) is exactly 3,000,000 -- AT the per-file cap, so it
    //     is not the per-file gate that refuses it.
    //   - charged by UTF-16 .length (the bug): 1,500,000 + 1,500,000 =
    //     3,000,000 <= 4,000,000 -- would have been ACCEPTED.
    //   - charged correctly in UTF-8 bytes (the fix): 1,500,000 + 3,000,000 =
    //     4,500,000 > 4,000,000 -- must be REFUSED.
    const accentedChars = "é".repeat(1_500_000);
    const multiByteFile = new File([accentedChars], "accented-resume.txt", { type: "text/plain" });
    expect(multiByteFile.size).toBe(3_000_000);
    expect(new TextEncoder().encode(accentedChars).length).toBe(3_000_000);
    expect(accentedChars.length).toBe(1_500_000); // the UTF-16 count the bug used

    const { state, handlers } = makeHarness([seededText("existing-notes.txt", 1_500_000)]);
    await handlers().addChatAttachments([multiByteFile]);

    expect(state.attached).toHaveLength(1); // only the pre-seeded entry
    expect(state.attachError).toContain("accented-resume.txt");
    expect(state.attachError).toMatch(/(total|together|already|remove|combined)/i);
  });

  it("PAIRED POSITIVE CONTROL: plain ASCII text is unaffected by the UTF-8 change", async () => {
    const { state, spies, handlers } = makeHarness();
    const file = textFile("plain-notes.txt", 100_000);

    await handlers().addChatAttachments([file]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(state.attached).toHaveLength(1);
    expect(state.attached[0].content.length).toBe(100_000);
    expect(state.attachError).toBe("");
  });
});

describe("addChatAttachments: bulk programmatic adds (ExperienceTab.js:471)", () => {
  it("an accepted attachment still opens the chat panel", async () => {
    // The bulk path (ExperienceTab's "Ask AI about these attachments") relies
    // on this: it attaches files and expects the panel to come up. A gate that
    // returns early past `setChatOpen(true)` would leave the user staring at
    // the page wondering whether anything happened.
    const { state, spies, handlers } = makeHarness();

    await handlers().addChatAttachments([
      new File([new Uint8Array([1, 2, 3, 4, 5])], "reference.png", { type: "image/png" }),
    ]);

    expect(spies.setChatOpen).toHaveBeenCalled();
    expect(state.opened).toBe(true);
  });

  it("names EVERY refused file, not just the last one", async () => {
    // The "Ask AI about these attachments" action hands over N files at once.
    // The user chose none of them individually; a message naming only the
    // last refusal reads as though the other two were attached fine.
    const { state, spies, handlers } = makeHarness();

    await handlers().addChatAttachments([
      imageFile("offer-letter-scan.png", 4_000_000),
      imageFile("portfolio-page-1.png", 4_000_000),
      imageFile("portfolio-page-2.png", 4_000_000),
    ]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(0);
    expect(state.attached).toHaveLength(0);
    expect(state.attachError).toContain("offer-letter-scan.png");
    expect(state.attachError).toContain("portfolio-page-1.png");
    expect(state.attachError).toContain("portfolio-page-2.png");
  });

  it("PAIRED POSITIVE CONTROL: a mixed batch attaches what fits and still names what did not", async () => {
    const { state, spies, handlers } = makeHarness();

    await handlers().addChatAttachments([
      new File([new Uint8Array([1, 2, 3, 4, 5])], "reference.png", { type: "image/png" }),
      imageFile("portfolio-page-1.png", 4_000_000),
    ]);

    expect(spies.setChatAttachedFiles).toHaveBeenCalledTimes(1);
    expect(state.attached).toHaveLength(1);
    expect(state.attached[0].name).toBe("reference.png");
    expect(state.attached[0].dataB64).toBe("AQIDBAU=");
    expect(state.attachError).toContain("portfolio-page-1.png");
  });
});
