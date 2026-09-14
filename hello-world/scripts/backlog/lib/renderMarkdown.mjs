// GENERATED SOURCE (this file itself is hand-authored, but its four string blocks were
// extracted mechanically from the pre-migration docs/BACKLOG.md rather than hand-retyped, to
// remove transcription risk from the byte-for-byte drift check). Reproduces docs/BACKLOG.md from
// parsed backlog.yml items: four static prose blocks (unchanged since migration) surrounding three
// generated tables (Next — actionable, Owner decisions, Verification owed).
import { compareIds } from "./idOrder.mjs";

export const GENERATED_HEADER =
  "<!-- GENERATED FROM docs/backlog.yml by hello-world/scripts/backlog/render.mjs — DO NOT HAND-EDIT -->";

const BLOCK_A = "# Backlog\n\nThe queue of work this repo owes: **what is owed, by whom, and measured how.**\n\nRead this **before starting anything** (step 0 of the dev loop). An item that lives only in a scratchpad, a\nsubagent report, or a chunk's own criteria is a deletion with extra steps — nothing reads those at the start of\nthe next piece of work.\n\n## Rules for this file\n\n1. **Every quantity names its command or `file:line`.** A number without an instrument rots silently, and this\n   repo has already shipped counts that were wrong in three documents at once.\n2. **Record at disposal, reconcile at the push.** When a check or a round disposes of a finding as \"later\",\n   append it here *then* — not at the end. Residuals are created many waves before a push.\n3. **No diary.** This is not a log of what was done. Closed items are deleted, not archived. Use `git log` for\n   history.\n4. **Owner-only items are never started by an agent.** They are listed so they are not forgotten, not so they\n   are picked up.\n5. **The loop does not stop while this file has entries.** Finishing a chunk is not finishing the work — the\n   next action is always the next backlog item. See \"How the loop consumes this file\" below.\n\n## How the loop consumes this file\n\n**While this file is non-empty, the dev loop does not stop.** At the end of every chunk, wave, or ruling, the\nnext action is read off this file rather than chosen freshly.\n\n| Section | What the loop does |\n|---|---|\n| **Next — actionable now** | Work it. Top to bottom unless a dependency says otherwise. This is where the loop spends its time. |\n| **Owner decisions outstanding** | **Never started.** When these are all that remain, the loop's action is to **put them to the owner as a decision** — once, with what is blocked and what would unblock it. Escalating is a step; idling is not. |\n| **Verification owed** | Same: surface it, with the exact instrument the owner would run. |\n\n**The loop ends a turn only after it has either advanced an actionable item or escalated a blocked one.**\nStopping with actionable entries present and neither done is the failure this rule exists to prevent.\n\n### Disjoint items are worked SIMULTANEOUSLY\n\nThe loop does not work the backlog one item at a time when items do not touch each other. Before dispatching,\ncompute each candidate item's **file set** and run them together when the sets do not intersect.\n\n**Disjointness has two halves, and both must hold. File-disjoint alone is not enough** — that lesson cost this\nrepo a whole contract mechanism when two design seats with non-overlapping outputs produced two incompatible\nschemas for the same table, because each was designing against facts the other was still establishing.\n\n1. **Exact-path disjointness — computed, never eyeballed.** An item's set is *the files it edits* **plus the\n   tests that assert on the behaviour it changes**. Intersect the sets mechanically (`sort | uniq -d`, empty\n   output) and paste the result.\n2. **Informational independence.** Ask of each pair: *does either establish a fact the other designs against?*\n   If yes they are coupled however disjoint their files are — sequence them, or extract the shared contract\n   into its own earlier step, alone.\n\n**Cap a simultaneous wave at 2–3 items.** A larger fan-out has produced duplicated discovery here — three\nagents independently finding the same blocker, and one designing a solution to a problem a sibling was\nconcurrently proving did not exist.\n\n**Worked example, run 2026-09-13 — and it refuted the obvious answer.** `SEC-1` (item 1) looked like the ideal\nparallel candidate: a one-file resolver fix, unrelated to interview-prep. Computed:\n`grep -rln \"featureEngine\\|wantsEmbedded\" --include=*.js app lib` → **58 files** (canary\n`zzNoSuchSymbolzz` → 0), and the set **includes `app/api/interview-prep/route.test.js` and\n`lib/copilot/groundingNotice.js`** — files IP3 and IP-N own. **Not disjoint.** SEC-1 waits.\nItems 2 and 3 (`scripts/regression/**` and a regression AC ruling) *are* disjoint from IP3's\n`lib/interviewPrep/**`, and run alongside it.\n\n**A blocked item is escalated once, not repeatedly.** Re-asking the same unanswerable question every turn is\nspinning wearing a decision's clothes. Once surfaced, it stays listed and silent until the owner answers or the\nblocker clears.\n\n---\n\n## Next — actionable now\n\n| # | Item | Owed by | Measured how |\n|---|---|---|---|";
const BLOCK_B = "\n## Owner decisions outstanding\n\n| # | Question | Why it is blocked |\n|---|---|---|";
const BLOCK_C = "\n## Verification owed\n\n| # | Item | Measured how |\n|---|---|---|";
const BLOCK_D = "\n## Standing hazards — re-read before trusting a number\n\n- **An instrument here is defective until a constructed mutant kills it.** The author's own claim that a mutant\n  dies is not evidence: one wave reported a kill in good faith and the real mutant survived, because the mutant\n  tested was easier than the named one (ledger `T3-S9-3`).\n- **A count beside a list it does not match** has occurred three times — a table heading, a column enumeration,\n  and a ledger figure asserted as 4 where `grep -c \"module:\"` returns **5**.\n- **A claim restated from another document is not verified.** Six false claims propagated here purely by\n  restatement, each one grep-checkable. Run the grep with a canary before repeating a fact.\n- **Ruling on a check's blockers alone silently drops its majors.** Nine majors once sat unrouted through three\n  revisions because a ruling answered only the blockers, and everything downstream read the check as handled.";

function nextRow(it) {
  return `| ${it.id} | ${it.title} | ${it.owed_by} | ${it.evidence.join("; ")} |`;
}
function ownerRow(it) {
  return `| ${it.id} | ${it.title} | ${it.blocked_reason} |`;
}
function verificationRow(it) {
  return `| ${it.id} | ${it.title} | ${it.instrument} |`;
}

/** Pure: parsed backlog.yml items -> the exact docs/BACKLOG.md markdown text. */
export function renderMarkdown(items) {
  const n = items.filter((it) => it.state === "actionable").sort((a, b) => compareIds(a.id, b.id));
  const d = items.filter((it) => it.state === "owner").sort((a, b) => compareIds(a.id, b.id));
  const v = items.filter((it) => it.state === "verification").sort((a, b) => compareIds(a.id, b.id));

  const parts = [
    GENERATED_HEADER,
    "",
    BLOCK_A,
    ...n.map(nextRow),
    BLOCK_B,
    ...d.map(ownerRow),
    BLOCK_C,
    ...v.map(verificationRow),
    BLOCK_D,
  ];
  return parts.join("\n") + "\n";
}
