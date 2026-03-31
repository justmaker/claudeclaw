import type { Provider, RunOptions, RunResult } from "./types";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

export class AnthropicProvider implements Provider {
  name = "anthropic";
  modelPrefixes = ["claude-"];

  async run(prompt: string, options: RunOptions): Promise<RunResult> {
    const apiKey = options.apiKey;
    if (!apiKey) return { stdout: "", stderr: "Anthropic API key not configured. Add providers.anthropic.apiKey to settings.", exitCode: 1 };
    const baseUrl = options.env?.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL;
    const model = options.model || "claude-sonnet-4-20250514";
    const timeoutMs = options.timeoutMs || 300_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
        body: JSON.stringify({ model, max_tokens: 16384, messages: [{ role: "user", content: prompt }] }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) { const t = await response.text(); return { stdout: "", stderr: `Anthropic API error (${response.status}): ${t}`, exitCode: 1 }; }
      const data = (await response.json()) as { content?: Array<{ type: string; text?: string }>; error?: { message?: string } };
      if (data.error) return { stdout: "", stderr: `Anthropic API error: ${data.error.message}`, exitCode: 1 };
      const text = data.content?.filter(b => b.type === "text").map(b => b.text ?? "").join("") ?? "";
      return { stdout: text, stderr: "", exitCode: 0 };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("abort")) return { stdout: "", stderr: `Anthropic request timed out after ${timeoutMs / 1000}s`, exitCode: 124 };
      return { stdout: "", stderr: `Anthropic request failed: ${message}`, exitCode: 1 };
    }
  }
}
