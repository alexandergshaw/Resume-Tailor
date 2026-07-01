import Box from "@mui/material/Box";

// Inline error message for forms/dialogs, in the danger color. Renders nothing
// when there's no message, so callers can pass a possibly-empty string.
export default function FieldError({ children, sx }) {
  if (!children) return null;
  return (
    <Box role="alert" sx={{ color: "var(--danger)", fontSize: "0.875rem", ...sx }}>
      {children}
    </Box>
  );
}
