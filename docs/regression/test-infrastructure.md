### R-172 | area: test-infrastructure | parallel-safe: yes | automatable: yes

**Summary:** A component whose source is a `.js` file containing JSX can be imported and rendered by a jsdom test.

**Steps:**
1. From `hello-world`, run `npx vitest run --no-file-parallelism app/components/JobDescriptionTab.test.js`.
2. Read the `oxc` block and the `setupFiles` line in `vitest.config.js`, and `vitest.setup.js`.

**Expected:** All tests pass. `app/components/JobDescriptionTab.test.js` is the first test in this repo to import a real component file, and it required two pieces of infrastructure that had simply never been exercised before:

- **JSX in `.js` was not transformed.** Every component in this repo is a plain `.js` file containing JSX -- there are no `.jsx`/`.ts`/`.tsx` files anywhere. Vite 8 transforms through Oxc, whose default filter gives JSX parsing only to `.jsx`/`.tsx`. Setting `esbuild.loader` does not help: Vite converts an `esbuild` config into an `oxc` one when `oxc` is not itself a plain object, and that converter carries over only the JSX **runtime** options, dropping `loader` silently. `oxc: { lang: "jsx", include: /\.js$/, exclude: /node_modules/ }` is what actually works. Oxc's `jsx` lang is a strict superset of plain JS, so it is a no-op for every file that has none.
- **jsdom implements no `CSS` global at all** -- no `CSS.escape`, no `CSS.supports`. `vitest.setup.js` polyfills `CSS.escape` (the standard serialize-an-identifier algorithm) and is loaded for every test, at no cost to the node-environment majority.

`vitest.config.js` stays `environment: "node"` by default; both new jsdom test files opt in per-file with a `// @vitest-environment jsdom` docblock. **This does not license mounting components instead of extracting logic** -- `lib/` remains the first choice, and the many comments across this repo saying so are still right. What it does close is the class of criteria that ARE the markup: which control is disabled mid-run, what a live region announces, and whether every control has an accessible name.

**`react-hooks/globals` is scoped off for test files in `eslint.config.mjs`.** `eslint-plugin-react-hooks` v7 ships the React Compiler's component-purity rules, which treat every capitalized function as production render code; a `Probe` component that assigns a hook's return value to an outer variable so assertions can read it between `act()` calls is the intended shape of this harness, not a bug. The rule stays fully active for real app code.

