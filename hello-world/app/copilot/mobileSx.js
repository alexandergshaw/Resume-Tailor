// Shared responsive `sx` fragments for the copilot UI, defined once so the
// mobile rules can't drift between the components that need them. Plain
// data module -- no "use client" needed, it exports only objects.

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
    top: { xs: -10, sm: 0 },
    bottom: { xs: -10, sm: 0 },
    left: { xs: -10, sm: 0 },
    right: { xs: -10, sm: 0 },
  },
};

// Keeps a small visual pill (e.g. SpeakerChip's 20px-tall button) visually
// unchanged while extending its hit area to roughly MOBILE_TAP_MIN on
// phones. Requires the element itself to be `position: relative`, which is
// why that key is included here -- the `::after` is positioned relative to
// it. The pseudo-element is transparent (no content, no background) and
// only exists to enlarge the hit area, so it must never intercept anything
// else on the page.
export const TOUCH_PILL_SX = {
  position: "relative",
  "&::after": {
    content: '""',
    position: "absolute",
    left: 0,
    right: 0,
    top: { xs: -12, sm: 0 },
    bottom: { xs: -12, sm: 0 },
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
export const PHONE_PANE_SX = {
  minHeight: { xs: 0, md: 340 },
  maxHeight: { xs: "none", md: "62vh" },
  overflowY: { xs: "visible", md: "auto" },
};
