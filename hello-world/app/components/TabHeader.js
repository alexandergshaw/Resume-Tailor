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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", flexShrink: 0 }}>{actions}</Box>
      ) : null}
    </Box>
  );
}
