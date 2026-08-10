import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // The default for the whole suite, and it should stay that way: almost
    // every test here exercises a pure function, and `node` is faster and
    // has no DOM globals to accidentally lean on. Many comments across this
    // codebase cite it as the reason a decision was extracted out of a
    // component or hook into a plain module — that reasoning is still
    // correct and those extractions should NOT be reversed.
    //
    // What HAS changed, and what several of those comments now overstate
    // when they say a hook "cannot be mounted in this repo": an individual
    // file can opt into a DOM by putting
    //
    //     // @vitest-environment jsdom
    //
    // as a docblock on its first line. That is a per-file override and does
    // not affect any other file. `jsdom` is a devDependency for exactly
    // this; `app/copilot/useCopilotDashboard.wiring.test.js` is the worked
    // example, and it exists because a composition defect (two correct,
    // separately-tested halves wired together wrong) is invisible to pure
    // unit tests by construction — inverting the line that joined them left
    // all 2856 other tests green.
    //
    // Reach for it only for that: wiring and effects that no pure function
    // can express. Extracting the DECISION into `lib/` remains the first
    // choice, not the fallback.
    environment: "node",
  },
});
