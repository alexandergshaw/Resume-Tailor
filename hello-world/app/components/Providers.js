"use client";

import { ThemeProvider } from "@mui/material/styles";
import theme from "../theme";

// Client-side provider wrapper applied in the root layout. Supplies the shared
// MUI theme (breakpoints, component defaults) to the whole tree so
// useMediaQuery and responsive `sx` breakpoints resolve consistently.
//
// CssBaseline is intentionally omitted: globals.css already provides the CSS
// reset and a custom gradient body background that CssBaseline would clobber.
export default function Providers({ children }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
