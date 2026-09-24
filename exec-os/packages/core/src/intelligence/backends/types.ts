import type { Skill, SkillContext } from "../skills/index.js";
import type { Logger } from "../../logging/logger.js";

export interface BackendInfo {
  name: "mock" | "copilot-sdk" | "copilot-cli";
  available: boolean;
  detail?: string;
  remediation?: string;
}

export interface RunOptions {
  logger: Logger;
  signal?: AbortSignal;
  /** Raw evidence for the mock backend to map fixtures against (ignored by real backends). */
  batchEvidence?: Array<{ evidence_id: string; source_ref_id: string; source_type: string; title: string; text?: string; occurred_at: string }>;
}

export interface IntelligenceBackend {
  readonly name: BackendInfo["name"];
  probe(): Promise<BackendInfo>;
  runSkill<TIn, TOut>(skill: Skill<TIn, TOut>, input: TIn, ctx: SkillContext, opts: RunOptions): Promise<TOut>;
  close?(): Promise<void>;
}

export class BackendError extends Error {
  constructor(message: string, readonly kind: "unavailable" | "auth" | "timeout" | "invalid_output" | "other" = "other") {
    super(message);
    this.name = "BackendError";
  }
}
