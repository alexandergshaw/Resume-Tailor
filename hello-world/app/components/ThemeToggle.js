"use client";

import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import { useColorMode } from "@/app/theme/colorMode";

// Header control to flip between light and dark mode. The mode is read via
// useSyncExternalStore (see colorMode.js), so the icon reconciles to the real
// mode after hydration without a hydration mismatch.
export default function ThemeToggle() {
  const { mode, toggleMode } = useColorMode();
  const isDark = mode === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Tooltip title={label}>
      <IconButton
        onClick={toggleMode}
        aria-label={label}
        size="small"
        sx={{ color: "var(--text-secondary)" }}
      >
        {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
