import type { Provider, RunOptions, RunResult } from "./types";

export class OllamaProvider implements Provider {
  name = "ollama";
  modelPrefixes = ["ollama/"];

  async run(prompt: string, options: RunOptions): Promise<RunResult> {
    const baseUrl = options.env?.OLLAMA_BASE_URL || "http://localhost:11434";
    const rawModel = options.model || "ollama/llama3";
    const model = rawModel.startsWith("ollama/") ? rawModel.slice(7) : rawModel;
    const timeoutMs = options.timeoutMs || 300_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) { const t = await response.text(); return { stdout: "", stderr: `Ollama API error (${response.status}): ${t}`, exitCode: 1 }; }
      const data = (await response.json()) as { message?: { content?: string }; error?: string };
      if (data.error) return { stdout: "", stderr: `Ollama error: ${data.error}`, exitCode: 1 };
      return { stdout: data.message?.content ?? "", stderr: "", exitCode: 0 };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("abort")) return { stdout: "", stderr: `Ollama request timed out after ${timeoutMs / 1000}s`, exitCode: 124 };
      if (message.includes("ECONNREFUSED")) return { stdout: "", stderr: `Ollama not running at ${baseUrl}. Start with: ollama serve`, exitCode: 1 };
      return { stdout: "", stderr: `Ollama request failed: ${message}`, exitCode: 1 };
    }
  }
}
