import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  // This repo's ".js" files freely mix JSX (every component under app/ is a
  // plain .js file, per the "no TypeScript, no .jsx extension" convention --
  // there are no .jsx/.ts/.tsx files anywhere in the tree). That's invisible
  // for as long as no test actually imports a component -- until
  // app/components/JobDescriptionTab.test.js (jsdom, first-of-its-kind:
  // earlier jsdom tests like useCopilotDashboard.wiring.test.js only render
  // hooks via createElement, never import a JSX-bearing source file) needed
  // to import JobDescriptionTab.js itself.
  //
  // Vite 8 transforms source through Oxc by default, and Oxc's own default
  // filter treats ".js" as plain JS (only .jsx/.tsx get JSX parsing), with
  // no supported way to widen that from the documented `oxc` options (the
  // "lang" switch that actually selects JSX-capable parsing is typed but
  // deliberately omitted from vite's public OxcOptions -- and setting
  // `esbuild.loader` instead doesn't help: vite auto-converts an `esbuild`
  // config into an `oxc` one when `oxc` isn't itself a plain object, and
  // that converter only carries over jsx-RUNTIME options, silently
  // dropping `loader`). Passing `lang: "jsx"` straight through in `oxc`
  // (untyped, but honored at runtime) is what actually works. Oxc's "jsx"
  // lang is a strict superset of plain JS, so this is a no-op for every
  // file that doesn't use JSX. Scoped to this project's own source
  // (excluding node_modules) to keep the blast radius to exactly the files
  // this repo owns.
  oxc: {
    lang: "jsx",
    include: /\.js$/,
    exclude: /node_modules/,
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
    // See vitest.setup.js: jsdom implements no `CSS` global at all, which a
    // jsdom test that resolves a `<label for>` association needs.
    setupFiles: ["./vitest.setup.js"],
  },
});
