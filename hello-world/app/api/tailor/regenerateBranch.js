// N104 - the server half of "regenerate to address these weaknesses", reached from
// the Ideal branch. It is the only place a regenerate request is recognised and the
// only door into regenerateToAddress.
//
// A regenerate is an ordinary Ideal tailor request that also carries the run it
// improves on: `pinnedAnalysis` (the posting analysis that run was scored against)
// and `beforeReview` (its review). By the time it gets here it has already passed
// the same engine gate as a first run (gateIdealRequest in the route), so an engine
// that cannot run the Ideal level has been refused with no artifact, never given an
// ungated regenerate.
//
//   runRegenerateRequest({ engine, args, realMaterial })
//     -> null                         not a regenerate: the caller runs the pipeline
//     -> { regenerated, closure, confirm, genuinelyUnqualified }
//     throws a stage error (bad-input) for a regenerate it cannot run
//
// What the browser may NOT supply is the steering: regenerateToAddress derives it
// from the review itself, and any `weaknessSteering` on the request is dropped here
// along with the two fields above, so the engine only ever sees the request a first
// run would have sent.
import { stageError } from "@/lib/llm/ideal/idealStageResult";
import { isValidPinnedAnalysis } from "@/lib/llm/ideal/pinnedAnalysis";
import { regenerateToAddress } from "@/lib/review/regenerateToAddress";

const REGENERATE_ARGS = ["pinnedAnalysis", "beforeReview", "weaknessSteering"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export async function runRegenerateRequest({ engine, args, realMaterial }) {
  if (args?.pinnedAnalysis === undefined && args?.beforeReview === undefined) return null;
  if (!isValidPinnedAnalysis(args.pinnedAnalysis) || !isObject(args.beforeReview)) {
    throw stageError(
      "input",
      "bad-input",
      "The regenerate request did not carry the run it should improve on. Nothing was produced.",
    );
  }
  const engineArgs = Object.fromEntries(Object.entries(args).filter(([key]) => !REGENERATE_ARGS.includes(key)));
  return regenerateToAddress({
    engine,
    args: engineArgs,
    realMaterial,
    beforeReview: args.beforeReview,
    pinnedAnalysis: args.pinnedAnalysis,
  });
}
