"use client";

// The digest dialog's body: the prose, the citation markers spliced into it,
// and the source list beneath. Extracted from AppViewDialog.js so it can be
// rendered - and therefore falsified - on its own.
//
// THE FOUR STATES THAT LOOK ALIKE, WHICH IS WHY THIS FILE EXISTS.
//
// Three of them are a zero and one of them is a NULL, and before the pipeline
// fix there was no data with which to separate any of them, so the panel drew
// the same nothing for all four and a candidate could not tell "we found no
// sources" from "we lost them":
//
//   1. citations present            -> markers in the prose, a numbered list.
//   2. the model genuinely searched nothing (`searched: false`) -> LEGITIMATE,
//      and said plainly: nothing here has a source behind it.
//   3. citations ARRIVED and none were placed (`annotations > 0, placed = 0`)
//      -> THE DEFECT this chunk exists to close. The user is told the search
//      ran and is shown what it returned. Never "no sources".
//   4. `citation_outcome IS NULL` -> the row predates the fix. Its publisher
//      URLs were destroyed at WRITE time (the links were replaced by their own
//      text), so there is nothing to back-fill from and nothing was ever
//      checked against Google's search. It gets its own group and its own
//      sentence, and it is NEVER rendered as "found nothing".
//
// A user must never be shown "no sources" when the truth is "we could not
// place them." That is one sentence and it is the whole point of the record.
//
// WHERE EVERY href COMES FROM. `safeExternalHref` and nothing else - the same
// control lib/tracking/citationHref.js re-exports as `citationHref` (the SAME
// function object, not a copy). It is imported here under its own name because
// that is the token app/components/hrefSafety.sweep.test.js recognises, and a
// gate the sweep cannot see is a gate nobody re-reads. Three unvalidated URL
// populations reach this file: the vendor's `url_citation.url` (whose own type
// constrains nothing), legacy `sources` elements written by a host-only match,
// and whatever `jsonb` hands back on read (`String({url})` renders
// "[object Object]" as an href). A refused URL renders NO anchor at all - no
// empty destination, no "#", no href-less <a> stub, and never an onClick
// navigation. The entry stays visible as inert text, because it is still what
// the research was built on.
//
// WHY THE HOST IS ALWAYS DERIVED FROM THE ANCHOR'S OWN href. An anchor's
// visible text, `title` and `aria-label` may name a host only when it came out
// of that anchor's own href, in the same expression that produced it. The
// measured counter-example is in this repo: a host-only lookup welded a real
// headline from one story onto an invented path on the same publisher, and
// swapping the order of an array nobody controls changed which headline.

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MarkdownPreview from "../experience/MarkdownPreview";
import { formatRelative } from "@/lib/feed/liveFeedClient";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { citationHost, nonPublisherHosts } from "@/lib/tracking/citationHref";
import { scanCitationResidue } from "@/lib/tracking/citationResidue";
import { CITATION_BINDING, renderCitedMarkdown } from "@/lib/tracking/renderCitedMarkdown";
import { triggerBlobDownload } from "@/lib/document/download";

// ---------------------------------------------------------------- the copy
// Every string a user reads on this surface. Forbidden vocabulary, because a
// footnote that claims more than it can prove is the harm: "verified",
// "fact-checked", "confirmed", and any phrasing implying the source backs the
// surrounding sentence.
const COPY = {
  scope:
    "Each number marks the passage Google's search attributed to that source — not a check that the claim is true.",
  citedHeading: "Sources for the numbered claims above",
  sourcesHeading: "Sources",
  alsoHeading: "Also searched — not attached to any passage",
  alsoWhy:
    "Google's search returned these pages for this research, but they could not be tied to a specific passage here, so they carry no number.",
  legacyHeading: "Links this research quoted — not from Google's search",
  legacyWhy:
    "These links were written by the model in an earlier version of this feature. Nothing matched them against what Google's search returned, and some point at pages that do not exist. Research again to replace them.",
  noSearch: "No web search ran for this research, so nothing below has a source behind it.",
  placedNoneWithEntries:
    "Google's search ran, but none of what it returned could be tied to a specific passage here. What it did return is listed below.",
  placedNoneEmpty:
    "Google's search ran, but it returned nothing that could be attached to this research.",
  stamp:
    "This research was changed after its citations were recorded, so the numbers have been removed. The sources are listed below, unnumbered. Research again for a fresh, numbered version.",
  residue:
    "The model's own links could not be separated from this research, so no numbers were added. The sources are listed below, unnumbered.",
  redirect: "These links open through Google's search redirect, not directly at the publisher.",
  truncated: "This research was cut short and may be incomplete.",
  preFeature:
    "This research predates source tracking, so nothing here was checked against Google's search.",
  unnamed: "Source (unnamed)",
};

// The refusal disclosure. "Passive, and about what WE could not do" is
// deliberate: the obvious active phrasing asserts the numbered ones were
// verified, which is exactly the claim this surface may not make.
const refusedLine = (n) =>
  n === 1
    ? "1 source the model named could not be matched to Google's search, so it was removed from the text above. Any claim it supported is unsourced here."
    : `${n} sources the model named could not be matched to Google's search, so they were removed from the text above. Any claim they supported is unsourced here.`;

// The legacy variant says something different because something different
// happened: nothing was removed from a legacy row, it was never checked.
const legacyRefusedLine = (n) =>
  n === 1
    ? "1 link the model wrote here was never matched against Google's search."
    : `${n} links the model wrote here were never matched against Google's search.`;

const confirmLine = (n) =>
  n > 0
    ? `Replace this research? The text above and its ${n} sources are overwritten, and there is no earlier version to go back to.`
    : "Replace this research? The text above is overwritten, and there is no earlier version to go back to.";

// ------------------------------------------------------------------- style
// One focus ring for every focusable thing this panel adds. LONGHANDS, never
// the `outline` shorthand: jsdom's parser drops the shorthand, so a correct
// implementation written with it makes its own falsifier read "none". And
// `:focus-visible`, never bare `:focus` - a mouse click must not paint a ring.
const FOCUS_SX = {
  outlineWidth: "2px",
  outlineStyle: "solid",
  outlineColor: "var(--accent)",
  outlineOffset: "2px",
  borderRadius: "2px",
};

// One link style for this surface, declared once, scoped away from the marker
// in the SELECTOR rather than by an override. A bare `& a` is specificity
// (0,1,1) against the marker's own class at (0,1,0), so the panel rule wins
// and the marker is underlined - the exact defect the affordance exists to
// prevent. `:not()` makes the marker match no declaration at all, so the
// resets are automatic and a property added here later cannot leak onto it.
// LONGHAND `textDecorationLine`: the shorthand computes "none".
const PANEL_SX = {
  fontSize: 14,
  "& a:not([data-citation-marker])": {
    textDecorationLine: "underline",
    textDecorationThickness: "from-font",
    textUnderlineOffset: "2px",
    overflowWrap: "anywhere",
    "&:focus-visible": FOCUS_SX,
  },
};

// A bracketed superscript in currentColor. The brackets are CSS generated
// content, not text, so `textContent` stays exactly the digits - which is what
// keeps the body's residue assertion and the renderer's own numbering honest
// at the same time. Colour is removed from the job of identifying a link
// entirely: accent against body text measures 1.86:1 light / 2.48:1 dark and
// WCAG 1.4.1 wants 3:1, so the brackets ARE the non-colour affordance. No
// resting underline - it is painted against the raised element's own baseline
// and lands mid-x-height, reading as a stray rule rather than a link.
const MARKER_SX = {
  fontSize: "0.75em",
  lineHeight: 0,
  verticalAlign: "super",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  padding: "0.5em 0.15em",
  color: "currentColor",
  textDecorationLine: "none",
  "&::before": { content: '"["' },
  "&::after": { content: '"]"' },
  "&:hover": { textDecorationLine: "underline" },
  "&:focus-visible": FOCUS_SX,
};

const SECTION_HEADING_SX = { fontSize: 12, fontWeight: 700, mb: 0.5 };
const GROUP_HEADING_SX = { fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", mb: 0.5 };
const CAPTION_SX = { fontSize: 11.5, color: "var(--text-secondary)", mb: 1 };
const LIST_SX = { m: 0, pl: 2.5, display: "flex", flexDirection: "column", rowGap: 1 };
const ITEM_SX = { fontSize: 13, fontVariantNumeric: "tabular-nums", "&::marker": { fontWeight: 600, fontVariantNumeric: "tabular-nums" } };
const HOST_SX = { fontSize: 11.5, color: "var(--text-secondary)" };
const NOTICE_SX = { fontSize: 12.5, color: "var(--warning)", bgcolor: "var(--warning-soft)", p: 1, borderRadius: 1, mb: 1.5 };

// ------------------------------------------------------------------ helpers

/**
 * A label short enough to be spoken, cut at a word boundary, never mid-word.
 *
 * The ellipsis is separated from the last word rather than glued to it, so a
 * reader (and a screen reader) meets a whole word and then the mark that says
 * "there was more", rather than a word that looks misspelled. That separation
 * is what DigestPanel.test.js's `/\S…$/` assertion pins.
 */
function truncateLabel(value, max = 80) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()} …`;
}

/**
 * One displayable source entry, derived ENTIRELY from its own record.
 *
 * `host` comes out of this entry's own url in the same expression that decides
 * whether the url may become an href at all, so there is no path by which a
 * host from somewhere else can be attached to it.
 */
function toEntry(raw, n) {
  const url = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.url : null;
  const host = citationHost(url);
  const rawTitle =
    raw && typeof raw === "object" && typeof raw.title === "string" ? raw.title.trim() : "";
  // When Google's title IS the bare domain - which its own published examples
  // show is the common case - showing both renders "reuters.com reuters.com".
  const titleIsHost = !!host && rawTitle.toLowerCase().replace(/^www\./, "") === host;
  return { n, url, host, title: titleIsHost ? "" : rawTitle };
}

/** The accessible name's label half: the entry's own title, else its own host. */
function entryLabel(entry, hiddenHosts) {
  if (entry.title) return truncateLabel(entry.title);
  if (entry.host && !hiddenHosts.has(entry.host)) return entry.host;
  return COPY.unnamed;
}

// ------------------------------------------------------------------- pieces

function SourceItem({ component, entry, hiddenHosts }) {
  // The gate, at the point of use. `entry.url` is whatever jsonb handed back;
  // this is the only expression in this file that turns one into a
  // destination, and a refused one simply yields no anchor.
  const entryHref = safeExternalHref(entry.url);
  const showHost = !!entry.host && !hiddenHosts.has(entry.host);
  // Neither a usable destination nor anything quotable: a link-shaped thing
  // that does nothing is worse than an omission.
  if (!entry.title && !showHost && !entryHref) return null;

  // The remaining title-less, host-less case is a real one and not a
  // degenerate row: the destination works, but its host is the vendor's
  // redirector and naming that as the source is the harm. It renders in the
  // HOST type rather than the title type, so the type says "placeholder"
  // without spending a word of copy on it.
  const body = (
    <>
      {entry.title ? <Box>{entry.title}</Box> : null}
      {showHost ? <Box sx={HOST_SX}>{entry.host}</Box> : null}
      {!entry.title && !showHost ? <Box sx={HOST_SX}>{COPY.unnamed}</Box> : null}
    </>
  );

  return (
    <Box component={component} value={entry.n} sx={ITEM_SX}>
      {entryHref ? (
        <Box
          component="a"
          href={entryHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${entryLabel(entry, hiddenHosts)} — opens in a new tab`}
          sx={{ color: "inherit", display: "flex", flexDirection: "column", rowGap: 0.25 }}
        >
          {body}
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", rowGap: 0.25 }}>{body}</Box>
      )}
    </Box>
  );
}

function SourceGroup({ name, heading, why, entries, hiddenHosts, ordered, sx }) {
  if (entries.length === 0) return null;
  const items = entries.map((entry, i) => (
    <SourceItem
      key={typeof entry.url === "string" ? entry.url : `${name}-${i}`}
      component="li"
      entry={entry}
      hiddenHosts={hiddenHosts}
    />
  ));
  return (
    <Box data-fn-group={name} sx={{ mt: 2, ...sx }}>
      {heading ? (
        <Box component="h3" sx={GROUP_HEADING_SX}>
          {heading}
        </Box>
      ) : null}
      {why ? <Box sx={CAPTION_SX}>{why}</Box> : null}
      {ordered ? (
        <Box component="ol" data-fn-list sx={LIST_SX}>
          {items}
        </Box>
      ) : (
        <Box component="ul" sx={LIST_SX}>
          {items}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- the model
//
// Everything the panel draws, decided in one pure pass so the four states are
// separated in one place rather than in six `&&`s down the JSX.
function buildView(digest) {
  const markdown = typeof digest.markdown === "string" ? digest.markdown : "";
  const sourceList = Array.isArray(digest.sources) ? digest.sources : [];
  const record = digest.citation_outcome;
  const hasRecord = !!record && typeof record === "object" && !Array.isArray(record);

  // ---- state 4: no record at all. NULL is the only honest encoding of "this
  // row was written before the feature existed", and an unrecognised version
  // is never guessed at either - a shape this build cannot read is not
  // evidence about what the pipeline did.
  const legacy = () => {
    const residue = scanCitationResidue(markdown);
    return {
      presentation: markdown,
      markers: null,
      cited: [],
      also: [],
      noProvenance: sourceList.map((raw) => toEntry(raw)),
      above: [COPY.preFeature, residue.count > 0 ? legacyRefusedLine(residue.count) : null],
      below: [],
      citedCount: 0,
    };
  };

  if (!hasRecord) return legacy();

  const spliced = renderCitedMarkdown(markdown, sourceList, record);
  if (
    spliced.bindingFailure === CITATION_BINDING.NO_OUTCOME ||
    spliced.bindingFailure === CITATION_BINDING.VERSION
  ) {
    return legacy();
  }

  const truncated = record.truncated === true ? COPY.truncated : null;
  const refusedCount = Number.isInteger(record.refused?.count) ? record.refused.count : 0;

  // ---- the stamp and the span binding. The offsets no longer describe this
  // string, so every citation degrades to "Google supplied it, we could not
  // place it" - which is a state this panel already draws. Printing a number
  // that appears nowhere in the prose would be the worst available outcome: a
  // fabricated correspondence.
  if (spliced.bindingFailure) {
    return {
      presentation: markdown,
      markers: null,
      cited: [],
      also: sourceList.map((raw) => toEntry(raw)),
      noProvenance: [],
      above: [
        truncated,
        spliced.bindingFailure === CITATION_BINDING.RESIDUE ? COPY.residue : COPY.stamp,
        refusedCount > 0 ? refusedLine(refusedCount) : null,
      ],
      below: [],
      citedCount: 0,
    };
  }

  // ---- the placed citations. Numbering, ordering and pairing all come off
  // the renderer's own `accepted` records; nothing here indexes a parallel
  // array by a marker number, which is the shape that makes a mis-paired
  // citation possible at all.
  const titleByIndex = new Map();
  sourceList.forEach((raw, index) => titleByIndex.set(index, raw));
  const acceptedIndexes = new Set(spliced.accepted.map((a) => a.index));

  const ordered = [...spliced.accepted].sort(
    (a, b) => a.n - b.n || a.end - b.end || a.index - b.index
  );

  const markers = new Map();
  const cited = [];
  const seenNumbers = new Set();
  for (const accepted of ordered) {
    const entry = toEntry(titleByIndex.get(accepted.index), accepted.n);
    if (!markers.has(accepted.href)) markers.set(accepted.href, entry);
    // Entry n is the FIRST marker carrying n in document order. Two spellings
    // of one page share a number and therefore share one entry, while each
    // marker still navigates to its own href.
    if (!seenNumbers.has(accepted.n)) {
      seenNumbers.add(accepted.n);
      cited.push(entry);
    }
  }

  const also = sourceList
    .filter((raw, index) => !acceptedIndexes.has(index))
    .map((raw) => toEntry(raw));

  const annotations = Number.isInteger(record.counts?.annotations) ? record.counts.annotations : 0;
  let verdict = null;
  if (cited.length === 0) {
    if (record.searched !== true) {
      // State 2. LEGITIMATE, and the only state that may say this.
      verdict = COPY.noSearch;
    } else if (annotations > 0) {
      // State 3. The search ran and returned pages; we placed none of them.
      // Saying "no sources" here is the lie this whole chunk exists to stop.
      verdict = also.length > 0 ? COPY.placedNoneWithEntries : COPY.placedNoneEmpty;
    }
    // annotations === 0 with a search that ran: there is nothing
    // citation-shaped anywhere, so there is no sourcing claim to disclose and
    // no empty heading to draw.
  }

  const disclosure = refusedCount > 0 ? refusedLine(refusedCount) : null;
  return {
    presentation: spliced.markdown,
    markers,
    cited,
    also,
    noProvenance: [],
    // A notice sits ABOVE the prose exactly when no marker rendered for it to
    // attach to. A partly cited digest is mostly sourced; a banner over it
    // would make the numbers read as suspect and push the research itself
    // below the fold on a phone.
    above: [truncated, verdict, cited.length === 0 ? disclosure : null],
    below: [cited.length > 0 ? disclosure : null],
    citedCount: cited.length,
  };
}

/** Hosts only, counts only. No user id, no résumé text, no posting text, no URLs. */
function buildLog(digest, view) {
  const record = digest.citation_outcome;
  const counts = record?.counts || {};
  const lines = [
    "# Company research log",
    "",
    `Application: ${digest.application_id || "unknown"}`,
    `Status: ${digest.status || "unknown"}`,
    `Surface: ${record?.surface || "pre-feature (citation_outcome is null)"}`,
    `Searched: ${record ? record.searched === true : "unknown"}`,
    `Truncated: ${record ? record.truncated === true : "unknown"}`,
    `Residue clean: ${record ? record.residueClean !== false : "unknown"}`,
    "",
    "## Counts",
    `annotations: ${counts.annotations ?? "-"}`,
    `urlsUsable: ${counts.urlsUsable ?? "-"}`,
    `spansUsable: ${counts.spansUsable ?? "-"}`,
    `splicesSafe: ${counts.splicesSafe ?? "-"}`,
    `placed: ${counts.placed ?? "-"}`,
    `refused: ${record?.refused?.count ?? "-"}`,
    `anomaly: ${record?.anomaly ? `${record.anomaly.stage} ${record.anomaly.inputCount} -> 0` : "none"}`,
    `countsViolation: ${record?.countsViolation || "none"}`,
    "",
    "## Sources, by host only",
  ];
  const add = (label, entries) => {
    for (const entry of entries) lines.push(`- ${label}: ${entry.host || "no usable host"}`);
  };
  add("placed", view.cited);
  add("also searched", view.also);
  add("no search provenance", view.noProvenance);
  return `${lines.join("\n")}\n`;
}

// ------------------------------------------------------------------- panel

export default function DigestPanel({ digest, nowTs, researching = false, onResearchAgain }) {
  const [confirming, setConfirming] = useState(false);

  if (!digest?.markdown) {
    return <Box sx={{ color: "text.secondary", fontStyle: "italic" }}>Not researched yet.</Box>;
  }

  const view = buildView(digest);
  const failed = digest.status === "failed";
  const researchedAt = digest.researched_at || digest.updated_at;

  // Computed ONCE over every entry the panel will draw, because clause (b) -
  // one host shared by every source in a multi-source digest is a redirector
  // by construction - needs the whole digest to decide.
  const hiddenHosts = nonPublisherHosts(
    [...view.cited, ...view.also, ...view.noProvenance].map((entry) => ({
      href: entry.url,
      title: entry.title,
    }))
  );
  const anyHidden = [...view.cited, ...view.also, ...view.noProvenance].some(
    (entry) => entry.host && hiddenHosts.has(entry.host)
  );

  // The failure disclosure is not allowed to depend on a timer. `nowTs`
  // resolves in an effect after mount, so gating the whole sentence on it
  // would leave a full digest reading as current research for one frame - and
  // in any harness that does not flush timers, forever.
  const above = view.above.filter(Boolean);
  if (failed) {
    above.unshift(
      nowTs > 0
        ? `The latest research failed. What you can see below is from ${formatRelative(researchedAt, nowTs)}.`
        : "The latest research failed. Everything below is from an earlier run."
    );
  }

  // The marker. Its href, its number, its host and its name all come from the
  // one record the renderer accepted for it.
  const renderLink = view.markers
    ? ({ href, key }) => {
        const entry = view.markers.get(href);
        if (!entry) return undefined;
        const markerHref = safeExternalHref(href);
        if (!markerHref) return undefined;
        const label = entryLabel(entry, hiddenHosts);
        const showHost = !!entry.host && !hiddenHosts.has(entry.host);
        return (
          <Box
            key={key}
            component="a"
            href={markerHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Source ${entry.n}: ${label}`}
            title={showHost ? `${label} — ${entry.host}` : label}
            data-citation-marker={String(entry.n)}
            sx={MARKER_SX}
          >
            {String(entry.n)}
          </Box>
        );
      }
    : undefined;

  const hasSources = view.cited.length + view.also.length + view.noProvenance.length > 0;

  return (
    <Box sx={PANEL_SX}>
      {above.length > 0 ? (
        <Box data-digest-notice sx={NOTICE_SX}>
          {above.map((line) => (
            <Box key={line} sx={{ mb: 0.5, "&:last-of-type": { mb: 0 } }}>
              {line}
            </Box>
          ))}
          {failed && digest.error ? <Box sx={{ mt: 0.5 }}>{String(digest.error)}</Box> : null}
        </Box>
      ) : null}

      <Box data-digest-body>
        <MarkdownPreview markdown={view.presentation} renderLink={renderLink} />
      </Box>

      {hasSources ? (
        <Box
          sx={{ mt: 2, pt: 1.5, borderTop: "1px solid var(--border)" }}
          {...(anyHidden ? { "data-fn-nonpublisher": "" } : {})}
        >
          {/* The section heading doubles as the numbered group's own heading -
              they name the same thing, and printing it twice would be noise.
              The other two groups are its `h3` subsections, so browse-by-
              heading skips past the markers and between the groups. */}
          <Box component="h2" sx={SECTION_HEADING_SX}>
            {view.cited.length > 0 ? COPY.citedHeading : COPY.sourcesHeading}
          </Box>
          {view.cited.length > 0 ? <Box sx={CAPTION_SX}>{COPY.scope}</Box> : null}
          {anyHidden ? <Box sx={CAPTION_SX}>{COPY.redirect}</Box> : null}
          {view.below.filter(Boolean).map((line) => (
            <Box key={line} sx={CAPTION_SX}>
              {line}
            </Box>
          ))}

          <SourceGroup
            name="cited"
            entries={view.cited}
            hiddenHosts={hiddenHosts}
            ordered
            sx={{ mt: 0 }}
          />
          <SourceGroup
            name="also-searched"
            heading={COPY.alsoHeading}
            why={COPY.alsoWhy}
            entries={view.also}
            hiddenHosts={hiddenHosts}
          />
          <SourceGroup
            name="no-provenance"
            heading={COPY.legacyHeading}
            why={COPY.legacyWhy}
            entries={view.noProvenance}
            hiddenHosts={hiddenHosts}
            sx={{ pl: 2 }}
          />
        </Box>
      ) : null}

      {nowTs > 0 && researchedAt ? (
        <Box sx={{ mt: 1.5, fontSize: 11, color: "var(--text-secondary)" }}>
          {failed
            ? `Last attempt failed ${formatRelative(digest.updated_at, nowTs)}`
            : `Researched ${formatRelative(researchedAt, nowTs)}`}
        </Box>
      ) : null}

      <Box sx={{ mt: 1, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
        {researching ? (
          <Button size="small" aria-disabled="true" onClick={() => {}} sx={{ opacity: 0.6, "&:focus-visible": FOCUS_SX }}>
            Researching…
          </Button>
        ) : confirming ? (
          // Inline, in place, never a nested dialog: a second modal inside the
          // view dialog's focus trap nests two traps and makes Escape
          // ambiguous. Escape and the arrow keys are stopped here because the
          // dialog pages on both with no target check, which would page a
          // half-answered destructive prompt off the screen.
          <Box
            data-confirm-research
            role="status"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setConfirming(false);
              }
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.stopPropagation();
            }}
            sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}
          >
            <Box>{confirmLine(view.citedCount)}</Box>
            {/* Focus lands on the NON-destructive button. The user pressed
                `Research again` with Enter; a second Enter on a focused
                `Replace research` destroys the only copy before they have read
                a word of the warning - the exact failure the confirmation
                exists to prevent, reproduced by the confirmation itself. */}
            <Button
              size="small"
              autoFocus
              onClick={() => setConfirming(false)}
              sx={{ "&:focus-visible": FOCUS_SX }}
            >
              Keep what I have
            </Button>
            <Button
              size="small"
              color="warning"
              onClick={() => {
                setConfirming(false);
                if (onResearchAgain) onResearchAgain(digest.application_id);
              }}
              sx={{ "&:focus-visible": FOCUS_SX }}
            >
              Replace research
            </Button>
          </Box>
        ) : (
          <Button
            size="small"
            onClick={() => setConfirming(true)}
            sx={{ "&:focus-visible": FOCUS_SX }}
          >
            Research again
          </Button>
        )}
        <Button
          size="small"
          onClick={() =>
            triggerBlobDownload(
              new Blob([buildLog(digest, view)], { type: "text/markdown" }),
              `company-research-log-${digest.application_id || "row"}.md`
            )
          }
          sx={{ "&:focus-visible": FOCUS_SX }}
        >
          Download research log
        </Button>
      </Box>
    </Box>
  );
}
