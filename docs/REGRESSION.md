# Regression Suite

The living record of behavior that must keep working. Stage 10 of the development
loop runs this whole document once per group, before that group is pushed.

**This file is the index. It contains no cases.** Every case lives under
`docs/regression/<area>.md` — one file per `area:` value, split further into
`<area>-2.md`, `<area>-3.md`, ... when an area grows past the split threshold in
`scripts/regression-integrity.sh` (rule 6). A case is always found with:

    grep -rn '^### R-NNN ' docs/regression/

The table at the bottom of this file records which file holds which area and ID
range, but **it is not the authority for that lookup** — `scripts/regression-integrity.sh`
checks it against the real directory, in both directions, on every run, and fails
if they disagree.

Rules:

- Acceptance criteria are appended here when a feature clears stage 9. A feature
  is not done until its AC lives under `docs/regression/`.
- Nothing is ever deleted because it became inconvenient. A case is removed only
  when the behavior it describes is deliberately retired, and the removal is
  stated in the commit that removes it.
- A case that cannot be automated still belongs here, marked `automatable: no`,
  with the manual steps written out. Blocked is not the same as passing.
- `scripts/regression-integrity.sh` must pass before this suite's stage-10 pass,
  and before push.

## Case format

Each case is one `###` heading followed by the three labelled blocks. The stage 10
workflow parses this shape, so keep it exact.

`parallel-safe: no` means the case cannot run beside another case: it builds, starts
or restarts a server, writes to a shared output directory such as `.next`, depends on
a specific working-tree state, or mutates files. Read-only inspection and scoped test
runs are `parallel-safe: yes`.

`automatable:` takes three values:

- `yes` — every step can run unattended (a real `npx vitest run ...` command, or
  equivalent).
- `no` — nothing in the case can run unattended; every step is manual.
- `partly` — some steps are automatable and some are not. Mark every manual step
  in the body as `` N. Manual (`automatable: no`): ... ``. That marker is what lets
  the runner execute the automatable steps and report the rest unrun, rather than
  silently skipping the case or silently counting the manual steps as passed.

## Appending a new case

1. **Pick the file.** Use the `area:` value of the nearest existing case for the
   same feature or defect. See every area and which file(s) it lives in with:

       grep -c '^### R-' docs/regression/*.md

   If the area has already been split into parts (`<area>-2.md`, `<area>-3.md`,
   ...), append to the **highest-numbered part**. If no existing area fits,
   create `docs/regression/<new-area>.md` and add its row to the index table
   below, **in the same commit**. There is no approval step for a new area.

2. **Compute the next free ID. Never write a literal ID into this file, into a
   case, or into a comment anywhere** — this document is appended to several
   times a day, so a number written down is wrong within hours. Compute it
   fresh, every time, from the live tree:

       expr $(grep -ho '^### R-[0-9]*' docs/regression/*.md | sed 's/### R-//' | sort -n | tail -1) + 1

   Zero-pad the result to at least 3 digits (`R-381`, never `R-81`) — the padding
   is what keeps a regression-case ID from colliding with the unpadded `R-N`
   review-finding IDs used elsewhere in this repo. IDs are never reused and never
   renumbered, including IDs that were skipped or belong to a case that was later
   retired — check the gap is not one of those before assuming it is free.

3. **Run `scripts/regression-integrity.sh` before you push.** It checks, among
   other things, that every file under `docs/regression/` is listed in the index
   below and every indexed file exists, that no case was duplicated or misfiled
   into the wrong area's file, and that IDs stay unique and zero-padded.

## Cases

Case bodies live under `docs/regression/<area>.md`, never in this file. The index
below records, for every file, which area it holds and which case IDs are in it.

| area | file | cases | ID ranges |
|---|---|---|---|
| ai-search | `docs/regression/ai-search.md` | 7 | R-203-209 |
| app-nav | `docs/regression/app-nav.md` | 1 | R-164 |
| autofill-a11y | `docs/regression/autofill-a11y.md` | 2 | R-311-312 |
| bl-feedback | `docs/regression/bl-feedback.md` | 5 | R-069-073 |
| body-language | `docs/regression/body-language.md` | 4 | R-065-068 |
| chat-a11y | `docs/regression/chat-a11y.md` | 3 | R-296, R-306-307 |
| chat-attachments | `docs/regression/chat-attachments.md` | 7 | R-286-291, R-294 |
| chat-platform-limits | `docs/regression/chat-platform-limits.md` | 3 | R-292-293, R-295 |
| chat-response-parsing | `docs/regression/chat-response-parsing.md` | 2 | R-284-285 |
| copilot-a11y | `docs/regression/copilot-a11y.md` | 6 | R-123-126, R-162, R-297 |
| copilot-answer | `docs/regression/copilot-answer.md` | 2 | R-264-265 |
| copilot-answer-cache | `docs/regression/copilot-answer-cache.md` | 2 | R-152, R-270 |
| copilot-answers | `docs/regression/copilot-answers.md` | 27 | R-322-337, R-352-362 |
| copilot-answers | `docs/regression/copilot-answers-2.md` | 10 | R-363-372 |
| copilot-audio | `docs/regression/copilot-audio.md` | 9 | R-034-039, R-043-044, R-144 |
| copilot-capture | `docs/regression/copilot-capture.md` | 1 | R-218 |
| copilot-code-language | `docs/regression/copilot-code-language.md` | 2 | R-274-275 |
| copilot-config | `docs/regression/copilot-config.md` | 2 | R-074, R-080 |
| copilot-cues | `docs/regression/copilot-cues.md` | 6 | R-224-229 |
| copilot-detection | `docs/regression/copilot-detection.md` | 1 | R-217 |
| copilot-diarization | `docs/regression/copilot-diarization.md` | 1 | R-219 |
| copilot-glossary | `docs/regression/copilot-glossary.md` | 14 | R-338-351 |
| copilot-interview-type | `docs/regression/copilot-interview-type.md` | 1 | R-304 |
| copilot-knowledge-base | `docs/regression/copilot-knowledge-base.md` | 7 | R-252-258 |
| copilot-live | `docs/regression/copilot-live.md` | 5 | R-139, R-142, R-216, R-263, R-268 |
| copilot-logs | `docs/regression/copilot-logs.md` | 2 | R-220, R-382 |
| copilot-manual-question | `docs/regression/copilot-manual-question.md` | 5 | R-182-186 |
| copilot-mobile | `docs/regression/copilot-mobile.md` | 6 | R-157-161, R-165 |
| copilot-practice | `docs/regression/copilot-practice.md` | 1 | R-163 |
| copilot-practice-speakers | `docs/regression/copilot-practice-speakers.md` | 4 | R-153-156 |
| copilot-predictions | `docs/regression/copilot-predictions.md` | 1 | R-237 |
| copilot-privacy | `docs/regression/copilot-privacy.md` | 4 | R-081, R-091, R-098, R-259 |
| copilot-questions | `docs/regression/copilot-questions.md` | 1 | R-262 |
| copilot-session | `docs/regression/copilot-session.md` | 1 | R-246 |
| copilot-speak-as | `docs/regression/copilot-speak-as.md` | 7 | R-230-236 |
| copilot-speaker-identity | `docs/regression/copilot-speaker-identity.md` | 6 | R-146-151 |
| cover-letter-grounding | `docs/regression/cover-letter-grounding.md` | 5 | R-001-002, R-004-006 |
| cover-letter-quality | `docs/regression/cover-letter-quality.md` | 1 | R-010 |
| cover-letter-structure | `docs/regression/cover-letter-structure.md` | 1 | R-003 |
| document-download | `docs/regression/document-download.md` | 1 | R-239 |
| document-preview-versions | `docs/regression/document-preview-versions.md` | 1 | R-278 |
| drive-client-state | `docs/regression/drive-client-state.md` | 1 | R-282 |
| drive-controls | `docs/regression/drive-controls.md` | 1 | R-280 |
| drive-foundation | `docs/regression/drive-foundation.md` | 1 | R-279 |
| drive-modal-mount | `docs/regression/drive-modal-mount.md` | 1 | R-283 |
| drive-routes | `docs/regression/drive-routes.md` | 1 | R-281 |
| engine-parity | `docs/regression/engine-parity.md` | 1 | R-007 |
| example | `docs/regression/example.md` | 1 | R-000 |
| experience-api | `docs/regression/experience-api.md` | 1 | R-188 |
| experience-askai | `docs/regression/experience-askai.md` | 1 | R-199 |
| experience-attachments | `docs/regression/experience-attachments.md` | 7 | R-192, R-200, R-214-215, R-238, R-240-241 |
| experience-attachments | `docs/regression/experience-attachments-2.md` | 2 | R-243-244 |
| experience-bulk | `docs/regression/experience-bulk.md` | 1 | R-196 |
| experience-context | `docs/regression/experience-context.md` | 1 | R-245 |
| experience-deck | `docs/regression/experience-deck.md` | 1 | R-198 |
| experience-markdown | `docs/regression/experience-markdown.md` | 1 | R-191 |
| experience-research | `docs/regression/experience-research.md` | 1 | R-197 |
| experience-schema | `docs/regression/experience-schema.md` | 2 | R-189, R-195 |
| experience-tab | `docs/regression/experience-tab.md` | 2 | R-193-194 |
| experience-tests | `docs/regression/experience-tests.md` | 1 | R-242 |
| experience-tree | `docs/regression/experience-tree.md` | 1 | R-187 |
| experience-tree-keyboard | `docs/regression/experience-tree-keyboard.md` | 1 | R-190 |
| feed-ingest | `docs/regression/feed-ingest.md` | 1 | R-202 |
| feed-ui | `docs/regression/feed-ui.md` | 4 | R-210-213 |
| file-size | `docs/regression/file-size.md` | 1 | R-026 |
| focus-ring | `docs/regression/focus-ring.md` | 1 | R-305 |
| formdialog-mobile | `docs/regression/formdialog-mobile.md` | 1 | R-303 |
| gates | `docs/regression/gates.md` | 1 | R-009 |
| gmail-oauth | `docs/regression/gmail-oauth.md` | 1 | R-277 |
| headless-tailoring | `docs/regression/headless-tailoring.md` | 1 | R-008 |
| hiring-email | `docs/regression/hiring-email.md` | 6 | R-028-033 |
| interview-copilot | `docs/regression/interview-copilot.md` | 1 | R-266 |
| interview-type | `docs/regression/interview-type.md` | 9 | R-084-086, R-090, R-092, R-269, R-271-273 |
| live-dashboard | `docs/regression/live-dashboard.md` | 2 | R-106, R-121 |
| live-pace | `docs/regression/live-pace.md` | 1 | R-102 |
| llm-grounding | `docs/regression/llm-grounding.md` | 1 | R-267 |
| manual-postings | `docs/regression/manual-postings.md` | 14 | R-167-171, R-173-181 |
| manual-tailoring | `docs/regression/manual-tailoring.md` | 1 | R-201 |
| meeting-a11y | `docs/regression/meeting-a11y.md` | 1 | R-302 |
| meeting-copilot | `docs/regression/meeting-copilot.md` | 4 | R-247-250 |
| mic-selection | `docs/regression/mic-selection.md` | 3 | R-101, R-107-108 |
| page-ranking | `docs/regression/page-ranking.md` | 1 | R-276 |
| persistence | `docs/regression/persistence.md` | 3 | R-017-019 |
| practice | `docs/regression/practice.md` | 1 | R-141 |
| practice-answer | `docs/regression/practice-answer.md` | 7 | R-048-053, R-059 |
| practice-capture | `docs/regression/practice-capture.md` | 3 | R-040-042 |
| practice-critique | `docs/regression/practice-critique.md` | 5 | R-054-056, R-058, R-128 |
| practice-dashboard | `docs/regression/practice-dashboard.md` | 5 | R-109-111, R-113, R-122 |
| practice-history | `docs/regression/practice-history.md` | 4 | R-060-063 |
| practice-notices | `docs/regression/practice-notices.md` | 2 | R-114, R-116 |
| practice-postings | `docs/regression/practice-postings.md` | 1 | R-045 |
| practice-privacy | `docs/regression/practice-privacy.md` | 2 | R-057, R-064 |
| practice-questions | `docs/regression/practice-questions.md` | 2 | R-046-047 |
| practice-setup | `docs/regression/practice-setup.md` | 1 | R-129 |
| preview-ai | `docs/regression/preview-ai.md` | 1 | R-015 |
| preview-concurrency | `docs/regression/preview-concurrency.md` | 5 | R-011-014, R-027 |
| regression-process | `docs/regression/regression-process.md` | 2 | R-260, R-381 |
| responsive-contract | `docs/regression/responsive-contract.md` | 3 | R-299-301 |
| sample-answer | `docs/regression/sample-answer.md` | 13 | R-082-083, R-087-089, R-097, R-117-120, R-130-132 |
| sample-answer | `docs/regression/sample-answer-2.md` | 5 | R-133-137 |
| sample-answer | `docs/regression/sample-answer-3.md` | 4 | R-138, R-140, R-143, R-298 |
| shared-text | `docs/regression/shared-text.md` | 1 | R-251 |
| sticky-question-strip | `docs/regression/sticky-question-strip.md` | 3 | R-313-314, R-320 |
| sticky-stats-row | `docs/regression/sticky-stats-row.md` | 6 | R-315-319, R-321 |
| stt-abstraction | `docs/regression/stt-abstraction.md` | 2 | R-075-076 |
| stt-diarization | `docs/regression/stt-diarization.md` | 1 | R-145 |
| stt-elevenlabs | `docs/regression/stt-elevenlabs.md` | 5 | R-077-079, R-127, R-261 |
| submitted-docs | `docs/regression/submitted-docs.md` | 6 | R-093-096, R-099-100 |
| tailoring-metadata | `docs/regression/tailoring-metadata.md` | 1 | R-016 |
| techwatch | `docs/regression/techwatch.md` | 2 | R-221-222 |
| test-infrastructure | `docs/regression/test-infrastructure.md` | 1 | R-172 |
| text-phrasing | `docs/regression/text-phrasing.md` | 1 | R-380 |
| tracking-a11y | `docs/regression/tracking-a11y.md` | 3 | R-308-310 |
| tracking-digest | `docs/regression/tracking-digest.md` | 1 | R-223 |
| version-diff | `docs/regression/version-diff.md` | 3 | R-023-025 |
| version-history | `docs/regression/version-history.md` | 3 | R-020-022 |

