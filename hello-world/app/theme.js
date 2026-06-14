import { createTheme } from "@mui/material/styles";

// Single source of truth for responsive breakpoints. These mirror MUI's
// defaults but are declared explicitly so JS (useMediaQuery / sx breakpoint
// objects) and the CSS modules stay in agreement. Reference values:
//   xs   0   – phones (portrait)
//   sm 600   – phones (landscape) / small tablets
//   md 900   – tablets / small laptops
//   lg 1200  – laptops / desktops
//   xl 1536  – large desktops
const theme = createTheme({
  breakpoints: {
    values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 },
  },
  // Slightly tighter default container behaviour so MUI dialogs/menus respect
  // small viewports. Component-level responsiveness is handled per component.
  components: {
    MuiDialog: {
      defaultProps: {
        // Dialogs never exceed the viewport on small screens; individual
        // dialogs opt into fullScreen via the useIsMobile hook.
        scroll: "paper",
      },
    },
  },
});

export default theme;
