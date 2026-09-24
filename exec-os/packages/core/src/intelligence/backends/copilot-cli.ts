/**
 * Fallback backend: GitHub Copilot CLI in non-interactive mode (verified flags, CLI 1.0.88):
 *   copilot -p "<prompt>" -s --output-format json --no-ask-user --disable-builtin-mcps
 *           --deny-tool shell --deny-tool write --deny-tool url --no-custom-instructions
 * The model is asked to return a single fenced JSON block, which is validated against the skill schema.
 * The executable is configurable so an enterprise wrapper (e.g. `agency`) can be substituted.
 */
import { spawn } from "node:child_process";
import type { IntelligenceBackend, BackendInfo, RunOptions } from "./types.js";
import { BackendError } from "./types.js";
import type { Skill, SkillContext } from "../skills/index.js";

export interface CopilotCliOptions {
  command: string;
  args: string[];
  copilotHome: string;
  model: string;
  timeoutMs: number;
}

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c.trim()); } catch { /* try next */ }
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  }
  return undefined;
}

export class CopilotCliBackend implements IntelligenceBackend {
  readonly name = "copilot-cli" as const;
  constructor(private readonly opts: CopilotCliOptions) {}

  private run(args: string[], timeoutMs: number, stdin?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.command, [...this.opts.args, ...args], {
        env: { ...process.env, COPILOT_HOME: this.opts.copilotHome, COPILOT_AUTO_UPDATE: "false", NO_COLOR: "1" },
        shell: process.platform === "win32",
        windowsHide: true,
      });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => { child.kill(); reject(new BackendError(`copilot cli timed out after ${timeoutMs}ms`, "timeout")); }, timeoutMs);
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => { clearTimeout(timer); reject(new BackendError(`cannot start ${this.opts.command}: ${e.message}`, "unavailable")); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      if (stdin !== undefined) child.stdin.end(stdin); else child.stdin.end();
    });
  }

  async probe(): Promise<BackendInfo> {
    try {
      const r = await this.run(["--version"], 20000);
      if (r.code !== 0) return { name: "copilot-cli", available: false, detail: (r.stderr || r.stdout).slice(0, 300), remediation: "Run `copilot login`." };
      return { name: "copilot-cli", available: true, detail: (r.stdout || r.stderr).trim().split("\n")[0] };
    } catch (e) {
      return { name: "copilot-cli", available: false, detail: (e as Error).message, remediation: `Install GitHub Copilot CLI (npm install -g @github/copilot) or set intelligence.copilot.command to your launcher (e.g. "agency").` };
    }
  }

  async runSkill<TIn, TOut>(skill: Skill<TIn, TOut>, input: TIn, ctx: SkillContext, opts: RunOptions): Promise<TOut> {
    const prompt = `${skill.system(ctx)}\n\n${skill.prompt(input, ctx)}\n\nReturn ONLY a single fenced \`\`\`json block containing the result object. No prose before or after.`;
    const args = ["-p", prompt, "-s", "--output-format", "json", "--no-ask-user", "--disable-builtin-mcps", "--no-custom-instructions",
      "--deny-tool", "shell", "--deny-tool", "write", "--deny-tool", "url"];
    if (this.opts.model && this.opts.model !== "auto") args.push("--model", this.opts.model);
    const r = await this.run(args, this.opts.timeoutMs);
    if (r.code !== 0 && !r.stdout.trim()) {
      const msg = (r.stderr || "copilot exited with error").slice(0, 400);
      throw new BackendError(msg, /auth|login|token|401|403/i.test(msg) ? "auth" : "other");
    }
    // JSONL: collect assistant text from the last assistant message; fall back to raw stdout.
    let text = "";
    for (const line of r.stdout.split(/\r?\n/)) {
      if (!line.trim().startsWith("{")) continue;
      try {
        const ev = JSON.parse(line) as { type?: string; data?: { content?: string }; content?: string; message?: string };
        const c = ev.data?.content ?? ev.content ?? ev.message;
        if (typeof c === "string" && /assistant|message/i.test(ev.type ?? "message")) text = c;
      } catch { /* not json */ }
    }
    const json = extractJson(text || r.stdout);
    const parsed = skill.output.safeParse(json);
    if (!parsed.success) {
      opts.logger.warn("copilot-cli invalid output", { skill: skill.name, issues: parsed.error.issues.length });
      throw new BackendError(`skill ${skill.name}: output did not match schema (${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message})`, "invalid_output");
    }
    return parsed.data;
  }
}
