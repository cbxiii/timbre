import "server-only";
import OpenAI from "openai";

let _client: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY;
  const apiURL = process.env.LLM_API_URL;
  if (!apiKey) {
    throw new Error("LLM_API_KEY is not configured");
  }
  if (!apiURL) {
    throw new Error("LLM_API_URL is not configured");
  }
  if (!_client) _client = new OpenAI({ baseURL: apiURL, apiKey: apiKey });
  return _client;
}

export async function callLLM(
  prompt: string,
  maxTokens: number = 1000,
  systemPrompt?: string
): Promise<string> {
  const openai = getOpenAIClient();

  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await openai.chat.completions.create({
    model: "chatgpt-gpt-5.5",
    max_tokens: maxTokens,
    messages,
  });

  return response.choices[0]?.message?.content ?? "";
}
