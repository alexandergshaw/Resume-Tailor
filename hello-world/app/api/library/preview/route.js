import { getEngine } from "@/lib/llm/engines";
import { getAuth, unauthorized } from "@/lib/llm/engines/tailor-lite/library/apiSupport";

export const runtime = "nodejs";

const MAX_POSTING_CHARS = 20000;

// Self-service preview: render the résumé + cover letter from a pasted posting
// using the signed-in user's CURRENT library (via the embedded engine + loader),
// so the user can verify an edit without any AI involvement. Read-only.
export async function POST(request) {
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const posting = typeof body?.posting === "string" ? body.posting.slice(0, MAX_POSTING_CHARS) : "";
  if (!posting.trim()) return Response.json({ error: "Paste a job posting to preview." }, { status: 400 });

  const engine = getEngine("embedded");
  try {
    const [resume, cover] = await Promise.all([
      engine.tailorResume({ jobPosting: posting, userId }),
      engine.tailorCoverLetter({ jobPosting: posting, userId }),
    ]);
    return Response.json({
      resume: resume.result,
      cover: cover.result,
      jobTitle: cover.jobTitle || resume.jobTitle || "",
      companyName: cover.companyName || resume.companyName || "",
      keywords: resume.report?.keywords || {},
    });
  } catch (err) {
    return Response.json({ error: err?.message || "Preview failed." }, { status: 500 });
  }
}
