import { getCached, setCached } from "@/lib/cache/jobCache";

export const runtime = "nodejs";

export async function GET() {
  const key = "redis-test";
  const testValue = { ok: true, ts: Date.now() };

  await setCached(key, testValue, 60);
  const result = await getCached(key);

  if (!result) {
    return Response.json({ connected: false, error: "Write succeeded but read returned null. Check env vars." }, { status: 500 });
  }

  return Response.json({ connected: true, value: result });
}
