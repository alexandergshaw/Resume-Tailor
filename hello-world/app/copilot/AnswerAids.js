"use client";

import { useId } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { normalizeAidChoice } from "../../lib/copilot/aidDisclosure.js";
import { createChoiceStore } from "../../lib/copilot/choiceStore.js";
import { PROJECT_PAGE_SOURCE } from "../../lib/copilot/projectStories.js";
import CollapsibleAid from "./CollapsibleAid";
import { useTechTermDetailApi } from "./useTechTermDetails";
import { useWarmOnMount } from "./useWarmOnMount";

// AC-K1.2/AC-K1.3: the two groups that sit UNDER a drafted answer's cues —
// what the candidate actually has (the role and project their answer came
// from), then what the posting wants (its vocabulary). One component,
// rendered by all three surfaces that show a drafted answer: practice
// mode's SampleAnswer.js, live mode's QuestionFeed.js card, and the shared
// dashboard's CurrentAnswerPanel. Three copies of this markup is exactly
// how live and practice drift into showing different things for the same
// answer — the same reasoning that pulled cleanAnswerPoints out into
// lib/copilot/answerPoints.js after its two copies had already diverged.
//
// Purely presentational: every value arrives as a prop, computed server-side
// by lib/copilot/postingBuzzwords.js and lib/copilot/resumeAnchor.js.
// Nothing here fetches, and nothing here decides what a buzzword or an
// aligned role IS — this only decides how they look.
//
// The candidate's own role and project is a description list: each label is a
// term whose value sits under it, which is what `dl` means. Nothing here is a
// heading, on purpose: it avoids inventing a further heading level under
// whichever heading already encloses it on each of its three parents —
// SampleAnswer.js's question card title (`h3`), QuestionFeed.js's "Detected
// questions" section title (`h3`), and CopilotDashboard.js's
// `CurrentAnswerPanel` title (`h4`). Adding a heading here would either
// repeat a level already in use one step up, or push the tree to `h5` — a
// depth nothing else under `/copilot` needs (R-125) — either of which is
// how heading order gets broken. The three groups below are disclosures
// (CollapsibleAid.js), whose header is a button, not a heading, for the same
// reason.
//
// The groups and the dividers between them are grouped by WHOSE material
// it is, not by data type: the candidate's own role/project first, then the
// posting's vocabulary. The résumé group is always visible with no header (it
// is the candidate's own material, and the first thing to glance at). Every
// group after it is a CollapsibleAid: collapsed by default below 600px and open
// from 600px up, remembered per section (N144a). A header REPLACES the label
// that used to be a `dt`, so a single-block group is a header over its body and
// not a one-row `dl` whose term would repeat the header's words.
//
// The posting's words sit second: one disclosure over the chip list.
//
// A THIRD group holds the tech buzzwords, always before the examples:
// LLM-suggested terms relevant to the question that the candidate may well NOT
// have in their materials. It is its own provenance (not the candidate's, not
// the posting's own words, not an invented project), and its lead says plainly
// that these are suggestions to be aware of rather than anything the candidate
// has done. Each term is a button that opens a short general explanation inline;
// the explanation comes from the scope-provided api (useTechTermDetails.js), so
// this file still fetches nothing. The lead sits in the same body as the chips,
// so whenever a term is on screen the warning is beside it.
//
// A FOURTH group, always LAST, holds the example projects: two INVENTED
// hypotheticals ("Ready example", picked from a pre-warmed set; "Example for
// this question", written after the answer lands). They are another provenance,
// not the candidate's and not the posting's, so they get their own separator,
// their own `dl` and a labelled group, never a row inside the résumé group where
// an invented project would sit beside the real "Project to talk about". Last
// also means the late arrival of the second row appends below everything
// already on screen and moves nothing the candidate is reading. The structure (a
// role="group" named by its header, the lead inside each `dd`, no CSS `order`,
// the second row appended last) is the stable surface the mobile pass restyles;
// keep it. Only this group is a role="group": the other bodies are one block,
// named by their header's aria-controls. Every state the two rows can be in,
// and the exact strings, are the example-projects UX design's
// (docs/loop/N143.ux.r1.md).

// Below `md` the grid collapses to one column ordered dt, dd, dt, dd — a
// single uniform rowGap would put a label exactly as far from its OWN value
// as from the next label, and the pairing that makes this readable would
// vanish. `rowGap` is tightened at `xs` only; `Aid` below adds the matching
// top margin that reopens the gap BETWEEN pairs. At `md` and up the grid is
// two columns (label, value side by side) so this collapse never applies.
//
// Was keyed to `sm` (600px). At exactly 600px the dashboard's own panel grid
// (CopilotDashboard.js) ALSO flips to two columns, halving each panel's
// content width to ~174px right as this grid tried to reserve 150px+ for the
// label column alone — the value column collapsed to a few px and degraded
// to one word per line. Raising the breakpoint to `md` keeps this grid
// single-column through the 600-899px band, where the dashboard is already
// two panels wide, so the value column always has real room before this
// grid goes two-up. `xs: "1fr"` and the `rowGap`/`mt` pairing below move
// with it so the single-column pairing logic stays correct throughout that
// band.
const AID_GRID_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", md: "minmax(0, 150px) minmax(0, 1fr)" },
  columnGap: 2,
  rowGap: { xs: 0.25, md: 1.25 },
  alignItems: "start",
  m: 0,
};

// The single margin used to separate stacked lines inside any one `dd` —
// a role line above its description phrases. One constant so no row invents
// its own spacing.
const LINE_GAP = 0.5;

// WHERE a piece of material came from, in words — the single source of
// attribution truth, read by BOTH `roleLabel` below and the no-role fallback
// label (~line 220) so a source can never be told honestly in one place and
// dishonestly in the other. Keyed on the exact `source` values the route
// actually sets (app/api/copilot/answer/route.js): "resume", "prep", and
// PROJECT_PAGE_SOURCE for a page-derived aid (lib/copilot/projectStories.js —
// its own header explains why page material must never borrow "resume" or
// "prep"). An absent/unrecognised source — anything not a key here — falls
// back to RESUME_WHERE. That fallback is deliberate, existing, and pinned by
// AnswerAids.test.js ("attribution when the source is unknown"): the résumé
// wording is what renders sooner than "undefined" ever could, not a claim
// that unlabelled material IS résumé material.
const RESUME_WHERE = "on your resume";
const SOURCE_WHERE = {
  prep: "in your prep notes",
  [PROJECT_PAGE_SOURCE]: "on a project page",
};

function sourceWhere(source) {
  return SOURCE_WHERE[source] || RESUME_WHERE;
}

// The label above the role. Says plainly WHY this role is the one being
// shown: `matched: false` means nothing in the question or the draft overlaps
// any role on file, so this is simply the most recent one — calling that a
// "closest match" would be claiming a relevance that was never computed.
// WHERE it came from is `sourceWhere` above — not a second ternary here,
// so a new source can never be taught to this half of the label and not the
// other.
function roleLabel(matched, source) {
  const where = sourceWhere(source);
  return matched ? `Closest role ${where}` : `Most recent role ${where}`;
}

// The no-role fallback label (~line 220) reads as a standalone label, not a
// sentence continuing "Closest role"/"Most recent role" — so it capitalizes
// `sourceWhere`'s phrase instead of prefixing it, the same map, just a
// different sentence position. "On your resume" / "In your prep notes" /
// "On a project page", never a second copy of SOURCE_WHERE's values.
function capitalizeFirst(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function roleText(anchor) {
  const title = (anchor?.title || "").trim();
  const company = (anchor?.company || "").trim();
  // An em dash is not spoken at default screen-reader punctuation, which
  // drops the employer relationship entirely ("Senior Engineer Acme Corp"
  // reads as two unrelated facts). "at" reads unambiguously either way.
  if (title && company) return `${title} at ${company}`;
  return title || company;
}

// The one row shape every `dl` here is built from. `ddSx` / `ddProps` exist
// for the example rows only: the accent rule on a `dd` that carries invented
// content, and `aria-busy` on one that is still being written.
function Aid({ label, children, ddSx, ddProps }) {
  return (
    <>
      <Typography
        component="dt"
        variant="caption"
        sx={{
          color: "var(--text-secondary)",
          fontWeight: 700,
          letterSpacing: 0.2,
          // Reopens the gap the tightened `rowGap` above closed, but only
          // ABOVE this label and only below `md` (matching AID_GRID_SX's
          // own breakpoint) — the first label of each group must not drift
          // down from the divider/group top, so `:first-of-type` (scoped
          // per `<dl>`, since each group is its own grid container) zeroes
          // it back out for the first row.
          mt: { xs: 1.25, md: 0 },
          "&:first-of-type": { mt: 0 },
        }}
      >
        {label}
      </Typography>
      <Box component="dd" {...ddProps} sx={{ m: 0, ...BREAK_LONG_WORDS_SX, ...ddSx }}>
        {children}
      </Box>
    </>
  );
}

// One section's remembered open/closed choice. Each aid group that collapses
// gets its OWN store under its OWN key, so opening one never moves another; the
// key literals stay at the call sites below (the example-projects key is pinned
// by a contract test reading this file's source). The stores are module scope,
// so every mounted AnswerAids on the page (the current card, expanded history
// items, feed cards, the sample answer) shares one choice per section. A
// stored value is the plain string `open` or `closed`; anything else reads as
// "not chosen" (aidDisclosure.js).
function createAidCollapseStore(storageKey) {
  const store = createChoiceStore({
    storageKey,
    defaultValue: null,
    normalize: normalizeAidChoice,
    crossWindow: true,
  });
  store.hydrate();
  return store;
}

const postingWordsCollapse = createAidCollapseStore("copilot-posting-words");

// ---------------------------------------------------------------------------
// The example-projects group. Everything below up to AnswerAids itself is
// presentation only: a row's state arrives on its prop already decided (Row 1
// by the answer route from the pool, Row 2 by the request the hooks fire after
// the answer lands), and this file only maps a state to markup. Nothing here
// decides what a good example is.
// ---------------------------------------------------------------------------

// Pinned copy. The lead is ONE constant pair shared by both rows so the two
// can never word the warning differently. No em dash or en dash anywhere in
// these (a screen reader does not speak one at default punctuation), no emoji.
const EXAMPLE_GROUP_LABEL = "Example projects (invented)";
const EXAMPLE_DT_READY = "Ready example";
const EXAMPLE_DT_LIVE = "Example for this question";
const EXAMPLE_LEAD_BOLD = "Not from your resume.";
const EXAMPLE_LEAD_REST = " Numbers are invented; swap in your own.";
const R1_WARMING = "Still being prepared. Shows from your next question.";
const R1_NO_MATCH = "No close match for this question.";
const R1_FAILED = "Couldn't prepare examples for this posting.";
const R2_PENDING = "Writing one for this question…";
const R2_FAILED = "Couldn't write one this time.";

// A 2px accent rule on the left of a `dd` that carries INVENTED content. It is
// reinforcement for the written lead inside the same `dd`, never the only
// carrier of "this is not yours" (WCAG 1.4.1), so it is only ever drawn with
// the lead.
const INVENTED_DD_SX = { borderLeft: "2px solid var(--accent)", pl: 1.25 };

// The group's open/closed choice, remembered across reloads and tabs. ONE
// choice for the whole group, never per row: two controls for one decision
// would bury the useful row or double the state. `null` means "the person has
// not chosen": absence, not "open", is the default, which is what lets the
// breakpoint decide (collapsed below 600px, open from 600px up; see
// lib/copilot/aidDisclosure.js) and lets a later release change that without
// migrating anything already stored. A storage failure falls back to the
// default without throwing (the store is memory-authoritative). The key keeps
// the encoding it always had, so a value already stored under it still works.
const EXAMPLES_COLLAPSE_KEY = "copilot-example-projects";
const examplesCollapse = createAidCollapseStore(EXAMPLES_COLLAPSE_KEY);

// An example is shown only if it is shaped like one: a title and at least one
// bullet, every bullet a non-empty string. The server validates on the way in,
// but this is the last gate before a made-up project is read aloud, and a
// half-built one is worse than none.
function isShownEntry(entry) {
  return (
    !!entry &&
    typeof entry.title === "string" &&
    entry.title.trim() !== "" &&
    Array.isArray(entry.bullets) &&
    entry.bullets.length > 0 &&
    entry.bullets.every((b) => typeof b === "string" && b.trim() !== "")
  );
}

// Row 1 ("Ready example"), pre-warmed and picked for this question. null means
// the row does not exist for this card (no application, or the embedded engine:
// the server omits the field), which is different from any state below. Only a
// `ready` value that passes the render guard ever shows content; everything
// else is one quiet line, and the status is read, never the carried fields, so
// a pending or failed value that still has a title on it shows no title.
function rowOneView(example) {
  if (!example || typeof example !== "object") return null;
  switch (example.status) {
    case "ready":
      return isShownEntry(example) ? { kind: "ready", entry: example } : { kind: "no_match" };
    case "pending":
      return { kind: "warming" };
    case "no_match":
      return { kind: "no_match" };
    default:
      return { kind: "failed" };
  }
}

// Row 2 ("Example for this question"), written after the answer lands.
// `finalOnly` is a past question's card (the history list): it can show only a
// final state, so a Row 2 that never settled reads as failed there instead of a
// skeleton counting down on a question that was answered long ago.
function rowTwoView(example, finalOnly) {
  if (!example || typeof example !== "object") return null;
  if (example.status === "ready") {
    return isShownEntry(example) ? { kind: "ready", entry: example } : { kind: "failed" };
  }
  if (example.status === "pending") return { kind: finalOnly ? "failed" : "pending" };
  return { kind: "failed" };
}

function QuietLine({ children }) {
  return (
    <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
      {children}
    </Typography>
  );
}

// The body of a row that carries invented content: the lead first (so the
// warning is read before the content, and survives a screen reader that drops
// `dl` semantics from a grid), then the title, then the bullets as a real list.
// The lead is NOT conditional on the entry's `hypothetical` flag: a missing or
// false flag cannot remove it, because an invented project read as the
// candidate's real one is the one lie that ends an interview. `competency`
// prefixes the title on Row 1 only, so a mis-selection is visible at a glance.
function ExampleBody({ entry, withCompetency }) {
  const competency = withCompetency && typeof entry.competency === "string" ? entry.competency.trim() : "";
  return (
    <Stack spacing={LINE_GAP}>
      <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
        <Box component="strong" sx={{ fontWeight: 700 }}>
          {EXAMPLE_LEAD_BOLD}
        </Box>
        {EXAMPLE_LEAD_REST}
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-primary)", fontWeight: 600 }}>
        {competency ? `${competency}: ${entry.title}` : entry.title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {entry.bullets.map((bullet, i) => (
          <Typography key={i} component="li" variant="body2" sx={{ color: "var(--text-primary)" }}>
            {bullet}
          </Typography>
        ))}
      </Box>
    </Stack>
  );
}

function RowOne({ view }) {
  if (view.kind === "ready") {
    return (
      <Aid label={EXAMPLE_DT_READY} ddSx={INVENTED_DD_SX}>
        <ExampleBody entry={view.entry} withCompetency />
      </Aid>
    );
  }
  const line = view.kind === "warming" ? R1_WARMING : view.kind === "no_match" ? R1_NO_MATCH : R1_FAILED;
  return (
    <Aid label={EXAMPLE_DT_READY}>
      <QuietLine>{line}</QuietLine>
    </Aid>
  );
}

function RowTwo({ view }) {
  if (view.kind === "ready") {
    return (
      <Aid label={EXAMPLE_DT_LIVE} ddSx={INVENTED_DD_SX}>
        <ExampleBody entry={view.entry} />
      </Aid>
    );
  }
  if (view.kind === "pending") {
    // A STATIC skeleton: MUI's default pulse is infinite and nothing in this
    // app honours prefers-reduced-motion, so the placeholder does not move at
    // all. Two text lines reserve roughly the height of a ready example so the
    // swap does not jump the page; `aria-hidden` because the visible line above
    // them is the announcement, and `aria-busy` marks the row as unfinished.
    // Nothing invented is on screen yet, so no lead and no accent rule.
    return (
      <Aid label={EXAMPLE_DT_LIVE} ddProps={{ "aria-busy": "true" }}>
        <QuietLine>{R2_PENDING}</QuietLine>
        <Box aria-hidden="true" sx={{ mt: 0.5 }}>
          <Skeleton animation={false} variant="text" width="85%" />
          <Skeleton animation={false} variant="text" width="60%" />
        </Box>
      </Aid>
    );
  }
  return (
    <Aid label={EXAMPLE_DT_LIVE}>
      <QuietLine>{R2_FAILED}</QuietLine>
    </Aid>
  );
}

// The labelled group: a CollapsibleAid (a native disclosure button whose name is
// its visible text) over the group's own `dl`, wrapped in a role="group" named by
// that header. Collapsing unmounts the `dl`, so a collapsed group is out of both
// the accessibility tree and the tab order, and only the header line remains --
// still honest, because "invented" is in its text.
function ExampleProjectsGroup({ rowOne, rowTwo }) {
  return (
    <CollapsibleAid label={EXAMPLE_GROUP_LABEL} choiceStore={examplesCollapse} labelledGroup>
      <Box component="dl" sx={AID_GRID_SX}>
        {rowOne ? <RowOne view={rowOne} /> : null}
        {rowTwo ? <RowTwo view={rowTwo} /> : null}
      </Box>
    </CollapsibleAid>
  );
}

// ---------------------------------------------------------------------------
// The tech-buzzwords group. Presentation only: the list arrives on its prop
// already decided (written by the hooks after the answer lands), and the
// explanation behind each term arrives through the scope's api. Nothing here
// decides which terms are relevant or what a term means.
// ---------------------------------------------------------------------------

// Pinned copy. No em dash or en dash (a screen reader does not speak one), no
// emoji. The lead is NOT conditional on anything about a term: a suggestion read
// as a claim of experience is the lie that ends an interview, so whenever terms
// are on screen the warning is beside them.
const TECH_TERMS_LABEL = "Tech buzzwords";
const TECH_TERMS_LEAD_BOLD = "Suggestions, not claims.";
const TECH_TERMS_LEAD_REST = " Terms to be aware of for this question. Only use ones you can speak to honestly.";
const TT_PENDING = "Finding tech terms for this question…";
const TT_FAILED = "Couldn't find tech terms this time.";
const TT_DETAIL_LOADING = "Looking that up…";
const TT_DETAIL_EMPTY = "Nothing useful to add for this one.";
const TT_DETAIL_ERROR = "Couldn't look that up.";
const TT_DETAIL_TIMEOUT = "That took too long to look up.";
const TT_DETAIL_DISABLED = "Term explanations are unavailable on this server right now.";

// Its own remembered choice, separate from the other sections (see
// createAidCollapseStore above).
const techTermsCollapse = createAidCollapseStore("copilot-tech-buzzwords");

// What the group shows for one card's `techTerms`. null means the row does not
// exist for this card (no application, the embedded engine, or the request not
// yet started), which is different from any state below. Terms are shown only
// for a `ready` value holding at least one non-empty string; anything half-built
// reads as failed. `finalOnly` is a past question's card: a list that never
// settled reads as failed there instead of a "finding" line on an old answer.
function techTermsView(techTerms, finalOnly) {
  if (!techTerms || typeof techTerms !== "object") return null;
  if (techTerms.status === "ready") {
    const seen = new Set();
    const terms = [];
    for (const raw of Array.isArray(techTerms.terms) ? techTerms.terms : []) {
      const term = typeof raw === "string" ? raw.trim() : "";
      if (!term || seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      terms.push(term);
    }
    return terms.length > 0 ? { kind: "ready", terms } : { kind: "failed" };
  }
  if (techTerms.status === "pending") return { kind: finalOnly ? "failed" : "pending" };
  return { kind: "failed" };
}

function detailMessage(status, code) {
  if (status === "empty") return TT_DETAIL_EMPTY;
  if (code === "timeout") return TT_DETAIL_TIMEOUT;
  if (code === "disabled") return TT_DETAIL_DISABLED;
  return TT_DETAIL_ERROR;
}

// One open term's explanation, inline below the chips. The term is named again
// above its text so several open at once stay attributable.
function TechTermDetail({ term, record, onRetry }) {
  const status = record?.status ?? "idle";
  // `idle` on an OPEN term means its record was evicted from the bounded store;
  // it reads as a failure with a Retry rather than a "looking" line that never
  // ends.
  const retryable = (status === "error" || status === "idle") && record?.code !== "disabled";
  return (
    <Box sx={{ borderLeft: "2px solid var(--border-strong)", pl: 1.25, ...BREAK_LONG_WORDS_SX }}>
      <Typography variant="caption" component="p" sx={{ m: 0, color: "var(--text-secondary)", fontWeight: 700 }}>
        {term}
      </Typography>
      {status === "loading" ? (
        <Typography variant="body2" aria-busy="true" sx={{ color: "var(--text-secondary)" }}>
          {TT_DETAIL_LOADING}
        </Typography>
      ) : status === "done" ? (
        <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
          {record.detail}
        </Typography>
      ) : (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
          <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
            {detailMessage(status, record?.code)}
          </Typography>
          {retryable ? (
            // No Retry on the kill switch (retrying what an operator switched
            // off is a lie) and none on an honest empty (it would spend money to
            // be told the same thing).
            <Button
              type="button"
              size="small"
              color="inherit"
              onClick={onRetry}
              aria-label={`Retry explaining ${term}`}
              sx={TOUCH_TARGET_SX}
            >
              Retry
            </Button>
          ) : null}
        </Stack>
      )}
    </Box>
  );
}

// One term as a NATIVE <button> (a Chip rendered as `button`) whose accessible
// name IS the term. Not a Tooltip, which would replace that name, and not a
// Modal or Popover, which trap focus on the sentence the candidate is about to
// say. `aria-controls` points at the group's one always-present detail region, so
// it is never a dangling reference. A term the scope cannot resolve (no scope
// mounted, or no answer in it suggested the term) is disabled rather than a
// button that silently does nothing.
//
// EACH CHIP WARMS ITS OWN DETAIL ON MOUNT, so opening it is instant. The chips
// exist only inside the CollapsibleAid body, which unmounts while the section is
// collapsed, so a collapsed section warms nothing: its terms are not on screen.
// Expanding it mounts every chip together and they warm together (throttled by the
// shared prefetch queue). Keyed on the resolved store key so a store write never
// re-fires it; a stand-in api without keyFor/prefetch yields a null key, a no-op.
function TechTermChip({ term, api, regionId }) {
  const warmKey = typeof api?.keyFor === "function" ? api.keyFor(term) : null;
  useWarmOnMount(warmKey, () => api?.prefetch?.(term));
  const interactive = !!api && api.resolves(term);
  const open = interactive && api.isOpen(term);
  return (
    <Box component="li" sx={{ display: "flex" }}>
      <Chip
        component="button"
        type="button"
        size="small"
        label={term}
        disabled={!interactive}
        onClick={() => api?.toggle(term)}
        aria-expanded={open ? "true" : "false"}
        aria-controls={regionId}
        sx={{
          height: "auto",
          fontSize: 12,
          color: "var(--text-primary)",
          background: open ? "var(--bg-soft)" : "var(--bg-surface)",
          // The open state is never colour alone (WCAG 1.4.1): the border also
          // thickens to the accent rule the invented-example rows use.
          border: open ? "2px solid var(--accent)" : "1px solid var(--text-muted)",
          ...TOUCH_TARGET_SX,
          "& .MuiChip-label": {
            overflow: "visible",
            whiteSpace: "normal",
            textOverflow: "clip",
            py: 0.5,
            ...BREAK_LONG_WORDS_SX,
          },
        }}
      />
    </Box>
  );
}

// The group is a CollapsibleAid whose body is everything that used to sit in the
// row's `dd`: the pending or failed line, or the lead, the chips and the live
// region. All of it unmounts together while collapsed, so the live region and the
// chips it belongs to always mount at the same moment; which terms are OPEN lives
// in the scope (useTechTermDetails), not in the chips, so collapsing and
// re-expanding keeps an opened term open. `aria-busy` stays on the inner pending
// line and never on an ancestor of the live region, which would suppress its
// announcements.
function TechTermsGroup({ view }) {
  const api = useTechTermDetailApi();
  const regionId = useId();

  if (view.kind !== "ready") {
    const pending = view.kind === "pending";
    return (
      <CollapsibleAid label={TECH_TERMS_LABEL} choiceStore={techTermsCollapse}>
        <Box aria-busy={pending ? "true" : undefined} sx={BREAK_LONG_WORDS_SX}>
          <QuietLine>{pending ? TT_PENDING : TT_FAILED}</QuietLine>
        </Box>
      </CollapsibleAid>
    );
  }

  const openTerms = api ? view.terms.filter((term) => api.isOpen(term)) : [];
  return (
    <CollapsibleAid label={TECH_TERMS_LABEL} choiceStore={techTermsCollapse}>
      <Stack spacing={LINE_GAP} sx={BREAK_LONG_WORDS_SX}>
        <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
          <Box component="strong" sx={{ fontWeight: 700 }}>
            {TECH_TERMS_LEAD_BOLD}
          </Box>
          {TECH_TERMS_LEAD_REST}
        </Typography>
        <Stack
          component="ul"
          role="list"
          direction="row"
          useFlexGap
          sx={{ flexWrap: "wrap", gap: 0.75, listStyle: "none", m: 0, p: 0 }}
        >
          {view.terms.map((term) => (
            <TechTermChip key={term} term={term} api={api} regionId={regionId} />
          ))}
        </Stack>
        {/* Mounted whenever the body is, whether or not anything is open, so
            the chips' aria-controls always names a real element and a polite
            live region exists before its text changes (a region that appears
            already populated is the case screen readers fail to announce).
            Deliberately NOT a role="region" landmark: one per card would
            leave an empty landmark for every answer on the page. */}
        <Stack id={regionId} aria-live="polite" spacing={LINE_GAP}>
          {openTerms.map((term) => (
            <TechTermDetail key={term} term={term} record={api.get(term)} onRetry={() => api.retry(term)} />
          ))}
        </Stack>
      </Stack>
    </CollapsibleAid>
  );
}

export default function AnswerAids({ buzzwords, anchor, projectExample, projectExampleLive, techTerms, finalOnly }) {
  const terms = (Array.isArray(buzzwords) ? buzzwords : []).filter((t) => typeof t === "string" && t.trim());

  // A plausibility gate upstream (lib/copilot/resumeAnchor.js) can suppress
  // a résumé bullet that was mis-parsed as a job title, leaving `title` and
  // `company` both "" while `project`/`description` still carry real
  // content. `role` being falsy is therefore NOT the same thing as "nothing
  // from the résumé" — it only means there's no role LINE, which is why the
  // row below falls back to a generic label — still driven by `sourceWhere`,
  // never hardcoded to the résumé — instead of disappearing whenever
  // description phrases are still present.
  const role = roleText(anchor);
  const project = (anchor?.project || "").trim();
  // BUG-K2: an ARRAY of independently-shortened phrases, one per source
  // bullet — never joined into one string, which is how two different
  // bullets got spliced into a single fabricated sentence with no separator
  // between them. Each element renders on its own line, and — see the
  // bullet-marker comment where these render below — carries a leading
  // bullet character for the same reason: two adjacent phrases must never
  // read as one run-on, whether by string concatenation or by two DOM text
  // nodes sitting back to back with nothing between them.
  const description = (Array.isArray(anchor?.description) ? anchor.description : []).filter(
    (d) => typeof d === "string" && d.trim(),
  );

  const hasRoleRow = !!role || description.length > 0;
  const hasProjectRow = !!project;
  const hasResumeGroup = hasRoleRow || hasProjectRow;

  const hasWordsRow = terms.length > 0;
  const hasPostingGroup = hasWordsRow;

  // The example rows: each is null when the card has nothing to say about it
  // (no application selected, the embedded engine, or Row 2 not yet fired), and
  // the group exists only while at least one row does.
  const exampleRowOne = rowOneView(projectExample);
  const exampleRowTwo = rowTwoView(projectExampleLive, !!finalOnly);
  const hasExampleGroup = !!exampleRowOne || !!exampleRowTwo;

  // The tech buzzwords: null when the card has no such row (no application, or
  // the embedded engine, or the request not yet started).
  const techTermsRow = techTermsView(techTerms, !!finalOnly);
  const hasTechTermsGroup = !!techTermsRow;

  // Nothing to show is nothing rendered — never a header with an empty
  // group under it. No posting selected means no posting group; no
  // submitted résumé means no résumé group; both are ordinary states, not
  // errors. A group whose every row is empty renders neither that `dl` nor
  // the divider next to it.
  if (!hasResumeGroup && !hasPostingGroup && !hasTechTermsGroup && !hasExampleGroup) return null;

  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: "1px solid var(--border)" }}>
      {hasResumeGroup ? (
        <Box component="dl" sx={AID_GRID_SX}>
          {hasRoleRow ? (
            <Aid label={role ? roleLabel(!!anchor?.matched, anchor?.source) : capitalizeFirst(sourceWhere(anchor?.source))}>
              <Stack spacing={LINE_GAP}>
                {role ? (
                  <Typography variant="body2" sx={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {role}
                  </Typography>
                ) : null}
                {description.map((phrase, i) => (
                  // A leading bullet is real text content, not a `::marker`
                  // pseudo-element — deliberately, so it survives being
                  // flattened (a screen reader's braille output, a
                  // copy-paste, this component's own test suite reading
                  // `container.textContent`). Two Typography elements sitting
                  // next to each other in the DOM produce no separator on
                  // their own; without this, "Cut settlement to one day" and
                  // a second phrase read back to back as one run-on sentence
                  // — the exact failure mode BUG-K2 (above) already banned
                  // for the array shape, reachable again here through the
                  // rendering instead of the data.
                  <Typography key={i} variant="body2" sx={{ color: "var(--text-secondary)" }}>
                    {`• ${phrase}`}
                  </Typography>
                ))}
              </Stack>
            </Aid>
          ) : null}

          {hasProjectRow ? (
            <Aid label="Project to talk about">
              <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
                {project}
              </Typography>
            </Aid>
          ) : null}
        </Box>
      ) : null}

      {hasResumeGroup && hasPostingGroup ? (
        // `role="separator"` is what gives this line ANY presence in the
        // accessibility tree — an empty `Box` is otherwise invisible to a
        // screen reader, so without it the grouping this redesign is built
        // around exists only in pixels. Its contrast is 1.28:1 in both
        // themes, far under WCAG 1.4.11's 3:1 floor for a meaningful
        // graphical object (raising it to --border-strong only reaches
        // 1.76:1 and still fails) — so it is deliberately decorative
        // reinforcement, not the thing carrying the grouping. The grouping
        // itself is carried by the row labels, each of which already names
        // whose material it is ("Closest role on your resume", "Words from
        // the posting to work in"). Do not "fix" this line's colour under
        // the impression it's load-bearing; it isn't, and can't be made to
        // be without failing contrast regardless.
        <Box role="separator" sx={{ my: 1.25, borderTop: "1px solid var(--border)" }} />
      ) : null}

      {hasPostingGroup ? (
        // The header IS the label that used to be a `dt` here, so the body is
        // the chip list alone.
        <CollapsibleAid label="Words from the posting to work in" choiceStore={postingWordsCollapse}>
          <Stack
            component="ul"
            // `listStyle: "none"` below strips Safari/VoiceOver's implicit
            // `list` role along with the bullet glyphs — documented WebKit
            // behaviour, not a MUI quirk — which is what silently turns
            // this into loose, uncounted text for a screen reader user:
            // no "list, N items" announcement, no sense that these chips
            // form a set. The `Chip`s below already carry `component="li"`
            // (the matching `listitem` role), so restoring just the `list`
            // role here is what makes this a list again. Do not delete
            // this as "redundant with the ul tag" — the redundancy is the
            // point; `listStyle: none` is exactly what breaks it.
            role="list"
            direction="row"
            // MUI v9's Stack `spacing` prop compiles to a margin on every
            // child but the first (`useFlexGap` defaults to false), which
            // is fine unwrapped but breaks under `flexWrap`: the first
            // chip of each WRAPPED row still inherits that left margin,
            // indenting every wrapped row by the spacing amount. `gap`
            // (via `useFlexGap`) applies evenly in both directions
            // instead, which is also why `rowGap` alone was already
            // needed here for the vertical axis.
            useFlexGap
            sx={{ flexWrap: "wrap", gap: 0.75, listStyle: "none", m: 0, p: 0, ...BREAK_LONG_WORDS_SX }}
          >
            {terms.map((term) => (
              <Chip
                key={term}
                component="li"
                size="small"
                label={term}
                sx={{
                  height: "auto",
                  fontSize: 12,
                  color: "var(--text-primary)",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--text-muted)",
                  "& .MuiChip-label": {
                    overflow: "visible",
                    whiteSpace: "normal",
                    textOverflow: "clip",
                    py: 0.5,
                    ...BREAK_LONG_WORDS_SX,
                  },
                }}
              />
            ))}
          </Stack>
        </CollapsibleAid>
      ) : null}

      {hasTechTermsGroup && (hasResumeGroup || hasPostingGroup) ? (
        // Same separator, same reasoning, ahead of the tech buzzwords: only when
        // an earlier group rendered, so a terms-only card opens with no line that
        // divides nothing from nothing.
        <Box role="separator" sx={{ my: 1.25, borderTop: "1px solid var(--border)" }} />
      ) : null}

      {hasTechTermsGroup ? <TechTermsGroup view={techTermsRow} /> : null}

      {hasExampleGroup && (hasResumeGroup || hasPostingGroup || hasTechTermsGroup) ? (
        // Same separator, same reasoning, as the one above: it gives the third
        // group's boundary a presence in the accessibility tree. Rendered only
        // when an earlier group did, so an examples-only card does not open with
        // a line that divides nothing from nothing.
        <Box role="separator" sx={{ my: 1.25, borderTop: "1px solid var(--border)" }} />
      ) : null}

      {hasExampleGroup ? <ExampleProjectsGroup rowOne={exampleRowOne} rowTwo={exampleRowTwo} /> : null}
    </Box>
  );
}
