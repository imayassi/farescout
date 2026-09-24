import type { AppConfig } from "../../config/schema.js";
import type { AppPaths } from "../../config/paths.js";
import type { Logger } from "../../logging/logger.js";
import type { IntelligenceBackend, BackendInfo } from "./types.js";
import { MockBackend } from "./mock.js";
import { CopilotSdkBackend } from "./copilot-sdk.js";
import { CopilotCliBackend } from "./copilot-cli.js";

export * from "./types.js";
export { MockBackend, CopilotSdkBackend, CopilotCliBackend };

export interface BackendSelection { backend: IntelligenceBackend; probes: BackendInfo[]; degraded: boolean }

/**
 * Select the intelligence backend: explicit config wins; "auto" tries SDK, then CLI, then mock
 * (mock only when a mock provider is enabled, so real data is never analyzed by heuristics silently).
 */
export async function selectBackend(app: AppConfig, paths: AppPaths, logger: Logger, opts: { allowMock: boolean }): Promise<BackendSelection> {
  const cfg = app.intelligence;
  const mk = {
    "copilot-sdk": () => new CopilotSdkBackend({ copilotHome: paths.copilotHome, model: cfg.copilot.model, reasoningEffort: cfg.copilot.reasoning_effort, timeoutMs: cfg.copilot.timeout_seconds * 1000 }),
    "copilot-cli": () => new CopilotCliBackend({ command: cfg.copilot.command, args: cfg.copilot.args, copilotHome: paths.copilotHome, model: cfg.copilot.model, timeoutMs: cfg.copilot.timeout_seconds * 1000 }),
    mock: () => new MockBackend(),
  } as const;
  const probes: BackendInfo[] = [];
  const order: Array<keyof typeof mk> = cfg.backend === "auto" ? ["copilot-sdk", "copilot-cli", "mock"] : [cfg.backend];
  for (const name of order) {
    if (name === "mock" && !opts.allowMock && cfg.backend === "auto") continue;
    const b = mk[name]();
    const info = await b.probe();
    probes.push(info);
    if (info.available) {
      logger.info("intelligence backend selected", { backend: name });
      return { backend: b, probes, degraded: name === "mock" && cfg.backend !== "mock" };
    }
    await (b as IntelligenceBackend).close?.();
  }
  // Nothing usable: return the mock backend but flag degraded so the UI shows it clearly.
  logger.warn("no intelligence backend available; running in degraded mode (no analysis)");
  return { backend: new MockBackend(), probes, degraded: true };
}
