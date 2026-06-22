import { NextResponse } from "next/server";
import { externalEngine } from "@/lib/llm/engines/externalEngine";

export const runtime = "nodejs";

const MAX_POSTING_CHARS = 20000;

// Proxy the external Resume Tailor API's /proposals endpoint so a client can
// review/override each placeholder slot, then generate with edited `values`.
// Only meaningful for the external engine; the API key stays server-side.
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

  try {
    const data = await externalEngine.getProposals({ jobPosting: posting });
    return NextResponse.json(data);
  } catch (err) {
    const status = err?.code === "ENGINE_NOT_CONFIGURED" ? 503 : 502;
    return NextResponse.json(
      { error: err?.message || "Could not fetch proposals." },
      { status },
    );
  }
}
