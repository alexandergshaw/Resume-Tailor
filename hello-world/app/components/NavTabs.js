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

export default function NavTabs({ value, onChange, tabs, size = "main", sx }) {
  const s = SIZES[size] || SIZES.main;
  // MUI warns if `value` matches no tab; fall back to "no selection" instead.
  const safeValue = tabs.some((t) => t.value === value) ? value : false;
  return (
    <Tabs
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
