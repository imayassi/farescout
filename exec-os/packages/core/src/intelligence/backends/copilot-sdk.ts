/**
 * GitHub Copilot SDK backend (verified API surface: @github/copilot-sdk 1.0.x).
 * - Spawns the Copilot CLI runtime and talks JSON-RPC; reuses the user's existing Copilot login.
 * - COPILOT_HOME is pointed at the private data directory so session transcripts never touch the repo.
 * - Structured output: each run registers a `submit_result` custom tool whose schema is the skill's
 *   output schema; the model must call it. Validation errors are fed back once for a retry.
 * - Least privilege: only `submit_result` is available; every other permission request is rejected.
 */
import { z } from "zod";
import type { IntelligenceBackend, BackendInfo, RunOptions } from "./types.js";
import { BackendError } from "./types.js";
import type { Skill, SkillContext } from "../skills/index.js";

export interface CopilotSdkOptions {
  copilotHome: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  timeoutMs: number;
  /** Explicit CLI path (e.g. an `agency`-provided runtime). Defaults to the SDK's bundled runtime. */
  cliPath?: string;
}

type SdkModule = typeof import("@github/copilot-sdk");

export class CopilotSdkBackend implements IntelligenceBackend {
  readonly name = "copilot-sdk" as const;
  private sdk: SdkModule | undefined;
  private client: InstanceType<SdkModule["CopilotClient"]> | undefined;
  constructor(private readonly opts: CopilotSdkOptions) {}

  private async load(): Promise<SdkModule> {
    if (this.sdk) return this.sdk;
    try {
      this.sdk = await import("@github/copilot-sdk");
      return this.sdk;
    } catch (e) {
      throw new BackendError(`@github/copilot-sdk is not installed: ${(e as Error).message}`, "unavailable");
    }
  }

  private async getClient() {
    if (this.client) return this.client;
    const sdk = await this.load();
    const env: Record<string, string | undefined> = { ...process.env, COPILOT_HOME: this.opts.copilotHome, COPILOT_AUTO_UPDATE: "false" };
    if (this.opts.cliPath) env.COPILOT_CLI_PATH = this.opts.cliPath;
    const client = new sdk.CopilotClient({ baseDirectory: this.opts.copilotHome, env, logLevel: "warning" });
    await client.start();
    this.client = client;
    return client;
  }

  async probe(): Promise<BackendInfo> {
    try {
      const client = await this.getClient();
      await client.ping("execos");
      return { name: "copilot-sdk", available: true, detail: `runtime ok (model ${this.opts.model})` };
    } catch (e) {
      const msg = (e as Error).message;
      const auth = /auth|login|token|401|403/i.test(msg);
      return {
        name: "copilot-sdk", available: false, detail: msg,
        remediation: auth ? "Run `copilot login` in a terminal to sign in with your GitHub account." : "Install GitHub Copilot CLI (`npm install -g @github/copilot`) and run `copilot login`.",
      };
    }
  }

  async runSkill<TIn, TOut>(skill: Skill<TIn, TOut>, input: TIn, ctx: SkillContext, opts: RunOptions): Promise<TOut> {
    const sdk = await this.load();
    const client = await this.getClient();
    let captured: TOut | undefined;
    let lastValidationError: string | undefined;
    let attempts = 0;
    const submit = sdk.defineTool("submit_result", {
      description: `Submit the final structured result for the ${skill.name} skill. Call exactly once.`,
      parameters: skill.output as unknown as z.ZodSchema<unknown> as never,
      skipPermission: true,
      handler: async (args: unknown) => {
        attempts++;
        const parsed = skill.output.safeParse(args);
        if (!parsed.success) {
          lastValidationError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 12).join("; ");
          return { ok: false, error: `Result did not match the schema. Fix these and call submit_result again: ${lastValidationError}` };
        }
        captured = parsed.data;
        return { ok: true };
      },
    });
    const session = await client.createSession({
      model: this.opts.model === "auto" ? "auto" : this.opts.model,
      reasoningEffort: this.opts.reasoningEffort,
      tools: [submit],
      availableTools: ["custom:submit_result"],
      systemMessage: { mode: "customize", sections: { code_change_rules: { action: "remove" } }, content: skill.system(ctx) },
      onPermissionRequest: (req: { kind: string; toolName?: string }) =>
        req.kind === "custom-tool" && req.toolName === "submit_result" ? { kind: "approve-once" } : { kind: "reject", feedback: "ExecOS only permits submit_result." },
      enableSessionStore: false,
    });
    try {
      const prompt = skill.prompt(input, ctx) + "\n\nWhen done, call submit_result exactly once with the complete structured result.";
      await session.sendAndWait({ prompt }, this.opts.timeoutMs);
      if (captured === undefined && attempts > 0 && lastValidationError) {
        await session.sendAndWait({ prompt: `Your previous submit_result call was rejected: ${lastValidationError}. Call submit_result again with a corrected, complete result.` }, this.opts.timeoutMs);
      }
      if (captured === undefined) throw new BackendError(`skill ${skill.name}: model did not submit a valid result${lastValidationError ? ` (${lastValidationError})` : ""}`, "invalid_output");
      opts.logger.info("copilot-sdk skill complete", { skill: skill.name, attempts });
      return captured;
    } catch (e) {
      if (e instanceof BackendError) throw e;
      const msg = (e as Error).message;
      throw new BackendError(msg, /timeout/i.test(msg) ? "timeout" : /auth|401|403|login/i.test(msg) ? "auth" : "other");
    } finally {
      try { await session.disconnect(); } catch { /* ignore */ }
    }
  }

  async close(): Promise<void> {
    try { await this.client?.stop(); } catch { /* ignore */ }
    this.client = undefined;
  }
}
