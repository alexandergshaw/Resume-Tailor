# Regression runbook: T3 bucket b

Rules for every command here:
- Run from **PowerShell**, never Bash (`node` is not reachable from Bash here).
- **Never `npx`.** Invoke `node` directly.
- **No case text ever goes on a command line.** Tokens from `docs/regression` stay in PowerShell variables;
  they are compared as strings and never passed to a command, a path API or `Invoke-Expression`.
- The base directory is always `Join-Path $env:TEMP 'resume-tailor-regression'` (never `GetTempPath()`).
- Never read an exit code from `Start-Process`; read text lines.

## 1. Launch bucket b
First run `bash scripts/regression-integrity.sh` from the Bash tool and note its exit code and last line.
Then, from PowerShell, fill in line 1 and run the block unchanged:

```powershell
$repo = '<repo root>'; $chunk = '<chunk folder>'; $integrity = 'EXIT=<code> FILES=<n> CASES=<n>'
$id = [guid]::NewGuid().ToString('N')
$B = Join-Path $env:TEMP 'resume-tailor-regression'
New-Item -ItemType Directory -Force -Path $B | Out-Null
$mint = Join-Path $chunk "bucket-b.$id.mint"
[IO.File]::WriteAllText($mint, "RUN_ID=$id`n")
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
Start-Process -FilePath $node -WorkingDirectory (Join-Path $repo 'hello-world') -WindowStyle Hidden `
  -ArgumentList @('scripts/regression/launch.js', '--mint', "`"$mint`"", '--integrity', "`"$integrity`"") `
  -RedirectStandardOutput (Join-Path $B "$id.launcher.out.txt") -RedirectStandardError (Join-Path $B "$id.launcher.err.txt")
"LAUNCHED RUN_ID=$id MINT=$mint"
```

Keep the printed mint path. If you lose it, use the newest `bucket-b.*.mint` in the chunk folder.

## 2. Read the gate (at least 15 s after launching; each poll at most 590 s)
```powershell
& node '<repo root>\hello-world\scripts\regression\gate.js' --mint '<mint path>'
```
It prints exactly one `GATE=… REASONS=… RUN_ID=…` line. Its exit code means nothing.

| Gate line | Next action |
|---|---|
| `GATE=green REASONS=-` | Bucket b is green. Glance at `CNJ_NEW` in the record. |
| `GATE=not-green` with `dirty` | Route every `judged-bad.jsonl` row: `node <repo>\hello-world\scripts\regression\render-row.js --run <run dir> --key <key>` renders its brief. If the line also says `fresh`, launch ONE new run first and route from it. Refuters run only the printed isolated command. |
| `REASONS=pin` | Run the vitest-version re-measure (OQ-11) before the next chunk proceeds. |
| `REASONS=fresh` or `exit-disagree` | Re-run with a new ID before routing anything. |
| `GATE=pending` | Wait. Poll again. **Never launch again.** |
| `overdue:<pid>` | The gate has already seen it twice, 30 s apart. Run the external kill (E), which is one-liner (C) in kill mode. `SURVIVORS=0` is required; report any `SURVIVORS_AFTER_TREE_KILL` above 0. Then poll until `i:launcher-lost`, then re-run with a new ID. |
| `i:launcher-lost` | Run (C) in walk mode. A listed launcher or runner root is a hung process: run (C) in kill mode. Other listed processes are orphans (a runner, vitest or worker whose root is gone): stop each with `taskkill.exe /PID <pid> /F`, then run (C) in walk mode with `$knownText` set to the previous output's `<pid>@<time>` tokens, until `SURVIVORS=0`. Then re-run with a new ID. |
| `i:unsettled` | Read the gate again. Do not re-run on this line. |
| `a:no-record` | Read `Get-Content -LiteralPath "$env:TEMP\resume-tailor-regression\<RUN_ID>.launcher.err.txt"`. A `LAUNCHER: refused <reason>` line names the refusal. If the file is absent, the launcher never started: check `Test-Path` on the base and `Get-Command node`, then re-run. |
| `LAUNCHER: refused concurrent-run lock-run=<id>` | Another run on this tree is live. Show the locks (A). If it is yours, poll its gate; otherwise wait for it. |
| `LAUNCHER: refused recursion-guard` | Your shell exports `VITEST`. Remove it (`Remove-Item Env:VITEST`) and launch again. |
| `i:lock-unreadable` | Show the locks (A). If a lock is not a 7-line `T3_LOCK=v1` file, and `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` shows no command line holding any RUN_ID it shows, delete that lock file by hand, then re-run. (This finds a live launcher or runner. (C) cannot run on an unreadable lock.) |
| `i:lock-lost` | Two launches raced and this one lost. Poll the other run; re-run only if (C) shows no live run. |
| `e:timeout` | Did the machine sleep? Is another vitest running? Re-run awake with nothing else running. After two timeouts, the last module line in `vitest.stdout.txt` names the hang. |
| any other `inconclusive` | Re-run with a new ID. |

**Stop rule.** After two INCONCLUSIVE runs with the same reason on a settled tree, stop re-running: act on the
reason, or use the hand fallback (section 3). A re-run always mints a new ID.

One-liners:
- **(A) Locks:** `Get-ChildItem -LiteralPath "$env:TEMP\resume-tailor-regression" -Filter 'lock-*' | ForEach-Object { "== $($_.Name)"; Get-Content -LiteralPath $_.FullName }`
- **(B) Recent runs:** `Get-ChildItem -LiteralPath "$env:TEMP\resume-tailor-regression" -Directory | Where-Object Name -cmatch '^[0-9a-f]{32}$' | Sort-Object CreationTime -Descending | Select-Object -First 5 Name, CreationTime`
- **(C) Survivors of a run** (capture, kill, re-check). vitest's worker processes do not carry the RUN_ID on their command line, and a walk over a snapshot taken after a kill cannot cross a dead process, so the tree is captured while it is alive and re-checked by `<pid>@<start time>`. In line 1, `$kill = $true` kills (only on `overdue:<pid>` or a hung root), and `$knownText` takes the `<pid>@<time>` tokens a previous run printed.

```powershell
$run = '<RUN_ID>'; $kill = $false; $knownText = ''
$B = Join-Path $env:TEMP 'resume-tailor-regression'
if ($run -cnotmatch '^[0-9a-f]{32}$') { throw 'RUN_ID invalid: do not walk' }
$pairs = @(Get-ChildItem -LiteralPath $B -File | Where-Object { $_.Name -clike 'lock-*' -or $_.Name -clike '*.prior-lock.txt' } | ForEach-Object {
  $l = @(Get-Content -LiteralPath $_.FullName)
  if ($l -ccontains "RUN_ID=$run") { (@($l | Where-Object { $_ -cmatch '^(LAUNCHER_PID|LAUNCHED)=' }) -join ' ') } } | Sort-Object -Unique)
if ($pairs.Count -ne 1 -or $pairs[0] -cnotmatch '^LAUNCHER_PID=([1-9][0-9]{0,9}) LAUNCHED=(\S+Z)$') { throw 'no single parseable lock for this run: walk by hand' }
$ic = [Globalization.CultureInfo]::InvariantCulture; $rk = [Globalization.DateTimeStyles]::RoundtripKind
$since = [DateTime]::Parse($Matches[2], $ic, $rk).ToUniversalTime()
$roots = @([int]$Matches[1])
$st = Join-Path (Join-Path $B $run) 'status.txt'
if (Test-Path -LiteralPath $st) { $m = @(Select-String -LiteralPath $st -CaseSensitive -Pattern '^RUNNER_PID=([1-9][0-9]{0,9})$'); if ($m.Count -gt 0) { $roots += [int]$m[0].Matches[0].Groups[1].Value } }
$known = @()
foreach ($w in @($knownText -split '\s+' | Where-Object { $_ })) {
  if ($w -cnotmatch '^([1-9][0-9]{0,9})@(\S+Z)$') { throw "known token invalid: $w" }
  $known += [pscustomobject]@{ Id = [int]$Matches[1]; Created = [DateTime]::Parse($Matches[2], $ic, $rk).ToUniversalTime() }
}
function Get-RunTree($kn) {
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, Name, CommandLine)
  $script:tree = New-Object System.Collections.ArrayList; $seen = @{}
  foreach ($r in $roots) {
    $cut = [DateTime]::MaxValue
    $rp = @($all | Where-Object { [int]$_.ProcessId -eq $r })
    if ($rp.Count -gt 0) {
      if ($rp[0].CommandLine -like "*$run*") { if (-not $seen.ContainsKey([string]$r)) { $seen[[string]$r] = 1; [void]$script:tree.Add($rp[0]) } }
      else { $cut = $rp[0].CreationDate.ToUniversalTime() }
    }
    $queue = @($r)
    while ($queue.Count -gt 0) {
      $p = $queue[0]; $queue = @($queue | Select-Object -Skip 1)
      foreach ($c in @($all | Where-Object { [int]$_.ParentProcessId -eq $p })) {
        $t = $c.CreationDate.ToUniversalTime(); $k = [string]$c.ProcessId
        if ($seen.ContainsKey($k) -or $t -lt $since -or ($p -eq $r -and $t -ge $cut)) { continue }
        $seen[$k] = 1; [void]$script:tree.Add($c); $queue += [int]$c.ProcessId
      }
    }
  }
  $queue = @($kn | ForEach-Object { $_.Id })
  foreach ($q in $kn) {
    foreach ($c in @($all | Where-Object { [int]$_.ProcessId -eq $q.Id -and $_.CreationDate.ToUniversalTime() -eq $q.Created })) {
      $k = [string]$c.ProcessId; if (-not $seen.ContainsKey($k)) { $seen[$k] = 1; [void]$script:tree.Add($c) }
    }
  }
  while ($queue.Count -gt 0) {
    $p = $queue[0]; $queue = @($queue | Select-Object -Skip 1)
    foreach ($c in @($all | Where-Object { [int]$_.ParentProcessId -eq $p -and $_.CreationDate.ToUniversalTime() -ge $since })) {
      $k = [string]$c.ProcessId; if ($seen.ContainsKey($k)) { continue }
      $seen[$k] = 1; [void]$script:tree.Add($c); $queue += [int]$c.ProcessId
    }
  }
}
function Format-Token($c) { '{0}@{1}' -f $c.ProcessId, $c.CreationDate.ToUniversalTime().ToString('o') }
Get-RunTree $known
if ($kill) {
  $cap = @($script:tree | ForEach-Object { Format-Token $_ })
  "CAPTURED=$($cap.Count) $($cap -join ' ')"
  $known += @($script:tree | ForEach-Object { [pscustomobject]@{ Id = [int]$_.ProcessId; Created = $_.CreationDate.ToUniversalTime() } })
  foreach ($x in @($script:tree | Where-Object { $roots -contains [int]$_.ProcessId })) { taskkill.exe /PID $x.ProcessId /T /F }
  Start-Sleep -Seconds 3; Get-RunTree $known
  "SURVIVORS_AFTER_TREE_KILL=$($script:tree.Count)"
  if ($script:tree.Count -gt 0) { foreach ($x in @($script:tree)) { taskkill.exe /PID $x.ProcessId /F }; Start-Sleep -Seconds 3; Get-RunTree $known }
}
"SURVIVORS=$($script:tree.Count)"
$script:tree | ForEach-Object { "SURVIVOR $(Format-Token $_) $($_.Name) $($_.CommandLine)" }
```

  `SURVIVORS=0` is the pass. In walk mode, stop each `SURVIVOR` with `taskkill.exe /PID <pid> /F` (never `/T` here), then run (C) again with `$knownText` set to the previous output's tokens. If it throws `walk by hand`, no single lock names this run: list `Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine` and trace the tree from the launcher by hand.
- **(E) External kill, only on `overdue:<pid>`:** first show the locks (A) and check that this run's lock says `LAUNCHER_PID=<pid>`, the same `<pid>` as `overdue:<pid>`; if not, do not kill, and read the gate again. Then run (C) with line 1 `$run = '<RUN_ID from the gate line>'; $kill = $true; $knownText = ''`. (C) uses `/T` only on a root whose command line holds the RUN_ID (§2.7's identity check). Never name a variable `$pid`: it is read-only in PowerShell.

## 3. Hand fallback: bucket b by hand
Use this only when the T3 launcher cannot give a finished record: its self-test fails, the runner crashes,
or two runs on a settled tree end INCONCLUSIVE for the same reason. Never use it to get past a red.

### 3.1 Preconditions
1. The tree is settled: no other session is editing it.
2. No live T3 run on this tree: run (A). If a lock's `HEARTBEAT=` is less than 60 s old and its run has no
   `--- end ---` line, wait for that run.
3. From `hello-world`, `node node_modules/vitest/vitest.mjs --version` must print `vitest/4.1.8 …`.
   Anything else: continue, but record `PIN=mismatch` and run the vitest-version re-measure before the next chunk.

### 3.2 Existence of every path a case names (string match; no per-token filesystem call)
From the repository root:

```powershell
$have = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
foreach ($f in @(git -c core.quotePath=false ls-files --cached --others --exclude-standard hello-world)) {
  $rel = $f.Substring('hello-world/'.Length); [void]$have.Add($rel)
  $parts = $rel.Split('/'); for ($i = 1; $i -lt $parts.Length; $i++) { [void]$have.Add(($parts[0..($i-1)] -join '/')) }
}
$tokens = New-Object 'System.Collections.Generic.SortedSet[string]' ([StringComparer]::Ordinal)
$spans = 0
foreach ($m in @(Get-ChildItem -LiteralPath 'docs\regression' -Recurse -Filter '*.md' | Select-String -Pattern 'npx vitest run[^`]*' -AllMatches | ForEach-Object { $_.Matches })) {
  $spans++
  $words = @([regex]::Matches($m.Value.Substring('npx vitest run'.Length), '"[^"]*"|\S+') | ForEach-Object { $_.Value })
  for ($i = 0; $i -lt $words.Count; $i++) {
    $w = $words[$i]
    if ($w.StartsWith('-')) { if ($w -eq '-t') { $i++ }; continue }
    [void]$tokens.Add(($w -replace '^"(.*)"$', '$1'))
  }
}
$refused = @(); $missing = @()
foreach ($t in $tokens) {
  if ($t -match ':|^[\\/]|(^|[\\/])\.\.([\\/]|$)|[. ]$' -or $t.StartsWith('-')) { $refused += $t }
  elseif (-not $have.Contains($t.TrimEnd('/'))) { $missing += $t }
}
"SPANS=$spans TOKENS=$($tokens.Count) REFUSED=$($refused.Count) MISSING=$($missing.Count)"
$refused | ForEach-Object { "REFUSED $_" }
$missing | ForEach-Object { "MISSING $_" }
```

- `SPANS` must be above 0. `SPANS=0` means the step read nothing: stop.
- Every `REFUSED` token is a red: a case names a flag-shaped or escaping path. Report the token and its case.
- **Pre-registered missing tokens** (known false reds of this check; the list changes only by a commit to this
  file, re-derived here after R-260's rewrite): `app/components/ChatPanel` (R-291),
  `app/components/experience/ExperienceTab` (R-242).
  Any other `MISSING` token is a red.

Derived 2026-09-13 on HEAD 8982ae6dfb732b43c82638dfeeb70fabec5fbb2d DEF12=e6b0663052352202a6d2f0764cc6db8659e8e704f3c7445718be130dc3d028d7.

- The match is case-sensitive: a token that differs from the file only in letter case reads missing. Fix the case.
- A `file.test.js:NN` token reads `REFUSED` here. T3 itself classes exactly that form as DEF-1u; the hand gate is stricter.
- The `@( … )` wrappers are load-bearing: without them a one-word span makes `$words` a string, and the loop invents tokens.
- **Blind spots:** `Select-String` is line-based, so a command span wrapped onto a second line is missed; the
  existence set is git's tracked + untracked-not-ignored files, so a gitignored file reads missing.

### 3.3 One whole-suite run, detached, output to fresh files
From `hello-world`:

```powershell
$B = Join-Path $env:TEMP 'resume-tailor-regression'
New-Item -ItemType Directory -Force -Path $B | Out-Null
$hid = [guid]::NewGuid().ToString('N')
$out = Join-Path $B "hand-$hid.out.txt"; $err = Join-Path $B "hand-$hid.err.txt"
if ((Test-Path -LiteralPath $out) -or (Test-Path -LiteralPath $err)) { throw 'output name exists: mint again' }
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$p = Start-Process -FilePath $node -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru `
  -ArgumentList @('node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', '--allowOnly=false') `
  -RedirectStandardOutput $out -RedirectStandardError $err
"HAND_ID=$hid PID=$($p.Id) OUT=$out"
```

The run takes about 11 minutes, longer than one 600 s tool call. Poll with
`Get-Process -Id <PID> -ErrorAction SilentlyContinue` until it is gone.

### 3.4 Read the result (text lines only)
```powershell
Select-String -LiteralPath $out -Pattern '^\s*(Test Files|Tests|Errors)\s'
Select-String -LiteralPath $out -Pattern '^\s*FAIL\s'
```
- **No `Tests` line: no result.** Re-run once; a second time means stop and report `$err`'s content.
- **Red** on any `FAIL` line; on any `failed` in the `Test Files` or `Tests` line; on a `Test Files` line whose
  parts do not sum to its total; on any `Errors` line; or on any red from 3.2.
- **Green** only when none of those holds and a `Tests` line exists.

### 3.5 Record
Record the push as `bucket b: HAND hand-<HAND_ID> (T3 run <RUN_ID or none>: <reason>)`.
**A hand green does not see:** vacuous cases (no counted test), a `-t` that matches nothing, which case a crashed
worker belonged to, CNJ items, or per-case attribution of any kind. It is stricter than the T3 gate in one way:
any failing test anywhere is red.

## 4. Accepted residual risk
These are shapes no rule can still close, each accepted for one of five reasons:
- **0 live**: no instance at this tree, by the named instrument;
- **vitest-silent**: vitest itself never reports it;
- **fails loud**: T3 gives INCONCLUSIVE or a red, never a clean;
- **content-neutral**: no verdict can change;
- **owner-accepted egress**: data leaves the machine by a traced route the owner has explicitly accepted.

A shape leaves this table only by a ruling. **Owner and detector:** at 0a of any chunk that touches `scripts/`,
`.claude/workflows/stage10-regression.js`, `.claude/agents/`, `docs/regression/`, `docs/regression-runbook.md` or the
vitest version, the orchestrator re-checks every `Reopens if` below; a condition that now holds reopens its row
before that chunk proceeds. `VITEST_PIN=mismatch` in every status record detects a vitest bump mechanically. S6's
fixture condition is also checked at every push, by the orchestrator (a push is the orchestrator's act).

| # | Shape | What T3 does | Evidence (instrument; rows that could fail) | Reason | Reopens if |
|---|---|---|---|---|---|
| R1 | A timer that throws after its test returned | Nothing: `pass`, `RESULT=clean` | a planted late-timer file under vitest 4.1.8: `Test Files 2 passed (2)`, no `Errors` line, 0 stderr lines, exit 0 (1 planted row, 0 detections) | vitest-silent (the ordinary gate has the same exposure) | vitest starts reporting it |
| R2 | Tracked submodules | a dirty gitlink is not computable: INCONCLUSIVE(h) | `git ls-files -s`, mode 160000: 0; no `.gitmodules` | 0 live; fails loud | a `.gitmodules` appears |
| R3 | Racy-git: an edit git's stat check misses | untested; start and end fingerprints could agree | 0 observed instances; git re-hashes index entries not older than the index | 0 live (window: one timestamp tick with an unchanged size; step 10 waits for the in-flight push) | any observed instance |
| R4 | Case-only renames | the status may not list the rename | DEF-5 is a lowercase substring rule (read of `definitions.selects`) | content-neutral | selection becomes case-sensitive |
| R5 | Snapshots | a mismatch fails its test; the argv never carries `-u`; obsolete snapshot files are not failures | Grep `toMatch(Inline|File)?Snapshot` over hello-world tests: 0 (no canary: weak) | 0 live; the obsolete case is vitest-silent | the first snapshot test lands |
| R6 | `node_modules`-only edits, lockfile untouched | the fingerprint is blind to them | DEF-12 hashes git status records; `node_modules` is gitignored (read) | content-neutral: the verdict is true of the dependencies the run loaded | a chunk installs during stage 10 |
| R7 | Index-only `git add` | moves the fingerprint: INCONCLUSIVE(h), re-run | fingerprint probe: the digest moved `82fb90996dcf` → `becf6c52500e` | fails loud | re-runs become frequent |
| R8 | A file edited inside an untracked nested repository | blind | fingerprint probe: digest unchanged (`8becd947a54f` twice); live nested repositories 0 (`find`, `node_modules` pruned) | 0 live | a `??` record ending `/` whose directory holds `.git` appears |
| R9 | A test state vitest does not know | mapped to `skipped`; a partial case can pass | vitest 4.1.8 source: `StatusMap[…] || "skipped"`; 7 mapped states, none unmapped reachable | vitest-silent | a vitest upgrade adds a state (any bump shows as `VITEST_PIN=mismatch`) |
| R10 | Partial skip: some passed plus some skipped counted tests | `pass`; the row reports the skipped count | Grep `\b(test|it|describe)\.(skip|todo|skipIf|runIf)\b|\bctx\.skip\(` over hello-world tests: 0 live (canary: 3 hits in 2 planted files; blind to aliases) | 0 live | the first live skip, todo-only or empty-skip file lands |
| R11 | Bucket-c runners run corpus commands without `--allowOnly=false` | a `.only` can hide a failure from them | planted `.only` files p10–p13 read `fail` in bucket b's argv (vitest 4.1.8) | fails loud: bucket b reds that file itself | bucket b stops running every Steps file |
| R12 | Tracked symlinks | not computable: INCONCLUSIVE(h) | `git ls-files -s`, mode 120000: 0 | 0 live; fails loud | a symlink is committed |
| R13 | The enumerate agent's self-reported `automatable` literal | a wrong `no` moves a case to `manualCases` | read of the integrity script's rows: `file`, `cases`, `bytes`, `payloadBytes`, no `automatable`; T3's step-10 D-2 compares against headings | out of T3's scope by ruling; the report carries the heading-derived literal | a later chunk puts `automatable` in the integrity rows |
| R14 | Edits reverted within one run; gitignored inputs (`.env*`); `.git/info/exclude`; `core.excludesFile`; skip-worktree/assume-unchanged | blind | `.git/info/exclude`: 1 pattern (`.claude/worktrees/`), 0 test inputs; `core.excludesFile` unset; skip-worktree 0 | 0 live test inputs there, or reverted content only | any live test input appears there |
| S6 | Test output, including fixture text such as the owner's own name and email, reaches each refuter's model provider through its own re-run, and through any record file a refuter opens | refuters run only the isolated command; the union observation is bucket b's own record or one shared launcher run; routed excerpts are bounded at 4,096 B per row | routes E1–E6 traced by reading; the owner's email is at `route.promptInjection.test.js:164`; at least 25 name hits in fixtures (Grep) | **owner-accepted egress: the owner, 2026-09-11, "egress is fine"**, after being shown this route, this data, this bound and these reopen conditions | a third party's real résumé data enters fixtures; or the refuter provider changes. Detectors: 0a via `.claude/agents/` and the workflow; at push, the orchestrator greps added lines under `hello-world/` for an email shape `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` or a US phone shape that is not the owner's own address or in the 555-01xx range (canary: the pattern hits `route.promptInjection.test.js:164`; blind to a name alone or a non-US phone) |

## 5. Certification record
<filled once, after T3's step 10, with the D-7 summary lines listed in plan.r2.md §6.5 (a); W5-S lands this placeholder line unchanged>
