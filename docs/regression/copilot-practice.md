### R-163 | area: copilot-practice | parallel-safe: yes | automatable: yes

**Summary:** Practice mode renders at all, and `no-undef` is the gate that keeps it that way.

**Steps:**
1. Run `npx eslint .` from `hello-world/`. It must report 0 errors and 0 warnings.
2. Delete the `const [replayUrl, setReplayUrl] = useState("")` declaration from `hello-world/app/copilot/practice/usePracticeAnswer.js` and re-run `npx eslint .`.
3. Restore it.
4. Open the copilot and switch to Practice. The setup, controls and question card must render.

**Expected:** Step 2 fails with three `no-undef` errors naming `setReplayUrl` twice and `replayUrl` once. This case exists because exactly that shipped to main: the declaration was lost in the extraction that split PracticeClient's hooks apart (commit d0dc09c), leaving `replayUrl`/`setReplayUrl` as free variables, and practice mode threw `ReferenceError: replayUrl is not defined` on its first render — the entire tab was a blank crash.

**Nothing caught it, and the reasons are the point of this case.** `eslint-config-next` leaves `no-undef` OFF, on the assumption that TypeScript does that job; this project has no `tsconfig.json` at all, and the development-loop notes already record that `tsc --noEmit` is vacuous here. `npm run build` passed, because an undeclared reference is legal SYNTAX and only fails at runtime. All 2816 tests passed, because at that time `vitest.config.js` was `environment: "node"` with no jsdom in the repo at all, so no test could render a component or a hook — the same gap recorded in R-152 and R-153. **Amended: that gap is no longer structural and must not be cited as a current fact.** `jsdom` (`^29.1.1`) is a devDependency, `environment: "node"` is only the suite DEFAULT, and a file opts into a DOM with a `// @vitest-environment jsdom` docblock on its first line (R-172); over a hundred test files here already do, `app/copilot/practice/PracticeControls.test.js` among them. A render crash of this shape in practice mode WOULD now be catchable by a mounted test. Nothing this case pins changes: `no-undef` is still the gate, it is still what actually caught this class for free across the whole repo including the files no test mounts, and the three green gates listed above still said nothing was wrong.

So three green gates said nothing was wrong while half the feature was dead. `no-undef` is now enabled in `eslint.config.mjs`; enabling it produced **zero** errors anywhere else in the codebase, so it costs nothing. Be precise about what it closes, though: bare free variables in linted source, and nothing wider. It cannot see a misspelled object property, cannot fire inside a `typeof` guard, does not reach anything under `globalIgnores`, and does not reach files outside `hello-world/`. Do not disable it, and do not add a `tsconfig.json` to "do it properly" — there are no TypeScript sources here for one to check.

