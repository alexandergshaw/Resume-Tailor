import mammoth from "mammoth";

// External "Resume Tailor API" engine. Calls the standalone service which holds
// its own {{placeholder}} template, fills it, and returns a finished .docx
// (docx_b64) plus a report. We extract the document's text for the app's
// preview/chip/AI-context fields and pass the finished doc back as `docxB64`
// so the client can serve it directly (no client-side template fill).
//
// Reads its own env directly (not getServerEnv) so it doesn't depend on the
// Gemini key being present.

function getConfig() {
  return {
    url: process.env.RESUME_TAILOR_API_URL || null,
    key: process.env.RESUME_TAILOR_API_KEY || null,
    workflow: (process.env.RESUME_TAILOR_WORKFLOW || "legacy").trim().toLowerCase(),
  };
}

function notConfiguredError() {
  const err = new Error(
    "Resume Tailor API is not configured (set RESUME_TAILOR_API_URL).",
  );
  err.code = "ENGINE_NOT_CONFIGURED";
  return err;
}

// Friendly messages for the documented status codes. 413 returns an HTML page
// (not JSON), so it's handled separately.
const STATUS_MESSAGES = {
  400: "Resume Tailor API rejected the request",
  401: "Resume Tailor API rejected the API key",
  403: "Resume Tailor API bank is read-only",
  404: "Resume Tailor API resource not found",
  409: "Resume Tailor API reported a duplicate",
  422: "Resume Tailor API template has no placeholders",
};

async function callApi(path, body) {
  const { url, key } = getConfig();
  if (!url) throw notConfiguredError();

  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (key) headers["X-API-Key"] = key;

  let res;
  try {
    res = await fetch(`${url.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Resume Tailor API request failed: ${err?.message || "network error"}`);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      detail = json?.detail || json?.error || detail;
    } catch {
      if (res.status === 413) detail = "request body over 10 MB";
    }
    throw new Error(`${STATUS_MESSAGES[res.status] || "Resume Tailor API error"}: ${detail}`);
  }

  return res.json();
}

async function extractDocxText(docxB64) {
  if (!docxB64) return { result: "", resultLines: [] };
  try {
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(docxB64, "base64"),
    });
    const text = (value || "").replace(/\r\n/g, "\n").trim();
    return { result: text, resultLines: text ? text.split("\n") : [] };
  } catch {
    return { result: "", resultLines: [] };
  }
}

function reportMeta(report) {
  return {
    warnings: Array.isArray(report?.warnings) ? report.warnings : [],
    degraded: !!report?.meta?.degraded,
  };
}

export const externalEngine = {
  name: "external",

  // True when the service is reachable from config (URL present).
  isConfigured() {
    return !!getConfig().url;
  },

  // Fetch every placeholder slot with a proposed value so a client can build a
  // review/override UI, then call tailorResume with edited `values`.
  async getProposals({ jobPosting }) {
    const { workflow } = getConfig();
    const posting = String(jobPosting || "").trim();
    if (!posting) throw new Error("A job posting is required for the Resume Tailor API.");

    const data = await callApi("/api/v1/proposals", { posting, workflow });
    return {
      slots: Array.isArray(data?.slots) ? data.slots : [],
      keywords: data?.keywords || null,
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
      degraded: !!data?.meta?.degraded,
    };
  },

  async tailorResume({ jobPosting, values }) {
    const { workflow } = getConfig();
    const posting = String(jobPosting || "").trim();
    if (!posting) throw new Error("A job posting is required for the Resume Tailor API.");

    const body = { posting, workflow };
    if (values && typeof values === "object" && Object.keys(values).length > 0) {
      body.values = values;
    }
    const data = await callApi("/api/v1/resume", body);
    const docxB64 = typeof data?.docx_b64 === "string" ? data.docx_b64 : "";
    const { result, resultLines } = await extractDocxText(docxB64);
    const { warnings, degraded } = reportMeta(data?.report);

    return {
      engine: "external",
      result,
      resultLines,
      jobTitle: "",
      companyName: "",
      docxB64,
      report: data?.report || null,
      warnings,
      degraded,
    };
  },

  async tailorCoverLetter({ jobPosting, jobTitle, companyName }) {
    const { workflow } = getConfig();
    const posting = String(jobPosting || "").trim();
    if (!posting) throw new Error("A job posting is required for the Resume Tailor API.");

    const data = await callApi("/api/v1/cover-letter", {
      posting,
      workflow,
      target_role: jobTitle || "",
      target_organization: companyName || "",
    });
    const docxB64 = typeof data?.docx_b64 === "string" ? data.docx_b64 : "";
    const { result, resultLines } = await extractDocxText(docxB64);
    const { warnings, degraded } = reportMeta(data?.report);

    return {
      engine: "external",
      result,
      resultLines,
      docxB64,
      report: data?.report || null,
      warnings,
      degraded,
    };
  },
};
