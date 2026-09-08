"use client";

import { useMemo } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme";
import { useColorMode } from "@/app/theme/colorMode";
import { SurfaceNavProvider } from "@/app/hooks/useSurfaceNav";

// Client-side provider wrapper applied in the root layout. Reads the active
// color mode (from <html data-theme>, seeded before paint in layout.js) and
// rebuilds the MUI theme to match, so `var(--token)` styling and the MUI
// palette flip together.
//
// CssBaseline is intentionally omitted: globals.css provides the reset and a
// custom gradient body background that CssBaseline would clobber.
//
// SurfaceNavProvider (AC-back-button-r2, Phase 1) is mounted here rather than
// in layout.js because THIS is what actually wraps <AppHeader/> -- layout.js
// renders `<Providers><AppHeader/>{children}</Providers>`, so AppHeader and
// the page are siblings inside Providers' own `children`. Mounting the stack
// here, above both, is what lets the header's back control and page.js's
// surface state share one stack.
export default function Providers({ children }) {
  const { mode } = useColorMode();
  const theme = useMemo(() => makeTheme(mode), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <SurfaceNavProvider>{children}</SurfaceNavProvider>
    </ThemeProvider>
  );
}
