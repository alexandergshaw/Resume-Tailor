// A DECISION RECORD CARRIES REASONS AND COUNTS -- NEVER CONTENT.
//
// ---------------------------------------------------------------------------
// WHY A SECOND, STRUCTURAL DEFENCE
// ---------------------------------------------------------------------------
// activityRedaction.js scrubs credential-SHAPED strings. It cannot stop a
// company name, a job title, a résumé sentence or a posting URL, because none of
// those look like a secret -- "Acme Corporation" is just words. A decision record
// exists to explain WHY the app did or did not act ("skipped, already applied");
// it has no business carrying the document text or the company the owner is
// applying to, and the downloaded activity log gets attached to a support ticket.
//
// duplicateApplyLogDocument.js already keeps content out by recording only a
// closed vocabulary of verdicts. This file pins the same posture for the
// app-wide decision seam: recordDecision(id, outcome, fields) keeps ONLY the
// field names the feature's DECISION_LEDGER entry declared, so content the record
// was never meant to carry cannot enter in the first place -- and the credential
// scrubber still runs on what remains, as a second, independent line.
//
// The recorder is exercised through createActivityLog (injectable, the
// appActivityLog.test.js idiom) so nothing here leans on the module singleton or
// a wall clock.

import { describe, it, expect } from "vitest";
import { createActivityLog } from "./appActivityLog.js";
import { redactSecretsDeep, REDACTED } from "./activityRedaction.js";
import * as channels from "./activityChannels.js";
import { secretLiteral } from "../../test/helpers/plantedSecrets.js";

function logAt(start = 1_700_000_000_000) {
  return createActivityLog({ now: () => start, startedAt: start });
}

// The decision the whole feature is modelled on: it already records today (the
// one production recordActivity call site), and its ledger entry is the concrete
// thing every assertion here reads its declared fields from.
const DUPE = "duplicate-check";
function dupeEntry() {
  const ledger = channels.DECISION_LEDGER;
  return Array.isArray(ledger) ? ledger.find((e) => e && e.id === DUPE) : undefined;
}

// The content a decision record must never carry, whatever field name it arrives
// under. None of these are credential-shaped, so ONLY the closed-vocabulary drop
// can keep them out -- the scrubber never would.
const CONTENT = {
  companyName: "Acme Corporation",
  postingUrl: "https://careers.acme.example.com/jobs/5521?ref=email",
  documentText: "Dear Hiring Manager, I am excited to apply for the Staff Engineer role...",
  factText: "Acme raised a $40M Series B led by Initech Ventures in 2025",
};
const CONTENT_LITERALS = Object.values(CONTENT);

// ===========================================================================
// GREEN CONTROLS -- prove the structural whitelist is not redundant with the
// scrubber, and prove the generic recorder does NOT already do this job. Both
// pass at HEAD, establishing that the red assertions below are testing a real,
// missing guarantee rather than one redaction already provides.
// ===========================================================================
describe("[control] the credential scrubber alone cannot keep content out", () => {
  it("leaves a company name, a posting URL and résumé prose completely untouched", () => {
    const out = redactSecretsDeep({ ...CONTENT });
    // If any of these WERE scrubbed, the whitelist would be redundant and the
    // red tests below would be testing nothing.
    expect(out.companyName).toBe(CONTENT.companyName);
    expect(out.factText).toBe(CONTENT.factText);
    expect(out.documentText).toBe(CONTENT.documentText);
    // The URL keeps its content too (redactSecretsDeep does not URL-scrub keys).
    expect(out.postingUrl).toContain("careers.acme.example.com");
  });

  it("the generic record() keeps whatever fields it is handed -- so it is NOT the guard", () => {
    // recordActivity/record deliberately record arbitrary feature fields. That
    // is correct for the general channel and is exactly why a decision needs a
    // DIFFERENT, field-restricting entry point.
    const log = logAt();
    log.record("act", "anything", { companyName: "Acme Corporation", reason: "x" });
    const [entry] = log.snapshot().events;
    expect(entry.companyName).toBe("Acme Corporation");
  });
});

// ===========================================================================
// RED at HEAD -- log.recordDecision does not exist yet. Each call throws inside
// its `it`, so every red is a clean assertion/throw, never a collection error.
// ===========================================================================
describe("[THE DEFINITION] recordDecision carries reasons and counts", () => {
  it("keeps the declared reason and count fields", () => {
    const entry = dupeEntry();
    expect(entry, "DECISION_LEDGER has no duplicate-check entry to drive this test").toBeTruthy();
    // Item 5's own words: a decision record carries "reasons and counts".
    expect(entry.fields, "duplicate-check does not declare a reason field").toContain("reason");
    expect(entry.fields, "duplicate-check does not declare a count field").toContain("count");

    const log = logAt();
    log.recordDecision(DUPE, "skipped", { reason: "same position seen earlier this session", count: 2 });
    const [ev] = log.snapshot().events;
    expect(ev.reason).toBe("same position seen earlier this session");
    expect(ev.count).toBe(2);
  });

  it("records on the act channel and stamps the id and outcome into the type", () => {
    const log = logAt();
    log.recordDecision(DUPE, "refused", { reason: "already applied to this posting" });
    const [ev] = log.snapshot().events;
    expect(ev.channel).toBe("act");
    expect(ev.type).toContain(DUPE);
    expect(ev.type).toContain("refused");
    expect(ev.reason).toBe("already applied to this posting");
  });
});

describe("[THE DEFINITION] recordDecision drops content it was never meant to carry", () => {
  it("keeps a declared reason but drops company, URL, document and fact text", () => {
    const log = logAt();
    log.recordDecision(DUPE, "skipped", { reason: "duplicate detected", ...CONTENT });
    const snap = log.snapshot();
    const [ev] = snap.events;
    expect(ev.reason).toBe("duplicate detected"); // the declared field survives
    // None of the content field NAMES made it onto the event...
    expect(ev.companyName).toBeUndefined();
    expect(ev.postingUrl).toBeUndefined();
    expect(ev.documentText).toBeUndefined();
    expect(ev.factText).toBeUndefined();
    // ...and none of the content VALUES leaked anywhere into the snapshot, which
    // is the object the downloaded, shareable file is built from.
    const rendered = JSON.stringify(snap);
    for (const literal of CONTENT_LITERALS) {
      expect(rendered, `content "${literal.slice(0, 24)}..." leaked into the decision record`).not.toContain(literal);
    }
  });

  it("carries no content when the decision id is unknown to the ledger", () => {
    // A decision the ledger never declared has an empty field vocabulary, so it
    // can leak nothing -- a fail-closed default rather than fail-open.
    const log = logAt();
    log.recordDecision("no-such-feature", "refused", { reason: "whatever", ...CONTENT });
    const rendered = JSON.stringify(log.snapshot());
    for (const literal of CONTENT_LITERALS) {
      expect(rendered, "an unknown decision id leaked content").not.toContain(literal);
    }
    // ...but the record still exists, so the gap is visible as a record rather
    // than a silence -- never dropped outright.
    expect(log.snapshot().events.length).toBe(1);
  });
});

describe("[THE DEFINITION] the scrubber still runs on what survives the whitelist", () => {
  it("redacts a credential that arrives inside a declared field", () => {
    // Defence in depth: even a legitimately-declared field (reason) must not
    // become a hole for a credential-shaped value echoed from an error string.
    const jwt = secretLiteral("supabase-anon-jwt");
    const log = logAt();
    log.recordDecision(DUPE, "failed", { reason: `provider rejected token ${jwt}` });
    const snap = log.snapshot();
    const rendered = JSON.stringify(snap);
    expect(rendered, "a credential in a declared field was not scrubbed").not.toContain(jwt);
    expect(snap.events[0].reason).toContain(REDACTED);
    // The surrounding diagnostic is kept -- redaction, not deletion.
    expect(snap.events[0].reason).toContain("provider rejected token");
  });
});

describe("[THE DEFINITION] a decision record is total, never breaking its caller", () => {
  it("normalizes an out-of-vocabulary outcome without dropping the record", () => {
    const log = logAt();
    log.recordDecision(DUPE, "banana", { reason: "unexpected" });
    const [ev] = log.snapshot().events;
    expect(log.snapshot().events.length).toBe(1); // recorded, not dropped
    expect(ev.type, "an invalid outcome leaked into the type verbatim").not.toContain("banana");
  });

  it("never throws on junk arguments", () => {
    const log = logAt();
    expect(() => log.recordDecision()).not.toThrow();
    expect(() => log.recordDecision(null, null, null)).not.toThrow();
    expect(() => log.recordDecision(DUPE, "refused", "not an object")).not.toThrow();
  });
});
