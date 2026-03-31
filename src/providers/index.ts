/**
 * Provider Registry — 管理所有 provider 並根據 model 名稱路由。
 *
 * Routing 規則：
 *   gpt-* / o1-* / o3-* / o4-* / chatgpt-*  → OpenAI
 *   claude-*（有 anthropic apiKey 時）        → Anthropic HTTP
 *   gemini-*                                  → Google Gemini
 *   bedrock/*                                 → AWS Bedrock
 *   ollama/*                                  → Ollama local
 *   cf/* / @cf/*                              → Cloudflare Workers AI
 *   copilot/*                                 → GitHub Copilot
 *   groq/*                                    → Groq
 *   deepseek-*                                → DeepSeek
 *   其他                                      → Claude CLI (default)
 */

import type { Provider, ProvidersConfig, RunOptions, RunResult } from "./types";
import { ClaudeCliProvider } from "./claude";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { BedrockProvider } from "./bedrock";
import { OllamaProvider } from "./ollama";
import {
  openaiProvider,
  groqProvider,
  deepseekProvider,
  workersAIProvider,
  copilotProvider,
} from "./openai-compat";

export type { Provider, ProvidersConfig, RunOptions, RunResult } from "./types";

const anthropicProvider = new AnthropicProvider();
const googleProvider = new GoogleProvider();
const bedrockProvider = new BedrockProvider();
const ollamaProvider = new OllamaProvider();
const claudeCliProvider = new ClaudeCliProvider();

/** 所有已註冊的 providers（順序決定 prefix match 優先級） */
const providers: Provider[] = [
  openaiProvider,
  anthropicProvider,
  googleProvider,
  bedrockProvider,
  ollamaProvider,
  workersAIProvider,
  copilotProvider,
  groqProvider,
  deepseekProvider,
  claudeCliProvider,
];

/**
 * 根據 model 名稱找到對應的 provider。
 * 特殊規則：claude-* 在有 anthropic apiKey 時走 HTTP，否則走 CLI。
 */
export function resolveProvider(model: string, providersConfig?: ProvidersConfig): Provider {
  const normalized = model.trim().toLowerCase();

  for (const provider of providers) {
    for (const prefix of provider.modelPrefixes) {
      if (normalized.startsWith(prefix)) {
        // claude-* 特殊處理：有 apiKey 才走 Anthropic HTTP
        if (provider.name === "anthropic" && !providersConfig?.anthropic?.apiKey) {
          return claudeCliProvider;
        }
        return provider;
      }
    }
  }

  return claudeCliProvider;
}

/**
 * 判斷 model 是否走外部 API（非 Claude CLI）。
 */
export function isExternalProvider(model: string, providersConfig?: ProvidersConfig): boolean {
  return resolveProvider(model, providersConfig).name !== "claude-cli";
}

/**
 * 從 ProvidersConfig 取得對應 provider 的 API key。
 */
function getApiKey(providerName: string, config: ProvidersConfig): string | undefined {
  switch (providerName) {
    case "openai": return config.openai?.apiKey;
    case "anthropic": return config.anthropic?.apiKey;
    case "google": return config.google?.apiKey;
    case "groq": return config.groq?.apiKey;
    case "deepseek": return config.deepseek?.apiKey;
    case "workers-ai": return config["workers-ai"]?.apiToken;
    case "copilot": return config.copilot?.apiKey;
    default: return undefined;
  }
}

/**
 * 從 ProvidersConfig 取得環境變數（baseUrl、region 等）。
 */
function getProviderEnv(providerName: string, config: ProvidersConfig): Record<string, string> {
  const env: Record<string, string> = {};
  switch (providerName) {
    case "openai":
      if (config.openai?.baseUrl) env.OPENAI_BASE_URL = config.openai.baseUrl;
      break;
    case "anthropic":
      if (config.anthropic?.baseUrl) env.ANTHROPIC_BASE_URL = config.anthropic.baseUrl;
      break;
    case "google":
      if (config.google?.baseUrl) env.GOOGLE_BASE_URL = config.google.baseUrl;
      break;
    case "bedrock":
      if (config.bedrock?.region) env.AWS_REGION = config.bedrock.region;
      if (config.bedrock?.accessKeyId) env.AWS_ACCESS_KEY_ID = config.bedrock.accessKeyId;
      if (config.bedrock?.secretAccessKey) env.AWS_SECRET_ACCESS_KEY = config.bedrock.secretAccessKey;
      break;
    case "ollama":
      if (config.ollama?.baseUrl) env.OLLAMA_BASE_URL = config.ollama.baseUrl;
      break;
    case "groq":
      if (config.groq?.baseUrl) env.GROQ_BASE_URL = config.groq.baseUrl;
      break;
    case "deepseek":
      if (config.deepseek?.baseUrl) env.DEEPSEEK_BASE_URL = config.deepseek.baseUrl;
      break;
  }
  return env;
}

/**
 * 透過 provider 執行 prompt。
 */
export async function runWithProvider(
  prompt: string,
  model: string,
  providersConfig: ProvidersConfig,
  options: Omit<RunOptions, "model" | "apiKey"> = {},
): Promise<RunResult> {
  const provider = resolveProvider(model, providersConfig);
  const apiKey = getApiKey(provider.name, providersConfig);
  const providerEnv = getProviderEnv(provider.name, providersConfig);

  return provider.run(prompt, {
    ...options,
    model,
    apiKey,
    env: { ...providerEnv, ...options.env },
  });
}

export function listProviders(): string[] {
  return providers.map((p) => p.name);
}

export function getProvider(name: string): Provider | undefined {
  return providers.find((p) => p.name === name);
}
