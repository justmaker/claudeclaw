import { describe, test, expect } from "bun:test";
import { resolveProvider, isExternalProvider, listProviders, getProvider, runWithProvider } from "../src/providers";
import type { ProvidersConfig } from "../src/providers";

describe("Provider Registry", () => {
  test("listProviders 回傳所有已註冊 provider", () => {
    const names = listProviders();
    expect(names).toContain("openai");
    expect(names).toContain("anthropic");
    expect(names).toContain("google");
    expect(names).toContain("bedrock");
    expect(names).toContain("ollama");
    expect(names).toContain("workers-ai");
    expect(names).toContain("copilot");
    expect(names).toContain("groq");
    expect(names).toContain("deepseek");
    expect(names).toContain("claude-cli");
  });

  test("getProvider 用名稱取得 provider", () => {
    expect(getProvider("openai")?.name).toBe("openai");
    expect(getProvider("anthropic")?.name).toBe("anthropic");
    expect(getProvider("google")?.name).toBe("google");
    expect(getProvider("bedrock")?.name).toBe("bedrock");
    expect(getProvider("ollama")?.name).toBe("ollama");
    expect(getProvider("groq")?.name).toBe("groq");
    expect(getProvider("deepseek")?.name).toBe("deepseek");
    expect(getProvider("workers-ai")?.name).toBe("workers-ai");
    expect(getProvider("copilot")?.name).toBe("copilot");
    expect(getProvider("claude-cli")?.name).toBe("claude-cli");
    expect(getProvider("nonexistent")).toBeUndefined();
  });
});

describe("Model Routing — prefix matching", () => {
  test("gpt-* / o1-* / o3-* → OpenAI", () => {
    expect(resolveProvider("gpt-4o").name).toBe("openai");
    expect(resolveProvider("gpt-4o-mini").name).toBe("openai");
    expect(resolveProvider("o1-preview").name).toBe("openai");
    expect(resolveProvider("o3-mini").name).toBe("openai");
    expect(resolveProvider("o4-mini").name).toBe("openai");
  });

  test("claude-* 沒有 anthropic apiKey → fallback Claude CLI", () => {
    expect(resolveProvider("claude-sonnet-4-20250514").name).toBe("claude-cli");
    expect(resolveProvider("claude-sonnet-4-20250514", {}).name).toBe("claude-cli");
  });

  test("claude-* 有 anthropic apiKey → Anthropic HTTP", () => {
    const cfg: ProvidersConfig = { anthropic: { apiKey: "sk-ant-test" } };
    expect(resolveProvider("claude-sonnet-4-20250514", cfg).name).toBe("anthropic");
    expect(resolveProvider("claude-opus-4-20250514", cfg).name).toBe("anthropic");
  });

  test("gemini-* → Google", () => {
    expect(resolveProvider("gemini-2.0-flash").name).toBe("google");
    expect(resolveProvider("gemini-1.5-pro").name).toBe("google");
  });

  test("bedrock/* → Bedrock", () => {
    expect(resolveProvider("bedrock/anthropic.claude-3").name).toBe("bedrock");
  });

  test("ollama/* → Ollama", () => {
    expect(resolveProvider("ollama/llama3").name).toBe("ollama");
  });

  test("cf/* / @cf/* → Workers AI", () => {
    expect(resolveProvider("cf/meta/llama-3").name).toBe("workers-ai");
    expect(resolveProvider("@cf/meta/llama-3").name).toBe("workers-ai");
  });

  test("copilot/* → Copilot", () => {
    expect(resolveProvider("copilot/gpt-4o").name).toBe("copilot");
  });

  test("groq/* → Groq", () => {
    expect(resolveProvider("groq/llama-3.3-70b").name).toBe("groq");
  });

  test("deepseek-* → DeepSeek", () => {
    expect(resolveProvider("deepseek-chat").name).toBe("deepseek");
    expect(resolveProvider("deepseek-coder").name).toBe("deepseek");
  });

  test("其他 → Claude CLI fallback", () => {
    expect(resolveProvider("sonnet").name).toBe("claude-cli");
    expect(resolveProvider("opus").name).toBe("claude-cli");
    expect(resolveProvider("").name).toBe("claude-cli");
    expect(resolveProvider("random-model").name).toBe("claude-cli");
  });

  test("大小寫不敏感", () => {
    expect(resolveProvider("GPT-4o").name).toBe("openai");
    expect(resolveProvider("Gemini-2.0-Flash").name).toBe("google");
    expect(resolveProvider("DeepSeek-Chat").name).toBe("deepseek");
  });
});

describe("isExternalProvider", () => {
  test("OpenAI/Google/Groq/DeepSeek/Bedrock/Ollama 是 external", () => {
    expect(isExternalProvider("gpt-4o")).toBe(true);
    expect(isExternalProvider("gemini-2.0-flash")).toBe(true);
    expect(isExternalProvider("groq/llama3")).toBe(true);
    expect(isExternalProvider("deepseek-chat")).toBe(true);
    expect(isExternalProvider("bedrock/claude-3")).toBe(true);
    expect(isExternalProvider("ollama/llama3")).toBe(true);
  });

  test("claude-* 沒 apiKey 不是 external", () => {
    expect(isExternalProvider("claude-sonnet-4-20250514")).toBe(false);
  });

  test("claude-* 有 apiKey 是 external", () => {
    const cfg: ProvidersConfig = { anthropic: { apiKey: "test" } };
    expect(isExternalProvider("claude-sonnet-4-20250514", cfg)).toBe(true);
  });

  test("空 model / 一般名稱不是 external", () => {
    expect(isExternalProvider("")).toBe(false);
    expect(isExternalProvider("sonnet")).toBe(false);
  });
});

describe("Provider 缺 API key 時回傳錯誤", () => {
  const cases = [
    { name: "openai", model: "gpt-4o" },
    { name: "anthropic", model: "claude-sonnet-4-20250514" },
    { name: "google", model: "gemini-2.0-flash" },
    { name: "groq", model: "groq/llama3" },
    { name: "deepseek", model: "deepseek-chat" },
  ];

  for (const { name, model } of cases) {
    test(`${name} 沒有 apiKey 應失敗`, async () => {
      const provider = getProvider(name)!;
      const result = await provider.run("test", { model });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not configured");
    });
  }
});

describe("Bedrock 缺 credentials 時回傳錯誤", () => {
  test("Bedrock 沒有 AWS credentials 應失敗", async () => {
    const provider = getProvider("bedrock")!;
    const result = await provider.run("test", { model: "bedrock/claude-3" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not configured");
  });
});

describe("runWithProvider 整合", () => {
  test("沒有 config 的 provider 應回傳錯誤", async () => {
    const result = await runWithProvider("hello", "gpt-4o", {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not configured");
  });
});
