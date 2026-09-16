#!/usr/bin/env node
// Regenerates lib/interviewPrep/data/givenNames.generated.js from the raw US
// Social Security Administration (SSA) national baby-names archive -- the
// given-name lexicon backing lib/interviewPrep/prepParse.js's
// `containsDetectedName` (backlog N26; ac.r5.md WB-5, R-N26-8).
//
// SOURCE. ssa.gov itself is Akamai-blocked from the network this was
// authored on (403 on every request, an "Access Denied" page rather than a
// transient failure) -- obtained instead from the GitHub mirror
// `hackerb9/ssa-baby-names`, path `raw-data/names.zip`. That archive is US
// federal public-domain data (SSA's own national per-year name/sex/count
// files, `yob1880.txt` .. `yob2020.txt`, plus SSA's own NationalReadMe.txt)
// and is verified here by its sha256 before anything is derived from it --
// see PINNED_SHA256 below.
//
// The archive is NOT committed to this repo (7.3 MB, and the only thing
// runtime code needs is the derived module this script writes) -- so this
// script is the disclosed, re-runnable provenance record: given a copy of
// `names.zip` whose sha256 matches PINNED_SHA256, running
//   node scripts/generate-given-names.mjs <path-to-names.zip>
// reproduces lib/interviewPrep/data/givenNames.generated.js's GIVEN_NAMES
// array byte-for-byte.
//
// ALGORITHM, chosen to match the archive's own natural ordering (verified by
// reconstruction against the working list this chunk measured all its FP/FN
// numbers against): for every name across every yobNNNN.txt entry (both
// M and F rows), take that name's SINGLE HIGHEST national year-count seen
// anywhere in the archive, then sort names by that max count, descending,
// breaking ties alphabetically. This is a full, UNFILTERED export (WB-8 /
// AC-N26.17: threshold 0) -- SSA's own privacy floor is already baked into
// the source files themselves (NationalReadMe.txt: "we restrict our list of
// names to those with at least 5 occurrences" in a given year, nationally),
// so no further cutoff is applied here, and none may be added at the
// consumption site either (a Set built from a truncated slice of this array
// would reopen exactly the cultural-skew defect this lexicon exists to
// avoid -- see the generated module's own header).
//
// Every emitted name is lowercased and de-duplicated (case-insensitively;
// the source data was already single-case per name, so this changes
// nothing observable, only guarantees the invariant going forward).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The sha256 of the SOURCE ZIP obtained from hackerb9/ssa-baby-names
// (raw-data/names.zip), independently verified twice against the file this
// module was generated from (`Get-FileHash -Algorithm SHA256`, matching
// case-insensitively). This is the hash of the ARCHIVE, not of the derived
// module this script writes -- see the generated module's own header for
// why those are necessarily different files.
const PINNED_SHA256 = "67cf9c3fbbbcc18994cc071417267c48545130131112bcda83a9a36b2abcbc7e";

const OUTPUT_PATH = path.join(__dirname, "..", "lib", "interviewPrep", "data", "givenNames.generated.js");

function usageError(message) {
  console.error(`generate-given-names: ${message}`);
  console.error("usage: node scripts/generate-given-names.mjs <path-to-names.zip>");
  process.exit(1);
}

/** Aggregates every yobNNNN.txt entry in the zip into name -> max single-year
 *  national count seen for that name (case-insensitive key, canonical
 *  spelling taken from the first row encountered -- the archive is already
 *  single-case per name, verified while authoring this script).
 *
 * @param {JSZip} zip
 * @returns {Map<string, {canonical: string, maxCount: number}>}
 */
async function aggregateNames(zip) {
  const byName = new Map();
  const yearFiles = Object.keys(zip.files).filter((name) => /^yob\d{4}\.txt$/.test(name));
  if (yearFiles.length === 0) {
    throw new Error("no yobNNNN.txt entries found in the archive -- is this the right zip?");
  }
  for (const entryName of yearFiles) {
    const text = await zip.files[entryName].async("string");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(",");
      if (parts.length !== 3) continue;
      const [name, , countText] = parts;
      const count = Number.parseInt(countText, 10);
      if (!name || !Number.isFinite(count)) continue;
      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { canonical: name, maxCount: count });
      } else if (count > existing.maxCount) {
        existing.maxCount = count;
      }
    }
  }
  return byName;
}

function renderModule(names, sourceZipPath) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const arrayLiteral = names.map((n) => JSON.stringify(n)).join(",\n  ");
  return `// GENERATED FILE -- produced by scripts/generate-given-names.mjs. Do not
// hand-edit; regenerate instead (see that script's own header for the exact
// command). Last generated ${generatedAt}.
//
// SOURCE: US Social Security Administration (SSA) national baby-names data
// -- US federal work, PUBLIC DOMAIN. ssa.gov itself was unreachable
// (Akamai-blocked, 403 "Access Denied") from the network this was obtained
// on, so this was fetched via the GitHub mirror \`hackerb9/ssa-baby-names\`,
// path \`raw-data/names.zip\`. That source archive's sha256 is:
//   ${PINNED_SHA256}
// (verify with \`Get-FileHash <names.zip> -Algorithm SHA256\` on Windows or
// \`sha256sum <names.zip>\` elsewhere). This module does not and cannot share
// that hash itself -- it is a derived, reformatted name list, not the zip;
// the hash above is the chain's root, checkable by re-running the generator
// against an archive that matches it (scripts/generate-given-names.mjs's own
// header has the exact command).
//
// RECORD COUNT: ${names.length} unique given names.
//
// PRIVACY FLOOR: SSA's own NationalReadMe.txt (shipped inside the source
// archive) states its restriction verbatim: "we restrict our list of names
// to those with at least 5 occurrences" in a given year, nationally, at
// least once between 1880 and 2020. Any real given name that never cleared
// that floor, in any culture, is therefore absent from this list by
// construction -- not a tuning choice made here.
//
// THRESHOLD: 0 (full, unfiltered). Every name meeting only SSA's own floor
// above is included, in every case lowercased. No further frequency cutoff
// is applied, and none may be added at the consumption site either -- a
// lexicon detector that only ships part of this list would silently regain
// a cultural-skew false-negative profile that shipping the full list avoids
// (backlog N26 ledger R-N26-4/R-N26-8/R-N26-9).
//
// Ordering: descending by each name's single highest national year-count
// anywhere in the source archive, alphabetical on ties. This is an
// implementation detail of the generator, not a contract any caller may
// depend on -- consumers should treat GIVEN_NAMES as an unordered set.
//
// LICENSE: source data is a US federal government work and is in the public
// domain. The mirror repository's own scripts carry LGPL-2.1, but no code
// from that repository is vendored here -- only the data, and facts are not
// copyrightable.
//
// Regenerate with: node scripts/generate-given-names.mjs <path-to-names.zip>
// (last run against: ${path.basename(sourceZipPath)})

export const GIVEN_NAMES = Object.freeze([
  ${arrayLiteral},
]);
`;
}

async function main() {
  const sourceZipPath = process.argv[2];
  if (!sourceZipPath) {
    usageError("missing required <path-to-names.zip> argument.");
    return;
  }
  if (!fs.existsSync(sourceZipPath)) {
    usageError(`file not found: ${sourceZipPath}`);
    return;
  }

  const rawZip = fs.readFileSync(sourceZipPath);
  const actualSha256 = crypto.createHash("sha256").update(rawZip).digest("hex");
  if (actualSha256 !== PINNED_SHA256) {
    usageError(
      `sha256 mismatch -- expected ${PINNED_SHA256}, got ${actualSha256}. ` +
        "This script refuses to generate from an archive that does not match the " +
        "verified SSA source (see this script's own header for where to obtain it).",
    );
    return;
  }

  const zip = await JSZip.loadAsync(rawZip);
  const byName = await aggregateNames(zip);

  const ordered = [...byName.entries()].sort((a, b) => {
    if (b[1].maxCount !== a[1].maxCount) return b[1].maxCount - a[1].maxCount;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const names = ordered.map(([lowerName]) => lowerName);

  if (names.length === 0) {
    throw new Error("generate-given-names: aggregation produced zero names -- refusing to write an empty lexicon.");
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, renderModule(names, sourceZipPath), "utf8");
  console.log(`generate-given-names: wrote ${names.length} names to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
