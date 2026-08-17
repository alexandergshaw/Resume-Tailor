"use client";

import { useId } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { TOUCH_TARGET_SX, BREAK_LONG_WORDS_SX, WRAP_ROW_SX } from "./mobileSx";
import { companyResearchDestination } from "@/lib/copilot/groundingNotice";

// T2-3 (AC-T2.10..T2.14, superseded by AC-group-T-amendment.md section I11).
// The live-interview "company" voice cue's results panel — purely
// presentational, every value a prop mirroring useCompanyBrief's return
// (app/copilot/useCompanyBrief.js): `{ status, articles, warnings, error,
// company, onRefresh, onBack }`, plus — since the BL-3 fix — `isEmbedded`
// (from useEngine), which this panel needs for exactly the same destination
// disclosure VoiceCueSidebar.js carries (BL-3, adversarial review: this
// panel used to carry NO disclosure at all, even though the acceptance
// criteria require one here too). No fetching, no state of its own.
//
// I11: this panel TAKES OVER the 280px rail rather than opening beside it —
// at 280px there is no room for both (I1's own arithmetic). Single column,
// no horizontal scroll, no modal, and — because it replaces the cue list
// rather than adding a second surface — a single "Back to voice cues"
// control rather than a second dismiss button (Teams' published in-meeting
// pane rules: single column, and when there is more than one nav layer,
// provide a back control instead of stacking dismiss buttons).
const RAIL_SX = { width: { xs: "100%", md: 280 }, flexShrink: 0, minWidth: 0 };

const CARD_SX = {
  p: 2, // "Card padding 16px" per spec
  borderRadius: 1.5,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
};

// "16px between cards" per spec.
const CARD_GAP = 2;

// Article dates arrive as whatever the research route/model returned (an
// absolute date string in this app's fixtures, e.g. "2026-02-01") — never
// reformatted into a narrow relative form here. A screen reader reads "1m"
// as "1 meter", not "1 month", so <time> carries the value verbatim in both
// `dateTime` and `title` rather than this component inventing a "2mo"-style
// abbreviation.
function ArticleMeta({ source, date }) {
  const parts = [source, date].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <Typography sx={{ fontSize: "0.72rem", color: "var(--text-secondary)", mt: 0.25 }}>
      {source ? <span>{source}</span> : null}
      {source && date ? " · " : ""}
      {date ? (
        <time dateTime={date} title={date}>
          {date}
        </time>
      ) : null}
    </Typography>
  );
}

// Card field order follows this app's existing CompanyResearchDialog
// (app/components/CompanyResearchDialog.js): title, then "source · date",
// then summary, then the suggestion. Deliberately does NOT copy that
// dialog's icon-only IconButton-with-Tooltip for the link — link text must
// be meaningful out of context (AC-T2.12), and a Tooltip would steal or
// rename the link's accessible name (the same F96 hazard VoiceCueSidebar's
// buttons avoid).
function ArticleCard({ article }) {
  return (
    <Box sx={CARD_SX}>
      {article.url ? (
        <Typography sx={{ fontSize: "0.9rem", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            {article.title}
          </a>
        </Typography>
      ) : (
        <Typography sx={{ fontSize: "0.9rem", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>{article.title}</Typography>
      )}
      <ArticleMeta source={article.source} date={article.date} />
      {article.summary ? (
        <Typography sx={{ fontSize: "0.82rem", mt: 0.75, ...BREAK_LONG_WORDS_SX }}>{article.summary}</Typography>
      ) : null}
      {article.suggestion ? (
        <Box sx={{ mt: 1 }}>
          {/* The suggestion sits last, under a constant visible label — the
              battlecard convention (Gong's "Just say this", Klue's
              Know/Say/Show) — and is never rendered in grey: grey is this
              app's own established convention for un-reviewed AI-generated
              text (e.g. PredictionPanel's accent treatment), and this line
              is exactly that: a model's suggestion, not a reviewed fact. */}
          <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--text-secondary)" }}>
            Ask this
          </Typography>
          <Typography sx={{ fontSize: "0.82rem", mt: 0.25, ...BREAK_LONG_WORDS_SX }}>{article.suggestion}</Typography>
        </Box>
      ) : null}
    </Box>
  );
}

// Loading renders three HEIGHT-ACCURATE skeleton cards, mirroring
// ArticleCard's own title/meta/summary/suggestion rhythm, so the panel does
// not reflow the instant real results land — someone reading it mid-sentence
// (mid-answer, in this app's actual use case) should not have the page jump
// under them. All results land at once (useCompanyBrief has no partial/
// streaming state), so there is exactly one transition to protect against.
function SkeletonCard({ index }) {
  return (
    <Box sx={CARD_SX} aria-hidden="true" data-testid={`brief-skeleton-${index}`}>
      <Skeleton variant="text" width="70%" height={22} />
      <Skeleton variant="text" width="45%" height={16} sx={{ mt: 0.5 }} />
      <Skeleton variant="text" width="100%" height={16} sx={{ mt: 1 }} />
      <Skeleton variant="text" width="90%" height={16} />
      <Skeleton variant="text" width="55%" height={16} sx={{ mt: 1 }} />
    </Box>
  );
}

export default function CompanyBriefPanel({
  status,
  articles = [],
  warnings = [],
  error = "",
  company = "",
  onRefresh,
  onBack,
  isEmbedded = false,
}) {
  const headingId = useId();
  const hasArticles = Array.isArray(articles) && articles.length > 0;
  // SF-5 (adversarial review): `warnings.length` with only an `= []`
  // default crashes on `warnings={null}` — a default parameter only fires
  // for `undefined`, never for an explicitly passed `null`. Guarded with
  // Array.isArray so any non-array value (null, or anything else a caller
  // might pass) degrades to "no warnings" instead of throwing.
  const warningList = Array.isArray(warnings) ? warnings : [];
  const hasCompany = !!String(company || "").trim();
  // BL-3: the same destination disclosure VoiceCueSidebar.js carries,
  // derived the same way — this panel had none at all before this fix,
  // though the acceptance criteria require it here too. `company` already
  // tells this component whether there is anything to research (see the
  // idle branch below), so no extra prop is needed beyond `isEmbedded`.
  const companyNotice = companyResearchDestination({ isEmbedded, hasCompany });

  return (
    // Same region/heading landmark discipline as VoiceCueSidebar — this
    // panel occupies the identical rail slot, so it carries its own,
    // equally identifiable region rather than leaving the slot unlabeled
    // while it is in the "brief" state.
    <Box role="region" aria-labelledby={headingId} sx={RAIL_SX}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, ...WRAP_ROW_SX }}>
        <Button size="small" onClick={onBack} sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}>
          Back to voice cues
        </Button>
      </Box>

      <Typography id={headingId} component="h3" sx={{ fontSize: "0.95rem", fontWeight: 700, mt: 1, mb: 0.5, ...BREAK_LONG_WORDS_SX }}>
        {company ? `Company research: ${company}` : "Company research"}
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, ...WRAP_ROW_SX }}>
        <Button
          size="small"
          variant="outlined"
          onClick={onRefresh}
          disabled={status === "loading"}
          sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}
        >
          Refresh
        </Button>
      </Box>

      {/* BL-3 (adversarial review): rendered in EVERY status, same as the
          sidebar's per-row disclosure — the Refresh button above can fire a
          fresh request from any status, so the disclosure of where that
          request goes needs to be on screen regardless of which status this
          panel happens to be showing right now. */}
      {companyNotice ? (
        <Typography sx={{ fontSize: "0.72rem", color: "var(--text-secondary)", mb: 1.5, fontStyle: "italic", ...BREAK_LONG_WORDS_SX }}>
          {companyNotice}
        </Typography>
      ) : null}

      {warningList.length > 0 ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1.5 }}>
          {warningList.map((w, i) => (
            <Typography key={i} sx={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              {w}
            </Typography>
          ))}
        </Box>
      ) : null}

      {status === "loading" ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: CARD_GAP }}>
          <SkeletonCard index={0} />
          <SkeletonCard index={1} />
          <SkeletonCard index={2} />
        </Box>
      ) : status === "error" ? (
        // AC-T2.11: role="alert" Alert with an inline Retry action, matching
        // SubmittedDocs.js's and SampleAnswer.js's sibling error paths —
        // never plain coloured text (WCAG 1.4.1, colour is not the only
        // carrier of the "this failed" meaning).
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRefresh} sx={{ textTransform: "none" }}>
              Retry
            </Button>
          }
        >
          {error || "Company research failed."}
        </Alert>
      ) : status === "done" && hasArticles ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: CARD_GAP }}>
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </Box>
      ) : status === "done" ? (
        <Typography sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {company
            ? `No recent coverage was found for ${company}.`
            : "No recent coverage was found."}
        </Typography>
      ) : hasCompany ? (
        // BL-4 (adversarial review): idle is reachable for TWO different
        // reasons, and they are not the same fact. useCompanyBrief.js
        // resets to idle on every posting change (its own
        // `belongsToCurrentPosting` guard resolves `effective` to
        // INITIAL_STATE the instant `forId` no longer matches) — including
        // a change onto a posting with a perfectly good company on file,
        // simply one no request has been made for yet. `company` is truthy
        // in exactly that case (see companyBriefRequest's own guard: it is
        // only ever non-empty when a company IS on file), so this branch
        // prompts the candidate toward the action that gets a result,
        // rather than denying a company exists when one plainly does — the
        // heading above already says "Company research: {company}" in this
        // exact state.
        <Typography sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {`Say "pull up the company" or press Refresh to research ${company} for this posting.`}
        </Typography>
      ) : (
        // idle, no company on file at all — reachable when the selected
        // posting names no company at all (useCompanyBrief's
        // companyBriefRequest returns null and the panel still opens so the
        // candidate can see why nothing happened, rather than nothing
        // appearing to occur when they say the cue).
        <Typography sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          No company name is on file for this posting, so there is nothing to research yet.
        </Typography>
      )}
    </Box>
  );
}
