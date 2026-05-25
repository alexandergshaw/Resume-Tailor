import { Redis } from "@upstash/redis";

let redis = null;

function getRedisClient() {
  if (redis) {
    return redis;
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

export default getRedisClient;
