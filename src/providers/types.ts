export interface RunOptions {
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  extraArgs?: string[];
  onProgress?: (text: string) => void;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Provider {
  name: string;
  modelPrefixes: string[];
  run(prompt: string, options: RunOptions): Promise<RunResult>;
}

export interface OpenAIProviderConfig { apiKey: string; baseUrl?: string; }
export interface AnthropicProviderConfig { apiKey: string; baseUrl?: string; }
export interface GoogleProviderConfig { apiKey: string; baseUrl?: string; }
export interface BedrockProviderConfig { region: string; accessKeyId: string; secretAccessKey: string; }
export interface OllamaProviderConfig { baseUrl?: string; }
export interface WorkersAIProviderConfig { accountId: string; apiToken: string; }
export interface GroqProviderConfig { apiKey: string; baseUrl?: string; }
export interface DeepSeekProviderConfig { apiKey: string; baseUrl?: string; }
export interface CopilotProviderConfig { apiKey: string; baseUrl?: string; }

export interface ProvidersConfig {
  openai?: OpenAIProviderConfig;
  anthropic?: AnthropicProviderConfig;
  google?: GoogleProviderConfig;
  bedrock?: BedrockProviderConfig;
  ollama?: OllamaProviderConfig;
  "workers-ai"?: WorkersAIProviderConfig;
  groq?: GroqProviderConfig;
  deepseek?: DeepSeekProviderConfig;
  copilot?: CopilotProviderConfig;
}
