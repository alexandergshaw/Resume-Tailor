const REQUIRED_SERVER_KEYS = ["GEMINI_API_KEY"];

export function getServerEnv() {
  const missingKeys = REQUIRED_SERVER_KEYS.filter((key) => !process.env[key]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(", ")}`,
    );
  }

  return {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  };
}