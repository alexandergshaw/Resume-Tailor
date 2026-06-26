import { NextResponse } from "next/server";
import { getEngine, resolveEngineName } from "@/lib/llm/engines";
import { getServerEnv } from "@/lib/config/env";

export const runtime = "nodejs";

const MAX_POSTING_CHARS = 20000;

// Fetch the proposed placeholder slots for a posting so a client can
// review/override each one, then generate with edited `values`. Routes to the
// selected engine (per-request `engine`, falling back to the server default).
// Only the "external" and "embedded" engines implement proposals; engines
// without it (e.g. Gemini) return 400.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const posting =
    typeof body?.posting === "string" ? body.posting.slice(0, MAX_POSTING_CHARS) : "";
  if (!posting.trim()) {
    return NextResponse.json({ error: "posting is required." }, { status: 400 });
  }

  let defaultEngine = "gemini";
  try {
    defaultEngine = getServerEnv().resumeEngine;
  } catch {
    // Missing server env (e.g. no Gemini key) shouldn't block the embedded
    // engine; fall back to the requested engine / "gemini".
  }
  const engineName = resolveEngineName(body?.engine, defaultEngine);
  const engine = getEngine(engineName);

  if (typeof engine.getProposals !== "function") {
    return NextResponse.json(
      { error: `The "${engineName}" engine does not support field review.` },
      { status: 400 },
    );
  }

  try {
    const data = await engine.getProposals({ jobPosting: posting });
    return NextResponse.json(data);
  } catch (err) {
    const status = err?.code === "ENGINE_NOT_CONFIGURED" ? 503 : 502;
    return NextResponse.json(
      { error: err?.message || "Could not fetch proposals." },
      { status },
    );
  }
}
