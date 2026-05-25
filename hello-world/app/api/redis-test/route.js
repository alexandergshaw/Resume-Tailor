import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

export async function GET() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return Response.json(
      {
        connected: false,
        error: "Env vars missing",
        KV_REST_API_URL: url ? "set" : "missing",
        KV_REST_API_TOKEN: token ? "set" : "missing",
      },
      { status: 500 },
    );
  }

  try {
    const redis = new Redis({ url, token });
    const key = "redis-test";
    const testValue = { ok: true, ts: Date.now() };

    await redis.set(key, testValue, { ex: 60 });
    const result = await redis.get(key);

    return Response.json({ connected: !!result, value: result });
  } catch (err) {
    return Response.json({ connected: false, error: err.message }, { status: 500 });
  }
}
