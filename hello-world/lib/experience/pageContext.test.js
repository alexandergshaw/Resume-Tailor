import { describe, it, expect } from "vitest";
import {
  buildPageContext,
  MAX_CONTEXT_CHARS,
  MAX_LISTED_CHILD_PAGES,
  MAX_LISTED_ATTACHMENTS,
  NOTICE_RESERVE_CHARS,
  formatAttachment,
  attachmentKindLabel,
} from "./pageContext.js";

// What "Ask AI" pins when you press it on a project page.
//
// The chat route caps pinned context (MAX_RESUME_CHARS, 12000) and silently
// truncates anything longer with an ellipsis. Silently is the problem: a model
// answering from a body that was cut mid-sentence gives a confident answer
// about half a project, and neither the user nor the model knows. So this
// module owns the budget, spends it deliberately, and SAYS when something was
// left out.
//
// It also decides what an attachment contributes. Video bytes are never sent as
// model context, so for a video the notes and any cached transcript are the
// only things the model will ever know about it - which is exactly why they
// must be here and must be labelled as such.

const page = (over = {}) => ({
  id: "p1",
  title: "Payments migration",
  body: "We moved billing off the legacy processor.",
  ...over,
});

const attachment = (over = {}) => ({
  id: "a1",
  name: "topology.png",
  kind: "image",
  bytes: 2048,
  notes: "",
  transcript: "",
  ...over,
});

// The single inventory line an attachment contributes, picked out of the
// assembled context by file name. Asserting on one line rather than on the
// whole string is what lets a test say "this kind's line changed and no
// other's did".
function lineFor(content, name) {
  return content.split("\n").find((line) => line.includes(name)) || "";
}

describe("buildPageContext", () => {
  it("labels the pin with the page title", () => {
    expect(buildPageContext({ page: page() }).label).toContain("Payments migration");
  });

  it("includes the body, the breadcrumb and the child pages", () => {
    const { content } = buildPageContext({
      page: page(),
      breadcrumb: ["Work", "Platform", "Payments migration"],
      childPages: [{ id: "c1", title: "Rollout plan" }],
    });
    expect(content).toContain("We moved billing off the legacy processor.");
    expect(content).toContain("Work / Platform / Payments migration");
    expect(content).toContain("Rollout plan");
  });

  it("lists each attachment with its kind and the user's notes", () => {
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ name: "topology.png", kind: "image", notes: "before the migration" }),
        attachment({ id: "a2", name: "spec.pdf", kind: "pdf", notes: "" }),
      ],
    });
    expect(content).toContain("topology.png");
    expect(content).toContain("before the migration");
    expect(content).toContain("spec.pdf");
  });

  it("gives a video its notes and transcript, and says so when it has neither", () => {
    // For a video these two strings are the ONLY thing the model ever learns
    // about it - the bytes are not sent. A video listed with nothing attached
    // must not read as though the model watched it.
    const withText = buildPageContext({
      page: page(),
      attachments: [
        attachment({ id: "v1", name: "demo.mp4", kind: "video", notes: "walkthrough", transcript: "first we log in" }),
      ],
    }).content;
    expect(withText).toContain("walkthrough");
    expect(withText).toContain("first we log in");

    const without = buildPageContext({
      page: page(),
      attachments: [attachment({ id: "v2", name: "silent.mp4", kind: "video", notes: "", transcript: "" })],
    }).content;
    expect(without).toContain("silent.mp4");
    expect(without.toLowerCase()).toMatch(/no transcript|not transcribed|no notes/);
  });

  it("names a deck and a spreadsheet by what they are", () => {
    // The parenthesised kind is what tells the model a .pptx is a deck rather
    // than a stray binary. Pinned by position (startsWith), not by
    // toContain: "slide deck" appearing anywhere on the line is also
    // satisfied by a sentence further along it, which leaves the label itself
    // free to be wrong.
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ id: "d1", name: "kickoff.pptx", kind: "slides", notes: "the launch deck" }),
        attachment({ id: "s1", name: "q3.xlsx", kind: "sheet", notes: "" }),
      ],
    });

    expect(lineFor(content, "kickoff.pptx")).toBe(
      "- kickoff.pptx (slide deck) - contents not read - notes: the launch deck",
    );
    expect(lineFor(content, "q3.xlsx")).toBe("- q3.xlsx (spreadsheet) - contents not read");
  });

  it("says 'not read' about the files the model really did not get, and not about the ones it did", () => {
    // This is a claim about the model's actual input, so it has to track what
    // is actually sent. Pressing Ask AI does two things in one handler
    // (app/components/experience/ExperienceTab.js): it pins this context, and
    // then it DOWNLOADS every attachment whose kind is in
    // DOWNLOADABLE_ATTACHMENT_KINDS - image, pdf, text - and hands the bytes
    // to addChatAttachments, which turns them into inline data and extracted
    // text on the same turn. So for those three the model does read the file.
    //
    // A deck or a spreadsheet is downloaded by nothing: OOXML is a zip of XML
    // that no path here parses. Their name and the user's notes are the whole
    // of what the model ever learns, which is exactly why the line has to say
    // so - "- q3.xlsx (spreadsheet)" on its own reads as though the numbers
    // are available, and that is how a model ends up quoting a figure nobody
    // supplied.
    //
    // An earlier draft of this test put the disclaimer on the whole
    // inventory. That was wrong in the more dangerous direction: it told the
    // model it had not read three files it was being handed in the same
    // request.
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ id: "d1", name: "kickoff.pptx", kind: "slides" }),
        attachment({ id: "s1", name: "q3.xlsx", kind: "sheet" }),
        attachment({ id: "i1", name: "topology.png", kind: "image", notes: "before the migration" }),
        attachment({ id: "p1", name: "spec.pdf", kind: "pdf" }),
        attachment({ id: "t1", name: "rows.csv", kind: "text" }),
      ],
    });

    expect(lineFor(content, "kickoff.pptx").toLowerCase()).toMatch(/not read/);
    expect(lineFor(content, "q3.xlsx").toLowerCase()).toMatch(/not read/);
    // The three kinds Ask AI actually uploads must not carry it.
    expect(lineFor(content, "topology.png").toLowerCase()).not.toMatch(/not read/);
    expect(lineFor(content, "spec.pdf").toLowerCase()).not.toMatch(/not read/);
    expect(lineFor(content, "rows.csv").toLowerCase()).not.toMatch(/not read/);
    // And nothing above the list claims it on everything's behalf.
    expect(content.split("\n")[0].toLowerCase()).not.toMatch(/not read/);

    // Positive control: a page with no attachments at all says nothing about
    // reading anything. Without it, hard-coding the phrase somewhere fixed
    // would satisfy the two assertions above.
    expect(buildPageContext({ page: page() }).content.toLowerCase()).not.toMatch(/not read/);
  });

  it("leaves the lines for every other kind exactly as they were", () => {
    // Positive control for the test above: stamping "contents not read" onto
    // every attachment line would satisfy it while quietly changing what the
    // model is told about an image or a PDF. Frozen literals, not a
    // toContain - the shape of these lines is the thing being pinned.
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ id: "i1", name: "topology.png", kind: "image", notes: "before the migration" }),
        attachment({ id: "p1", name: "spec.pdf", kind: "pdf", notes: "" }),
        attachment({ id: "t1", name: "rows.csv", kind: "text", notes: "" }),
      ],
    });
    expect(lineFor(content, "topology.png")).toBe("- topology.png (image) - notes: before the migration");
    expect(lineFor(content, "spec.pdf")).toBe("- spec.pdf (PDF)");
    expect(lineFor(content, "rows.csv")).toBe("- rows.csv (text file)");
  });

  it("never includes attachment bytes or storage paths", () => {
    // The pinned context is sent to a third-party model and logged. An image's
    // bytes would be pure cost and a storage path is an internal detail.
    const { content } = buildPageContext({
      page: page(),
      attachments: [
        attachment({ dataB64: "SECRETBYTES", storage_path: "u1/experience/p1/a1-topology.png", url: "https://signed.example/x" }),
      ],
    });
    expect(content).not.toContain("SECRETBYTES");
    expect(content).not.toContain("u1/experience");
    expect(content).not.toContain("signed.example");
  });

  it("stays within the budget and says what it dropped", () => {
    // Not merely "is shorter than the cap" - a truncation the reader cannot see
    // is the actual defect. Assert the notice, or an implementation that
    // silently slices passes.
    const { content, truncated } = buildPageContext({
      page: page({ body: "x".repeat(MAX_CONTEXT_CHARS * 3) }),
    });
    expect(content.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(truncated).toBe(true);
    expect(content.toLowerCase()).toMatch(/truncat|shortened|not included/);
  });

  it("reports nothing truncated when everything fits", () => {
    // Positive control: an implementation that always claims truncation would
    // pass the test above.
    const { content, truncated } = buildPageContext({ page: page() });
    expect(truncated).toBe(false);
    expect(content.toLowerCase()).not.toMatch(/truncat/);
  });

  it("keeps the title and breadcrumb even when the body must be cut", () => {
    // Spending the whole budget on the body and losing the page's identity
    // makes the model answer about text with no idea what project it is.
    const { content } = buildPageContext({
      page: page({ body: "x".repeat(MAX_CONTEXT_CHARS * 3) }),
      breadcrumb: ["Work", "Payments migration"],
    });
    expect(content).toContain("Payments migration");
    expect(content).toContain("Work / Payments migration");
  });

  it("keeps the attachment inventory even when the body must be cut", () => {
    // The inventory is small and disproportionately useful - it is how the
    // model knows a video exists at all. Losing it to a long body means the
    // model cannot mention files the user can plainly see on the page.
    const { content } = buildPageContext({
      page: page({ body: "x".repeat(MAX_CONTEXT_CHARS * 3) }),
      attachments: [attachment({ name: "topology.png", notes: "the diagram" })],
    });
    expect(content).toContain("topology.png");
  });

  it("produces something usable for an empty page", () => {
    const { content, label } = buildPageContext({ page: { id: "p9", title: "", body: "" } });
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
    expect(typeof content).toBe("string");
  });

  it("never throws on junk input", () => {
    for (const input of [
      {},
      { page: null },
      { page: page(), attachments: null },
      { page: page(), attachments: [null, {}] },
      { page: page(), breadcrumb: null, childPages: null },
    ]) {
      expect(() => buildPageContext(input)).not.toThrow();
    }
  });
});

// A zip is an opaque blob to every path in this repo - nothing unzips one, and
// its bytes are never handed to the model. So it belongs with slides and
// spreadsheets on the "contents not read" side of the per-line rule, NOT with
// image/pdf/text, whose bytes really are sent in the same request.
//
// Getting this wrong is not cosmetic: it would tell the model a zip's contents
// were provided when nothing read them, which is precisely the claim this file
// exists to keep honest.
describe("a zip attachment is inventory only", () => {
  const zip = { name: "project-export.zip", kind: "archive", notes: "", transcript: "" };

  it("says its contents were not read", () => {
    const { content } = buildPageContext({ page: page(), breadcrumb: [], childPages: [], attachments: [zip] });
    expect(content).toContain("project-export.zip");
    expect(content).toContain("contents not read");
  });

  it("keeps the notes when there are some, still disclaimed", () => {
    const { content } = buildPageContext({
      page: page(),
      breadcrumb: [],
      childPages: [],
      attachments: [{ ...zip, notes: "Full source drop for the migration" }],
    });
    expect(content).toContain("contents not read");
    expect(content).toContain("Full source drop for the migration");
  });

  it("does NOT disclaim a pdf alongside it", () => {
    // Positive control: a blanket disclaimer applied to everything would pass
    // both tests above and would lie about the pdf, whose bytes ExperienceTab
    // downloads and attaches to the very same request.
    const { content } = buildPageContext({
      page: page(),
      breadcrumb: [],
      childPages: [],
      attachments: [zip, { name: "spec.pdf", kind: "pdf", notes: "", transcript: "" }],
    });
    const pdfLine = content.split("\n").find((l) => l.includes("spec.pdf"));
    expect(pdfLine).toBeDefined();
    expect(pdfLine).not.toContain("contents not read");
  });

  it("names the kind in words rather than leaving it a generic file", () => {
    const { content } = buildPageContext({ page: page(), breadcrumb: [], childPages: [], attachments: [zip] });
    const line = content.split("\n").find((l) => l.includes("project-export.zip"));
    expect(line).toContain("archive");
  });
});

// WHICH ones, not how many.
//
// Both lists above stop at 60 and report a bare integer. That integer is the
// whole of what the reader gets: "3 sub-pages not included" tells someone that
// the assistant is answering about a project with a hole in it, and gives them
// no way to find out where the hole is. The identity is not even hard to
// recover here — both caps are a PREFIX CUT, so the dropped items are exactly
// the tail of the list that was already in hand; it simply was not returned.
//
// The fix follows lib/experience/tailorContext.js's, which closed the same
// defect for the tailoring prompt after the owner's own words forced it ("i
// need to know exactly which ones were left out"). Two differences from that
// precedent, both deliberate:
//
//  - There, the names go to the ROUTE's response warning and the model-facing
//    notice stays a count. Here there is no such second surface: the only
//    reader of this string is the model that is about to answer questions
//    about the page (app/components/experience/ExperienceTab.js hands
//    `content` straight to the chat, and ChatPanel renders only the `label`).
//    So the names go into the notice itself — otherwise nothing anywhere ever
//    learns them — AND are returned alongside, so that component can surface
//    them to the human without re-deriving a set it does not own.
//  - Because they go into the notice, they compete with the very budget the
//    notice is describing. NOTICE_RESERVE_CHARS is a FIXED number sized for a
//    count-only sentence, and the defensive final clamp at the end of
//    buildPageContext cuts from the tail — where the notice lives. So the
//    names are rationed inside the reserve and the reserve never moves; see
//    lib/experience/droppedNames.js for that rule and the last test here for
//    what it looks like at the boundary.
describe("naming what was left out", () => {
  const children = (n, title = (i) => `Sub-page ${i + 1}`) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: title(i) }));

  it("names the sub-pages it dropped, and not the ones it kept", () => {
    // The mutant this kills first: returning the INCLUDED names. They are the
    // same length of array, they are all real page titles, and every "does it
    // name something" assertion passes on them — while telling the reader the
    // exact opposite of the truth.
    const { content, droppedChildPages } = buildPageContext({
      page: page(),
      childPages: children(MAX_LISTED_CHILD_PAGES + 2),
    });

    expect(droppedChildPages).toEqual([
      `Sub-page ${MAX_LISTED_CHILD_PAGES + 1}`,
      `Sub-page ${MAX_LISTED_CHILD_PAGES + 2}`,
    ]);
    expect(content).toContain(
      `2 sub-pages not included: “Sub-page ${MAX_LISTED_CHILD_PAGES + 1}”, “Sub-page ${MAX_LISTED_CHILD_PAGES + 2}”`,
    );
    // The kept ones are listed above as inventory and must NOT also appear in
    // the "left out" sentence.
    expect(content.slice(content.lastIndexOf("[Note:"))).not.toContain("“Sub-page 1”");
  });

  it("pins the cap on both sides", () => {
    // Off-by-one at the cap is the other mutant that reads perfectly: exactly
    // 60 children must produce no notice at all, and the 61st must be the one
    // named — never the 60th, which really was included.
    const exactly = buildPageContext({ page: page(), childPages: children(MAX_LISTED_CHILD_PAGES) });
    expect(exactly.droppedChildPages).toEqual([]);
    expect(exactly.truncated).toBe(false);
    expect(exactly.content).not.toContain("not included");

    const oneMore = buildPageContext({ page: page(), childPages: children(MAX_LISTED_CHILD_PAGES + 1) });
    expect(oneMore.droppedChildPages).toEqual([`Sub-page ${MAX_LISTED_CHILD_PAGES + 1}`]);
    expect(oneMore.truncated).toBe(true);
    expect(oneMore.content).toContain(`1 sub-page not included: “Sub-page ${MAX_LISTED_CHILD_PAGES + 1}”`);
    expect(oneMore.content).toContain(`- Sub-page ${MAX_LISTED_CHILD_PAGES}`);
  });

  it("calls an untitled dropped sub-page what the list above already calls it", () => {
    // The tree creates pages titled "", and people write the body before
    // naming one — so a nameless page is ordinary, not a fixture. It must not
    // reach the sentence as an empty string (`“”`) or as its raw id, and it
    // must use the SAME word the inventory line above it uses, or the reader
    // is looking for two different things.
    const list = [...children(MAX_LISTED_CHILD_PAGES), { id: "c-blank", title: "   " }];
    const { content, droppedChildPages } = buildPageContext({ page: page(), childPages: list });

    expect(droppedChildPages).toEqual(["Untitled page"]);
    expect(content).toContain("1 sub-page not included: “Untitled page”");
    expect(content).not.toContain("“”");
    expect(content).not.toContain("c-blank");
  });

  it("names the attachments it dropped", () => {
    const many = Array.from({ length: MAX_LISTED_ATTACHMENTS + 3 }, (_, i) =>
      attachment({ id: `a${i}`, name: `file-${i}.pdf`, kind: "pdf" }),
    );
    const { content, droppedAttachments } = buildPageContext({ page: page(), attachments: many });

    expect(droppedAttachments).toEqual([
      `file-${MAX_LISTED_ATTACHMENTS}.pdf`,
      `file-${MAX_LISTED_ATTACHMENTS + 1}.pdf`,
      `file-${MAX_LISTED_ATTACHMENTS + 2}.pdf`,
    ]);
    expect(content).toContain(
      `3 attachments not included: “file-${MAX_LISTED_ATTACHMENTS}.pdf”, “file-${MAX_LISTED_ATTACHMENTS + 1}.pdf”, “file-${MAX_LISTED_ATTACHMENTS + 2}.pdf”`,
    );
    expect(content).toContain(`- file-${MAX_LISTED_ATTACHMENTS - 1}.pdf (PDF)`);
    expect(content).not.toContain(`- file-${MAX_LISTED_ATTACHMENTS}.pdf (PDF)`);
  });

  it("neither counts nor names a row that was never going to be listed", () => {
    // formatAttachment refuses anything without a usable name (see its own
    // guard). Counting such a row as "an attachment not included" would
    // report a file the user does not have, and NAMING it would force an
    // "Untitled file" that is worse still — the very line that guard exists
    // to stop being minted. So the cap now applies to the attachments that
    // would really have produced a line, which also makes the count and the
    // names describe one single set by construction.
    const junk = [null, {}, { name: "  " }, "spec.pdf"];
    const real = Array.from({ length: MAX_LISTED_ATTACHMENTS }, (_, i) =>
      attachment({ id: `a${i}`, name: `file-${i}.pdf`, kind: "pdf" }),
    );
    const { content, droppedAttachments, truncated } = buildPageContext({
      page: page(),
      attachments: [...junk, ...real],
    });

    expect(droppedAttachments).toEqual([]);
    expect(truncated).toBe(false);
    expect(content).not.toContain("Untitled file");
    // And every real file still made it — the junk did not eat four slots.
    expect(content).toContain(`- file-${MAX_LISTED_ATTACHMENTS - 1}.pdf (PDF)`);
  });

  it("keeps both counts and both name lists in one notice", () => {
    const { content, truncated } = buildPageContext({
      page: page({ body: "x".repeat(MAX_CONTEXT_CHARS * 3) }),
      childPages: children(MAX_LISTED_CHILD_PAGES + 1),
      attachments: Array.from({ length: MAX_LISTED_ATTACHMENTS + 1 }, (_, i) =>
        attachment({ id: `a${i}`, name: `file-${i}.pdf`, kind: "pdf" }),
      ),
    });
    expect(truncated).toBe(true);
    expect(content).toContain("the body was truncated");
    expect(content).toContain(`1 sub-page not included: “Sub-page ${MAX_LISTED_CHILD_PAGES + 1}”`);
    expect(content).toContain(`1 attachment not included: “file-${MAX_LISTED_ATTACHMENTS}.pdf”`);
  });

  it("shrinks the name list rather than blowing the notice reserve", () => {
    // THE TRAP THIS FILE'S OWN HEADER NAMES. A notice that grows with the
    // number of names is competing for the reserve carved out to hold it, and
    // the defensive clamp at the end of buildPageContext cuts from the tail —
    // so the sentence explaining the truncation is the first thing a long list
    // would destroy, mid-name, mid-quote.
    //
    // The reserve does not move. The NAMES do: they are handed back to the
    // "and N more" tally until the whole notice fits.
    const long = (i) => `Sub-page ${i + 1} — the quarterly rollout notes`;
    const { content } = buildPageContext({
      page: page({ body: "x".repeat(MAX_CONTEXT_CHARS * 3) }),
      childPages: children(MAX_LISTED_CHILD_PAGES + 10, long),
    });

    const notice = content.slice(content.lastIndexOf("[Note:"));
    expect(content.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(notice.length).toBeLessThanOrEqual(NOTICE_RESERVE_CHARS);
    // Intact: the closing bracket survived, and no name was cut mid-quote.
    expect(notice.endsWith("]")).toBe(true);
    expect(notice).not.toMatch(/“[^”]*$/);
    // The count is never what gets sacrificed — that is the number the reader
    // needs even when the names could not all fit.
    expect(notice).toContain("10 sub-pages not included:");
    expect(notice).toMatch(/and \d+ more/);
  });

  it("keeps the bare count when not one name can fit", () => {
    // The degenerate end of the same rule: a single title longer than the
    // whole reserve leaves nothing to say, and the notice falls back to
    // exactly what it says today rather than printing a fragment of a title.
    const { content } = buildPageContext({
      page: page(),
      childPages: [
        ...children(MAX_LISTED_CHILD_PAGES),
        { id: "c-huge", title: "T".repeat(NOTICE_RESERVE_CHARS * 2) },
      ],
    });
    const notice = content.slice(content.lastIndexOf("[Note:"));
    expect(notice).toContain("1 sub-page not included");
    expect(notice).not.toContain("1 sub-page not included:");
    expect(notice.length).toBeLessThanOrEqual(NOTICE_RESERVE_CHARS);
    expect(notice.endsWith("]")).toBe(true);
  });

  it("returns empty name lists, never undefined, when nothing was dropped", () => {
    // A caller that renders `droppedChildPages.length` must not have to guard
    // for the ordinary case.
    const result = buildPageContext({ page: page() });
    expect(result.droppedChildPages).toEqual([]);
    expect(result.droppedAttachments).toEqual([]);
  });
});

// Two helpers became public exports so the meeting copilot can build its own
// multi-page context without re-implementing the attachment-honesty rules.
//
// Re-implementing them is the thing to avoid: this module is the single
// enforcement point for "an inventory line reads ONLY name/kind/notes/
// transcript - never bytes, storage_path or url". A second copy in another
// feature is a second place for that to drift, and the drift would not look
// like a bug, it would look like a model quoting a file nobody read.
//
// A public export cannot enforce that its one careful caller stays its only
// caller. lib/copilot/groundingNotice.js records what that cost last time: a
// helper whose private caller always checked a precondition was exported
// unchanged, and the unchecked case then returned a sentence claiming a
// document had been sent when none existed. Hence the guard asserted below.
describe("formatAttachment as a public export", () => {
  it("builds the same inventory line the pinned context uses", () => {
    expect(formatAttachment({ name: "spec.pdf", kind: "pdf", notes: "The API contract" })).toBe(
      "- spec.pdf (PDF) - notes: The API contract",
    );
  });

  it("keeps the contents-not-read disclaimer for the kinds nothing reads", () => {
    expect(formatAttachment({ name: "kickoff.pptx", kind: "slides" })).toContain("contents not read");
    expect(formatAttachment({ name: "q3.xlsx", kind: "sheet" })).toContain("contents not read");
    expect(formatAttachment({ name: "export.zip", kind: "archive" })).toContain("contents not read");
  });

  it("still does NOT disclaim the kinds whose bytes really are sent", () => {
    // The per-line rule is the whole reason this helper is worth sharing
    // rather than approximating.
    expect(formatAttachment({ name: "spec.pdf", kind: "pdf" })).not.toContain("contents not read");
    expect(formatAttachment({ name: "shot.png", kind: "image" })).not.toContain("contents not read");
  });

  it("returns nothing at all for input that is not an attachment", () => {
    // THE GUARD. Left alone, the helper's own defaults turn `null` into
    // `- Untitled file (file)` - an inventory line for a file that does not
    // exist, manufactured by a caller that passed junk. Inside this module
    // that was unreachable because formatAttachments filtered first; a public
    // export has no such promise.
    expect(formatAttachment(null)).toBe("");
    expect(formatAttachment(undefined)).toBe("");
    expect(formatAttachment({})).toBe("");
    expect(formatAttachment({ name: "   " })).toBe("");
    expect(formatAttachment("spec.pdf")).toBe("");
  });

  it("never lets a storage path or url reach the line", () => {
    // Asserted on a row carrying every field the real database row has, so
    // this fails if the helper ever starts spreading its input.
    const line = formatAttachment({
      name: "spec.pdf",
      kind: "pdf",
      notes: "The API contract",
      storage_path: "u1/experience/p1/a1-spec.pdf",
      url: "https://example.com/signed/abc",
      bytes: 12345,
    });
    expect(line).not.toContain("u1/experience");
    expect(line).not.toContain("https://");
    expect(line).not.toContain("12345");
  });
});

describe("attachmentKindLabel as a public export", () => {
  it("names each kind in the words the inventory uses", () => {
    expect(attachmentKindLabel("pdf")).toBe("PDF");
    expect(attachmentKindLabel("image")).toBe("image");
    expect(attachmentKindLabel("video")).toBe("video");
    expect(attachmentKindLabel("text")).toBe("text file");
    expect(attachmentKindLabel("slides")).toBe("slide deck");
    expect(attachmentKindLabel("sheet")).toBe("spreadsheet");
    expect(attachmentKindLabel("archive")).toBe("archive");
  });

  it("falls back to a plain word for a kind it does not know", () => {
    expect(attachmentKindLabel("hologram")).toBe("file");
    expect(attachmentKindLabel(undefined)).toBe("file");
  });
});
