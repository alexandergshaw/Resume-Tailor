import { NextResponse } from "next/server";
import { extractEmploymentFromResumeText } from "@/lib/llm/extractEmployment";
import { parseEmploymentHistory } from "@/lib/resume/parseEmployment";
import { wantsEmbedded } from "@/lib/llm/featureEngine";

export const runtime = "nodejs";

const MAX_RESUME_CHARS = 20000;

// Extract employment history from résumé text. The client sends already-extracted
// text (it handles .docx/.txt parsing on-device). The Embedded engine (or a
// deploy with no Gemini key) parses it deterministically with the same heuristic
// parser the client uses as a fallback; otherwise Gemini does the extraction.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const resumeText =
    typeof body?.resumeText === "string" ? body.resumeText.slice(0, MAX_RESUME_CHARS) : "";
  if (!resumeText.trim()) {
    return NextResponse.json({ error: "resumeText is required." }, { status: 400 });
  }

  if (wantsEmbedded(body?.engine)) {
    return NextResponse.json({ positions: parseEmploymentHistory(resumeText), engine: "embedded" });
  }

  try {
    const positions = await extractEmploymentFromResumeText(resumeText);
    return NextResponse.json({ positions, engine: "gemini" });
  } catch (err) {
    console.error("[extract-employment] failed:", err?.message || err);
    // Rather than fail outright, fall back to the deterministic parser so the
    // feature still returns something usable (the client also parses locally).
    return NextResponse.json({ positions: parseEmploymentHistory(resumeText), engine: "embedded" });
  }
}
