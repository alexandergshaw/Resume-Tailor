"use client";

// PHASE 1 of AC-back-button-r2 -- the control itself (r2 §6.3, §7).
//
// One control, four computed modes, never a disabled no-op:
//   stack non-empty                      Back   "Back to {top.label}"
//   empty, on /copilot or /library       Exit   "Back to Resume Tailor"
//   empty, on /, not at the default      Home   "Go to Materials"
//   empty, on /, at the default surface  Absent (a fixed-width spacer)
//
// Back and Home are a real MUI IconButton (a <button>, no href, so
// app/components/hrefSafety.sweep.test.js has nothing to gate). Exit is the
// ONE place an href appears, and it is a hard-coded LITERAL "/" -- passing
// `href` to IconButton with no `component` override renders it as a real
// `<a>` (MUI's ButtonBase), which is what lets it leave the SPA and close the
// /copilot and /library dead end (r2 §2.1, §9.4).
import { usePathname } from "next/navigation";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Box from "@mui/material/Box";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HomeIcon from "@mui/icons-material/Home";
import { useSurfaceStack, SURFACE_FIELDS } from "../hooks/useSurfaceNav.js";
import { MOBILE_TAP_MIN, TOUCH_ICON_SX } from "@/app/theme/mobileSx";

// The only two fields a label may promise are the two fields the descriptor
// actually carries (r2 §4) -- page.js's own tab list and section list,
// mirrored here for presentation only.
const MAIN_TAB_LABELS = {
  applying: "Materials",
  manualApplying: "Manual Applying",
  feed: "Auto Applying",
  interviewing: "Tracking",
  copilot: "Interview Copilot",
  library: "Library",
  experience: "Professional Experience",
};

const SECTION_LABELS = {
  url: "Posting URL",
  manual: "Job Description",
  screenshots: "Screenshots",
};

// `activeSection` only means something under Manual Applying -- naming it
// for any other tab would promise a sub-tab the descriptor never restores
// for that surface (AC-B1c).
function labelFor(descriptor) {
  const main = MAIN_TAB_LABELS[descriptor.mainTab] || descriptor.mainTab;
  const section = SECTION_LABELS[descriptor.activeSection];
  if (descriptor.mainTab === "manualApplying" && section) {
    return `${main} › ${section}`;
  }
  return main;
}

function sameSurface(a, b) {
  return Boolean(a) && Boolean(b) && SURFACE_FIELDS.every((field) => a[field] === b[field]);
}

// A DEFINITE width on both the control and the spacer (never "auto"): jsdom
// has no layout, so an auto width cannot be compared to anything at all
// (AC-6). AppHeader is `display: flex` with the brand's `marginRight: auto`
// immediately after this slot, so the spacer holding the identical box is
// what stops the brand sliding left every time the control appears or
// disappears.
const CONTROL_SX = {
  ...TOUCH_ICON_SX,
  width: `${MOBILE_TAP_MIN}px`,
  flexShrink: 0,
  color: "var(--text-secondary)",
};

export default function BackButton() {
  const pathname = usePathname() || "";
  const { stack, current, defaultSurface, navigate, goBack } = useSurfaceStack();
  const onSubRoute = pathname.startsWith("/copilot") || pathname.startsWith("/library");

  if (stack.length > 0) {
    const label = `Back to ${labelFor(stack[stack.length - 1])}`;
    return (
      <Tooltip title={label}>
        <IconButton data-testid="back-control" onClick={goBack} aria-label={label} sx={CONTROL_SX}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  if (onSubRoute) {
    const label = "Back to Resume Tailor";
    return (
      <Tooltip title={label}>
        <IconButton data-testid="back-control" href="/" aria-label={label} sx={CONTROL_SX}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  if (current && defaultSurface && !sameSurface(current, defaultSurface)) {
    const label = `Go to ${MAIN_TAB_LABELS[defaultSurface.mainTab] || defaultSurface.mainTab}`;
    const goHome = () => navigate({ mainTab: defaultSurface.mainTab, activeSection: defaultSurface.activeSection });
    return (
      <Tooltip title={label}>
        <IconButton data-testid="back-control" onClick={goHome} aria-label={label} sx={CONTROL_SX}>
          <HomeIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  return <Box data-testid="back-control-spacer" aria-hidden="true" sx={CONTROL_SX} />;
}
