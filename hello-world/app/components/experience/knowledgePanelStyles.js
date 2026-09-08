"use client";

import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

// The knowledge panel's measured style constants, plus the one render helper
// its three components share.
//
// WHY THE CONSTANTS ARE EXPORTED AT ALL. `:focus-visible` is measurably flaky
// in this harness — five true and five false over ten identical runs of the
// same assertion — so a focus-ring criterion proved by simulating focus fails
// one run in two for reasons that have nothing to do with the code. Exporting
// the objects turns that criterion into a static read of a value, which is
// stable. The no-colour-literal and no-dimming rules are read the same way.
//
// THREE THINGS HERE ARE CHEAP TO GET WRONG AND EXPENSIVE TO SHIP:
//
//   1. THE FOCUS RING IS FOUR LONGHANDS, NEVER THE SHORTHAND. jsdom's CSS
//      parser drops the shorthand entirely, so an implementation written with
//      it makes its own falsifier read back "none" — a green test beside a
//      missing ring.
//
//   2. NO DIMMING ANYWHERE. The obvious blocked-control look lands the label
//      at 1.81–2.36:1 on every ground against a 4.5 floor. WCAG 1.4.3 exempts
//      "inactive user interface components", but an `aria-disabled` control is
//      deliberately NOT inactive — it stays in the tab order precisely so the
//      user can reach the reason — so the exemption cannot be claimed for it.
//      The label swaps instead ("Regenerate summary" -> "Generating…"), at
//      full contrast.
//
//   3. NO COLOUR LITERAL ANYWHERE. This app switches theme by stamping
//      `data-theme` on <html>, and there is no dark `@media` rule at all, so a
//      literal flips in NEITHER channel: it is frozen in both. Every colour
//      below is a `var(--token)` the theme's own token table redefines per
//      mode.
//
// The panel also sets its control borders EXPLICITLY rather than inheriting a
// default: the palette has no mid-grey clearing 3:1, and `--border-control` is
// the token the theme added for exactly this (`--border` measures 1.28:1 and
// `--border-strong` 1.76:1 against the panel ground). Naming it here means the
// panel's controls do not depend on which component happens to inherit the
// theme override.

// The panel container. `border`, `borderRadius` and `backgroundColor` are
// TechWatchPanel's own region values, so two sibling panels in one tab do not
// disagree about what a panel looks like. The gap is `mt: 3` rather than that
// panel's `mt: 2`, matching the AttachmentPanel wrapper this one sits after.
export const PANEL_SX = {
  mt: 3,
  p: 1.5,
  border: "1px solid var(--border)",
  borderRadius: 1.5,
  backgroundColor: "var(--bg-soft)",
};

// FOUR LONGHANDS. Never the shorthand — see this file's header.
// `--accent` measures 5.15–8.77:1 on every ground in both modes.
export const FOCUS_SX = {
  outlineWidth: "2px",
  outlineStyle: "solid",
  outlineColor: "var(--accent)",
  outlineOffset: "2px",
  borderRadius: "2px",
};

// Every button in the panel. `textTransform: "none"` matches every other
// control in this directory; the border is pinned rather than inherited.
//
// The 44px phone floor lives HERE rather than at each call site, because all
// three of this feature's components (KnowledgePanel, KnowledgeQuestionBox,
// KnowledgeHistory) style every button through this one constant -- so one
// spread covers them all and there is nowhere for a fourth button to be added
// without it. `size="small"` buttons are ~30.75px tall, well under the floor;
// TOUCH_TARGET_SX's `sm` branch is `auto`, min-height's own initial value, so
// nothing above the phone breakpoint moves.
export const BTN_SX = {
  textTransform: "none",
  borderColor: "var(--border-control)",
  ...TOUCH_TARGET_SX,
  "&:focus-visible": FOCUS_SX,
};

// The question field. MUI draws an outlined input's resting border on the
// notched-outline fieldset, not on the root, so pinning `borderColor` on the
// root would style nothing at all.
export const FIELD_SX = {
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border-control)" },
};

export const HEADING_SX = { fontWeight: 700, fontSize: 15, m: 0 };
export const SUBHEAD_SX = { fontWeight: 700, fontSize: 13, m: 0, mb: 0.5 };
export const SCOPE_SX = { fontSize: 12.5, color: "var(--text-secondary)" };
export const CAPTION_SX = { fontSize: 12.5, color: "var(--text-secondary)" };

// A state line: glyph, then an optional bold lead-in, then the sentence.
// `alignItems: "flex-start"` keeps the glyph on the first line of a sentence
// that wraps to three.
export const STATE_ROW_SX = { display: "flex", alignItems: "flex-start", gap: 0.75, fontSize: 12.5, mt: 0.5 };

// The bold opening of an attention state. The COMPLETE state has no run at
// weight 700 anywhere, which is the second of the three monochrome channels
// (the first is the glyph silhouette, the third is the sentence itself).
export const LEAD_IN_SX = { fontWeight: 700, color: "var(--warning)" };
export const SENTENCE_SX = { fontWeight: 400, color: "var(--text-primary)" };
export const OK_LINE_SX = { fontWeight: 400, color: "var(--text-secondary)" };

// Text, on the panel's own ground — deliberately NOT a tinted band. A soft
// band measures 1.01–1.34:1 at its own edge, which is a colour claim with no
// outline to carry it, and the danger token on its own soft ground is 3.98:1
// in dark against a 4.5 floor: correct in light, non-conformant in dark, from
// the same two tokens.
export const FAILED_SX = { fontSize: 12.5, color: "var(--danger)" };

export const SEP_SX = { borderTop: "1px solid var(--text-muted)", mt: 1.5, pt: 1.5 };

// The collapsed cap for long model output. 17em is ten line boxes at
// MarkdownPreview's own 14px / 1.7, so the question field sits at most ~250px
// below the panel's top even against a 40,000-character summary.
//
// The overflow is HIDDEN, never scrolled: a nested scroller traps the wheel,
// hides its content from find-in-page, and adds a second scrollbar the user
// did not ask for. The "show the whole summary" control is the way down.
export const COLLAPSED_BODY_MAX_HEIGHT = "17em";
export function BODY_SX(expanded) {
  return { maxHeight: expanded ? "none" : COLLAPSED_BODY_MAX_HEIGHT, overflow: "hidden" };
}

// Descendant rules add overflow-wrap and NOTHING else. At (0,1,1) these beat
// MarkdownPreview's own (0,1,0) rules, so anything added here wins silently
// over that component's spacing and colour — which is how one markdown
// renderer quietly acquires two different appearances in two places.
export const PROSE_SX = {
  fontSize: 14,
  "& p, & li, & code": { overflowWrap: "anywhere" },
};

// The standard visually-hidden clip rect, same values as ExperienceTab's own.
// THE "1px" STRINGS ARE LOAD-BEARING: in `sx` a bare number at or below 1 is a
// multiplier, so `width: 1` computes 100% and turns a hidden announcement sink
// into a full-panel overlay. `display: none` and `visibility: hidden` are
// absent for the opposite reason — either would remove the node from the
// accessibility tree and silence every announcement it exists to make.
export const HIDDEN_STATUS_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// Built from its code point rather than typed as a literal character, for the
// reason PageEditor.js gives for its own: an invisible unicode character
// embedded directly in source is easy to lose or mis-copy in an edit. React
// bails out of a setState whose value is Object.is-equal to the previous one,
// so two identical announcements in a row need a genuinely different text node
// for assistive tech to notice the second.
export const ANNOUNCE_TOGGLE = String.fromCodePoint(0x200b);

/**
 * renderInertLink — MarkdownPreview's `renderLink` seam, made TOTAL.
 *
 * It returns an element for EVERY link token and never returns `undefined`.
 * That matters more than it looks: `undefined` is the seam's own documented
 * fall-through value, and falling through reaches a branch that renders
 * `href={token.href}` UNGATED for same-origin paths and `mailto:`. So a
 * `renderLink` written exactly as the component recommends would let a model
 * mint live same-origin anchors inside a grounded answer.
 *
 * Nothing in this panel has a URL to point at in the first place: a page is
 * component state, never a route, and the shared external-href gate refuses
 * every relative URL by construction. So the honest rendering of any link a
 * model writes is its label as inert text — the same degradation the
 * `javascript:` case has always had.
 *
 * Lives in this module rather than in one of the three components because all
 * three render model markdown and must refuse identically; putting it in the
 * panel and importing it downward would make a cycle out of a one-line
 * function.
 */
export function renderInertLink({ key, children }) {
  return <span key={key}>{children}</span>;
}
