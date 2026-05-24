import { NextResponse } from "next/server";
import { generateTailoredResumeDraft } from "@/lib/llm/tailorResume";

export const runtime = "nodejs";

const MAX_RESUME_CHARS = 20000;
const TEXT_MIME_PREFIX = "text/";
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"];

function isTextLikeFile(file) {
  if (file.type && file.type.startsWith(TEXT_MIME_PREFIX)) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

async function readResumeText(file) {
  if (!file) {
    return "";
  }

  if (!isTextLikeFile(file)) {
    return "Resume uploaded in non-text format. Extract text with a parser before model invocation for best results.";
  }

  const rawText = await file.text();

  if (!rawText) {
    return "";
  }

  return rawText.slice(0, MAX_RESUME_CHARS);
}

export async function POST(request) {
  try {
    const formData = await request.formData();

    const jobPosting = formData.get("jobPosting")?.toString().trim() || "";
    const resumeFile = formData.get("resume");

    if (!jobPosting) {
      return NextResponse.json(
        { error: "jobPosting is required." },
        { status: 400 },
      );
    }

    const resumeText = await readResumeText(
      resumeFile instanceof File ? resumeFile : null,
    );

    const result = await generateTailoredResumeDraft({
      jobPosting,
      resumeText,
      resumeFileName: resumeFile instanceof File ? resumeFile.name : "",
    });

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Error generating tailored resume:", error);
    return NextResponse.json(
      {
        error:
          "Unable to generate tailored resume draft. Check server logs and environment configuration.",
      },
      { status: 500 },
    );
  }
}