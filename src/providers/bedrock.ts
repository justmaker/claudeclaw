import type { Provider, RunOptions, RunResult } from "./types";
import { createHmac, createHash } from "crypto";

function sha256(data: string | Buffer): string { return createHash("sha256").update(data).digest("hex"); }
function hmacSha256(key: Buffer | string, data: string): Buffer { return createHmac("sha256", key).update(data).digest(); }

export class BedrockProvider implements Provider {
  name = "bedrock";
  modelPrefixes = ["bedrock/"];

  async run(prompt: string, options: RunOptions): Promise<RunResult> {
    const accessKeyId = options.env?.AWS_ACCESS_KEY_ID;
    const secretAccessKey = options.env?.AWS_SECRET_ACCESS_KEY;
    const region = options.env?.AWS_REGION || "us-east-1";
    if (!accessKeyId || !secretAccessKey) return { stdout: "", stderr: "AWS Bedrock credentials not configured. Add providers.bedrock config to settings.", exitCode: 1 };
    const rawModel = options.model || "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0";
    const model = rawModel.startsWith("bedrock/") ? rawModel.slice(8) : rawModel;
    const timeoutMs = options.timeoutMs || 300_000;
    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;
    const body = JSON.stringify({ messages: [{ role: "user", content: [{ text: prompt }] }], inferenceConfig: { maxTokens: 16384 } });
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const service = "bedrock";
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const parsedUrl = new URL(url);
    const signedHeaderNames = ["content-type", "host", "x-amz-date"];
    const headerValues: Record<string, string> = { "content-type": "application/json", host: parsedUrl.host, "x-amz-date": amzDate };
    const canonicalHeaders = signedHeaderNames.map(k => `${k}:${headerValues[k]}`).join("\n") + "\n";
    const canonicalRequest = ["POST", parsedUrl.pathname, "", canonicalHeaders, signedHeaderNames.join(";"), sha256(body)].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmacSha256(hmacSha256(hmacSha256(hmacSha256(`AWS4${secretAccessKey}`, dateStamp), region), service), "aws4_request");
    const signature = hmacSha256(signingKey, stringToSign).toString("hex");
    const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", "x-amz-date": amzDate, Authorization: authHeader },
        body, signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) { const t = await response.text(); return { stdout: "", stderr: `Bedrock API error (${response.status}): ${t}`, exitCode: 1 }; }
      const data = (await response.json()) as { output?: { message?: { content?: Array<{ text?: string }> } } };
      const text = data.output?.message?.content?.map(b => b.text ?? "").join("") ?? "";
      return { stdout: text, stderr: "", exitCode: 0 };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("abort")) return { stdout: "", stderr: `Bedrock request timed out after ${timeoutMs / 1000}s`, exitCode: 124 };
      return { stdout: "", stderr: `Bedrock request failed: ${message}`, exitCode: 1 };
    }
  }
}
