import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

const baseURL = process.env["HELIOS_AI_BASE_URL"];
const apiKey = process.env["HELIOS_AI_KEY"];
const modelId = process.env["HELIOS_AI_MODEL"] ?? "gemini-3.5-flash";

if (!baseURL || !apiKey) {
  throw new Error("HELIOS_AI_BASE_URL 和 HELIOS_AI_KEY 必须由 Helios 注入，不能走 Vercel AI Gateway");
}

const sealos = createOpenAICompatible({
  name: "sealos",
  baseURL,
  apiKey
});

export default defineAgent({
  model: sealos.chatModel(modelId),
  modelContextWindowTokens: 1_048_576
});
