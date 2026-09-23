"use client";

// N49 (line-cap extraction, the same standing rule PrepSectionActions.js and
// PrepPackNamesStrip.js already used): the four presentation primitives
// every section of PrepPackPanel.js's original StagesSection/AnswerSection/
// AskThemSection/EmptySection shared -- `CitationMarker`, `SourceList`,
// `RecommendedAnswer` and `Section` -- pulled out verbatim so that file has
// room for N49's own new `ResearchStages` branch under its 1000-line cap.
// Nothing about these four components changed in the move; every prop, every
// class name and every rendered node is identical to what PrepPackPanel.js
// defined inline before this extraction.
import Box from "@mui/material/Box";
import { BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";
import { safeExternalHref } from "@/lib/url/safeExternalHref";

// N43: a bracketed superscript, reused verbatim from DigestPanel.js's own
// MARKER_SX/FOCUS_SX (measured there in a real Chromium layout -- see that
// file's header for the 24x24 WCAG 2.5.8 floor and the `marginBlock: -6px`
// line-height compensation) rather than re-derived here. DigestPanel.js does
// not export either object, so this is an identical copy, not an import --
// design-experience.r1.md ss1 leaves promoting the shared copy to a
// structure seat.
const FOCUS_SX = {
  outlineWidth: "2px",
  outlineStyle: "solid",
  outlineColor: "var(--accent)",
  outlineOffset: "2px",
  borderRadius: "2px",
};

const MARKER_SX = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  minWidth: 24,
  minHeight: 24,
  marginBlock: "-6px",
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

/** The citation marker itself. `resolved` is one `resolveSupport(...)`
 *  result and `n` its assigned per-section number -- both come from the
 *  caller's own `numberResolved(...)` pass, never computed here, so there is
 *  exactly one numbering implementation.
 *
 *  A cited marker is a real link, reachable by keyboard, named
 *  "Source {n}: {claim.text}" -- never the bare digit, which is decorative.
 *  An unsafe marker (AC-N43.7(b): `support` resolves but the claim's
 *  `sourceUrl` fails `safeExternalHref`) is a `<span>`, never an `<a>` stub:
 *  no `href`, no tabindex, no interactive role, and its own name discloses
 *  the link is unavailable rather than pretending to be a working source. */
export function CitationMarker({ resolved, n }) {
  if (!resolved || resolved.state === "none" || n == null) return null;
  if (resolved.state === "unsafe") {
    return (
      <Box
        component="span"
        aria-label={`Citation ${n}: link unavailable`}
        data-citation-marker={String(n)}
        sx={MARKER_SX}
      >
        {String(n)}
      </Box>
    );
  }
  // The href attribute is recomputed here, at the point of use, through
  // safeExternalHref directly -- rather than trusting `resolved.href` (which
  // prepCitations.js already computed the same way) -- so
  // app/components/hrefSafety.sweep.test.js's own source-text sweep, which
  // can only see gating within ONE file, finds the gate on this line too.
  return (
    <Box
      component="a"
      href={safeExternalHref(resolved.claim.sourceUrl)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Source ${n}: ${resolved.claim.text}`}
      data-citation-marker={String(n)}
      sx={MARKER_SX}
    >
      {String(n)}
    </Box>
  );
}

/** A section's own numbered source list -- rendered only when that section
 *  resolved at least one citation (AC-N43.1); gated, never an empty
 *  heading. Per-section, never a combined list (owner ruling): each of the
 *  four sections gets its own "Sources for {label}" list, and the same
 *  claim cited from two sections earns two independent entries. The unsafe
 *  branch shows the claim's own text as inert content -- never a raw
 *  `href` built from the unvalidated string -- with something beyond the
 *  bare claim text so the reader is not left wondering why it isn't a link
 *  (design-experience.r1.md ss9 gates the exact wording, not the shape).
 *  N50/AC-N50.4(c): the list is T2 -- secondary colour throughout, its
 *  anchor kept `color: "inherit"` so it never reads as an ordinary,
 *  primary-colour link (F4).
 *  m-d (N50 fix round 2): a top rule and a wider gap set the block off from
 *  what precedes it -- verify.r2.md's own defect: it used to read as a
 *  stage's own "Suggested answer:" sub-label instead. Heading stays an h4
 *  named "Sources for {label}" (AC-N50.5's own walker) -- only the
 *  SURROUNDING style changes. Applies to all four sections, not just Stages.
 *  Rounds 3-6 (verify3/4/5/6.md) each WIDENED this block's own `pb` -- 12px,
 *  then 24px -- chasing the gap to the section's own Regenerate/history row
 *  past the 16px inter-section gap (sectionHeaders.test.js pins that value).
 *  N50 fix round 7 (verify.r7.md M-3): the wrong quantity was being moved.
 *  `pb` is padding INSIDE a section; 16px is the gap BETWEEN sections --
 *  widening the first past the second guarantees the action row reads as
 *  closer to the NEXT section than to the content above it it belongs to
 *  (measured: 36px above the row, 16px below -- 2.25:1 the wrong way).
 *  `pb: 0` restores the ordering instead: the section wrapper's own `mb: 1`
 *  ("8px", `Section` below) and `PrepSectionActions`'s own `mt: 0.5` ("4px")
 *  already separate the list from the action row without this padding. */
export function SourceList({ label, entries }) {
  if (entries.length === 0) return null;
  return (
    <Box sx={{ mt: 2.5, mb: 0, pt: 1, pb: 0, borderTop: "1px solid var(--border)" }}>
      <Box
        component="h4"
        sx={{
          fontSize: 10.5,
          fontWeight: 700,
          mt: 0,
          mb: 0.5,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Sources for {label}
      </Box>
      <Box component="ol" sx={{ m: 0, pl: 2.5, display: "flex", flexDirection: "column", rowGap: 0.75, color: "var(--text-secondary)" }}>
        {entries.map((entry) => {
          // Same discipline as CitationMarker above: recomputed here, in
          // this file, through safeExternalHref directly, rather than
          // trusting the `href` prepCitations.js already resolved.
          const href = safeExternalHref(entry.claim.sourceUrl);
          return (
            <Box component="li" key={entry.claim.id} sx={{ fontSize: 12.5, ...BREAK_LONG_WORDS_SX }}>
              {href ? (
                <Box component="a" href={href} target="_blank" rel="noopener noreferrer" sx={{ color: "inherit", display: "block" }}>
                  {entry.claim.text}
                </Box>
              ) : (
                <Box>
                  {entry.claim.text}
                  <Box component="span" sx={{ color: "var(--text-secondary)" }}>
                    {" "}
                    (source link unavailable)
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

const RECOMMENDED_ANSWER_LABEL_SX = { fontWeight: 700, fontSize: 11.5, color: "var(--text-secondary)" };
const RECOMMENDED_ANSWER_BODY_SX = { fontSize: 12.5, color: "var(--text-secondary)", mt: 0.25, mb: 0 };

/** N48: the model generates a `recommendedAnswer` for every stage and it was
 *  discarded at the last hop to a human -- the same defect class this chunk
 *  keeps shipping (a complete, correct mechanism with nothing rendering its
 *  output). Always visible, in full, never behind a disclosure control or a
 *  truncation: design-experience.r1.md ss3 argues a click-gate here is a
 *  stronger minimize-clicks violation than the usual "hide the details"
 *  case, because this is the section's primary payload, not optional detail.
 *  Demoted typographically instead -- smaller, secondary colour, labelled --
 *  so it reads as reference material after the questions rather than
 *  competing with them. `null`/blank renders nothing, same discipline as
 *  every other optional field in this file. */
export function RecommendedAnswer({ text }) {
  if (typeof text !== "string" || text.trim() === "") return null;
  return (
    <Box sx={{ mt: 0.75, mb: 0 }}>
      <Box component="span" sx={RECOMMENDED_ANSWER_LABEL_SX}>
        Suggested answer:
      </Box>
      <Box sx={RECOMMENDED_ANSWER_BODY_SX}>{text}</Box>
    </Box>
  );
}

export function Section({ heading, children }) {
  return (
    <Box sx={{ mb: 1 }}>
      {/* N44/AC-N44.9: `margin-top` is stated explicitly (never left to the
       *  browser's UA default `1em` on an `<h3>`) -- the same defect class
       *  070e1ec fixed in a sibling file, now four times as visible because
       *  this heading renders unconditionally in every state. N50/AC-N50.4:
       *  15px, strictly larger than every T1 body line (13.5px), so the
       *  heading always outranks what it labels. N50/C5: this wrapper's own
       *  `mb: 1` ("8px") is the gap between the heading's body and its own
       *  PrepSectionActions -- the gap BETWEEN sections is now owned by the
       *  role="group" wrapper one level up. */}
      {/* m4 (N50 fix round 1): 17px, widened from 15px so the step to a stage
       *  h4 (13.5px) reads as two ranks apart rather than a 1.11 ratio that a
       *  sighted reader can mistake for one continuous list ("Interview
       *  stages" followed by "Recruiter screen" as siblings). */}
      <Box component="h3" sx={{ fontSize: 17, fontWeight: 700, mt: 0, mb: 0.5 }}>
        {heading}
      </Box>
      {children}
    </Box>
  );
}
