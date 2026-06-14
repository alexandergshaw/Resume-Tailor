"use client";

import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

// Shared responsive helpers built on the app theme's breakpoints.
//
//   useIsMobile()  -> true below `sm` (phones). Drives fullScreen dialogs,
//                     stacked layouts, and disabling pixel-drag interactions.
//   useIsTablet()  -> true below `md` (phones + small tablets). Drives layouts
//                     that need to collapse a little later than `sm`.
//
// `noSsr: true` avoids a hydration flash by evaluating on the client only;
// the surrounding UI is already client-rendered.
export function useIsMobile() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("sm"), { noSsr: true });
}

export function useIsTablet() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("md"), { noSsr: true });
}
