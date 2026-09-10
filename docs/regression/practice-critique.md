### R-054 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** The critique response contract is enforced by the server on every path, and the engine that produced a critique is reported truthfully.

**Steps:**
1. Read `sanitizeCritique`, `sanitizeStar` and the branch structure in `hello-world/app/api/copilot/critique/route.js`.
2. Run `npx vitest run --no-file-parallelism app/api/copilot/critique/route.test.js` from `hello-world/`.

**Expected:** `source` is always set by the server from the path actually taken and is never read from the model, so a Gemini response claiming `source: "embedded"` cannot survive. `star` is null unless the question type is behavioral, on both paths. The score is clamped to an integer 0-100 and the arrays are capped, so no unexpected field from the model reaches the client. The response shape is identical across the embedded, Gemini and fallback paths.

### R-055 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** The critique never dead-ends and never leaks camera frames to a path that should not have them.

**Steps:**
1. Read the `wantsEmbedded` branch, `sanitizeFrames`, and the fallback handling in `hello-world/app/api/copilot/critique/route.js`.
2. Run `npx vitest run --no-file-parallelism app/api/copilot/critique/route.test.js` from `hello-world/`.

**Expected:** No signed-in user returns 401. The embedded engine returns the deterministic critique, never constructs a Gemini client, and never parses frames at all. Frames reach Gemini only on the non-embedded path, and a non-JPEG data URL, a payload that is not decodable base64, a non-string entry, and anything past the third frame are all dropped. A Gemini throw, an unparseable response, and malformed client metrics all still return a usable critique rather than a 5xx — inputs are normalized once, before either branch, so the fallback cannot fail the same way the primary did.

### R-056 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** The deterministic rubric — what a no-API-key deploy runs — states nothing about the candidate's answer that it did not measure, and never contradicts itself.

**Steps:**
1. Read `RESULT_PHRASE_RE` / `RESULT_METRIC_RE`, `SITUATION_RE`, `TECH_TRADEOFF_RE`, `structureStrengthText`, the posting-overlap term matching, and the relevance boilerplate filter in `hello-world/lib/copilot/critiqueLocal.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** A quantified result is detected anywhere in a sentence — "Support tickets fell by 40% after the change." and "It generated250,000 in new revenue." both set the result beat. "A complete STAR story" is claimed only when all four beats are present, never alongside a `missing` entry naming an absent beat. "I looked at the logs" does not credit a Situation beat, and a bare "however" or "although" does not credit a trade-off. Posting-vocabulary overlap matches on word boundaries with a minimum canonical length, so short taxonomy entries cannot match inside unrelated words and manufacture a strength. Interview-question boilerplate is stripped before relevance overlap, so a directly responsive answer is not told it drifted. The rubric is fully deterministic — identical inputs give an identical score AND identical wording — and the score stays an integer within 0-100 for an empty answer, a one-word answer, a 2000-word answer and an all-filler answer. An empty answer returns a low score, an honest verdict, empty strengths, and asserts nothing about prose that does not exist.

### R-058 | area: practice-critique | parallel-safe: yes | automatable: no

**Summary:** The shared prep context behaves like one value across both copilot views, and a deliberate deletion sticks.

**Steps:**
1. Read `usePrepContext` in `hello-world/app/copilot/usePrepContext.js`, specifically the listener store, the fallback latch, and how a stored empty string is distinguished from a never-written key.
2. Confirm `CopilotClient` wraps the setter only to clear its answer cache, and that the cache-clearing logic is not inside the hook.

**Expected:** The `/api/user-context` fallback runs at most once per mount and is not re-fired by the stored value changing, so clearing the textarea does not silently refill it from the account's saved context. The hook is a real external store — a module-level listener set, a subscribe that registers and unregisters, and a setter that notifies after writing — so an edit in practice mode is immediately visible to the live view mounted alongside it, and neither can overwrite the other with a stale value. Storage access stays wrapped in try/catch and the live path keeps the same storage key, the same fallback and the same answer-cache clearing on edit.

### R-128 | area: practice-critique | parallel-safe: yes | automatable: yes

**Summary:** A wpm no human voice can produce is flagged as an implausible measurement, not clamped into a smaller number and not asserted as delivery fact to the critique model.

**Steps:**
1. Read `MAX_PLAUSIBLE_WPM` and `paceIsPlausible` in `hello-world/lib/copilot/answerMetrics.js`, and `normalizeMetrics`'s/`buildDeliveryNotes`'s implausible-pace handling in `hello-world/lib/copilot/critiqueLocal.js`.
2. Run `npx vitest run --no-file-parallelism lib/copilot/answerMetrics.test.js lib/copilot/critiqueLocal.test.js` from `hello-world/`.

**Expected:** `computeAnswerMetrics` sets `paceIsPlausible: false` once `wordsPerMinute` exceeds 300 (a physical ceiling, distinct from the existing RUSHED_WPM_MIN=170 delivery band) — it never clamps the number itself, so a measurement fault stays visible as a fault instead of rendering as a plausible-looking, wrong one. `critiqueLocal.js`'s `normalizeMetrics` independently RE-DERIVES `paceIsPlausible` from the numeric `wordsPerMinute` it just normalized rather than trusting whatever a client payload claims, in both directions: a client that (falsely) claims `paceIsPlausible: true` at an impossible wpm is overridden to `false`, and a client that (incorrectly) flags a genuinely plausible wpm as implausible is overridden back to `true`. `buildDeliveryNotes` cites the wpm as fact ("You spoke for N seconds at N words per minute...") only when plausible; when not, it reports that speech was captured and that the pace measurement points to a data problem, without stating the impossible number — which is what keeps it out of `app/api/copilot/critique/route.js`'s "MEASURED DELIVERY METRICS... treat those numbers as ground truth" prompt section as a fact to cite. No score moves: `computePaceScore`/`computeDeliveryScore` still key off `paceLabel` alone, proven by a case that holds `paceLabel` fixed while flipping `wordsPerMinute` across the ceiling and asserting `critiqueAnswerLocal`'s score is byte-identical either way.

