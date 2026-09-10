### R-201 | area: manual-tailoring | parallel-safe: yes | automatable: yes

**Summary:** The manual tab accepts new postings while a tailor run is in flight.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/tailor/rollingQueue.test.js app/hooks/useManualPostings.test.js app/components/JobDescriptionTab.test.js`.

**Expected:** All pass, including the full journey in one test: paste, press Tailor, ADD A NEW BOX mid-run, paste, press Tailor again, and both postings tailor within a single pool with `running` transitioning to false exactly once.

Load-bearing specifics:

- `runWithConcurrency` is untouched. It is a batch primitive - a fixed array in, resolved when it drains - and its other callers depend on that. The rolling queue replaced it for this hook only.
- Enqueuing something already waiting does not inflate the total, or the progress readout never reaches its own target.
- The cap applies across the whole active period, not per press: two submissions of two must not put four model calls in flight.
- The period ends only when nothing is pending AND nothing is in flight. Checking one alone ends it early, sets the tally mid-flight, and flips the UI to idle while results are still arriving.
- A posting that already succeeded is not re-submitted.
- Locking is PER-ROW: only the box a worker owns is frozen.

**One correction recorded here deliberately:** a pre-existing test required the Add button to stay disabled during a run - the batch-era invariant this change removes. It was corrected into the two rules that now apply rather than deleted, and the reason is written into the test itself. Without that correction the feature was inert: you could not create the box for the second posting.

