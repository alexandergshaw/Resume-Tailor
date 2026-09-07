"use client";

import { useEffect, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Popover from "@mui/material/Popover";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import SettingsIcon from "@mui/icons-material/Settings";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import { useColorMode } from "@/app/theme/colorMode";
import { installActivityInstrumentation } from "@/lib/activityLog/activityInstrumentation.js";
import GmailButton from "./GmailButton";
import DriveButton from "./DriveButton";
import AccountSection from "./AccountSection";
import ActivityLogButton from "./ActivityLogButton";

// Section wrapper: an uppercase label above its control(s).
function Section({ label, children }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box
        sx={{
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </Box>
      {children}
    </Box>
  );
}

function AppearanceControl() {
  const { mode, setMode } = useColorMode();
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={mode}
      onChange={(_e, v) => v && setMode(v)}
      fullWidth
    >
      <ToggleButton value="light" sx={{ gap: 0.75 }}>
        <LightModeIcon fontSize="small" /> Light
      </ToggleButton>
      <ToggleButton value="dark" sx={{ gap: 0.75 }}>
        <DarkModeIcon fontSize="small" /> Dark
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

// Gear button in the top bar that collapses the app's chrome controls
// (appearance, Gmail connection, account) into one popover.
export default function SettingsMenu() {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  // The session-wide activity log starts recording HERE, not in the Admin
  // tools section below. This component is rendered by AppHeader, which the
  // root layout mounts on every route, so this is the earliest client code in
  // the app; the section below lives inside a MUI Popover with no
  // `keepMounted`, so it does not exist in the DOM until somebody opens
  // Settings. Installing there would mean the log started recording at the
  // moment a user went looking for it and was empty for everything before --
  // which is the one session where they needed it. The returned cleanup
  // restores every wrapped global, so a remount leaves no residue.
  useEffect(() => installActivityInstrumentation(), []);

  return (
    <>
      <Tooltip title="Settings">
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="Settings"
          aria-haspopup="true"
          size="small"
          sx={{ color: "var(--text-secondary)" }}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 1, borderRadius: 2 } } }}
      >
        <Box
          sx={{
            p: 2,
            width: 280,
            maxWidth: "90vw",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Section label="Appearance">
            <AppearanceControl />
          </Section>
          <Divider />
          <Section label="Gmail">
            <GmailButton />
          </Section>
          <Divider />
          <Section label="Google Drive">
            <DriveButton />
          </Section>
          <Divider />
          <Section label="Account">
            <AccountSection />
          </Section>
          <Divider />
          <Section label="Admin tools">
            <ActivityLogButton />
          </Section>
        </Box>
      </Popover>
    </>
  );
}
