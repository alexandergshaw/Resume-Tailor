// Shared responsive `sx` fragments for the copilot UI, defined once so the
// mobile rules can't drift between the components that need them. Plain
// data module -- no "use client" needed, it exports only objects.
//
// Most of these constants are phone-only: TOUCH_TARGET_SX, TOUCH_SWITCH_SX,
// TOUCH_PILL_SX, TOUCH_FIELD_SX, TOUCH_ICON_SX, TOUCH_NATIVE_SELECT_SX and
// TOUCH_MUI_SELECT_SX all key their touch-target enlargement to `xs`, and
// their `sm` (or higher) branch is the value that leaves rendering at `sm`
// and up unchanged -- never a plausible-looking `0` -- so rendering at `sm`
// and up is unchanged. That has already broken once in this codebase
// (`SpeakerChip`'s `minWidth: { xs: 44, sm: 0 }` removed a flex item's
// shrink floor); treat any `sm`/`md` branch that isn't that value as a bug.
//
// For a property nothing else sets, "the value that leaves rendering
// unchanged" IS the CSS initial value, which is what every constant here but
// one uses. TOUCH_MUI_SELECT_SX is the exception, and deliberately: it
// overrides properties MUI itself sets on `.MuiSelect-select`, so its `sm`
// branch carries MUI's OWN values rather than CSS's bare initials. Same rule,
// applied to an element that is not starting from the initial value -- see
// that constant's own comment for the source citations.
//
// Three constants are NOT phone-scoped, deliberately:
//   - WRAP_ROW_SX (`flexWrap: "wrap", rowGap: 1`) applies at every width --
//     rows should wrap wherever they don't fit, not just on phones.
//   - BREAK_LONG_WORDS_SX (`overflowWrap: "anywhere"`) applies at every
//     width for the same reason: a single unbroken token can overflow a
//     narrow container at any breakpoint, not just on phones. This one is
//     not inert on desktop even when nothing actually overflows: unlike
//     `break-word`, `anywhere` also feeds into intrinsic min-content sizing,
//     so it can shrink a box's computed minimum width at any breakpoint.
//   - TOUCH_PILL_SX's `position: relative` and its `::after`'s `left: 0` /
//     `right: 0` apply at every width -- they establish the positioning
//     context and horizontal bounds the pseudo-element always needs; only
//     its `top`/`bottom` offsets are phone-scoped.
//
// PHONE_PANE_SX is the one exception keyed to `md` instead of `sm`: it
// deliberately extends its phone behaviour through the 600-899px tablet
// band too (see its own comment for why), so it changes rendering in that
// band on purpose.

// CSS px, the iOS Human Interface Guidelines minimum tap target size.
export const MOBILE_TAP_MIN = 44;

// Guarantees a tappable control is at least MOBILE_TAP_MIN tall on phones
// without changing its size on larger breakpoints, where the mouse-driven
// "auto" height it already has is fine.
export const TOUCH_TARGET_SX = { minHeight: { xs: MOBILE_TAP_MIN, sm: "auto" } };

// MUI's Switch hit area is comfortable with a mouse but small for a finger:
// `size="small"` gives a 40x24 root whose `switchBase` ButtonBase is only
// 24x24 of real target.
//
// This extends the target with a transparent `::after` on the switchBase
// rather than by padding it. Padding was tried first and is WRONG: the Switch
// root has a FIXED width (40px at `size="small"`) and the switchBase is
// absolutely positioned inside it, so growing its padding to 12px pushed the
// base to 40x40 overhanging a 40x24 track and shoved the thumb to 28px along
// a 40px rail — measured in a browser, a visibly broken control. The
// pseudo-element adds no layout, so the track and thumb keep their exact
// geometry while the tappable region reaches the 44px minimum.
// `switchBase` is already `position: absolute`, so the offsets resolve
// against it without needing a `position` of our own.
export const TOUCH_SWITCH_SX = {
  "& .MuiSwitch-switchBase::after": {
    content: '""',
    position: "absolute",
    top: { xs: -10, sm: "auto" },
    bottom: { xs: -10, sm: "auto" },
    left: { xs: -10, sm: "auto" },
    right: { xs: -10, sm: "auto" },
  },
};

// Keeps a small visual pill (e.g. SpeakerChip's 20px-tall button) visually
// unchanged while extending its hit area to roughly MOBILE_TAP_MIN on
// phones. Requires the element itself to be `position: relative`, which is
// why that key is included here -- the `::after` is positioned relative to
// it.
//
// Be precise about what this does, because an earlier version of this
// comment claimed the pseudo-element "must never intercept anything else on
// the page" and that is not something it can promise. The overlay is
// transparent and paints nothing, but it DOES take pointer events -- that is
// the entire mechanism, and `pointer-events: none` would defeat it. It
// extends 12px above and below the pill (bounded horizontally to the pill's
// own box, so side-by-side chips never collide), which means it can sit over
// whatever is directly above or below.
//
// The invariant a caller owes: **do not use this where another interactive
// control sits within 12px vertically.** Both current call sites satisfy it
// -- SpeakerChip's rows in TranscriptView have only non-interactive text
// above and below, and CopilotClient's who's-talking bar lays its chips out
// horizontally. Put an interactive element under one of these and the pill
// will quietly swallow taps meant for it.
export const TOUCH_PILL_SX = {
  position: "relative",
  "&::after": {
    content: '""',
    position: "absolute",
    left: 0,
    right: 0,
    top: { xs: -12, sm: "auto" },
    bottom: { xs: -12, sm: "auto" },
  },
};

// Raises a `size="small"` form control (TextField/Select, including
// Autocomplete's TextField renderInput) to the MOBILE_TAP_MIN touch target
// on phones. `size="small"` only trims the input's padding — it never
// changes font-size, and every input in this app already computes to 16px,
// so there is no iOS focus-zoom problem here and none should be "fixed" by
// adding a `fontSize`. Targets `.MuiInputBase-root` (the actual
// clickable/typeable surface) rather than the outer FormControl, whose
// height can already exceed the input's own (e.g. once helper text is
// showing) without the input itself meeting the minimum.
export const TOUCH_FIELD_SX = {
  "& .MuiInputBase-root": { minHeight: { xs: MOBILE_TAP_MIN, sm: "auto" } },
};

// Pairs with TOUCH_FIELD_SX on a `TextField select` rendered with
// `slotProps.select.native` (RolePicker.js, MicPicker.js). TOUCH_FIELD_SX
// raises the InputBase ROOT to the 44px tap minimum, which is what the user
// sees, but R-235 measured in a browser that the native `<select>` INSIDE it
// is still only 40px at that width: the root's own padding is not part of
// the select's own hit area, so a tap in the top or bottom 2px of the
// visible control lands on a div instead of the select. This stretches the
// select itself to fill its root. `sm` carries each property's REAL initial
// value (`content-box`, `auto`), not a plausible-looking `0` -- see this
// module's own header note on why that matters -- so nothing above the phone
// breakpoint changes.
export const TOUCH_NATIVE_SELECT_SX = {
  "& select": {
    boxSizing: { xs: "border-box", sm: "content-box" },
    minHeight: { xs: MOBILE_TAP_MIN, sm: "auto" },
  },
};

// Completes the 44px touch target on a non-native MUI `Select`, which
// TOUCH_FIELD_SX alone does not reach. TOUCH_FIELD_SX raises
// `.MuiInputBase-root` (the outer clickable surface) to MOBILE_TAP_MIN, but
// `InputBase.js:87-88` makes that root `inline-flex` + `align-items: center`
// while `SelectInput.js:87` gives the display div inside it `height: auto`,
// so a ~40px child ends up centred in the 44px root and the top/bottom bands
// land on the root div instead of the select's own display element -- the
// same dead-band defect TOUCH_NATIVE_SELECT_SX fixes for the native `<select>`
// flavour, here for the non-native one. The two constants target DIFFERENT
// elements and are used TOGETHER, spread alongside TOUCH_FIELD_SX rather than
// instead of it (see RolePicker.js:35 for the native precedent that pairs
// TOUCH_FIELD_SX with TOUCH_NATIVE_SELECT_SX the same way).
//
// The doubled class in the selector is REQUIRED, and it was measured, not
// argued. MUI's own rule is `&.${selectClasses.select}` inside a styled
// component (SelectInput.js:85-95), which serialises to
// `.css-hash.MuiSelect-select { min-height: 1.4375em }` -- specificity
// (0,2,0), with MUI's own comment on it reading "Win specificity over the
// input base." A plain `& .MuiSelect-select` from `sx` serialises to
// `.css-rootHash .MuiSelect-select` -- ALSO (0,2,0). A tie is decided by
// insertion order, and emotion serialises the FormControl root's class
// (carrying the `sx`) before the inner SelectSelect's, so MUI's rule lands
// last and WINS. Measured, not deduced: `InterviewTypePicker.test.js`'s
// "computed cascade" block renders the picker under jsdom and reads
// `getComputedStyle`, and against the single-class selector it read back
// `min-height: 1.4375em` -- i.e. the 44px floor was entirely INERT while
// looking correct in the source. Doubling the class makes it (0,3,0), which
// wins outright and no longer depends on insertion order at all.
//
// `!important` was rejected, and the honest reason is narrower than the one
// this comment used to give. It claimed a caller's own `sx` override would
// still win against the doubled class; the mobile regression pass MEASURED
// that and it is false -- a caller writing the natural `& .MuiSelect-select`
// (0,2,0) LOSES to this, reading back 44px rather than their own value. The
// cost is real and belongs here rather than being discovered: **a caller that
// needs to override this must match or beat (0,3,0)**, e.g. by doubling the
// class the same way. What `!important` would additionally cost is that even
// THAT would not work, and neither would an inline style -- so the rejection
// stands, on "a caller can still get out of it if they mean to" rather than
// on "a caller's ordinary override is unaffected", which it is not.
//
// That test is this constant's only oracle -- it targets an element whose
// height nothing else in this tree can observe -- so it must keep failing if
// either the selector's specificity or the values below regress.
//
// WATCH ITEM, not a defect today: `display: flex` at `xs` takes this element
// out of block layout, and `text-overflow: ellipsis` (which MUI sets on it,
// SelectInput.js:92) only applies to a block container. So on a phone a label
// too wide for the control would clip rather than ellipsize. Measured as
// unreachable with the shipped vocabulary -- the longest label gives
// scrollWidth 252 == clientWidth 252 at 320px, the narrowest width this app
// targets -- so nothing is being traded away yet. If a longer interview type
// is ever added, the fix is NOT to drop the centring: `display: block` plus
// `align-content: center` keeps both, and is the thing to reach for, but it
// is a 2024-era property with no fallback and no oracle in this tree, so it
// is written down rather than shipped ahead of the need.
//
// Every `sm` branch here is deliberately NOT the bare CSS initial value --
// each one is MUI's OWN value for that property on `.MuiSelect-select`,
// verified at source (MUI 9.0.1):
//   - minHeight: '1.4375em'   -- MUI, SelectInput.js:89 (a reset for
//     multiple-select chips)
//   - display: 'block'        -- MUI, InputBase.js:157
//   - boxSizing: 'content-box' -- MUI, InputBase.js:150 (also the CSS
//     initial value)
//   - alignItems: 'normal'    -- nobody sets this; CSS initial value
// This module's header rule is "the `sm` branch is the property's real
// initial value, so rendering at `sm` and up is unchanged" -- for a property
// MUI itself sets, the value that leaves rendering unchanged at `sm` and up
// is MUI's own value, not CSS's bare initial. This is a deliberate reading of
// that rule, not an exception to it -- and with the specificity raised it is
// now load-bearing rather than belt-and-braces: at `sm` and up these rules
// now WIN, so they have to restate exactly what they displaced.
export const TOUCH_MUI_SELECT_SX = {
  "& .MuiSelect-select.MuiSelect-select": {
    minHeight: { xs: MOBILE_TAP_MIN, sm: "1.4375em" },
    display: { xs: "flex", sm: "block" },
    boxSizing: { xs: "border-box", sm: "content-box" },
    alignItems: { xs: "center", sm: "normal" },
  },
};

// Raises a small IconButton (Autocomplete's popup/clear indicators, an
// Alert's dismiss button) to the MOBILE_TAP_MIN touch target on phones.
// IconButton centers its icon via flexbox, so growing the box with
// min-width/min-height enlarges the tappable area without touching the
// icon's own size, the button's padding, or its border radius. `sm: "auto"`
// is min-width/min-height's own initial value, not an arbitrary "off"
// switch, so nothing here changes the rendering at `sm` and up.
export const TOUCH_ICON_SX = {
  minWidth: { xs: MOBILE_TAP_MIN, sm: "auto" },
  minHeight: { xs: MOBILE_TAP_MIN, sm: "auto" },
};

// Lets a row of controls wrap onto multiple lines on narrow screens instead
// of overflowing or squeezing, with a small vertical gap between wrapped
// rows so wrapped items don't touch.
export const WRAP_ROW_SX = { flexWrap: "wrap", rowGap: 1 };

// app/globals.css:20 sets `html { overflow-x: hidden }`, so horizontal
// overflow is silently clipped and unreachable, not scrollable. A single
// long unbroken token (a dictated URL, an email address, a long company
// slug) would therefore delete content rather than cause a scrollbar.
// Allowing a break inside such a token keeps it fully visible instead.
export const BREAK_LONG_WORDS_SX = { overflowWrap: "anywhere" };

// Below `md`, a pane must NOT be its own scroll container, for two
// independent reasons: (1) a nested touch scroller steals the page-scroll
// swipe gesture from the surrounding page, making the page feel stuck, and
// (2) `62vh` is the *large*-viewport height on iOS Safari (the height when
// the URL bar is collapsed), so a pane sized to it is taller than the
// visible area whenever the URL bar is expanded, clipping its own content.
// Removing the height cap and letting the pane grow with its content makes
// the page the single scroller on phones; at `md` and up the original
// bounded, internally-scrolling pane behaviour is unchanged.
//
// `minHeight: { xs: "auto", ... }` -- not `0` -- for the same real-initial-
// value reason as everywhere else in this module. On phones this pane is a
// flex item in a column Stack, where `min-height: auto` is the automatic
// content-based floor (it stops a flex item from shrinking below its
// content). Pairing `xs: 0` with the uncapped `maxHeight` and non-scrolling
// `overflowY` above would not reintroduce the bounded-pane problem this
// constant exists to fix, but it would hand away that floor for no reason;
// `xs: "auto"` costs nothing here (the pane already grows with its content
// and never scrolls internally below `md`) and keeps the constant honest
// about which value is actually "off".
export const PHONE_PANE_SX = {
  minHeight: { xs: "auto", md: 340 },
  maxHeight: { xs: "none", md: "62vh" },
  overflowY: { xs: "visible", md: "auto" },
};
