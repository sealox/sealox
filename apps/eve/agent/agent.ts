import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";
import { installConsoleRedaction } from "./lib/security";
import { readFallbackModels, withModelFallback } from "./lib/model-fallback";

installConsoleRedaction();

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

const primary = sealos.chatModel(modelId);
const fallbackModels = readFallbackModels(process.env["HELIOS_AI_FALLBACK_MODELS"], modelId)
  .map((id) => sealos.chatModel(id));

export default defineAgent({
  model: withModelFallback(primary, fallbackModels),
  modelContextWindowTokens: 1_048_576
});
