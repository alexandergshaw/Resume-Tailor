// node (this repo's default environment). Characterizes the two pure helpers
// that were lifted out of app/copilot/practice/PracticeClient.js to get that
// component back under its 950-line ceiling (usePracticeHandlers.extraction
// .test.js): `submittedDocsFlagsFor` (the four document flags the notice is
// gated on) and `buildPracticeNotice` (the framesWillUpload derivation, the
// buildPrivacyNotice call and the join with the room-question sentence).
//
// BEHAVIOUR-NEUTRAL, which is the whole claim. `inlineOracle` below is a
// frozen, literal copy of what PracticeClient.js computed inline before the
// move — same derivations, same call, same template — and every combination of
// the inputs it reads must produce the byte-identical notice through the
// extracted pair. buildPrivacyNotice's own wording is pinned by
// practiceNotices.test.js's and practiceNotices.noPreDraft.test.js's oracles,
// so this file does not re-derive it; it pins the GLUE that those cannot see:
// which flag feeds which argument, and the single space before the clause.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPracticeNotice, buildPrivacyNotice, submittedDocsFlagsFor } from "./practiceNotices";
import { roomQuestionPrivacyClause } from "@/app/copilot/practice/practiceRoomQuestionPrivacy.js";

// The literal pre-extraction derivation, flag by flag.
function inlineOracle({ sttProviderName, isEmbedded, sendFrames, saveEnabled, posting, submittedDocs }) {
  const framesWillUpload = sendFrames && !isEmbedded;
  const hasPosting = !!posting;
  const hasCompany = !!String(posting?.company || "").trim();
  const docsSettled = submittedDocs.status === "done";
  const hasSubmittedResume = !!submittedDocs.resume;
  const hasSubmittedCoverLetter = !!submittedDocs.coverLetter;
  return `${buildPrivacyNotice({
    sttProviderName,
    isEmbedded,
    framesWillUpload,
    hasPosting,
    docsSettled,
    hasSubmittedResume,
    hasSubmittedCoverLetter,
    saveEnabled,
  })} ${roomQuestionPrivacyClause({ isEmbedded, hasPosting, docsSettled, hasSubmittedResume, hasSubmittedCoverLetter, hasCompany })}`;
}

// The same composition PracticeClient.js performs at its call site, through
// the extracted pair.
function extracted({ sttProviderName, isEmbedded, sendFrames, saveEnabled, posting, submittedDocs }) {
  const hasCompany = !!String(posting?.company || "").trim();
  const docFlags = submittedDocsFlagsFor(posting, submittedDocs);
  return buildPracticeNotice({
    sttProviderName,
    isEmbedded,
    sendFrames,
    saveEnabled,
    ...docFlags,
    roomQuestionClause: roomQuestionPrivacyClause({ isEmbedded, ...docFlags, hasCompany }),
  });
}

const POSTINGS = [
  null,
  { id: "p1" },
  { id: "p1", company: "   " },
  { id: "p1", company: "Acme" },
];

// Every status useApplicationDocs can report, with each document combination
// where the status is "done" (the only status that asserts rather than hedges).
const DOCS = [
  { status: "idle", resume: "", coverLetter: "", error: "" },
  { status: "loading", resume: "", coverLetter: "", error: "" },
  { status: "error", resume: "", coverLetter: "", error: "boom" },
  { status: "done", resume: "", coverLetter: "", error: "" },
  { status: "done", resume: "R", coverLetter: "", error: "" },
  { status: "done", resume: "", coverLetter: "C", error: "" },
  { status: "done", resume: "R", coverLetter: "C", error: "" },
];

function everyInput() {
  const out = [];
  for (const sttProviderName of [null, "Deepgram"]) {
    for (const isEmbedded of [false, true]) {
      for (const sendFrames of [false, true]) {
        for (const saveEnabled of [false, true]) {
          for (const posting of POSTINGS) {
            for (const submittedDocs of DOCS) {
              out.push({ sttProviderName, isEmbedded, sendFrames, saveEnabled, posting, submittedDocs });
            }
          }
        }
      }
    }
  }
  return out;
}

const label = (input) => JSON.stringify(input);

describe("submittedDocsFlagsFor", () => {
  test("reads the four flags off the posting and the documents hook, and nothing else", () => {
    expect(submittedDocsFlagsFor({ id: "p1" }, { status: "done", resume: "R", coverLetter: "" })).toEqual({
      hasPosting: true,
      docsSettled: true,
      hasSubmittedResume: true,
      hasSubmittedCoverLetter: false,
    });
    expect(submittedDocsFlagsFor(null, { status: "loading", resume: "", coverLetter: "C" })).toEqual({
      hasPosting: false,
      docsSettled: false,
      hasSubmittedResume: false,
      hasSubmittedCoverLetter: true,
    });
  });

  test("docsSettled is true for the status \"done\" and for no other status", () => {
    for (const status of ["idle", "loading", "error", "done "]) {
      expect(submittedDocsFlagsFor({ id: "p1" }, { status, resume: "", coverLetter: "" }).docsSettled, status).toBe(false);
    }
    expect(submittedDocsFlagsFor({ id: "p1" }, { status: "done", resume: "", coverLetter: "" }).docsSettled).toBe(true);
  });

  test("every flag is a real boolean, never the truthy value it was read from", () => {
    const flags = submittedDocsFlagsFor({ id: "p1" }, { status: "done", resume: "text", coverLetter: "more text" });
    for (const [name, value] of Object.entries(flags)) expect(typeof value, name).toBe("boolean");
  });

  test("hasPosting follows posting truthiness exactly", () => {
    const docs = { status: "idle", resume: "", coverLetter: "" };
    expect(submittedDocsFlagsFor(null, docs).hasPosting).toBe(false);
    expect(submittedDocsFlagsFor(undefined, docs).hasPosting).toBe(false);
    expect(submittedDocsFlagsFor({}, docs).hasPosting).toBe(true);
  });
});

describe("buildPracticeNotice is byte-identical to the inline derivation it replaced", () => {
  test("across every sttProvider x engine x frames x save x posting x documents state", () => {
    const inputs = everyInput();
    // The grid really is the grid: 2 x 2 x 2 x 2 x 4 x 7.
    expect(inputs).toHaveLength(448);
    for (const input of inputs) {
      expect(extracted(input), label(input)).toBe(inlineOracle(input));
    }
  });

  test("[control] the oracle discriminates between inputs, so the comparison above can fail", () => {
    const seen = new Set(everyInput().map((input) => inlineOracle(input)));
    // Not one constant compared against itself: engine, frames, posting, documents,
    // company and save state each change the sentence stack.
    expect(seen.size).toBeGreaterThan(40);
  });

  test("[control] a swapped-flag wiring bug is detected by the same grid", () => {
    // The glue bug this file exists to catch: the two document flags handed to
    // the wrong argument. Built here, in the test, as a variant of the
    // composition -- never by touching the source. It must diverge from the
    // oracle on at least one input, otherwise the grid above could not tell a
    // swapped wiring from a correct one.
    const swapped = (input) => {
      const hasCompany = !!String(input.posting?.company || "").trim();
      const flags = submittedDocsFlagsFor(input.posting, input.submittedDocs);
      const wrong = {
        ...flags,
        hasSubmittedResume: flags.hasSubmittedCoverLetter,
        hasSubmittedCoverLetter: flags.hasSubmittedResume,
      };
      return buildPracticeNotice({
        sttProviderName: input.sttProviderName,
        isEmbedded: input.isEmbedded,
        sendFrames: input.sendFrames,
        saveEnabled: input.saveEnabled,
        ...wrong,
        roomQuestionClause: roomQuestionPrivacyClause({ isEmbedded: input.isEmbedded, ...wrong, hasCompany }),
      });
    };
    const diverging = everyInput().filter((input) => swapped(input) !== inlineOracle(input));
    expect(diverging.length).toBeGreaterThan(0);
    // ...and only where a single document exists: with both or neither the swap
    // is invisible, which is exactly why the grid has the one-document rows.
    for (const input of diverging) {
      const hasResume = input.submittedDocs.resume !== "";
      const hasCover = input.submittedDocs.coverLetter !== "";
      expect(hasResume !== hasCover, label(input)).toBe(true);
    }
  });
});

describe("buildPracticeNotice, stated directly", () => {
  const docFlags = {
    hasPosting: true,
    docsSettled: true,
    hasSubmittedResume: true,
    hasSubmittedCoverLetter: false,
  };
  const base = {
    sttProviderName: "Deepgram",
    isEmbedded: false,
    sendFrames: false,
    saveEnabled: false,
    ...docFlags,
    roomQuestionClause: "ROOM-CLAUSE-SENTINEL.",
  };

  test("appends the room-question clause verbatim after exactly one space", () => {
    const notice = buildPracticeNotice(base);
    expect(notice.endsWith(" ROOM-CLAUSE-SENTINEL.")).toBe(true);
    expect(notice).toBe(
      `${buildPrivacyNotice({
        sttProviderName: "Deepgram",
        isEmbedded: false,
        framesWillUpload: false,
        ...docFlags,
        saveEnabled: false,
      })} ROOM-CLAUSE-SENTINEL.`,
    );
  });

  test("sends frames only when the switch is on AND the engine is not embedded", () => {
    const frames = (over) => buildPracticeNotice({ ...base, ...over }).includes("up to three still frames");
    expect(frames({ sendFrames: true, isEmbedded: false })).toBe(true);
    expect(frames({ sendFrames: false, isEmbedded: false })).toBe(false);
    // The embedded engine never uploads a frame, whatever the switch says.
    expect(frames({ sendFrames: true, isEmbedded: true })).toBe(false);
    expect(frames({ sendFrames: false, isEmbedded: true })).toBe(false);
  });

  test("threads the STT provider and the save switch into their own sentences", () => {
    expect(buildPracticeNotice({ ...base, sttProviderName: "Deepgram" })).toContain("streamed to Deepgram");
    expect(buildPracticeNotice({ ...base, sttProviderName: null })).toContain("Your audio is streamed for transcription.");
    expect(buildPracticeNotice({ ...base, saveEnabled: true })).toContain("uploaded to your own Supabase storage");
    expect(buildPracticeNotice({ ...base, saveEnabled: false })).toContain("stays in your browser");
  });

  test("threads each document flag into the engine sentence", () => {
    const withDocs = (over) => buildPracticeNotice({ ...base, ...over });
    expect(withDocs({})).toContain("The critique also sends the resume you submitted");
    expect(withDocs({ hasSubmittedResume: false, hasSubmittedCoverLetter: true })).toContain(
      "The critique also sends the cover letter you submitted",
    );
    expect(withDocs({ hasSubmittedCoverLetter: true })).toContain("the resume and cover letter you submitted");
    expect(withDocs({ docsSettled: false })).toContain("The critique may also send any resume or cover letter");
    expect(withDocs({ hasPosting: false })).not.toContain("you submitted for the selected posting to Gemini.");
  });
});

describe("the extraction is pure and is WIRED at the call site", () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const NOTICES = stripComments(read("./practiceNotices.js"));
  const CLIENT = stripComments(read("../../app/copilot/practice/PracticeClient.js"));

  test("[control] stripping comments leaves real code behind in both files", () => {
    expect(NOTICES).toMatch(/export function buildPracticeNotice\(/);
    expect(CLIENT).toMatch(/export default function PracticeClient\(/);
  });

  test("practiceNotices.js reaches for no React hook and imports nothing", () => {
    expect(NOTICES).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(NOTICES).not.toMatch(/^import\s/m);
  });

  test("PracticeClient calls the extracted pair and no longer derives the flags itself", () => {
    expect(CLIENT).toMatch(/import \{[^}]*\bbuildPracticeNotice\b[^}]*\} from "@\/lib\/copilot\/practiceNotices"/);
    expect(CLIENT).toMatch(/import \{[^}]*\bsubmittedDocsFlagsFor\b[^}]*\} from "@\/lib\/copilot\/practiceNotices"/);
    expect(CLIENT).toMatch(/buildPracticeNotice\(\{/);
    expect(CLIENT).toMatch(/submittedDocsFlagsFor\(posting, submittedDocs\)/);
    expect(CLIENT).not.toMatch(/const framesWillUpload\b/);
    expect(CLIENT).not.toMatch(/const docsSettled\b/);
    expect(CLIENT).not.toMatch(/const hasSubmittedResume\b/);
    expect(CLIENT).not.toMatch(/buildPrivacyNotice\(/);
  });

  test("every argument the helper reads is handed over at the production call", () => {
    const at = CLIENT.indexOf("buildPracticeNotice({");
    expect(at, "no call site").toBeGreaterThan(-1);
    const call = CLIENT.slice(at, CLIENT.indexOf("});", at));
    for (const arg of ["sttProviderName", "isEmbedded", "sendFrames", "saveEnabled", "...docFlags", "roomQuestionClause"]) {
      expect(call, `${arg} is not wired`).toContain(arg);
    }
    // The room-question sentence is composed from the SAME flags, so the two
    // halves of the notice can never disagree about which documents exist.
    expect(call).toMatch(/roomQuestionPrivacyClause\(\{[^}]*\.\.\.docFlags[^}]*\bhasCompany\b[^}]*\}\)/);
  });
});
