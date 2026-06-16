import { NextResponse } from "next/server";
import { extractEmploymentFromResumeText } from "@/lib/llm/extractEmployment";

export const runtime = "nodejs";

const MAX_RESUME_CHARS = 20000;

// Extract employment history from résumé text using Gemini. The client sends
// already-extracted text (it handles .docx/.txt parsing on-device), and falls
// back to its own heuristic parser if this route is unavailable.
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

  try {
    const positions = await extractEmploymentFromResumeText(resumeText);
    return NextResponse.json({ positions });
  } catch (err) {
    console.error("[extract-employment] failed:", err?.message || err);
    return NextResponse.json(
      { error: "AI extraction failed. Check server configuration." },
      { status: 500 },
    );
  }
}
