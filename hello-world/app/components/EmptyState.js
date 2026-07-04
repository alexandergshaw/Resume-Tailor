"use client";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

// Standard empty / placeholder / unauthenticated panel: a centered column with an
// optional icon, a title, a message, and an optional action.
export default function EmptyState({ icon, title, message, action, sx }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", py: 6, px: 2, ...sx }}>
      {icon ? <Box sx={{ color: "text.disabled", mb: 1.5, display: "flex", "& svg": { fontSize: 48 } }}>{icon}</Box> : null}
      {title ? <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5, fontSize: "1.05rem" }}>{title}</Typography> : null}
      {message ? <Typography sx={{ color: "text.secondary", fontSize: "0.9rem", maxWidth: 420, lineHeight: 1.5 }}>{message}</Typography> : null}
      {action ? <Box sx={{ mt: 2 }}>{action}</Box> : null}
    </Box>
  );
}
