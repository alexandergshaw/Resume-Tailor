const REQUIRED_SERVER_KEYS = ["Gemini_LLM_API_Key"];

export function getServerEnv() {
  const missingKeys = REQUIRED_SERVER_KEYS.filter((key) => !process.env[key]);

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(", ")}`,
    );
  }

  return {
    geminiApiKey: process.env.Gemini_LLM_API_Key,
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  };
}