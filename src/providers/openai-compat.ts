import type { Provider, RunOptions, RunResult } from "./types";

export interface OpenAICompatConfig {
  name: string;
  modelPrefixes: string[];
  defaultBaseUrl: string;
  defaultModel: string;
}

export class OpenAICompatProvider implements Provider {
  name: string;
  modelPrefixes: string[];
  private defaultBaseUrl: string;
  private defaultModel: string;

  constructor(config: OpenAICompatConfig) {
    this.name = config.name;
    this.modelPrefixes = config.modelPrefixes;
    this.defaultBaseUrl = config.defaultBaseUrl;
    this.defaultModel = config.defaultModel;
  }

  async run(prompt: string, options: RunOptions): Promise<RunResult> {
    const apiKey = options.apiKey;
    if (!apiKey) {
      return { stdout: "", stderr: `${this.name} API key not configured. Add providers.${this.name}.apiKey to settings.`, exitCode: 1 };
    }
    const envKey = `${this.name.toUpperCase().replace(/-/g, "_")}_BASE_URL`;
    const baseUrl = options.env?.[envKey] || this.defaultBaseUrl;
    const rawModel = options.model || this.defaultModel;
    const model = rawModel.includes("/") ? rawModel.split("/").slice(1).join("/") : rawModel;
    const timeoutMs = options.timeoutMs || 300_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 16384 }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        const errorText = await response.text();
        return { stdout: "", stderr: `${this.name} API error (${response.status}): ${errorText}`, exitCode: 1 };
      }
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      if (data.error) return { stdout: "", stderr: `${this.name} API error: ${data.error.message}`, exitCode: 1 };
      return { stdout: data.choices?.[0]?.message?.content ?? "", stderr: "", exitCode: 0 };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("abort")) return { stdout: "", stderr: `${this.name} request timed out after ${timeoutMs / 1000}s`, exitCode: 124 };
      return { stdout: "", stderr: `${this.name} request failed: ${message}`, exitCode: 1 };
    }
  }
}

export const openaiProvider = new OpenAICompatProvider({ name: "openai", modelPrefixes: ["gpt-", "o1-", "o3-", "o4-", "chatgpt-"], defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" });
export const groqProvider = new OpenAICompatProvider({ name: "groq", modelPrefixes: ["groq/"], defaultBaseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" });
export const deepseekProvider = new OpenAICompatProvider({ name: "deepseek", modelPrefixes: ["deepseek-"], defaultBaseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" });
export const workersAIProvider = new OpenAICompatProvider({ name: "workers-ai", modelPrefixes: ["cf/", "@cf/"], defaultBaseUrl: "https://api.cloudflare.com/client/v4/accounts", defaultModel: "@cf/meta/llama-3-8b-instruct" });
export const copilotProvider = new OpenAICompatProvider({ name: "copilot", modelPrefixes: ["copilot/"], defaultBaseUrl: "https://api.githubcopilot.com", defaultModel: "gpt-4o" });
