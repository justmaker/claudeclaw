import type { Provider, RunOptions, RunResult } from "./types";

export class ClaudeCliProvider implements Provider {
  name = "claude-cli";
  modelPrefixes: string[] = [];
  async run(_prompt: string, _options: RunOptions): Promise<RunResult> {
    return { stdout: "", stderr: "Claude CLI provider should be invoked through runner.ts directly", exitCode: 1 };
  }
}
