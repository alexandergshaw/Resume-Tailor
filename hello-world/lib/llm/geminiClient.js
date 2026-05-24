import { GoogleGenAI } from "@google/genai";
import { getServerEnv } from "@/lib/config/env";

let geminiClient;

export function getGeminiClient() {
  if (geminiClient) {
    return geminiClient;
  }

  const { geminiApiKey } = getServerEnv();
  geminiClient = new GoogleGenAI({ apiKey: geminiApiKey });
  return geminiClient;
}