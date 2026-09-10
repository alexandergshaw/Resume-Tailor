#!/usr/bin/env bash
#
# scripts/regression-integrity.sh
#
# Deterministic, LLM-free structural check over docs/REGRESSION.md (the index)
# and docs/regression/*.md (the case files). No network call, no tokenizer, no
# agent - everything here is grep/find/awk/perl over the tree on disk, so it
# cannot drift the way a parsed-by-an-LLM enumeration can.
#
# Run this before every push, and run it FIRST at the head of every stage-10
# regression pass: the caller runs this script with its own Bash tool and
# passes its per-file rows in as args.files to the stage10-regression workflow
# (see .claude/workflows/stage10-regression.js's meta.whenToUse). If this
# script exits non-zero, DO NOT invoke that workflow - report this script's
# stderr and stop.
#
# stdout contract (do not change the shape without updating the caller):
#   - zero or more FAIL:/WARN: diagnostic lines
#   - one NDJSON row per case file: {"file":...,"cases":[...],"bytes":N,
#     "payloadBytes":{"<id>":N,...}}
#   - GRANDFATHERED=<n>, YES_MANUAL_SMELL=<n>, YES_WITH_MARKER=<n>
#   - the LAST line is always exactly: FILES=<n> CASES=<n>
# A missing summary line means this script crashed before finishing - treat
# that as a hard stop, the same as a non-zero exit.
#
# Exit 0 iff every FAIL-severity rule passed. WARN-severity findings never
# affect the exit code.

set -u
export LC_ALL=C

cd "$(dirname "$0")/.." || { echo "FATAL: cannot cd to repo root"; echo "FILES=0 CASES=0"; exit 2; }

INDEX="docs/REGRESSION.md"
DIR="docs/regression"
H=110000                       # hard cap: a file above this cannot be enumerated
S=34000                        # split threshold: a maintenance trigger, not a failure
GRANDFATHERED_BASELINE=25      # partly cases with no per-step manual marker - must not increase
YES_MANUAL_SMELL_BASELINE=13   # automatable:yes, no marker, steps smell of a browser/app/devtools - must not increase
YES_WITH_MARKER_BASELINE=1     # automatable:yes cases that self-contradict with a manual marker (R-220) - must not increase
GAP_IDS="103 104 105 112 115 166"   # retired IDs that must stay gaps forever

fail=0

failmsg() { echo "FAIL: $1"; fail=1; }
warnmsg() { echo "WARN: $1"; }

TMP=$(mktemp -d) || { echo "FATAL: mktemp failed"; echo "FILES=0 CASES=0"; exit 2; }
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------------------
# Preconditions - if these fail there is nothing else to usefully check.
# ---------------------------------------------------------------------------
if [ ! -f "$INDEX" ]; then
  failmsg "$INDEX not found"
  echo "FILES=0 CASES=0"
  exit 1
fi
if [ ! -d "$DIR" ]; then
  failmsg "$DIR does not exist"
  echo "FILES=0 CASES=0"
  exit 1
fi

# ---------------------------------------------------------------------------
# Rule 1: the index carries zero case headings.
# Catches: a case appended to docs/REGRESSION.md instead of docs/regression/.
# ---------------------------------------------------------------------------
idx_cases=$(tr -d '\r' < "$INDEX" | grep -c '^### R-')
if [ "$idx_cases" -ne 0 ]; then
  failmsg "rule 1: $INDEX contains $idx_cases '### R-' heading(s) - move them into docs/regression/<area>.md"
fi

# ---------------------------------------------------------------------------
# Rule 2: the file set is find(1), not a flat glob; flatness; bidirectional
# agreement with the index table. Catches: a new area file nobody indexed, an
# index row whose file was deleted/renamed, and a file hidden in a subdirectory
# (a flat glob and find disagree the moment anyone makes a subdirectory).
# ---------------------------------------------------------------------------
find "$DIR" -name '*.md' | sort > "$TMP/real_files.txt"
FILES=$(wc -l < "$TMP/real_files.txt" | tr -d ' ')

subdirs=$(find "$DIR" -mindepth 1 -type d)
if [ -n "$subdirs" ]; then
  failmsg "rule 2: $DIR is not flat - subdirectory found: $(printf '%s' "$subdirs" | tr '\n' ' ')"
fi

tr -d '\r' < "$INDEX" | grep -o '`docs/regression/[A-Za-z0-9._-]*\.md`' | tr -d '`' | sort -u > "$TMP/index_files.txt"

comm -23 "$TMP/real_files.txt" "$TMP/index_files.txt" > "$TMP/unindexed.txt"
comm -13 "$TMP/real_files.txt" "$TMP/index_files.txt" > "$TMP/ghost.txt"
if [ -s "$TMP/unindexed.txt" ]; then
  failmsg "rule 2: file(s) under $DIR with no index row: $(tr '\n' ' ' < "$TMP/unindexed.txt")"
fi
if [ -s "$TMP/ghost.txt" ]; then
  failmsg "rule 2: index row(s) naming a file that does not exist: $(tr '\n' ' ' < "$TMP/ghost.txt")"
fi

if [ "$FILES" -eq 0 ]; then
  failmsg "rule 2: FILES=0 - an empty $DIR is never a valid state"
fi

# ---------------------------------------------------------------------------
# Rule 3: per file, grep -c '^### R-' equals the index's declared count.
# Catches: an append that did not update the index's count column.
# ---------------------------------------------------------------------------
tr -d '\r' < "$INDEX" | awk -F'|' '
  $0 ~ /`docs\/regression\// {
    file = $3; gsub(/[ `]/, "", file)
    cnt = $4;  gsub(/[ ]/, "", cnt)
    if (file != "" && cnt ~ /^[0-9]+$/) print file, cnt
  }
' > "$TMP/index_counts.txt"

while read -r ic_file ic_cnt; do
  [ -f "$ic_file" ] || continue   # already reported as ghost by rule 2
  actual=$(tr -d '\r' < "$ic_file" | grep -c '^### R-')
  if [ "$actual" != "$ic_cnt" ]; then
    failmsg "rule 3: $ic_file has $actual case(s) but the index declares $ic_cnt"
  fi
done < "$TMP/index_counts.txt"

# ---------------------------------------------------------------------------
# Rule 4: placement - each case's area: equals its filename minus any -<digits>
# part suffix. This is the one corruption the per-case hash oracle cannot see
# (a byte-identical case moved to the wrong file hashes clean).
#
# MUST NOT use a backslash character class ([\/\\]) here: delivered through a
# shell command string that collapses \\ to \, gawk then treats the lone \]
# as an escaped bracket, the class never closes, and it silently swallows the
# rest of the line - the program parses, runs, exits 0, and reports every
# case misplaced. sub(/^.*\//,"",n) needs one escape, not three, and `find`
# (used below) always yields forward-slash paths on every platform this runs
# on, so no backslash variant is needed at all. This program - including the
# self-test canary - must only ever be written to disk with a tool that
# writes literal file bytes (never a heredoc built from a tool command
# string); that is how this file itself was authored.
# ---------------------------------------------------------------------------
find "$DIR" -name '*.md' -exec grep -H '^### R-' {} + | tr -d '\r' | awk '
BEGIN {
  probe_ok  = "docs/regression/app-nav.md:### R-001 | area: app-nav | x"
  probe_bad = "docs/regression/app-nav.md:### R-002 | area: sample-answer | x"
  if (verdict(probe_ok) != "" || verdict(probe_bad) !~ /^MISPLACED R-002 file=app-nav area=sample-answer$/) {
    print "PLACEMENT-CHECK SELF-TEST FAILED - do not trust this run" > "/dev/stderr"
    exit 9
  }
}
function verdict(s,   i, path, line, n, id, a) {
  i = index(s, ":### "); if (i == 0) return ""
  path = substr(s, 1, i-1); line = substr(s, i+1)
  n = path; sub(/^.*\//, "", n); sub(/\.md$/, "", n); sub(/-[0-9]+$/, "", n)
  id = line; sub(/^### /, "", id); sub(/ .*$/, "", id)
  a = line; if (a !~ /\| area: /) return "UNPARSED " id " in " n
  sub(/^.*\| area: /, "", a); sub(/ *\|.*$/, "", a)
  if (a != n) return "MISPLACED " id " file=" n " area=" a
  return ""
}
{ v = verdict($0); if (v != "") print v }
' > "$TMP/placement_hits.txt" 2> "$TMP/placement_stderr.txt"
placement_exit=$?

if [ "$placement_exit" -ne 0 ]; then
  failmsg "rule 4: placement-check self-test failed (exit $placement_exit) - do not trust any prior clean run: $(tr '\n' ' ' < "$TMP/placement_stderr.txt")"
elif [ -s "$TMP/placement_hits.txt" ]; then
  failmsg "rule 4: misplaced or unparsed case(s): $(tr '\n' ' ' < "$TMP/placement_hits.txt")"
fi

# ---------------------------------------------------------------------------
# Rule 5: IDs globally unique; zero-padded to >= 3 digits; none in the
# retired gap set (a case legitimately removed must never be resurrected).
# ---------------------------------------------------------------------------
find "$DIR" -name '*.md' -exec grep -ho '^### R-[0-9]*' {} + | sed 's/^### //' | sort > "$TMP/all_ids.txt"

dupe=$(uniq -d < "$TMP/all_ids.txt")
if [ -n "$dupe" ]; then
  failmsg "rule 5: duplicate case ID(s): $(printf '%s' "$dupe" | tr '\n' ' ')"
fi

badpad=$(sed 's/^R-//' "$TMP/all_ids.txt" | awk 'length($0) < 3 {print "R-" $0}')
if [ -n "$badpad" ]; then
  failmsg "rule 5: unpadded case ID(s), must be zero-padded to >= 3 digits: $(printf '%s' "$badpad" | tr '\n' ' ')"
fi

gap_hits=""
for gid in $GAP_IDS; do
  if sed 's/^R-0*//' "$TMP/all_ids.txt" | grep -qx "$gid"; then
    gap_hits="$gap_hits R-$gid"
  fi
done
if [ -n "$gap_hits" ]; then
  failmsg "rule 5: resurrected retired case ID(s), these must stay gaps:$gap_hits"
fi

# ---------------------------------------------------------------------------
# Rule 6 + Rule 11 core: run the per-case scanner once. It emits one NDJSON
# row per file (file, case-id list, file bytes, per-case Steps:+Expected:
# payload bytes) and a small key=value env file with the rule 6 oversize list
# and the rule 7 ratchet counts. One pass feeds several rules because they
# all need the same case-block parse.
# ---------------------------------------------------------------------------
perl - "$DIR" "$TMP/scan.env" <<'PERL_EOF' > "$TMP/rows.ndjson"
use strict; use warnings;
my $dir = $ARGV[0] // 'docs/regression';
my $envfile = $ARGV[1] or die "usage: <dir> <envfile>";
my $S = 34000;
my @files = sort glob("$dir/*.md");
my $total_cases = 0;
my $grand = 0; my $smell = 0; my $ywm = 0;
my (@grand_ids, @smell_ids, @ywm_ids, @oversize);
for my $f (@files) {
  open(my $fh, "<:raw", $f) or die "cannot open $f: $!";
  local $/; my $content = <$fh>;
  close $fh;
  $content =~ s/\r//g;
  my @blocks = split /(?=^### R-)/m, $content;
  my @ids; my %payload;
  for my $b (@blocks) {
    next unless length($b);
    next unless $b =~ /^### (R-\d+) \| area: ([^|]*)\| parallel-safe: [^|]*\| automatable: (\S+)/m;
    my ($id, $area, $auto) = ($1, $2, $3);
    push @ids, $id;
    $total_cases++;
    my $bytes = length($b);
    if ($bytes > $S) { push @oversize, "$id:$bytes"; }
    my ($steps_on) = $b =~ /(\*\*Steps:\*\*.*)/s;
    $steps_on = "" unless defined $steps_on;
    $payload{$id} = length($steps_on);
    my $has_marker = ($b =~ /Manual \(`automatable: no`\)/) ? 1 : 0;
    if ($auto eq "partly" && !$has_marker) { $grand++; push @grand_ids, $id; }
    if ($auto eq "yes" && !$has_marker) {
      my ($steps) = $b =~ /\*\*Steps:\*\*(.*?)(?:\*\*Expected:\*\*|\z)/s;
      $steps = "" unless defined $steps;
      if ($steps =~ /real browser|in a browser|devtools|screen reader|voiceover|nvda|jaws|in the app|reload the app|reload the page|bookmarks bar|on a phone|signed-in session/i) {
        $smell++; push @smell_ids, $id;
      }
    }
    if ($auto eq "yes" && $has_marker) { $ywm++; push @ywm_ids, $id; }
  }
  my $fbytes = -s $f;
  my $idlist = join(",", map { qq("$_") } @ids);
  my $payloadjson = join(",", map { qq("$_":$payload{$_}) } @ids);
  print qq({"file":"$f","cases":[$idlist],"bytes":$fbytes,"payloadBytes":{$payloadjson}}\n);
}
open(my $ef, ">", $envfile) or die "cannot write $envfile: $!";
print $ef "GRANDFATHERED=$grand\n";
print $ef "GRANDFATHERED_IDS=" . join(",", @grand_ids) . "\n";
print $ef "YES_MANUAL_SMELL=$smell\n";
print $ef "YES_MANUAL_SMELL_IDS=" . join(",", @smell_ids) . "\n";
print $ef "YES_WITH_MARKER=$ywm\n";
print $ef "YES_WITH_MARKER_IDS=" . join(",", @ywm_ids) . "\n";
print $ef "OVERSIZE_CASES=" . scalar(@oversize) . "\n";
print $ef "OVERSIZE_IDS=" . join(",", @oversize) . "\n";
print $ef "TOTAL_CASES=$total_cases\n";
close $ef;
PERL_EOF
scan_exit=$?

if [ "$scan_exit" -ne 0 ] || [ ! -s "$TMP/scan.env" ]; then
  failmsg "rule 6/7/11: the per-case scanner crashed (exit $scan_exit) - nothing below this line can be trusted"
  GRANDFATHERED=0; YES_MANUAL_SMELL=0; YES_WITH_MARKER=0; OVERSIZE_CASES=0; OVERSIZE_IDS=""; TOTAL_CASES=0
else
  # shellcheck source=/dev/null
  . "$TMP/scan.env"
fi

# ---- Rule 6: hard cap H, warn at split threshold S, fail on an oversize case.
for f in $(cat "$TMP/real_files.txt"); do
  fbytes=$(wc -c < "$f" | tr -d ' ')
  if [ "$fbytes" -gt "$H" ]; then
    failmsg "rule 6: $f is $fbytes bytes, over the hard cap H=$H - it cannot be enumerated inside the per-agent budget"
  elif [ "$fbytes" -gt "$S" ]; then
    warnmsg "rule 6: $f is $fbytes bytes, over the split threshold S=$S - schedule a sub-split at the end of this group"
  fi
done
if [ "${OVERSIZE_CASES:-0}" -gt 0 ]; then
  failmsg "rule 6: case(s) individually over S=$S, so their area can never be brought under S by any boundary choice: ${OVERSIZE_IDS:-}"
fi

# ---- Rule 7: ratchet the honesty-debt counts; never judge a case by name.
if [ "${GRANDFATHERED:-0}" -gt "$GRANDFATHERED_BASELINE" ]; then
  failmsg "rule 7: GRANDFATHERED=$GRANDFATHERED exceeds the baseline of $GRANDFATHERED_BASELINE (a new 'partly' case with no per-step manual marker) - ids: ${GRANDFATHERED_IDS:-}"
fi
if [ "${YES_MANUAL_SMELL:-0}" -gt "$YES_MANUAL_SMELL_BASELINE" ]; then
  failmsg "rule 7: YES_MANUAL_SMELL=$YES_MANUAL_SMELL exceeds the baseline of $YES_MANUAL_SMELL_BASELINE (an 'automatable: yes' case whose steps smell of a browser/app/devtools/screen reader) - ids: ${YES_MANUAL_SMELL_IDS:-}"
fi
if [ "${YES_WITH_MARKER:-0}" -gt "$YES_WITH_MARKER_BASELINE" ]; then
  failmsg "rule 7: YES_WITH_MARKER=$YES_WITH_MARKER exceeds the baseline of $YES_WITH_MARKER_BASELINE (an 'automatable: yes' case that contradicts itself with a per-step manual marker) - ids: ${YES_WITH_MARKER_IDS:-}"
fi

# ---------------------------------------------------------------------------
# Rule 8: no area: value ends in -<digits> - that suffix is reserved for
# sub-split parts, and rule 4's placement check is only correct because of it.
# ---------------------------------------------------------------------------
bad_area=$(find "$DIR" -name '*.md' -exec grep -ho '^### R-[0-9]* | area: [^|]*' {} + \
  | sed 's/.*area: //; s/[[:space:]]*$//' | sort -u | grep -E -- '-[0-9]+$')
if [ -n "$bad_area" ]; then
  failmsg "rule 8: area value(s) ending in a digit-suffix, which collides with the part-file convention: $(printf '%s' "$bad_area" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# Rule 9: every area file begins '### R-' at byte 0 - no title, no per-file
# preamble, no reflow. A single added heading line reds every case that
# follows it across the cat boundary.
# ---------------------------------------------------------------------------
while read -r f; do
  [ -n "$f" ] || continue
  head6=$(head -c 6 "$f")
  if [ "$head6" != "### R-" ]; then
    failmsg "rule 9: $f does not begin with '### R-' at byte 0"
  fi
done < "$TMP/real_files.txt"

# ---------------------------------------------------------------------------
# Rule 10: the index must never hardcode a next-free ID. It is appended to
# several times a day, so any literal ID written into it is wrong within
# hours (this is exactly how a prior revision of this plan quoted "R-380"
# and had that ID committed by someone else before the sentence was read).
# ---------------------------------------------------------------------------
if tr -d '\r' < "$INDEX" | grep -qiE 'next[-_ ]free[^\n]{0,40}\bR-[0-9]{3,}\b'; then
  failmsg "rule 10: $INDEX appears to hardcode a next-free case ID instead of computing it"
fi

# ---------------------------------------------------------------------------
# Rule 11: emit the per-file rows (already produced above) followed by the
# ratchet counts, and finish with FILES=<n> CASES=<n> as the unconditional
# last line - the caller's proof that this script ran to completion rather
# than dying partway through.
# ---------------------------------------------------------------------------
cat "$TMP/rows.ndjson"
echo "GRANDFATHERED=${GRANDFATHERED:-0}"
echo "YES_MANUAL_SMELL=${YES_MANUAL_SMELL:-0}"
echo "YES_WITH_MARKER=${YES_WITH_MARKER:-0}"
CASES="${TOTAL_CASES:-0}"
echo "FILES=$FILES CASES=$CASES"

exit $fail
