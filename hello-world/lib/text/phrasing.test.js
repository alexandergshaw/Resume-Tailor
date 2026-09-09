import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { hashString, pick, pickDistinct } from "./phrasing.js";

describe("hashString", () => {
  it("is stable and differs across inputs", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    expect(typeof hashString("x")).toBe("number");
  });
});

describe("pick", () => {
  const opts = ["one", "two", "three", "four"];

  it("is deterministic for a given seed", () => {
    expect(pick("Acme", opts)).toBe(pick("Acme", opts));
  });

  it("varies the choice across different seeds", () => {
    const chosen = new Set(["Acme", "Globex", "Initech", "Umbrella", "Stark"].map((s) => pick(s, opts)));
    expect(chosen.size).toBeGreaterThan(1);
  });

  it("handles empty option lists", () => {
    expect(pick("x", [])).toBe("");
    expect(pick("x", null)).toBe("");
  });
});

describe("pickDistinct", () => {
  // `proven(seed, options, n)` is `pickDistinct(seed, options, n)` with the
  // termination gate in front of it - see the header comment below. EVERY
  // in-process call to the real function in this file goes through it,
  // including these two, which pre-date the gate and used to run ungated.
  //
  // The second one asks for n = 5 from a 2-entry array: the OVER-ASK shape.
  // `n` is clamped to the array length by `Math.min(n, list.length)`, and in
  // the defective source that clamp lives INSIDE the unbounded `while`
  // condition - so a fix that replaces the loop deletes the clamp unless it
  // notices, and this call then spins forever. Ungated, that took the whole
  // vitest run down with 171 bytes of output and no `Tests` line at all.
  it("returns n distinct options, deterministically", () => {
    const a = proven("seed", ["a", "b", "c", "d"], 2);
    const b = proven("seed", ["a", "b", "c", "d"], 2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(new Set(a).size).toBe(2);
  });

  it("caps at the number of available options", () => {
    expect(proven("seed", ["a", "b"], 5)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// HOW THESE TESTS AVOID HANGING THE SUITE, AND WHY THAT SHAPE IS LOAD-BEARING.
//
// `pickDistinct` retries on index collision inside a `while` loop with no
// iteration bound. If the generator behind it cannot reach every index of the
// options array, that loop never collects `n` distinct entries and never
// returns. Calling it straight from a test would not produce a red test - it
// would wedge the worker, take the whole run down with it, and read as CI
// infrastructure trouble rather than as this defect. A test that hangs is
// worse than no test.
//
// So NO TEST IN THIS FILE CALLS THE REAL FUNCTION IN-PROCESS ON A SHAPE THAT
// HAS NOT ALREADY BEEN PROVEN TO TERMINATE - and that is NOT a promise made in
// prose. Prose cannot fail. It is enforced by `proven()` below, which throws
// with a diagnosis when asked for an unproven shape, so a drifted or forgotten
// gate turns into a red test instead of a silent hole. The mechanism:
//
//   1. Every call shape is exercised first in a CHILD PROCESS, under
//      spawnSync's hard `timeout`. A spin there is killed by the OS after
//      SHAPE_TIMEOUT_MS. The child writes each result with fs.writeSync to fd
//      1 - a synchronous syscall, not Node's buffered async stdout - so
//      results produced BEFORE the kill survive it and we learn exactly which
//      shape wedged rather than only that something did.
//      "Every call shape" means all of them, not just the convenient ones:
//      n = 1..length, the default-n shape, the OVER-ASK shapes (n > length),
//      the degenerate shapes (empty / null / undefined) and the seed fan.
//   2. One child per length, so a hang at one length costs one timeout and
//      does not hide the lengths after it.
//   3. A missing result is the failure signal, asserted loudly by length.
//   4. The in-process assertions are GATED on the child having completed that
//      exact shape. `pickDistinct` is pure and deterministic, so same code +
//      same inputs means: if the child terminated, the in-process call
//      terminates too. That gate is what makes calling it in-process safe.
//   5. A child that does not deliver is NOT assumed to have hung. `result.error`
//      (spawn failure vs ETIMEDOUT), `result.status`, `result.signal` and
//      `result.stderr` are all captured, and the failure text says WHICH of
//      "the function hung", "the child crashed", "the spawn failed" and "the
//      machine was too slow" actually happened. A crash inside a candidate fix
//      used to surface here as "the harness is broken", pointing the
//      implementer at the wrong file.
//
// These tests assert BEHAVIOUR only - what came back for a given seed and
// options array. They deliberately do not pin the generator's constants or its
// internal structure: a correct fix may legitimately replace the whole
// generator, and a test that forbids that is a test that forbids the fix.
// ---------------------------------------------------------------------------

const LENGTHS = Array.from({ length: 20 }, (_, i) => i + 1);
// "seed" is in here because the two `pickDistinct` tests above use it: a shape
// is only proven for the exact seed the child ran, so the seed list has to
// cover every seed this file calls the real function with.
const SEEDS = ["Acme", "Globex", "manager", "tech-lead", "Senior Software Engineer", "", "seed"];

// n greater than options.length. Swept for every length and seed, because this
// is the shape whose clamp is easiest to delete by accident (see above).
// Offset 3 is what makes `pickDistinct("seed", ["a","b"], 5)` a proven shape.
const OVER_ASK_OFFSETS = [1, 3, 5];

// The child that runs length 1 also runs the degenerate shapes, so that the
// three ungated `pickDistinct("x", [])` / `(..., null)` / `(..., undefined)` calls in
// the last describe are proven too. An implementation that takes `h % list.length`
// without a zero guard spins on an empty array exactly the way the real defect
// does, and length 1 is the trivially safe length under any generator.
const DEGENERATE_LENGTH = 1;

// SEED SENSITIVITY (see the "varies with the seed" test). A fan of unrelated
// seeds, swept in the child at three lengths, none of them divisible by 4 so
// the property is measurable even while the reachability defect is unfixed.
// 5 is the length production actually uses (lib/copilot/roleSituations.js).
const FAN_SEEDS = Array.from({ length: 40 }, (_, i) => `fan-seed-${i}`);
const FAN_LENGTHS = [5, 9, 13];

// Bars set from MEASUREMENT, not from taste. Across these 40 seeds, four
// structurally different correct implementations (seeded Fisher-Yates,
// decorate-sort-undecorate, pool-splice, and the shipped generator itself)
// produce, at lengths 5/9/13:
//     distinct orders        37/40/40 | 9/15/27 | 30/40/40 | 33/40/40
//     distinct first entries    5/9/13 |  5/8/11 |   5/9/13 |   5/9/13
//     largest shared order      2/1/1  |  6/4/3  |   3/1/1  |   4/1/1
// The worst of those is decorate-sort-undecorate, and it is a legitimate
// implementation - so "every seed yields a different permutation" would be a
// bar that FAILS CORRECT CODE, and is not the property asserted here. A
// seed-blind implementation scores 1 / 1 / 40 on all three at every length,
// which is nowhere near any of these bars.
const FAN_MIN_DISTINCT_ORDERS = 4;
const FAN_MIN_DISTINCT_FIRST_ENTRIES = 4;
const FAN_MAX_SEEDS_SHARING_ONE_ORDER = FAN_SEEDS.length / 2;

// 10s, not 2s. Measured on this machine with this sweep: the slowest child
// takes tens of milliseconds idle and ~537ms under 2x CPU oversubscription, and
// the full suite runs 659 files in parallel. At 2000ms the headroom collapsed
// to 3.7x under load, and a loaded machine then turns 5 tests red against a
// FULLY CORRECT implementation with every message claiming the function hung.
// At 10s the headroom under the same load is ~15x. A timeout can only remove
// rows and missing rows are always failures, so a slow machine can never
// produce a false GREEN here - only a false RED, which is why the budget is
// generous. If these tests go red, read the diagnosis: it says whether the
// machine was slow. DO NOT respond to a red by raising this number.
const SHAPE_TIMEOUT_MS = 10_000;
// Worst case is every length timing out: 20 x SHAPE_TIMEOUT_MS, plus headroom.
const SWEEP_BUDGET_MS = LENGTHS.length * SHAPE_TIMEOUT_MS + 120_000;

const optionsOfLength = (length) => Array.from({ length }, (_, i) => `opt${i}`);

// Runs in a child process. Sweeps every explicit `n` from 1 to the length, then
// the DEFAULT-n shape (`pickDistinct(seed, options)`) - the dangerous call
// shape, because `n` defaults to `options.length` - then the degenerate shapes
// (length 1 only), then the seed fan, then the OVER-ASK shapes.
//
// TWO ORDERING DECISIONS, both load-bearing:
//   - The riskiest shapes go LAST, so a spin in one of them still leaves every
//     earlier row on fd 1 and the failure names the shape that actually wedged.
//   - The ladder is walked n-MAJOR, not seed-major. Walking it seed-major means
//     a spin at n=3 kills the child before any other seed is measured at all,
//     so shapes that are perfectly safe go unproven and the gate then refuses
//     calls that would have been fine. n-major costs nothing and every seed
//     gets to report its own first-unsatisfiable n.
const CHILD_SCRIPT = `
const { pickDistinct } = await import(process.env.PHRASING_URL);
const { writeSync } = await import("node:fs");
const length = Number(process.env.SWEEP_LENGTH);
const seeds = JSON.parse(process.env.SWEEP_SEEDS);
const fanSeeds = JSON.parse(process.env.SWEEP_FAN_SEEDS);
const overAsk = JSON.parse(process.env.SWEEP_OVER_ASK);
const options = Array.from({ length }, (_, i) => "opt" + i);
const emit = (row) => writeSync(1, JSON.stringify(row) + "\\n");
for (let n = 1; n <= length; n += 1) {
  for (const seed of seeds) emit({ seed, n, got: pickDistinct(seed, options, n) });
}
for (const seed of seeds) emit({ seed, n: "default", got: pickDistinct(seed, options) });
if (process.env.SWEEP_DEGENERATE === "1") {
  emit({ lenKey: "0", seed: "x", n: "default", got: pickDistinct("x", []) });
  emit({ lenKey: "null", seed: "x", n: "default", got: pickDistinct("x", null) });
  emit({ lenKey: "undefined", seed: "x", n: "default", got: pickDistinct("x", undefined) });
}
for (const seed of fanSeeds) emit({ seed, n: "fan", got: pickDistinct(seed, options) });
for (const seed of seeds) {
  for (const extra of overAsk) {
    emit({ seed, n: length + extra, got: pickDistinct(seed, options, length + extra) });
  }
}
`;

// key: \`\${length}|\${seed}|\${n}\` -> the array the child got back.
const completed = new Map();
const unfinishedLengths = [];
// length -> what the child process actually did, so a red can say which of
// "hung", "crashed", "spawn failed" and "too slow" happened.
const childOutcome = new Map();
let slowestFinishedChildMs = 0;

const shapeKey = (length, seed, n) => `${length}|${seed}|${n}`;
// The length half of a key, for an arbitrary `options` argument: a number for a
// real array, the literal "null"/"undefined" for the degenerate calls.
const optionsKey = (options) => (Array.isArray(options) ? options.length : String(options));
const callKey = (seed, options, n) => shapeKey(optionsKey(options), seed, n === undefined ? "default" : n);

// Every shape the child is expected to emit for this length. A missing key is
// the failure signal; nothing here is "counted" approximately.
function expectedKeysFor(length) {
  const keys = [];
  for (const seed of SEEDS) {
    for (let n = 1; n <= length; n += 1) keys.push(shapeKey(length, seed, n));
    keys.push(shapeKey(length, seed, "default"));
  }
  if (length === DEGENERATE_LENGTH) {
    keys.push(shapeKey("0", "x", "default"), shapeKey("null", "x", "default"), shapeKey("undefined", "x", "default"));
  }
  if (FAN_LENGTHS.includes(length)) {
    for (const seed of FAN_SEEDS) keys.push(shapeKey(length, seed, "fan"));
  }
  for (const seed of SEEDS) {
    for (const extra of OVER_ASK_OFFSETS) keys.push(shapeKey(length, seed, length + extra));
  }
  return keys;
}

function sweepLength(length) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", CHILD_SCRIPT], {
    timeout: SHAPE_TIMEOUT_MS,
    encoding: "utf8",
    env: {
      ...process.env,
      PHRASING_URL: new URL("./phrasing.js", import.meta.url).href,
      SWEEP_LENGTH: String(length),
      SWEEP_SEEDS: JSON.stringify(SEEDS),
      SWEEP_FAN_SEEDS: JSON.stringify(FAN_LENGTHS.includes(length) ? FAN_SEEDS : []),
      SWEEP_OVER_ASK: JSON.stringify(OVER_ASK_OFFSETS),
      SWEEP_DEGENERATE: length === DEGENERATE_LENGTH ? "1" : "0",
    },
  });
  const elapsedMs = Date.now() - startedAt;
  for (const line of String(result.stdout || "").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    completed.set(shapeKey(row.lenKey === undefined ? length : row.lenKey, row.seed, row.n), row.got);
  }
  const expected = expectedKeysFor(length);
  const missing = expected.filter((key) => !completed.has(key));
  childOutcome.set(length, {
    errorCode: result.error ? result.error.code || "UNKNOWN" : null,
    errorMessage: result.error ? String(result.error.message || "") : "",
    status: result.status,
    signal: result.signal,
    stderr: String(result.stderr || "").trim(),
    elapsedMs,
    delivered: expected.length - missing.length,
    expected: expected.length,
  });
  // Only a child that ran to completion says anything about how fast this
  // machine is. A killed one tells us nothing except that it was killed.
  if (!result.error && result.status === 0 && missing.length === 0) {
    slowestFinishedChildMs = Math.max(slowestFinishedChildMs, elapsedMs);
  }
  if (missing.length) unfinishedLengths.push(length);
}

// The short form, for per-shape failure lines: WHICH failure mode, in a few
// words. Never claims a timeout it did not observe.
function verdictFor(length) {
  const outcome = childOutcome.get(length);
  if (!outcome) return "NOT SWEPT (no child was run for this length)";
  if (outcome.errorCode && outcome.errorCode !== "ETIMEDOUT") return `SPAWN FAILED (${outcome.errorCode})`;
  if (outcome.errorCode === "ETIMEDOUT") return `FUNCTION HUNG (child killed at ${SHAPE_TIMEOUT_MS}ms)`;
  if (outcome.status !== 0) return `CHILD CRASHED (exit ${outcome.status}${outcome.signal ? `, signal ${outcome.signal}` : ""})`;
  return "INCOMPLETE (child exited 0 without emitting every shape)";
}

// The long form, reported once per unfinished length.
function diagnosisFor(length) {
  const outcome = childOutcome.get(length);
  if (!outcome) {
    return `length ${length}: no child process was ever run for this length. The sweep itself did not reach it.`;
  }
  const where = `delivered ${outcome.delivered}/${outcome.expected} shapes in ${outcome.elapsedMs}ms of the ${SHAPE_TIMEOUT_MS}ms budget`;
  if (outcome.errorCode && outcome.errorCode !== "ETIMEDOUT") {
    return (
      `length ${length}: THE SPAWN FAILED (${outcome.errorCode}: ${outcome.errorMessage}). ` +
      `This is an environment or harness fault - antivirus, a missing node binary, handle exhaustion - ` +
      `and NOT a defect in pickDistinct. Fix the environment; do not change phrasing.js. It ${where}.`
    );
  }
  if (outcome.errorCode === "ETIMEDOUT") {
    const budgetShare = slowestFinishedChildMs / SHAPE_TIMEOUT_MS;
    const machineNote =
      slowestFinishedChildMs > 0
        ? budgetShare > 0.25
          ? `WARNING: the slowest child that DID finish took ${slowestFinishedChildMs}ms, over a quarter of the budget - THE MACHINE MAY SIMPLY BE TOO SLOW (or too loaded). Re-run on an idle machine before believing this is a hang. Do NOT raise SHAPE_TIMEOUT_MS to make it green.`
          : `The slowest child that DID finish took ${slowestFinishedChildMs}ms, about ${Math.round(SHAPE_TIMEOUT_MS / Math.max(slowestFinishedChildMs, 1))}x under budget, so this is not a slow machine: pickDistinct really did not return.`
        : outcome.delivered > 0
          ? `No child completed its whole shape list, so there is no timing baseline - but this one still delivered ${outcome.delivered} shapes before the kill, which proves the spawn and the harness are working. THE MACHINE IS NOT THE PROBLEM: the function did not return.`
          : "No child delivered a single shape, so there is no evidence the harness works at all - suspect the environment or this test file before the implementation.";
    return `length ${length}: THE FUNCTION HUNG. The child was killed by the ${SHAPE_TIMEOUT_MS}ms timeout${outcome.signal ? ` (signal ${outcome.signal})` : ""} and ${where}. ${machineNote}`;
  }
  if (outcome.status !== 0) {
    const stderrHead = outcome.stderr.split("\n").slice(0, 6).join(" | ") || "(stderr was empty)";
    return (
      `length ${length}: THE CHILD CRASHED - it exited with status ${outcome.status}${outcome.signal ? ` (signal ${outcome.signal})` : ""} and ${where}. ` +
      `This is a THROW, not a hang: look for a syntax or runtime error in phrasing.js, not for an unbounded loop. stderr: ${stderrHead}`
    );
  }
  return (
    `length ${length}: THE CHILD EXITED CLEANLY (status 0) but only ${where}. ` +
    `The sweep script and expectedKeysFor() disagree about which shapes are emitted - that is a fault in THIS TEST FILE, not in phrasing.js.`
  );
}

// The executable form of the header comment: refuse to call the real function
// on a shape the child has not already finished. Throwing here is a red test
// with an explanation; calling anyway would be a wedged run with no output.
function proven(seed, options, n) {
  const key = callKey(seed, options, n);
  if (!completed.has(key)) {
    const lengthKey = optionsKey(options);
    const diagLength = LENGTHS.includes(Number(lengthKey)) ? Number(lengthKey) : DEGENERATE_LENGTH;
    throw new Error(
      `REFUSING to call pickDistinct in-process on the unproven shape "${key}" ` +
        `(seed ${JSON.stringify(seed)}, options ${Array.isArray(options) ? `of length ${lengthKey}` : lengthKey}, ` +
        `n ${n === undefined ? "default (= options.length)" : n}). The child sweep never completed it, so calling it ` +
        `here could wedge the entire run instead of failing. ${diagnosisFor(diagLength)}`,
    );
  }
  return n === undefined ? pickDistinct(seed, options) : pickDistinct(seed, options, n);
}

beforeAll(() => {
  for (const length of LENGTHS) sweepLength(length);
  // The harness itself must be working. If the child could not run at all -
  // a bad module URL, a spawn failure - every length would look "hung" and
  // this file would report the defect everywhere while measuring nothing.
  // Length 1 is trivially safe under any generator, so it is the canary.
  if (!completed.has(shapeKey(1, "Acme", "default"))) {
    throw new Error(
      "phrasing sweep produced no result even for length 1, which is trivially safe under any generator. " +
        `That means the MEASUREMENT failed, not necessarily pickDistinct. ${diagnosisFor(1)}`,
    );
  }
}, SWEEP_BUDGET_MS);

describe("pickDistinct - terminates and returns every option (the default-n shape)", () => {
  // `n` defaults to `options.length`, so `pickDistinct(seed, list)` is the
  // shape that asks for a full permutation. lib/copilot/roleSituations.js
  // makes exactly this request on every /api/copilot/role-situation call.
  it("returns options.length distinct entries for every length 1..20, across seeds", () => {
    const offenders = [];
    for (const length of LENGTHS) {
      const options = optionsOfLength(length);
      for (const seed of SEEDS) {
        const got = completed.get(shapeKey(length, seed, "default"));
        if (got === undefined) {
          offenders.push(`length ${length}, seed ${JSON.stringify(seed)}: no result - ${verdictFor(length)}`);
          continue;
        }
        // POSITIVE CONTROL: not merely "it came back", but what it came back
        // WITH. An implementation that returned early with a short array would
        // satisfy "did not hang" and must not pass here.
        if (got.length !== length || new Set(got).size !== length) {
          offenders.push(
            `length ${length}, seed ${JSON.stringify(seed)}: got ${got.length} entries ` +
              `(${new Set(got).size} distinct), expected ${length}`,
          );
          continue;
        }
        if (JSON.stringify([...got].sort()) !== JSON.stringify([...options].sort())) {
          offenders.push(`length ${length}, seed ${JSON.stringify(seed)}: returned entries are not the options array`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never leaves a length unfinished", () => {
    // Paired with the assertion above on purpose. This one names the lengths
    // that wedged; that one proves the finishing lengths returned real content.
    // The diagnoses go first so that the message a red produces says WHICH
    // failure mode occurred instead of asserting a timeout that may not have
    // happened.
    expect(unfinishedLengths.map((length) => diagnosisFor(length))).toEqual([]);
    expect(unfinishedLengths).toEqual([]);
  });
});

describe("pickDistinct - index reachability", () => {
  // The property under the symptom. The symptom is a hang; the CAUSE is that
  // the generator's reachable index set is a strict subset of the options
  // array's indices, so some options can never be selected at all. Asserted
  // through behaviour: the set of entries that come back must be the whole
  // options set, for EVERY seed - not merely for the union across seeds, which
  // a generator confined to a different half per seed would still satisfy.
  it("every option is reachable from every seed, at every list length 1..20", () => {
    const unreachable = [];
    for (const length of LENGTHS) {
      const options = optionsOfLength(length);
      for (const seed of SEEDS) {
        const got = completed.get(shapeKey(length, seed, "default"));
        if (got === undefined) {
          unreachable.push(`length ${length}, seed ${JSON.stringify(seed)}: could not be measured - ${verdictFor(length)}`);
          continue;
        }
        const missing = options.filter((o) => !got.includes(o));
        if (missing.length) {
          unreachable.push(
            `length ${length}, seed ${JSON.stringify(seed)}: ${missing.length}/${length} options unreachable (${missing.join(",")})`,
          );
        }
      }
    }
    expect(unreachable).toEqual([]);
  });

  it("can be pushed to any depth: every n from 1 to options.length yields n distinct entries", () => {
    // The reachability ladder. Asking for n options must work for every n up
    // to the array's length - if the generator can only reach k < length
    // distinct indices, this fails at n = k + 1 and names that boundary,
    // which is the most useful single number for diagnosing the defect.
    const offenders = [];
    for (const length of LENGTHS) {
      for (const seed of SEEDS) {
        // The child walks the ladder n-major, so a wedge at n=k still leaves
        // every seed measured for n < k and each one reports its own boundary.
        // If even n=1 is missing the child died before the ladder started, and
        // this seed is UNMEASURED rather than failing: saying "unsatisfiable at
        // n=1" for it would be an artifact of the kill reported as a
        // measurement - a zero that is silence, not a finding.
        if (!completed.has(shapeKey(length, seed, 1))) {
          offenders.push(
            `length ${length}, seed ${JSON.stringify(seed)}: not measured - ${verdictFor(length)} at an earlier seed`,
          );
          continue;
        }
        for (let n = 1; n <= length; n += 1) {
          const got = completed.get(shapeKey(length, seed, n));
          if (got === undefined) {
            offenders.push(`length ${length}, seed ${JSON.stringify(seed)}: first unsatisfiable n is ${n}`);
            break;
          }
          if (got.length !== n || new Set(got).size !== n) {
            offenders.push(
              `length ${length}, seed ${JSON.stringify(seed)}, n=${n}: got ${got.length} entries (${new Set(got).size} distinct)`,
            );
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("clamps n greater than options.length instead of spinning, at every length and seed", () => {
    // THE LANDMINE, made a first-class asserted shape. `Math.min(n, list.length)`
    // is the whole of the clamp and it sits inside the `while` condition a fix
    // replaces, so losing it is a natural consequence of a correct-looking
    // change - and the function then never returns for n > length. Measured:
    // ungated, that produced 171 bytes of output, no `Tests` line at all, and
    // was killed only by an outer 90-second timeout. Here it is a red test that
    // names the shape.
    const unmeasured = [];
    const wrong = [];
    const diagnosed = new Set();
    for (const length of LENGTHS) {
      const options = optionsOfLength(length);
      for (const seed of SEEDS) {
        for (const extra of OVER_ASK_OFFSETS) {
          const n = length + extra;
          const got = completed.get(shapeKey(length, seed, n));
          if (got === undefined) {
            if (!diagnosed.has(length)) {
              diagnosed.add(length);
              unmeasured.push(`over-ask n=${n} on a ${length}-entry array never returned. ${diagnosisFor(length)}`);
            }
            continue;
          }
          if (got.length !== length || new Set(got).size !== length) {
            wrong.push(
              `length ${length}, seed ${JSON.stringify(seed)}, n=${n}: got ${got.length} entries ` +
                `(${new Set(got).size} distinct), expected all ${length} of them`,
            );
            continue;
          }
          if (JSON.stringify([...got].sort()) !== JSON.stringify([...options].sort())) {
            wrong.push(`length ${length}, seed ${JSON.stringify(seed)}, n=${n}: returned entries are not the options array`);
          }
        }
      }
    }
    expect(unmeasured).toEqual([]);
    expect(wrong).toEqual([]);
  });
});

describe("pickDistinct - varies with the seed", () => {
  // GAP THIS CLOSES: every other assertion in this file is per-seed. Tests
  // 7/9/10 loop over seeds but assert only properties that hold seed by seed;
  // the determinism tests compare a seed against itself; the declaration-order
  // test uses one seed. A `pickDistinct` that ignores its seed entirely and
  // shuffles from a constant passes every one of them. Three independent
  // instruments confirmed it, and so does roleSituations.contract.test.js
  // (R-233) - but only if someone remembers to run that file. Seed-driven
  // selection is the module's whole stated purpose ("the wording varies with
  // the input"), so it is asserted here, in its own file.
  it("distinct seeds produce distinct orders, not one order for everyone", () => {
    const offenders = [];
    let measuredRows = 0;
    for (const length of FAN_LENGTHS) {
      const orderCounts = new Map();
      const firstEntries = new Set();
      const missing = [];
      for (const seed of FAN_SEEDS) {
        const got = completed.get(shapeKey(length, seed, "fan"));
        if (got === undefined) {
          missing.push(seed);
          continue;
        }
        if (got.length !== length) {
          offenders.push(
            `length ${length}, seed ${JSON.stringify(seed)}: the fan row has ${got.length} entries, expected ${length} - ` +
              `nothing about seed sensitivity can be concluded from a result that is not a full permutation`,
          );
          continue;
        }
        measuredRows += 1;
        const order = JSON.stringify(got);
        orderCounts.set(order, (orderCounts.get(order) || 0) + 1);
        firstEntries.add(got[0]);
      }
      if (missing.length) {
        offenders.push(
          `length ${length}: ${missing.length}/${FAN_SEEDS.length} fan seeds produced no result. ${diagnosisFor(length)}`,
        );
        continue;
      }
      const distinctOrders = orderCounts.size;
      const mostShared = orderCounts.size ? Math.max(...orderCounts.values()) : FAN_SEEDS.length;
      const summary =
        `length ${length}, ${FAN_SEEDS.length} unrelated seeds: ${distinctOrders} distinct orders, ` +
        `${firstEntries.size} distinct first entries, ${mostShared} seeds sharing the single most common order`;
      if (distinctOrders < FAN_MIN_DISTINCT_ORDERS) {
        offenders.push(`${summary} - fewer than ${FAN_MIN_DISTINCT_ORDERS} distinct orders: the result barely depends on the seed`);
      }
      if (firstEntries.size < Math.min(FAN_MIN_DISTINCT_FIRST_ENTRIES, length)) {
        offenders.push(
          `${summary} - fewer than ${Math.min(FAN_MIN_DISTINCT_FIRST_ENTRIES, length)} distinct first entries: ` +
            `the seed does not decide which option leads`,
        );
      }
      if (mostShared > FAN_MAX_SEEDS_SHARING_ONE_ORDER) {
        offenders.push(
          `${summary} - more than ${FAN_MAX_SEEDS_SHARING_ONE_ORDER} of the ${FAN_SEEDS.length} seeds share one order: ` +
            `a seed-blind implementation puts all ${FAN_SEEDS.length} here`,
        );
      }
    }
    expect(offenders).toEqual([]);
    // POSITIVE CONTROL: say how many rows could have produced a failure, so a
    // fan that measured nothing cannot pass by having nothing to disagree
    // about. 40 seeds x 3 lengths = 120 rows. The LITERAL floor is the half
    // that matters: `FAN_SEEDS.length * FAN_LENGTHS.length` is computed from
    // the same two constants, so emptying either list would satisfy it at 0.
    expect(measuredRows).toBe(FAN_SEEDS.length * FAN_LENGTHS.length);
    expect(measuredRows).toBeGreaterThanOrEqual(100);
  });
});

describe("pickDistinct - determinism", () => {
  it("gives the same result for the same seed and options, in-process", () => {
    const mismatched = [];
    let comparedInProcess = 0;
    for (const length of LENGTHS) {
      const options = optionsOfLength(length);
      for (const seed of SEEDS) {
        // GATE: only call the real function for a shape the child already
        // finished. An ungated call here is what would wedge the worker.
        if (!completed.has(shapeKey(length, seed, "default"))) continue;
        const a = proven(seed, options);
        const b = proven(seed, options);
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          mismatched.push(`length ${length}, seed ${JSON.stringify(seed)}`);
        }
        // POSITIVE CONTROL: determinism is trivially satisfied by a function
        // that always returns []. `a === b` is not enough - assert what `a`
        // actually IS, so a dead implementation cannot agree with itself here.
        if (a.length !== length || new Set(a).size !== length) {
          mismatched.push(
            `length ${length}, seed ${JSON.stringify(seed)}: the in-process result had ${a.length} entries ` +
              `(${new Set(a).size} distinct), expected ${length} - it agreed with itself about nothing`,
          );
          continue;
        }
        comparedInProcess += 1;
      }
    }
    expect(mismatched).toEqual([]);
    // POSITIVE CONTROL: determinism is trivially satisfied by a function that
    // always returns []. Assert the gate actually let real work through.
    expect(completed.size).toBeGreaterThan(0);
    expect(comparedInProcess).toBeGreaterThan(0);
  });

  it("gives the same result across processes", () => {
    const mismatched = [];
    let compared = 0;
    for (const length of LENGTHS) {
      const options = optionsOfLength(length);
      for (const seed of SEEDS) {
        const fromChild = completed.get(shapeKey(length, seed, "default"));
        if (fromChild === undefined) continue; // gated, as above
        // POSITIVE CONTROL: an [] from the child matches an [] from this
        // process perfectly, so "they agree" is worthless unless what they
        // agree ON is a real full permutation. Checked before counting.
        if (fromChild.length !== length || new Set(fromChild).size !== length) {
          mismatched.push(
            `length ${length}, seed ${JSON.stringify(seed)}: the child's result had ${fromChild.length} entries ` +
              `(${new Set(fromChild).size} distinct), expected ${length} - there is nothing meaningful to compare`,
          );
          continue;
        }
        compared += 1;
        if (JSON.stringify(proven(seed, options)) !== JSON.stringify(fromChild)) {
          mismatched.push(`length ${length}, seed ${JSON.stringify(seed)}`);
        }
      }
    }
    expect(mismatched).toEqual([]);
    // POSITIVE CONTROL, same reason: a cross-process comparison that compared
    // nothing would pass silently. Say how many rows could have failed.
    expect(compared).toBeGreaterThan(0);
  });

  it("orders the result by the seed rather than returning the options array as declared", () => {
    // The property lib/copilot/roleSituations.js relies on and docs/REGRESSION.md
    // R-233 states: the order is "stable and reproducible without being the
    // bank's declaration order". Returning the input untouched would satisfy
    // every distinctness assertion above, so it is ruled out separately - and
    // as a majority-of-lengths bar, not a single case, since a correct seeded
    // permutation leaves declaration order intact only by coincidence.
    //
    // The length/distinctness requirement in the filter is load-bearing: a
    // returned [] is also `!==` the options array, so without it an empty
    // result counts as "successfully shuffled" and a completely dead
    // pickDistinct scores a perfect 18/18 on this test.
    const shuffled = LENGTHS.filter((length) => {
      if (length < 3) return false; // too short for "not declaration order" to mean anything
      const options = optionsOfLength(length);
      const got = completed.get(shapeKey(length, "manager", "default"));
      if (got === undefined || got.length !== length || new Set(got).size !== length) return false;
      return JSON.stringify(got) !== JSON.stringify(options);
    });
    expect(shuffled.length).toBeGreaterThanOrEqual(Math.ceil(LENGTHS.filter((l) => l >= 3).length / 2));
  });
});

describe("pickDistinct - degenerate inputs still terminate", () => {
  it("handles empty, null and nullish-padded option lists", () => {
    // Proven in the child too: `h % list.length` on an empty array is NaN, and
    // an implementation that loses the zero guard spins here exactly the way
    // the real defect does.
    expect(proven("x", [])).toEqual([]);
    expect(proven("x", null)).toEqual([]);
    expect(proven("x", undefined)).toEqual([]);
  });

  it("asking for more than exists returns everything, not a hang", () => {
    // Bounded by the child sweep the same way - but on the OVER-ASK shape
    // itself (n = length + 5), not on the default-n shape. The old gate here
    // checked "default", which the child sweeps, and then called n = length + 5,
    // which it did not: the gate opened on a shape nothing had proven.
    for (const length of [1, 2, 3, 5]) {
      const options = optionsOfLength(length);
      const got = proven("Acme", options, length + 5);
      expect(got).toHaveLength(length);
      expect(new Set(got).size).toBe(length);
    }
  });

  it("returns [] for n = 0 and for any negative n, never the unshuffled pool", () => {
    // THE OTHER SIDE OF THE CLAMP. `count = Math.max(0, Math.min(n,
    // list.length))` guards two directions: the sibling test above ("asking
    // for more than exists...") covers the over-ask side (`n > list.length`);
    // this one covers the non-positive side, which is what `Math.max(0, ...)`
    // alone is responsible for. Delete just that `Math.max(0, ...)` and
    // `count` becomes `Math.min(n, list.length)`, which is negative whenever
    // `n` is negative - so the `count === 0` early return is skipped, and the
    // function falls through to the draw loop and `pool.slice(0, count)`.
    // For `n = -1` on a 4-entry list that is `pool.slice(0, -1)`: the whole
    // unshuffled options list minus its last entry, returned silently
    // instead of throwing or hanging.
    //
    // This shape needs no child-process gate, unlike the shapes above: the
    // draw loop's bound is `i < count` starting from `i = 0`, so a
    // non-positive `count` is already 0 iterations under ANY value of the
    // clamp - there is no mutation of the clamp that can turn a non-positive
    // `n` into a hang. It is safe to call pickDistinct directly here.
    const options = ["a", "b", "c", "d"];
    expect(pickDistinct("seed", options, 0)).toEqual([]);
    expect(pickDistinct("seed", options, -1)).toEqual([]);
    expect(pickDistinct("seed", options, -4)).toEqual([]);
  });
});
