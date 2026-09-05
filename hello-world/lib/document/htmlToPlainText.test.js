// @vitest-environment jsdom
//
// ACCEPTANCE tests for AC-C1 (the clipboard is the text of the surface on
// screen) and AC-C19 (the highlight toggle changes no copied byte).
//
// WHY jsdom AND NOT node (AC-C1's OBSERVED BY 1, plan R-1/C-1): `htmlToPlainText`
// is specified to parse with `new DOMParser().parseFromString(html, "text/html")`
// -- an INERT document, so a pasted `<img src>` starts no resource load, which
// `element.innerHTML = html` on a live document would. `typeof DOMParser` is
// `undefined` in this repo's default vitest `environment: "node"` (measured), so
// this file carries the per-file jsdom docblock above and AC-C19's equality
// lives HERE rather than in `docxPreview.test.js`, which is a node file and
// would throw `ReferenceError` on the same assertion.
//
// One `it` per row of the spec table, each stating its corpus. The table has
// SEVENTEEN rows: the sixteen of AC-C1.3 plus F1, which the plan added after
// measuring that the sixteen implemented literally FAIL the AC's own equality
// (email: 87 characters against an expected 86; cover template: 15 lines
// against an expected 14).

import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "./htmlToPlainText.js";
import { renderModelToHtml, linesToModel, modelToLines } from "./docxPreview.js";
import { markVersionChanges } from "./versionDiff.js";
import { emailPreviewLines } from "@/lib/tailor/documentScopes.js";

// Written as a code point, never as a pasted glyph: an NBSP in source is
// invisible in every diff and every review, and a corpus that silently loses
// it makes the N1 assertion vacuous (AC-C1.4).
const NBSP = String.fromCharCode(0x00a0);
const SP = String.fromCharCode(0x0020);

// A negative assertion whose operand can be `undefined` is a positive
// assertion about nothing: `expect(undefined).not.toContain("x")` PASSES.
// Every negative-containment check below goes through this gate first.
function nonEmptyString(value) {
  expect(typeof value).toBe("string");
  expect(value.length).toBeGreaterThan(0);
  return value;
}

describe("harness sanity control", () => {
  it("DOMParser is available here -- if this is red, every row below is red for the wrong reason", () => {
    expect(typeof DOMParser).toBe("function");
    const doc = new DOMParser().parseFromString("<p>x</p>", "text/html");
    expect(doc.body.childNodes.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BLOCK rows -- B1..B7
// ---------------------------------------------------------------------------

describe("AC-C1.3 block rows", () => {
  it("B1: a <p> contributes its inline text then ONE line terminator", () => {
    // Corpus: two flat <p>s, the shape renderModelToHtml emits for every
    // paragraph and the shape insertReference inserts at the caret.
    expect(htmlToPlainText("<p>A</p><p>B</p>")).toBe("A\nB");
  });

  it("B2: a <div> behaves exactly as a <p> -- Chrome's default block for Enter in a contentEditable", () => {
    // Corpus: the exact mixed shape a hand-edit produces (a seeded <p>, then
    // blocks Chrome created by pressing Enter).
    expect(htmlToPlainText("<p>A</p><div>B</div><div>C</div>")).toBe("A\nB\nC");
  });

  it("B3: h1..h6 behave exactly as a <p> -- EditorToolbar's formatBlock over BLOCK_STYLES", () => {
    expect(htmlToPlainText("<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5><h6>F</h6>")).toBe("A\nB\nC\nD\nE\nF");
  });

  it("B4: an <li> is a bare line -- NO bullet glyph, NO indent, NO numbering", () => {
    // Corpus: EditorToolbar.exec("insertUnorderedList"/"insertOrderedList")'s
    // own output. An app-introduced bullet character in a resume pasted into
    // an ATS is AC-C7's class of harm in visible form.
    const unordered = htmlToPlainText("<ul><li>Led migration</li><li>Built pipeline</li></ul>");
    const ordered = htmlToPlainText("<ol><li>Led migration</li><li>Built pipeline</li></ol>");
    expect(unordered).toBe("Led migration\nBuilt pipeline");
    expect(ordered).toBe("Led migration\nBuilt pipeline");
    for (const glyph of ["\u2022", "\u00b7", "-", "*", "\t", "1."]) {
      expect(nonEmptyString(unordered)).not.toContain(glyph);
      expect(nonEmptyString(ordered)).not.toContain(glyph);
    }
  });

  it("B5: <td>/<th> each contribute one line -- a docx table never reaches here AS a table (AC section 0.5)", () => {
    expect(htmlToPlainText("<table><tbody><tr><th>H1</th><th>H2</th></tr><tr><td>A</td><td>B</td></tr></tbody></table>")).toBe("H1\nH2\nA\nB");
  });

  it("B6: blockquote, pre, dt, dd, figcaption and address each behave as a <p>", () => {
    // Corpus: paste only -- no in-app producer emits these. Named so a later
    // reader knows the row is deliberate rather than speculative.
    expect(
      htmlToPlainText("<blockquote>A</blockquote><pre>B</pre><dl><dt>C</dt><dd>D</dd></dl><figcaption>E</figcaption><address>F</address>"),
    ).toBe("A\nB\nC\nD\nE\nF");
  });

  it("B7: ul, ol, table, tbody, thead and tr contribute NOTHING of their own", () => {
    // The failure this pins: a container that also emits a terminator turns
    // a three-bullet list into a list plus a phantom blank line.
    expect(htmlToPlainText("<ul><li>A</li><li>B</li><li>C</li></ul><p>After</p>")).toBe("A\nB\nC\nAfter");
    expect(htmlToPlainText("<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>A</td></tr></tbody></table><p>After</p>")).toBe("H\nA\nAfter");
  });
});

// ---------------------------------------------------------------------------
// INLINE rows -- I1, I2
// ---------------------------------------------------------------------------

describe("AC-C1.3 inline rows", () => {
  it("I1: a <span> at any nesting with any inline style contributes its children's text with NO boundary", () => {
    // Corpus: renderModelToHtml's per-run span, plus the nested spans
    // EditorToolbar.exec("bold") produces under styleWithCSS.
    expect(
      htmlToPlainText('<p><span style="font-weight:700">Bold</span><span> and </span><span style="font-style:italic"><span>nested</span></span></p>'),
    ).toBe("Bold and nested");
  });

  it("I2: b, i, u, em, strong, a, font, mark, code, small, sub and sup behave exactly as a <span>", () => {
    expect(
      htmlToPlainText('<p><b>a</b><i>b</i><u>c</u><em>d</em><strong>e</strong><a href="#">f</a><font>g</font><mark>h</mark><code>i</code><small>j</small><sub>k</sub><sup>l</sup></p>'),
    ).toBe("abcdefghijkl");
  });
});

// ---------------------------------------------------------------------------
// TEXT rows -- T1, T2
// ---------------------------------------------------------------------------

describe("AC-C1.3 text rows", () => {
  it("T1: a text node contributes its data VERBATIM -- no whitespace collapsing, no trimming", () => {
    // Corpus: every rendered <p> carries white-space:pre-wrap
    // (docxPreview.js renderModelToHtml), so runs of spaces and tabs ARE on
    // screen. modelToLines's per-paragraph .replace(/\s+$/g,"") is the
    // DELIBERATELY REJECTED rule and is the sole cause of the measured
    // 5-of-37 resume divergence from the screen.
    const out = htmlToPlainText("<p>   leading and    inner   </p><p>\ttabbed\t</p>");
    expect(out).toBe("   leading and    inner   \n\ttabbed\t");
    // Explicit anti-collapse control: the input really does contain a run of
    // four spaces, so the equality above cannot pass vacuously.
    expect(out).toContain("    ");
  });

  it("T2: a \\n inside a text node is one line break -- the <w:br> soft break arrives as a literal \\n in r.text", () => {
    // Corpus: renderModelToHtml over the run AC-C17's parser fix produces
    // for the cover letter's sign-off.
    const html = renderModelToHtml({
      paragraphs: [{ runs: [{ text: "Sincerely,\nAlex Shaw" }], align: "left", spaceBeforePt: 0, spaceAfterPt: 4 }],
    });
    expect(htmlToPlainText(html)).toBe("Sincerely,\nAlex Shaw");
  });
});

// ---------------------------------------------------------------------------
// BR rows -- BR1, BR2. BR2 is the most defect-prone row in the table.
// ---------------------------------------------------------------------------

describe("AC-C1.3 <br> rows", () => {
  it("BR1: a <br> that is NOT its block's last child contributes one \\n at that point", () => {
    // Corpus: Shift+Enter inside a contentEditable.
    expect(htmlToPlainText("<p>Staff Engineer<br>Omaha, NE</p>")).toBe("Staff Engineer\nOmaha, NE");
  });

  it("BR2: a <br> that IS its block's last child contributes NOTHING", () => {
    // Corpus 1: renderModelToHtml's blank-paragraph form, emitted for EVERY
    // blank paragraph -- the shipped cover-letter template has 7 of 14.
    // The naive rule ("a trailing <br> counts unless the block already has
    // text") yields "\n\nB" here: TWO blank lines where the screen shows one.
    expect(htmlToPlainText('<p style="text-align:left;margin:0pt 0 4pt;white-space:pre-wrap;min-height:0.9em;"><br></p><p>B</p>')).toBe("\nB");
    // Corpus 2: Chrome's bogus trailing <br> after typed text.
    expect(htmlToPlainText("<p>A<br></p><p>B</p>")).toBe("A\nB");
    // Corpus 3: a blank paragraph ALONE is the empty string, not "\n".
    expect(htmlToPlainText('<p style="min-height:0.9em;"><br></p>')).toBe("");
  });
});

// ---------------------------------------------------------------------------
// EXCLUSION rows -- X1, X2
// ---------------------------------------------------------------------------

describe("AC-C1.3 exclusion rows", () => {
  it("X1: script, style, template and noscript contribute nothing", () => {
    const out = htmlToPlainText("<p>A<script>var leaked = 1;</script><style>p{color:red}</style></p><template>TPL</template><noscript>NOJS</noscript><p>B</p>");
    expect(out).toBe("A\nB");
    for (const leak of ["leaked", "color:red", "TPL", "NOJS"]) {
      expect(nonEmptyString(out)).not.toContain(leak);
    }
  });

  it("X2: [hidden], aria-hidden=\"true\" and inline display:none contribute nothing", () => {
    const out = htmlToPlainText('<p>A</p><p hidden>HIDDEN</p><p aria-hidden="true">ARIA</p><p style="display:none">NONE</p><p>B</p>');
    expect(out).toBe("A\nB");
    for (const leak of ["HIDDEN", "ARIA", "NONE"]) {
      expect(nonEmptyString(out)).not.toContain(leak);
    }
  });
});

// ---------------------------------------------------------------------------
// N1 -- the ONE documented substitution (AC-C1.4)
// ---------------------------------------------------------------------------

describe("AC-C1.4 N1: U+00A0 becomes U+0020, and nothing else changes", () => {
  it("substitutes every NBSP, including one straddling a text-node boundary", () => {
    // Chrome's contentEditable emits &nbsp; for the SECOND of two
    // consecutively typed spaces. An ATS keyword matcher reading
    // "Mutual" + U+00A0 + "Omaha" does not tokenise it as two words -- the
    // same failure class mui-a11y-traps item 6 records for U+200B.
    const input = `<p>Mutual${NBSP}Omaha</p><p><span>Java${NBSP}</span><span>${NBSP}Script</span></p>`;
    // MANDATORY SELF-TEST: without this, one typo in the corpus turns the
    // assertion below into a permanently-green tautology.
    expect(input).toContain(NBSP);
    const out = htmlToPlainText(input);
    expect(out).toBe(`Mutual${SP}Omaha\nJava${SP}${SP}Script`);
    expect(nonEmptyString(out)).not.toContain(NBSP);
  });

  it("introduces no invisible codepoint of its own", () => {
    // Constructed with escapes, never with pasted glyphs (AC-C7).
    const INVISIBLE = new RegExp("[\\u200B\\u200C\\u200D\\u2060\\uFEFF\\u00AD]");
    // MANDATORY SELF-TEST: the regex really does match a zero-width joiner.
    expect(INVISIBLE.test(`Java\u200BScript`)).toBe(true);
    const out = htmlToPlainText(`<p>Alex Shaw</p><p>Mutual${NBSP}Omaha</p>`);
    expect(INVISIBLE.test(nonEmptyString(out))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F1 -- the seventeenth row. Without it AC-C1's own equality is FALSE.
// ---------------------------------------------------------------------------

describe("AC-C1.3 F1: the LAST block's terminator is dropped -- exactly one, at the very end", () => {
  it("is RED against .trim(), .trimEnd() AND .replace(/\\n+$/,\"\") on one corpus", () => {
    // MANDATED CORPUS (plan PART 2): ["", "Only line.", ""] is the minimum
    // 3-row corpus that is red against all three lazy repairs at once. A
    // corpus whose FIRST line is blank kills .trim() only; one whose LAST
    // line is blank kills .trimEnd() and the regex only.
    //
    // Why this matters beyond tidiness: .trim() silently eats a cover
    // letter's opening blank line and .trimEnd() its closing one -- in a
    // document the user pastes into an ATS.
    const lines = ["", "Only line.", ""];
    const want = lines.join("\n");
    const got = htmlToPlainText(renderModelToHtml(linesToModel(lines)));
    expect(got).toBe(want);
    // The three lazy repairs, each shown to differ from `want` on THIS
    // corpus -- so the equality above is known to be discriminating.
    expect(got.trim()).not.toBe(want);
    expect(got.trimEnd()).not.toBe(want);
    expect(got.replace(/\n+$/, "")).not.toBe(want);
  });

  it("holds on the recommended 5-row corpus, which also exercises T1's no-trim rule", () => {
    const lines = ["", "Dear Hiring Manager,", "", "Alex Shaw   ", ""];
    const want = lines.join("\n");
    const got = htmlToPlainText(renderModelToHtml(linesToModel(lines)));
    expect(got).toBe(want);
    expect(got).toContain("Alex Shaw   \n"); // the penultimate row's trailing spaces survive
    expect(got.trim()).not.toBe(want);
    expect(got.trimEnd()).not.toBe(want);
    expect(got.replace(/\n+$/, "")).not.toBe(want);
  });

  it("is a FLAG, not endsWith(\"\\n\"): a trailing text node's own newline survives", () => {
    // The rule is "the last thing the walk emitted was a block terminator".
    // The endsWith("\n") shortcut is right for every construct this app
    // PRODUCES and wrong for a paste whose last node is bare text ending in
    // a newline -- it eats a text node's own data, which T1 says is verbatim.
    expect(htmlToPlainText("<p>A</p>tail\n")).toBe("A\ntail\n");
    expect(htmlToPlainText("<p>A\n</p>")).toBe("A\n"); // exactly ONE terminator removed, not all of them
  });

  it("is DEPTH-INDEPENDENT: a list closes with no terminator of the container's own", () => {
    // The other tempting form (`depth === 0`) is measurably wrong here: the
    // body's last child is a <ul>, a container, not a block, so a
    // depth-gated flag keeps the <li>'s terminator and yields "A\nB\n".
    expect(htmlToPlainText("<ul><li>A</li><li>B</li></ul>")).toBe("A\nB");
  });

  it("edge rows, pinned so nobody \"fixes\" them", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText("bare text")).toBe("bare text"); // no block, so nothing to drop
    expect(htmlToPlainText("<p>A</p>")).toBe("A");
    expect(htmlToPlainText("<p>A</p>tail")).toBe("A\ntail");
  });

  it("FILED, NOT FIXED (plan C-7): a block nested directly in another block emits TWO terminators", () => {
    // "<div><p>A</p></div><p>B</p>" is "A\n\nB" where the screen shows two
    // lines. This is B1/B2 as the AC settled them, it is identical under both
    // F1 forms, and it is NOT introduced by this change. No in-app producer
    // nests blocks (renderModelToHtml emits a flat <p> run; insertReference
    // inserts a flat <p>; Chrome's Enter makes a flat <div>) -- it arrives
    // only by paste, and <blockquote><p>...</p></blockquote> is a common
    // Word/Google-Docs paste shape. Routed to manual check MC-4.
    //
    // Pinned here as the SETTLED behaviour so a later reader can tell a
    // deliberate decision from an oversight, and so "fixing" it is a visible
    // change to this file rather than a silent one.
    expect(htmlToPlainText("<div><p>A</p></div><p>B</p>")).toBe("A\n\nB");
  });
});

// ---------------------------------------------------------------------------
// AC-C1.7 -- getText must be defensive, so the function must be too
// ---------------------------------------------------------------------------

describe("AC-C1.7 defensive entry", () => {
  it("returns \"\" for null/undefined and never throws on a non-string", () => {
    // editorRef.current.innerText is `undefined` in this jsdom without the
    // polyfill, and `undefined.trim()` throws INSIDE an async click handler,
    // where the rejection is unhandled and the user sees nothing at all.
    expect(htmlToPlainText(undefined)).toBe("");
    expect(htmlToPlainText(null)).toBe("");
    expect(htmlToPlainText(0)).toBe("0");
    expect(htmlToPlainText(false)).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// AC-C1.5 / AC-C1.6 -- the property, over the two producers and a hand-edit
// ---------------------------------------------------------------------------

describe("AC-C1.5: the derived text equals the surface, over both in-app producers", () => {
  it("row 1 -- renderModelToHtml over a 5-paragraph model: 2 trailing-whitespace, 1 blank, 1 soft break, 1 multi-run", () => {
    // 4 of the 5 rows are failable: rows 1 and 5 by the rejected
    // trailing-whitespace strip, row 2 by BR2, row 3 by T2.
    const model = {
      paragraphs: [
        { runs: [{ text: "Header   " }], align: "left", spaceBeforePt: 0, spaceAfterPt: 4 },
        { runs: [], align: "left", spaceBeforePt: 0, spaceAfterPt: 4 },
        { runs: [{ text: "Sincerely,\nAlex Shaw" }], align: "left", spaceBeforePt: 0, spaceAfterPt: 4 },
        { runs: [{ text: "Multi " }, { text: "run " }, { text: "line" }], align: "left", spaceBeforePt: 0, spaceAfterPt: 4 },
        { runs: [{ text: "Tail  " }], align: "left", spaceBeforePt: 0, spaceAfterPt: 4 },
      ],
    };
    const html = renderModelToHtml(model);
    const got = htmlToPlainText(html);
    expect(got).toBe("Header   \n\nSincerely,\nAlex Shaw\nMulti run line\nTail  ");

    // The surface's own text, read off a parsed copy of the very html the
    // render site sets. This corpus is FLAT <p>s, which is the one shape
    // where textContent per <p> is a faithful reading of the screen --
    // AC-C1.6 below is the corpus where it is not, and that is why this is
    // not the general observation.
    const surface = new DOMParser().parseFromString(html, "text/html").body;
    expect(got).toBe([...surface.querySelectorAll("p")].map((p) => p.textContent).join("\n"));

    // The rejected derivation, shown to be measurably different -- so the
    // equality above is not something every derivation would satisfy.
    expect(modelToLines(model, { includeEmpty: true }).join("\n")).not.toBe(got);
  });

  it("row 2 -- linesToModel over a 6-line hiring email preserves emailPreviewLines' invariant byte for byte", () => {
    // documentScopes.js's own doc comment states this invariant: the preview
    // render model and the dialog's copy control must be the same text.
    // 3 of the 6 rows are failable (2 trailing-whitespace, 1 blank).
    const entry = {
      emailSubject: "Application: Staff Engineer",
      emailResultLines: ["Hi there,", "", "Please find my resume.  ", "", "Thanks,", "Alex Shaw"],
    };
    const lines = emailPreviewLines(entry);
    const html = renderModelToHtml(linesToModel(lines));
    expect(htmlToPlainText(html)).toBe(lines.join("\n"));
    // Corpus self-test: the fixture really does carry a blank row and a
    // trailing-whitespace row, so the equality cannot pass vacuously.
    expect(lines).toContain("");
    expect(lines.some((l) => /\s$/.test(l) && l.length > 0)).toBe(true);
  });
});

describe("AC-C1.6: the hand-edited corpus a querySelectorAll(\"p\") implementation cannot pass", () => {
  // 7 top-level children -- H2, P, P, H3, UL, DIV, P -- comprising 9
  // line-bearing block nodes of which 6 are NON-<p> (H2, H3, LI, LI, LI,
  // DIV), carrying 9 content lines and 1 blank line. Hand-authored to model
  // Chrome's contentEditable output; every construct traces to a producer in
  // AC-C1.3's table.
  const CORPUS =
    "<h2>ALEX SHAW</h2>" +
    "<p>Staff Engineer<br>Omaha, NE</p>" +
    '<p style="min-height:0.9em;"><br></p>' +
    "<h3>EXPERIENCE</h3>" +
    "<ul><li>Led migration</li><li>Built pipeline</li><li>Shipped v2</li></ul>" +
    "<div>Added by pressing Enter</div>" +
    `<p>Skills: JS,${NBSP}SQL</p>`;

  it("carries all 9 content lines, in order, with the blank line preserved", () => {
    expect(htmlToPlainText(CORPUS)).toBe(
      [
        "ALEX SHAW",
        "Staff Engineer",
        "Omaha, NE",
        "",
        "EXPERIENCE",
        "Led migration",
        "Built pipeline",
        "Shipped v2",
        "Added by pressing Enter",
        `Skills: JS,${SP}SQL`,
      ].join("\n"),
    );
  });

  it("contains all three bullet texts -- the conjunct a querySelectorAll(\"p\") rule cannot satisfy", () => {
    const got = nonEmptyString(htmlToPlainText(CORPUS));
    for (const bullet of ["Led migration", "Built pipeline", "Shipped v2"]) {
      expect(got).toContain(bullet);
    }
    // POSITIVE CONTROL for the conjunct: the rejected derivation really does
    // lose them, so "contains all three bullets" is a discriminating test and
    // not a property every plausible implementation has. Measured: 6 of 9
    // content lines lost outright and a 7th boundary destroyed (Staff
    // Engineer fuses to Omaha, NE, because textContent renders <br> as
    // nothing -- the same fusion class as "Sincerely,Alex Shaw").
    const naive = [...new DOMParser().parseFromString(CORPUS, "text/html").querySelectorAll("p")]
      .map((p) => p.textContent)
      .join("\n");
    expect(naive).not.toContain("Led migration");
    expect(naive).toContain("Staff EngineerOmaha, NE");
    expect(naive.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AC-C19 -- moved here from docxPreview.test.js (plan R-1/C-1)
// ---------------------------------------------------------------------------

describe("AC-C19: the version-diff highlight changes not one copied byte", () => {
  it("htmlToPlainText of the annotated model equals htmlToPlainText of the plain model", () => {
    // markChangedParagraphs returns { ...p, runs: p.runs.map(r => ({...r, mark:true})) }
    // -- it adds `mark` and never touches r.text. renderModelToHtml turns
    // `mark` into a background-color INSIDE the span's style attribute, never
    // into text. htmlToPlainText reads text nodes only (AC-C1.3 I1). So the
    // property holds by construction and this is a guard on it.
    const plain = linesToModel(["ALEX SHAW", "", "Led migration", "Built pipeline"]);
    const previousLines = ["ALEX SHAW", "", "Led migration", "A line that is gone"];
    const currentLines = modelToLines(plain, { includeEmpty: true });
    const annotated = markVersionChanges(plain, previousLines, currentLines);

    // CORPUS SELF-TEST, mandatory: state how many paragraphs actually carry
    // mark:true. With zero annotated paragraphs the equality below is vacuous
    // -- it would compare a model with itself.
    const markedCount = annotated.paragraphs.filter((p) => p.runs.some((r) => r.mark)).length;
    expect(markedCount).toBe(1);
    expect(annotated.paragraphs.length).toBe(4); // and 3 paragraphs are deliberately UNannotated
    expect(renderModelToHtml(annotated)).toContain("background-color:rgba(255,213,79,0.55)");
    expect(renderModelToHtml(plain)).not.toContain("background-color:rgba(255,213,79,0.55)");

    expect(htmlToPlainText(renderModelToHtml(annotated))).toBe(htmlToPlainText(renderModelToHtml(plain)));
  });
});
