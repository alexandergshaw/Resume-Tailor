### R-260 | area: regression-process | parallel-safe: yes | automatable: no

**Summary:** The stage-10 workflow cannot parse this document any more, and two cases had been unrunnable for months.

**Steps:**
1. Run the stage-10 regression workflow against this document.
2. Read its failure output, not only its summary.

**Expected:** It fails, and **its summary is misleading**: it reports `"No regression document at docs/REGRESSION.md"`. The document exists. The real cause is in the failure log — the enumeration agent exceeds a 64000-token output cap trying to turn ~3900 lines into executable cases. Taken at face value the summary would lead someone to recreate a document that is already there, or to skip the gate.

**Until it is chunked, drive it directly.** The automatable cases name their own commands: `grep -o "npx vitest run [^\`]*" docs/REGRESSION.md`, collect the distinct paths, check each exists, and run them in one invocation. As of this group that is 175 commands naming 191 paths across 187 `automatable: yes` cases, and it completes in about three minutes.

**Doing that surfaced two cases that could never have failed.** `lib/copilot/deepgram.test.js` moved under `lib/copilot/stt/` when speech-to-text became pluggable, and `app/components/TrackingTab.test.js` was split into `TrackingTab.digest.test.js`. Both were still named here, so those two cases had been silently vacuous since those commits. Paths corrected. **A case naming a file that does not exist is not a passing case.**

**And the workflow never runs `automatable: no` cases at all** — four occurrences now, once against an explicit instruction. Its "all passing" covers the automatable subset only. The manual cases in the changed area have to be fanned out to adversarial reviewers by hand, **grouped by defect rather than by file**: in this group that pass found the honesty-gate hole, both privacy-notice failures, the contrast failure and the self-contradicting caption — every one of them invisible to the 5409 automated tests that were green throughout.

### R-381 | area: regression-process | parallel-safe: yes | automatable: yes

**Summary:** `docs/REGRESSION.md` grew to roughly 1 MB and 368 cases and stage 10 could no longer enumerate it — R-260's own workaround was needed because the workflow reported `{"docFound": false, "detail": "No regression document at docs/REGRESSION.md"}`, which was false; the file was there. The document is now an index over 116 per-area files under `docs/regression/`, backed by a committed integrity script, and the workflow takes its file list from the caller instead of trusting an agent to discover it.

**Steps:**
1. From the repository root, run `bash scripts/regression-integrity.sh`. Confirm it exits `0`, prints no `FAIL:` line, and that its last line reads `FILES=<n> CASES=<n>`, where the first number matches `find docs/regression -name '*.md' | wc -l` and the second matches the sum of `grep -c '^### R-'` across those same files.
2. Reproduce the split's losslessness against the pre-split commit, independently of the script that performed the move:
   ```
   cat > /tmp/casehash.pl <<'PERL_EOF'
   use strict; use warnings; use Digest::MD5 qw(md5_hex);
   my ($id, $blk) = ("", ""); my @out;
   while (my $l = <STDIN>) {
     if ($l =~ /^### (R-\d+)\b/) {
       push @out, "$id " . md5_hex($blk) if $id ne "";
       $id = $1; $blk = "";
     }
     $blk .= $l if $id ne "";
   }
   push @out, "$id " . md5_hex($blk) if $id ne "";
   print "$_\n" for sort @out;
   PERL_EOF
   git show 234bbd1:docs/REGRESSION.md | tr -d '\r' | perl /tmp/casehash.pl > /tmp/before.hashes
   cat docs/regression/*.md            | tr -d '\r' | perl /tmp/casehash.pl > /tmp/after.hashes
   diff /tmp/before.hashes /tmp/after.hashes && echo LOSSLESS
   ```
   `234bbd1` is the last commit whose `docs/REGRESSION.md` is the pre-split, monolithic document — confirm that first with `git show 234bbd1:docs/REGRESSION.md | grep -c '^### R-'` (368). `tr -d '\r'` is mandatory on **both** sides: this repo has `core.autocrlf=true` and no `.gitattributes`, so the blob `git show` hands back and the worktree's own markdown are smudged differently on checkout, and skipping the strip reddens every case.
3. Enumerate the case files with `find docs/regression -name '*.md' | wc -l` — **never** a flat glob (`ls docs/regression/*.md`, or any bare shell `*.md` expansion).
4. Count every `automatable:` value across the corpus: `grep -rho 'automatable: [a-z]*' docs/regression/*.md | sort | uniq -c`.

**Expected:** Step 1 exits `0` with an empty FAIL set; at ship time the trailing line read `FILES=116 CASES=368`. Step 2's diff is empty: 368 case hashes on both sides, none missing, none added, no duplicate IDs, and the two sides' case-region byte totals are identical — measured at ship time as 1,024,003 bytes on each side, via `git show 234bbd1:docs/REGRESSION.md | tr -d '\r' | awk '/^### R-/{f=1} f{print}' | wc -c` against `cat docs/regression/*.md | tr -d '\r' | wc -c`. Separately, `tr -d '\r' < docs/REGRESSION.md | grep -c '^### R-'` is `0` — the index itself carries zero case headings. Step 3's count (116 files) is the one a flat glob cannot be trusted to reproduce: during this change's own adversarial verification, a glob saw 115 files / 354 cases where `find` saw 116 / 368 — fourteen cases were invisible to the glob-based instrument while every count-only check built on it kept reporting green. Step 4 gives `63 no / 41 partly / 264 yes`; the workflow's execution filter is `automatable !== 'no'` (not `automatable === 'yes'`), so the executed set is `41 + 264 = 305` cases, not 264.

**Root cause, fixed here:** `.claude/workflows/stage10-regression.js` used one guard, `if (!enumerated || !enumerated.docFound)`, to cover two unrelated events — "the enumerate agent returned nothing" and "the document is missing" — and its handler unconditionally returned the literal `docFound: false` for both, so a cap failure was reported as a missing file. The workflow now tracks three independent flags (`enumerationFailed`, `docFound`, `enumerationIncomplete`), each set by its own code path and never reset once set, so the three outcomes cannot collapse into each other. It also reads its file list from `args.files` — supplied by the caller, which runs `scripts/regression-integrity.sh` itself and passes its rows in — rather than asking an agent to discover the tree; enumerates in packed batches; and asserts **set identity**, not just a count, between each batch's expected and returned IDs, so a batch that drops one ID while inventing a different one at the same total is still caught.

Load-bearing specifics the next reader needs:

- **The placement check (`scripts/regression-integrity.sh` rule 4) must never use a backslash character class (`[\/\\]` or similar).** Delivered through a shell command string — even inside a quoted heredoc — `\\` collapses to `\`, gawk then reads the trailing `\]` as an escaped bracket instead of a class terminator, the class never closes, and it silently swallows the rest of the program. **It parses without error and reports every case misplaced** — a uniformly red run that looks like a real finding but is actually just broken. `sub(/^.*\//,"",n)` needs exactly one backslash, and the `find`-fed input this rule scans only ever contains forward slashes, so no backslash variant is needed at all.
- Rule 4 carries a **self-test canary** for exactly that failure mode: before scanning anything, it runs one known-good and one known-misplaced probe line through its own `verdict()` function and exits `9` with `PLACEMENT-CHECK SELF-TEST FAILED` on stderr if either answer comes back wrong. A clean rule-4 result is only trustworthy because that canary ran silently first — a `PLACEMENT-CHECK SELF-TEST FAILED` line anywhere in stderr means every other rule-4 result in that run is meaningless.
- The `FILES=`/`CASES=` line and every count in this case's Expected section are point-in-time (ship-time) figures. `docs/REGRESSION.md` is appended to several times a day, so re-derive them from the live tree with the commands above rather than trusting either this document or whoever last ran them.

