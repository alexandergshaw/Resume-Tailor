### R-010 | area: beta | parallel-safe: yes | automatable: yes

**Summary:** The top-level test runs from a CRLF case file.

**Steps:**
1. Run `cd hello-world && npx vitest run grp/one.test.js -t "solo"`.

**Expected:** The solo test passes.

### R-011 | area: beta | parallel-safe: yes | automatable: yes

**Summary:** The speaker file runs whole.

**Steps:**
1. Run `cd hello-world && npx vitest run kb/speaker.test.js`.

**Expected:** The speaker test passes.
