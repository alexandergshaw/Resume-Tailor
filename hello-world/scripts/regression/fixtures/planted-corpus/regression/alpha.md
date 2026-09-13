### R-001 | area: alpha | parallel-safe: yes | automatable: yes

**Summary:** Speaker labels render for a planted transcript.

**Steps:**
1. Run `cd hello-world && npx vitest run kb/speaker.test.js -t "speaker labels"`.

**Expected:** The speaker test passes.

### R-002 | area: alpha | parallel-safe: yes | automatable: yes

**Summary:** The grouped suite runs.

**Steps:**
1. Run `cd hello-world && npx vitest run grp/one.test.js` (the café fixture).

**Expected:** Both tests in the file pass.

### R-003 | area: alpha

**Summary:** A short-header block: its heading keeps area: and lacks the later fields.
