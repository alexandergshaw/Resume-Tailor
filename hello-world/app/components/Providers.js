"use client";

import { useMemo } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme";
import { useColorMode } from "@/app/theme/colorMode";

// Client-side provider wrapper applied in the root layout. Reads the active
// color mode (from <html data-theme>, seeded before paint in layout.js) and
// rebuilds the MUI theme to match, so `var(--token)` styling and the MUI
// palette flip together.
//
// CssBaseline is intentionally omitted: globals.css provides the reset and a
// custom gradient body background that CssBaseline would clobber.
export default function Providers({ children }) {
  const { mode } = useColorMode();
  const theme = useMemo(() => makeTheme(mode), [mode]);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
