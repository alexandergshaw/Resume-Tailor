### R-901 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** The planted control file passes on its own.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js`.

**Expected:** The selected files pass.

### R-902 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p02 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p02.fail.test.js`.

**Expected:** The selected files pass.

### R-903 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p03 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p03.import.test.js`.

**Expected:** The selected files pass.

### R-904 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p04 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p04.syntax.test.js`.

**Expected:** The selected files pass.

### R-905 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p05 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p05.beforeall.test.js`.

**Expected:** The selected files pass.

### R-906 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p06 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p06.unhandled.test.js`.

**Expected:** The selected files pass.

### R-907 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p07 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p07.crash.test.js`.

**Expected:** The selected files pass.

### R-908 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p08 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p08.afterall.test.js`.

**Expected:** The selected files pass.

### R-909 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p09 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p09.empty.test.js`.

**Expected:** The selected files pass.

### R-910 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p10 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p10.only.test.js`.

**Expected:** The selected files pass.

### R-911 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p11 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p11.onlyalias.test.js`.

**Expected:** The selected files pass.

### R-912 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p12 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p12.describeonly.test.js`.

**Expected:** The selected files pass.

### R-913 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p13 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p13.concurrentonly.test.js`.

**Expected:** The selected files pass.

### R-914 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p14 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p14.skipped.test.js`.

**Expected:** The selected files pass.

### R-915 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p15 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p15.todo.test.js`.

**Expected:** The selected files pass.

### R-916 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Planted shape p16 selected beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/p16.dupname.test.js`.

**Expected:** The selected files pass.

### R-917 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** An import-time worker kill (q03) beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/q03.importkill.test.js`.

**Expected:** The selected files pass.

### R-918 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Todo-shaped file t02 beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/t02.describetodo.test.js`.

**Expected:** The selected files pass.

### R-919 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Todo-shaped file t03 beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/t03.todothenkill.test.js`.

**Expected:** The selected files pass.

### R-920 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** Todo-shaped file t05 beside the p01 control.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js planted/t05.emptyskip.test.js`.

**Expected:** The selected files pass.

### R-921 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** A describe.todo-only file selected alone.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/t02.describetodo.test.js`.

**Expected:** The selected files pass.

### R-922 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** One filter names a file that does not exist.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p99.absent.test.js planted/p01.pass.test.js`.

**Expected:** The selected files pass.

### R-923 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** A test-name pattern that matches no test.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js -t "zzz nothing"`.

**Expected:** The selected files pass.

### R-924 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** The control passes; a failing file is named only outside Steps. The failing file `npx vitest run planted/d7only.fail.test.js` is named here, outside Steps.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js`.

**Expected:** The selected files pass.

### R-925 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** The Expected region claims more tests than exist.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p01.pass.test.js`.

**Expected:** 3 tests pass.

### R-926 | area: planted | parallel-safe: yes | automatable: yes

**Summary:** A test-title claim on a name two tests share.

**Steps:**
1. Run `cd hello-world && npx vitest run planted/p16.dupname.test.js`.

**Expected:** `p16 grp > p16 same name` passes.

