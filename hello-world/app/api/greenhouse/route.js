import { searchGreenhouseJobs } from "@/lib/greenhouse/searchJobs";

export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();
  if (!query) {
    return Response.json({ error: "query parameter is required." }, { status: 400 });
  }
  const companiesParam = searchParams.get("companies");
  const companySlugs = companiesParam
    ? companiesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const jobs = await searchGreenhouseJobs({ query, companySlugs });
  return Response.json({ jobs });
}
