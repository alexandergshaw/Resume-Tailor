"use client";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

// Standard header for every tab: a title, an optional one-line description, and
// an optional right-aligned actions slot. Colors come from the theme palette
// (wired to the design tokens), so it flips with light/dark.
export default function TabHeader({ title, description, actions, sx }) {
  return (
    <Box sx={{ display: "flex", alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between", gap: 1.5, flexWrap: "wrap", ...sx }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h2" sx={{ fontWeight: 700, fontSize: "1.05rem", color: "text.primary", lineHeight: 1.3 }}>
          {title}
        </Typography>
        {description ? (
          <Typography sx={{ color: "text.secondary", fontSize: "0.85rem", mt: 0.25, lineHeight: 1.45, maxWidth: "70ch" }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {actions ? (
        // On a phone the actions row takes a line of its own and is allowed to
        // shrink and wrap inside it. `flexShrink: 0` alone pinned this row at its
        // content width, and since app/globals.css sets `html { overflow-x: hidden }`
        // anything past the right edge was clipped and unreachable rather than
        // scrollable -- on the feed that put "Filters", and so the whole mobile
        // filter sheet, out of reach at 375px. `minWidth: 0` is required alongside
        // flexShrink because a flex item's default `min-width: auto` floors it at
        // max-content. Desktop is unchanged: it keeps `flexShrink: 0` and sits
        // beside the title, which TabHeader.mobile.test.js guards in both directions.
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
            flexShrink: { xs: 1, sm: 0 },
            minWidth: 0,
            width: { xs: "100%", sm: "auto" },
          }}
        >
          {actions}
        </Box>
      ) : null}
    </Box>
  );
}
