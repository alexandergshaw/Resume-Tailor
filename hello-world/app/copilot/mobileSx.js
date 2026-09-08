// MOVED. The responsive contract now lives at app/theme/mobileSx.js, next to
// the breakpoint table it keys off (app/theme/index.js:47-49) and to
// app/hooks/useResponsive.js, which reads the same breakpoints. It was never
// copilot-specific -- while it lived under app/copilot/ the rest of the app
// could not reasonably import it and hand-rolled the same rule three times
// with DIFFERENT values (app/components/preview/, since collapsed).
//
// This file is a re-export shim, not the module. It exists so the 30 existing
// `from "./mobileSx"` / `from "../mobileSx"` statements under app/copilot/ did
// not have to churn in the same wave as the move -- four of them were being
// edited by a concurrent workstream at the time.
//
// COST, so nobody discovers it: grepping for "theme/mobileSx" UNDER-COUNTS the
// contract's real adoption by 30 files, because they come through here.
//
// NEW CODE MUST IMPORT `@/app/theme/mobileSx` DIRECTLY. Retiring this shim is
// one mechanical find-and-replace over those 30 lines, and is a follow-up
// chunk, not a permanent arrangement.
export * from "@/app/theme/mobileSx";
