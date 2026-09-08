"use client";

import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";

// App navigation tabs (MUI), in the two sizes the app uses: "main" for the
// top-level sections and "section" for sub-navigation. Scrollable when the tabs
// overflow. Colors come from the design tokens so they flip with light/dark.
const SIZES = {
  main: {
    fontWeight: 700,
    fontSize: { xs: "0.92rem", sm: "1rem" },
    px: { xs: 2, sm: 3.5 },
    indicator: 3,
    border: "2px solid var(--border)",
    mb: 0.5,
  },
  section: {
    fontWeight: 600,
    fontSize: { xs: "0.88rem", sm: "0.94rem" },
    px: { xs: 1.75, sm: 2.5 },
    indicator: 2,
    border: "1px solid var(--border)",
    mb: 0,
  },
};

// ACCESSIBILITY RULING (tab-strip landmark/name audit) --------------------
//
// MUI's <Tabs> already renders role="tablist" (and each <Tab>, role="tab")
// on its own -- Tabs.js forwards an `aria-label` prop straight onto that
// tablist root. Wrapping this in a `<nav>` landmark was considered and
// REJECTED: every caller reaches this through
// app/hooks/useSurfaceNav.js's goMainTab/goSection, which only flip React
// state (mainTab/activeSection) -- that module's own header says the app
// "writes zero browser history entries" and no URL or document ever
// changes when a tab is clicked. That is the WAI-ARIA APG tabs pattern
// (several panels, one shown at a time, switched in place), not
// page-to-page navigation, so a `<nav>` landmark here would mislabel a
// widget as a navigation region -- and would sit on top of, not replace,
// the tablist role already present. No landmark is added.
//
// What WAS genuinely missing: a NAME on the tablist. app/page.js mounts one
// "main"-sized strip and, once "Manual Applying" is selected, a second
// "section"-sized strip AT THE SAME TIME (page.js's two <NavTabs> call
// sites) -- unnamed, both are indistinguishable "tablist"s to a
// screen-reader user scanning by role. NavTabs is generic and takes no
// caller-supplied label (neither call site passes one), so the `size` prop
// -- already the axis every caller varies -- doubles as the key for a
// distinct default accessible name per strip.
const DEFAULT_ARIA_LABELS = {
  main: "Main tabs",
  section: "Section tabs",
};

export default function NavTabs({ value, onChange, tabs, size = "main", sx }) {
  const s = SIZES[size] || SIZES.main;
  const ariaLabel = DEFAULT_ARIA_LABELS[size] || DEFAULT_ARIA_LABELS.main;
  // MUI warns if `value` matches no tab; fall back to "no selection" instead.
  const safeValue = tabs.some((t) => t.value === value) ? value : false;
  return (
    <Tabs
      aria-label={ariaLabel}
      value={safeValue}
      onChange={(_e, v) => onChange(v)}
      variant="scrollable"
      scrollButtons="auto"
      sx={{
        mb: s.mb,
        minHeight: 0,
        borderBottom: s.border,
        "& .MuiTab-root": {
          minHeight: 0,
          minWidth: { xs: 0, sm: 90 },
          py: 1.25,
          px: s.px,
          fontWeight: s.fontWeight,
          fontSize: s.fontSize,
          color: "var(--text-secondary)",
          "&:hover": { color: "var(--text-primary)" },
        },
        "& .Mui-selected": { color: "var(--accent)" },
        "& .MuiTabs-indicator": { backgroundColor: "var(--accent)", height: s.indicator },
        ...sx,
      }}
    >
      {tabs.map((t) => (
        <Tab key={t.value} value={t.value} label={t.label} />
      ))}
    </Tabs>
  );
}
