"use client";

import { useId, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";

import { useIsMobile } from "@/app/hooks/useResponsive";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { resolveAidOpen } from "../../lib/copilot/aidDisclosure.js";

// One independent disclosure over a block of answer aids (N144a). Opening one
// never opens or closes another, so a candidate under live pressure can open
// one aid without anything else moving; it is the APG disclosure pattern, not
// an exclusive accordion.
//
// The header is a native button (one tab stop, Enter and Space for free) whose
// accessible name is its static visible `label` and nothing else: the state is
// `aria-expanded`'s job, so the name does not swap between "Show" and "Hide",
// and there is no Tooltip (it would replace the name) and no `aria-label`
// (WCAG 2.5.3, Label in Name). The caller puts any provenance word IN the label
// ("Example projects (invented)"), so a collapsed control still says it.
//
// The body is UNMOUNTED while collapsed: out of the accessibility tree and the
// tab order, with no transition (nothing in the app honours
// prefers-reduced-motion, and `Collapse` would keep the children mounted). The
// panel wrapper around it is always mounted, empty when collapsed, so
// `aria-controls` resolves in both states instead of dangling.
//
// This adds no heading (a new level under the three parent headings breaks
// heading order, R-125), no live region, no `role="status"` and no `aria-busy`.
// A body that owns a live region keeps it INSIDE the body; an `aria-busy`
// ancestor would suppress its announcements.
//
// Open state is the caller's `choiceStore` (lib/copilot/choiceStore.js) through
// `resolveAidOpen`. Nothing is written on mount; a tap writes the opposite of
// what is on screen. Every instance of one store moves together, which is how
// one choice covers every card on the page.
//
// `useIsMobile` is the SAME gate CopilotClient uses for the live height lock
// (below 600px the page is the only scroller), and it is imported through the
// module specifier below so the suites that mock "@/app/hooks/useResponsive"
// keep applying.

// The touch floor is the shared token, spread last of the shared pieces; this
// constant holds only what is specific to a disclosure header. `variant="text"`
// draws no border, which keeps it out of the outlined-control contrast sweep.
const HEADER_SX = {
  justifyContent: "flex-start",
  minWidth: 0,
  px: 0,
  textTransform: "none",
  textAlign: "left",
  color: "var(--text-secondary)",
  fontWeight: 700,
  width: { xs: "100%", sm: "auto" },
};

export default function CollapsibleAid({
  label,
  choiceStore,
  defaultOpenOnMobile = false,
  labelledGroup = false,
  children,
}) {
  const headerId = useId();
  const panelId = useId();
  const isMobile = useIsMobile();
  const choice = useSyncExternalStore(choiceStore.subscribe, choiceStore.get, choiceStore.getServerSnapshot);
  const open = resolveAidOpen({ choice, isMobile, defaultOpenOnMobile });

  // `role="group"` only where the body holds several separately labelled rows
  // (the example projects). A single-block body is already named by its header
  // through `aria-controls`, and the first `[role="group"]` in DOM order is what
  // the example-projects contract test reads, so a second group would break it.
  const groupProps = labelledGroup ? { role: "group", "aria-labelledby": headerId } : null;

  return (
    <Box {...groupProps}>
      <Button
        id={headerId}
        type="button"
        variant="text"
        size="small"
        onClick={() => choiceStore.set(open ? "closed" : "open")}
        aria-expanded={open}
        aria-controls={panelId}
        sx={{ ...HEADER_SX, ...TOUCH_TARGET_SX, mb: open ? 0.5 : 0 }}
      >
        <Box component="span" aria-hidden="true" sx={{ mr: 0.75 }}>
          {open ? "▾" : "▸"}
        </Box>
        {label}
      </Button>
      <Box id={panelId}>{open ? children : null}</Box>
    </Box>
  );
}
