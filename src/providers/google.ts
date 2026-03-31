import type { Provider, RunOptions, RunResult } from "./types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GoogleProvider implements Provider {
  name = "google";
  modelPrefixes = ["gemini-"];

  async run(prompt: string, options: RunOptions): Promise<RunResult> {
    const apiKey = options.apiKey;
    if (!apiKey) return { stdout: "", stderr: "Google API key not configured. Add providers.google.apiKey to settings.", exitCode: 1 };
    const baseUrl = options.env?.GOOGLE_BASE_URL || DEFAULT_BASE_URL;
    const model = options.model || "gemini-2.0-flash";
    const timeoutMs = options.timeoutMs || 300_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 16384 } }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) { const t = await response.text(); return { stdout: "", stderr: `Google Gemini API error (${response.status}): ${t}`, exitCode: 1 }; }
      const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
      if (data.error) return { stdout: "", stderr: `Google Gemini API error: ${data.error.message}`, exitCode: 1 };
      return { stdout: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", stderr: "", exitCode: 0 };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("abort")) return { stdout: "", stderr: `Google Gemini request timed out after ${timeoutMs / 1000}s`, exitCode: 124 };
      return { stdout: "", stderr: `Google Gemini request failed: ${message}`, exitCode: 1 };
    }
  }
}
