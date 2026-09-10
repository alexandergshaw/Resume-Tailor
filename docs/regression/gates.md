### R-009 | area: gates | parallel-safe: no | automatable: yes

**Summary:** Project gates are green. Exclusive because the build writes to shared output.

**Steps:**
1. From `hello-world`, run `npx eslint .`
2. From `hello-world`, run `npx vitest run`
3. From `hello-world`, run `npm run build`

**Expected:** eslint reports zero errors and zero warnings. vitest reports at least 816 passing tests with zero failures. The build compiles successfully. Note `tsc --noEmit` is not applicable: this project has `jsconfig.json` and no `tsconfig.json`.

