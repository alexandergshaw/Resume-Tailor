### R-164 | area: app-nav | parallel-safe: yes | automatable: no

**Summary:** The main tab strip is usable on a phone, and the change that made it so is understood to be app-wide rather than copilot-only.

**Steps:**
1. At 320px, open the app and confirm the six top-level tabs (Materials, Manual Applying, Auto Applying, Tracking, Interview Copilot, Library) can all be reached by swiping the strip.
2. Confirm the same on a sub-navigation strip inside a tab, since `NavTabs` renders both sizes.
3. On a device or emulation profile with a COARSE pointer but a wide viewport -- a touch laptop, or a tablet in landscape -- confirm the strip is still navigable when it overflows.
4. At 1280px with a mouse, confirm scroll arrows still appear when the strip overflows.

**Expected:** `app/components/NavTabs.js` uses `variant="scrollable" scrollButtons="auto"` and, since the mobile pass, NO `allowScrollButtonsMobile`. That prop forced both `TabScrollButton`s to render even on touch, costing 80px of a 252px strip at 320px -- roughly one tab visible at a time out of six. Dropping it lets MUI hide them under `@media (pointer: coarse)`, where swiping is the natural affordance. `minWidth: { xs: 0, sm: 90 }` on `.MuiTab-root` stops short labels reserving MUI's default 90px they do not need; at `sm` and up it is `90`, matching the stock default exactly.

**This case exists because the change is app-wide and shipped inside a copilot-scoped commit.** `NavTabs` is used by `app/page.js` for the main nav AND for sub-navigation in several tabs, so every tab strip in the product is affected -- and the commit's claim of "verified at 1280 that the desktop rendering is unchanged" was verified with a FINE pointer, which is precisely the configuration the removed prop does not affect. Step 3 is the one that actually exercises the trade-off: a coarse-pointer wide viewport now has swipe and no arrows. If that ever proves inadequate, the fix is a breakpoint-scoped reinstatement, not restoring the prop unconditionally -- the 320px case is what it cost.

