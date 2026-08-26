"use client";

import { useId } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { VOICE_CUES } from "@/lib/copilot/voiceCues";
import { answerCompanyFactsNotice, companyResearchDestination } from "@/lib/copilot/groundingNotice";
import { SPEAKER_ATTRIBUTION, cueAvailabilityNotice, cueRowNote } from "@/lib/copilot/cuePolicy";
import { TOUCH_TARGET_SX, WRAP_ROW_SX, BREAK_LONG_WORDS_SX } from "./mobileSx";

// T3 (AC-T3.1..T3.7, superseded by AC-group-T-amendment.md section I). Lists
// every voice cue the live interview screen understands, with a one-click
// equivalent for each — driven entirely off VOICE_CUES (lib/copilot/voiceCues.js)
// so a new cue there needs no edit here (AC-T3.1). Purely presentational: the
// wiring wave supplies `pinned` (whether the hold cue is currently active),
// `onActivate` (called with a cue's `action` — "pin" | "unpin" | "company" —
// when its one-click button is pressed), the collapse state, and — since the
// BL-1 fix — `isEmbedded`/`hasCompany`, the two facts the company-cue
// destination disclosure below is derived from (see groundingNotice.js).
//
// I1: rail width is 280px, and this component does not decide when it sits
// beside the dashboard versus stacked below it — that's the caller's job
// (below `md`/900, TranscriptDisclosure's own house pattern renders this
// rail OUTSIDE the bounded live column so it's reachable by page scroll
// rather than clipped). This component only promises it will not itself
// force horizontal overflow at 320px, and caps its own width at `md` so it
// never tries to claim more than the 280px the rail arithmetic allows.
const RAIL_SX = { width: { xs: "100%", md: 280 }, flexShrink: 0, minWidth: 0 };

// I2/SF-6 (adversarial review, mutation harness). Rows, not cards. A card
// per cue (heading + summary + list + button) measured 166px, so three cues
// plus a header is 624px against a ~700px bounded column, and overflows at
// four cues. A row (button + one summary line + one "also say" line)
// measured 88px, so three cues is 382px and still fits at six. This is not
// a stylistic preference, it is what makes AC-T3.6's above-the-fold
// requirement satisfiable at all.
//
// SF-6 correction: the shipped copy blew that own budget (~742px measured
// against the 280px column, nearly double the 382px prediction), for two
// compounding reasons this file used to get wrong, both fixed below rather
// than by re-inflating the row style itself (which stays exactly as
// measured-correct as it always was):
//   1. The row's <h4> and its button used to carry the IDENTICAL string
//      side by side in a 280px-wide flex row, so the heading wrapped to two
//      lines AND the row announced its own title twice. Below, the button
//      IS the heading (`<Typography component="h4"><Button>…`) — the
//      accordion-header pattern the ARIA Authoring Practices Guide
//      recommends for exactly this shape (a clickable row heading) — so the
//      title renders, and is announced, exactly once, on one line.
//   2. `cue.summary` in the registry is now written short enough to render
//      whole on one line at 280px, and the phrase list caps at MAX_PHRASES
//      rather than every phrase a cue happens to advertise.
const ROW_SX = { py: 1.25, borderBottom: "1px solid var(--border)", "&:last-of-type": { borderBottom: "none" } };

// SF-6: how many of a cue's advertised phrases the row actually renders.
// Every phrase still matches the cue via voiceCues.js's own patterns; this
// only trims what this ONE row shows so the row stays one line, not how
// many ways a candidate can trigger the cue by voice.
const MAX_PHRASES = 3;

// SF-6, corrected after measuring the real thing in a browser. This file
// used to carry a `shortSummary` helper that clipped `cue.summary` at 45
// characters and appended an ellipsis. That was the wrong fix, and no test
// could see it: the tests asserted the summary "renders", which a truncated
// fragment does. On screen it read "Freezes the current question and its
// answer…" — a sentence cut mid-thought, which is worse than a short one.
// It also put an ellipsis into text a screen reader reads aloud, which this
// codebase avoids everywhere else for the same reason.
//
// The registry's summaries are now WRITTEN short (voiceCues.js), so there is
// nothing to trim: the row renders `cue.summary` whole. Shortening prose is
// an edit to the copy, never a runtime slice of it.

// I4: no aria-label anywhere in this file. WCAG 2.5.3 Label in Name, and
// failure technique F96 specifically: Apple Voice Control (and Dragon,
// Voice Access) act on the ACCESSIBLE NAME, not the visible text, and will
// not act on a control whose visible text and accessible name diverge. This
// feature exists to be operated while the user's hands and eyes are busy
// with an interview — decorating a button's name with context via
// aria-label breaks it for exactly the audience it serves. So every button
// below is disambiguated STRUCTURALLY (the region's own aria-labelledby,
// and each row's own h4 — which, per SF-6 above, now simply IS the button)
// rather than lexically, and its visible text IS its full accessible name.
//
// I5: the hold ("pin") cue's button is not a "Hold"/"Release" label swap —
// APG's Button pattern, Roselli on dynamic accessible names, and Higley's
// toggle matrix all agree a control changes its NAME or its STATE, never
// both at once, because a name that changes under a screen reader mid­
// session reads as a different control appearing, not the same one
// changing. So this button's text (cue.title, e.g. "Hold the question")
// never changes; only `aria-pressed` and the sibling "Currently held" badge
// (visual + textual, never colour alone — AC-X2) carry the state.
function isPinCue(cue) {
  return cue.action === "pin";
}

// The company cue is the one control on this screen that fires a real
// outbound network request the instant it activates, with no confirmation
// step (by design — AC-X3 rules out a confirmation dialog for a
// non-destructive action). When it is triggered by VOICE rather than by
// this button, the candidate clicked nothing at all, so the disclosure of
// where the data goes must already be on screen BEFORE the cue is ever
// spoken — it cannot live only inside the results panel that opens after
// the request has already fired (amendment section E4), and — BL-2,
// adversarial review — it must still be on screen once a session goes
// live, which is the ONLY time a spoken cue can actually fire and is
// exactly when this rail auto-collapses (see the collapsed branch below).
//
// BL-1 (adversarial review, mutation S16): this used to be a single
// hardcoded sentence naming Google unconditionally. It is now derived from
// the two facts a caller actually has — `isEmbedded` (from useEngine) and
// `hasCompany` (whether the selected posting has one on file) — by
// companyResearchDestination (lib/copilot/groundingNotice.js), which is
// where the honest, engine-by-engine reasoning and its literal-oracle tests
// live. This component states no fact about the network on its own.
function CueRow({ cue, pinned, onActivate, companyNotice, availabilityRowNote }) {
  const titleId = useId();
  // AC-V2.6.1 (accessibility audit): the id the row's degraded-state note
  // renders under, so the note can be the BUTTON's accessible description
  // rather than a paragraph that merely sits near it. See the
  // aria-describedby on the <Button> below for the whole reasoning; minted
  // unconditionally because hooks cannot be called conditionally, and only
  // referenced when there is actually a note to point at.
  const noteId = useId();
  const pressed = isPinCue(cue) ? pinned : undefined;
  const phrases = cue.phrases.slice(0, MAX_PHRASES);
  return (
    <Box component="li" sx={{ ...ROW_SX, listStyle: "none" }} aria-labelledby={titleId}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, ...WRAP_ROW_SX }}>
        {/* SF-6: the row's own heading IS its button — the APG accordion-
            header pattern (a <button> inside the heading element) — so
            cue.title renders, and is announced, exactly once, not twice. */}
        <Typography component="h4" sx={{ m: 0, flex: 1, minWidth: 0 }}>
          <Button
            id={titleId}
            size="small"
            variant={pressed ? "contained" : "outlined"}
            aria-pressed={pressed}
            // AC-V2.6.1 (accessibility audit, WCAG 1.3.1): the row note used
            // to be a positional sibling <p> and nothing more — the row's own
            // aria-labelledby points only at this button, so a user tabbing
            // the rail heard "Release the question, button" with no
            // indication that saying it does nothing this session. The state
            // was on the page and not on the control.
            //
            // DESCRIPTION, never name. I4/WCAG 2.5.3 Label in Name is the
            // reason there is no aria-label anywhere in this file: Voice
            // Control and Dragon act on the accessible NAME, and this feature
            // exists to be driven hands-free. aria-describedby is announced
            // separately from the name and leaves it byte-identical, so both
            // invariants hold — VoiceCueSidebar.test.js asserts each button's
            // name still equals its own trimmed visible text, in this state
            // too. `undefined` (not "", not null) when there is no note, so
            // the attribute is absent rather than present-and-dangling.
            aria-describedby={availabilityRowNote ? noteId : undefined}
            onClick={() => onActivate(cue.action)}
            sx={{
              textTransform: "none",
              justifyContent: "flex-start",
              width: "100%",
              fontSize: "0.85rem",
              fontWeight: 600,
              ...BREAK_LONG_WORDS_SX,
              ...TOUCH_TARGET_SX,
            }}
          >
            {cue.title}
          </Button>
        </Typography>
        {/* I6: pressed state carries three signals, none of them colour
            alone — the border (via variant="outlined"/"contained"), the
            aria-pressed value, and this text badge. */}
        {pressed ? (
          <Chip
            label="Currently held"
            size="small"
            variant="outlined"
            sx={{ height: 18, fontSize: 10.5, borderColor: "var(--warning)", color: "var(--warning)", flexShrink: 0 }}
          />
        ) : null}
      </Box>
      <Typography sx={{ fontSize: "0.78rem", color: "var(--text-secondary)", mt: 0.25, ...BREAK_LONG_WORDS_SX }}>
        {cue.summary}
      </Typography>
      {/* SF-2 (adversarial review): "Also say:" is a label FOR the list
          below, not an item IN it — a <span> sitting as a direct child of a
          role="list" is invalid list content, so it lives outside the list
          now instead of as the list's first (non-<li>) child. */}
      <Box sx={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 600, mt: 0.25 }}>Also say:</Box>
      {/* AC-T3.2/I7: role="list" is load-bearing — Safari drops list
          semantics from a <ul> styled list-style:none, so the role is
          restated explicitly rather than relied on implicitly. Rendered as
          one wrapped line rather than a stacked bullet list, which is what
          keeps this row's height at "one summary line + one phrases line"
          instead of growing with however many example phrases a cue happens
          to advertise (I2); SF-6 additionally caps the phrases actually
          shown at MAX_PHRASES.

          No separator character between items. Every advertised phrase is a
          whole sentence carrying its own terminal punctuation, so appending
          one rendered as ".;" on screen and would be read out as a stray
          "semicolon" after each phrase. The list semantics plus the gap do
          the separating; the punctuation the phrase already has does the
          rest. */}
      <Box
        component="ul"
        role="list"
        sx={{ display: "flex", flexWrap: "wrap", columnGap: 1, rowGap: 0.25, m: 0, mt: 0.25, p: 0, listStyle: "none" }}
      >
        {phrases.map((phrase) => (
          <Box
            component="li"
            key={phrase}
            sx={{ fontSize: "0.72rem", color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX }}
          >
            {phrase}
          </Box>
        ))}
      </Box>
      {cue.action === "company" && companyNotice ? (
        <Typography sx={{ fontSize: "0.72rem", color: "var(--text-secondary)", mt: 0.5, fontStyle: "italic", ...BREAK_LONG_WORDS_SX }}>
          {companyNotice}
        </Typography>
      ) : null}
      {/* AC-V2.6: read straight off cuePolicy.js's cueRowNote — never
          hand-written here — so this row can never claim a button-only
          state resolveCueAction has stopped enforcing, or stay silent about
          one it still enforces. "" (the common case) renders nothing. */}
      {availabilityRowNote ? (
        // AC-V2.6.1: carries `noteId` so it is the button's own accessible
        // description (see the aria-describedby above), while staying exactly
        // the visible sentence it already was — nothing here is hidden, and
        // nothing about the state is carried by colour.
        <Typography
          id={noteId}
          sx={{ fontSize: "0.72rem", color: "var(--text-secondary)", mt: 0.5, fontStyle: "italic", ...BREAK_LONG_WORDS_SX }}
        >
          {availabilityRowNote}
        </Typography>
      ) : null}
    </Box>
  );
}

// BL-2 (adversarial review): the full-length version, shown once at the
// foot of the EXPANDED rail. Three facts, each with its own reason: (1) it
// is the candidate's OWN microphone the cues listen to, so an interviewer's
// voice bleeding through the candidate's speakers on a shared/room
// microphone can still be picked up on that channel — there is no better
// signal available on tab/system audio capture (amendment AC-T1.13.2); (2)
// matching only runs on a completed utterance, which the provider's own
// endpointing delay makes a real, visible ~0.3-1.5s lag, not a bug; (3) on
// the in-person source specifically, cues stay inert until speaker identity
// has actually settled (two voices observed, or a manual override), because
// before that the "you" channel is a display guess, not a decision anything
// should act on — the buttons above are the whole fallback for that window.
const MIC_NOTE_FULL =
  "Cues are heard on your own microphone and matched only once you finish speaking, so there is a short delay before one takes effect. In person, on a shared microphone, cues stay inert until the app has worked out who is who. The buttons above always work as a fallback.";

// BL-2: the same three facts, condensed to one line for the COLLAPSED rail
// — the state a session is actually live in, which is the only state a
// spoken cue can fire in at all. "The buttons above" is dropped here on
// purpose: collapsed renders no buttons.
const MIC_NOTE_SHORT =
  "Cues use your own microphone, take a short pause to register, and stay inert in person until speaker identity settles.";

// AC-T3.5/I3: expanded while idle (the cues must be learnable before Start)
// and auto-collapsed to a one-line summary plus an expand control once a
// session is live — the caller (CopilotClient, later wave) owns exactly
// WHEN that switch happens and passes `collapsed`/`onToggleCollapsed` down.
// Every product with primary docs already ships this as "show commands on
// demand" (macOS Voice Control, Dragon, Windows Speech); the one vendor
// that shipped a persistent rail (Nuance) removed it in the successor
// product.
//
// BL-2 (adversarial review): a session going live is exactly when this rail
// collapses AND exactly the only window a spoken cue can fire in — so the
// company-cue destination disclosure and the mic/delay/in-person note
// cannot live ONLY in the expanded branch, or the one moment they matter
// most is the one moment neither is on screen. Both render in the collapsed
// branch too, in one-line form.
export default function VoiceCueSidebar({
  collapsed = false,
  onToggleCollapsed,
  pinned = false,
  onActivate,
  isEmbedded = false,
  hasCompany = false,
  // AC-V2.1/V2.6: defaults to the tab/system idle value, same default
  // useLiveSession.js's own `speakerAttribution` state starts at — a caller
  // that hasn't wired this prop through yet (an older mock, a test written
  // before V2) renders exactly today's copy, with no degraded-state notice.
  speakerAttribution = SPEAKER_ATTRIBUTION.NOT_APPLICABLE,
  // AC-V2.8: the session's live speaker snapshot, handed to the policy beside
  // the attribution flag and used for nothing else in this file. `null` — a
  // caller that hasn't wired it through, and every mock written before V2.8 —
  // is NO EVIDENCE, so the policy gives the conservative answer and this rail
  // renders exactly what it rendered before. See cuePolicy.js's
  // `effectiveAttribution`: the flag under-claims by design, and the tags are
  // what tell a session that genuinely cannot separate voices apart from one
  // whose token route merely blipped. Passing it is what stops this rail
  // saying "button only this session" about cues the policy now permits.
  speakerSnapshot = null,
}) {
  const headingId = useId();
  const companyNotice = companyResearchDestination({ isEmbedded, hasCompany });
  // P1.7. A DIFFERENT transfer from the cue's, and the reason it is disclosed
  // on this rail rather than only where the cue's is: the company-facts search
  // fires on every drafted answer, mid-session, with nothing said and nothing
  // clicked. `postingGroundingNotice` — the notice that carries the same
  // sentence in live mode — renders inside SessionSetup's `<Collapse>`, which
  // `start()` itself collapses, so for the entire live window it is out of the
  // DOM while the transfer keeps firing. This rail is on screen for that whole
  // window, which is exactly the argument BL-2 already made for putting
  // `companyNotice` in both branches, so this sits beside it in both.
  //
  // Derived, not written here: like every other network claim in this file it
  // comes from lib/copilot/groundingNotice.js, so practice mode, live mode's
  // notice and this rail cannot drift into three descriptions of one payload.
  const companyFactsNotice = answerCompanyFactsNotice({ isEmbedded, hasCompany });
  // AC-V2.6: both read straight off lib/copilot/cuePolicy.js, never
  // hand-written here — see that module's own header for why: this
  // component's whole reason for taking `speakerAttribution` as a prop is so
  // its sentence can never drift from what resolveCueAction actually
  // enforces in useLiveSession.js/useCueActions.js.
  //
  // AC-V2.6.2: `collapsed` is handed to the policy rather than used to pick
  // between two sentences written here. The notice's closing clause is an
  // INSTRUCTION ("…from their buttons below"), and it is false in the
  // collapsed rail, whose only button is the expand toggle above it — the
  // same trap MIC_NOTE_SHORT below already documents having fallen into. The
  // component still states no fact of its own; it just tells the policy which
  // rail the user is looking at.
  const availabilityNotice = cueAvailabilityNotice(speakerAttribution, {
    collapsed,
    snapshot: speakerSnapshot,
  });

  return (
    // AC-T3.1's own landmark: role="region" with aria-labelledby pointing at
    // this component's own h3, following TechWatchPanel.js's house pattern
    // (app/components/experience/TechWatchPanel.js). Deliberately not a MUI
    // Drawer: `variant="temporary"` renders through Modal and traps focus,
    // and `persistent`/`permanent` emit no landmark role and no accessible
    // name at all — neither gives this rail the identity a region needs.
    <Box role="region" aria-labelledby={headingId} sx={RAIL_SX}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, ...WRAP_ROW_SX }}>
        <Typography id={headingId} component="h3" sx={{ fontSize: "0.95rem", fontWeight: 700, m: 0 }}>
          Voice cues
        </Typography>
        <Button
          size="small"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}
        >
          {collapsed ? "Show voice cues" : "Hide voice cues"}
        </Button>
      </Box>

      {collapsed ? (
        <>
          <Typography sx={{ fontSize: "0.78rem", color: "var(--text-secondary)", mt: 0.5, ...BREAK_LONG_WORDS_SX }}>
            {VOICE_CUES.length} voice cue{VOICE_CUES.length === 1 ? "" : "s"} available. Hold, release, or pull up
            company research by saying it, or expand this to see how.
          </Typography>
          {companyNotice ? (
            <Typography sx={{ fontSize: "0.7rem", color: "var(--text-secondary)", mt: 0.5, fontStyle: "italic", ...BREAK_LONG_WORDS_SX }}>
              {companyNotice}
            </Typography>
          ) : null}
          {/* P1.7: the automatic transfer, disclosed in the collapsed rail —
              the state a live session is actually in, and the state the
              transfer actually fires in. --text-secondary is the 6.67:1 token
              R-228 settled for small text; the sentence carries its whole
              meaning as text, with nothing said by colour. */}
          {companyFactsNotice ? (
            <Typography sx={{ fontSize: "0.7rem", color: "var(--text-secondary)", mt: 0.5, ...BREAK_LONG_WORDS_SX }}>
              {companyFactsNotice}
            </Typography>
          ) : null}
          {/* AC-V2.6: must render here too, not only expanded — collapsed is
              the state a LIVE session is actually in, the only state a
              spoken cue can fire in at all (same reasoning as companyNotice
              and MIC_NOTE_SHORT just above, BL-2). */}
          {availabilityNotice ? (
            <Typography sx={{ fontSize: "0.7rem", color: "var(--text-secondary)", mt: 0.5, fontStyle: "italic", ...BREAK_LONG_WORDS_SX }}>
              {availabilityNotice}
            </Typography>
          ) : null}
          <Typography sx={{ fontSize: "0.7rem", color: "var(--text-secondary)", mt: 0.5, ...BREAK_LONG_WORDS_SX }}>
            {MIC_NOTE_SHORT}
          </Typography>
        </>
      ) : (
        <>
          {/* AC-V2.6: the expanded rail's own copy of the same sentence —
              read off the same module as the collapsed one above and each
              row's own note below, so all three can never disagree. */}
          {availabilityNotice ? (
            <Typography sx={{ fontSize: "0.78rem", color: "var(--text-secondary)", mt: 0.5, fontStyle: "italic", ...BREAK_LONG_WORDS_SX }}>
              {availabilityNotice}
            </Typography>
          ) : null}
          {/* SF-1 (adversarial review): role="list" restated here too, not
              just on the inner phrase lists — this outer row list is a
              list-style:none <ul> exactly as much as the phrase lists are,
              and Safari's semantics-drop bug this file's own comments cite
              (I7) applies to it identically. */}
          <Box component="ul" role="list" sx={{ m: 0, mt: 0.5, p: 0, listStyle: "none" }}>
            {VOICE_CUES.map((cue) => (
              <CueRow
                key={cue.id}
                cue={cue}
                pinned={pinned}
                onActivate={onActivate}
                companyNotice={companyNotice}
                availabilityRowNote={cueRowNote(cue.action, speakerAttribution, {
                  snapshot: speakerSnapshot,
                })}
              />
            ))}
          </Box>
          {/* Foot-of-rail note, once — not repeated per cue (AC-T3.7). */}
          <Typography sx={{ fontSize: "0.7rem", color: "var(--text-secondary)", mt: 1, ...BREAK_LONG_WORDS_SX }}>
            {MIC_NOTE_FULL}
          </Typography>
          {/* P1.7: and the same sentence at the foot of the EXPANDED rail, so
              expanding the cues mid-session never removes a disclosure that
              was on screen a moment earlier. Once, at the foot — it is a fact
              about drafting an answer, not about any one cue, so it is not a
              row note. */}
          {companyFactsNotice ? (
            <Typography sx={{ fontSize: "0.7rem", color: "var(--text-secondary)", mt: 1, ...BREAK_LONG_WORDS_SX }}>
              {companyFactsNotice}
            </Typography>
          ) : null}
        </>
      )}
    </Box>
  );
}
