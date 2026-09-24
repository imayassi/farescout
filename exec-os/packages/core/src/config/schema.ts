import { z } from "zod";

export const RetentionSchema = z.object({
  lookback_days: z.number().int().min(1).max(365).default(90),
  journal_days: z.number().int().min(1).max(365).default(30),
  journal_keep_days: z.number().int().min(1).max(3650).default(180),
  raw_text: z.enum(["trimmed", "full", "none"]).default("trimmed"),
});

export const AppConfigSchema = z.object({
  user: z
    .object({
      display_name: z.string().default(""),
      email: z.string().default(""),
      role: z.string().default(""),
      team_members: z.array(z.string()).default([]),
    })
    .default({}),
  retention: RetentionSchema.default({}),
  enabled_sources: z.record(z.string(), z.boolean()).default({}),
  summaries: z
    .object({
      daily: z.boolean().default(true),
      weekly: z.boolean().default(true),
      monthly: z.boolean().default(true),
      quarterly: z.boolean().default(false),
    })
    .default({}),
  themes: z
    .object({
      auto_discover: z.boolean().default(true),
      pinned: z.array(z.string()).default([]),
    })
    .default({}),
  terminology: z.record(z.string(), z.string()).default({}),
  important_roles: z.array(z.object({ title: z.string(), name: z.string().default("") })).default([]),
  intelligence: z
    .object({
      backend: z.enum(["auto", "copilot-sdk", "copilot-cli", "mock"]).default("auto"),
      copilot: z
        .object({
          command: z.string().default("copilot"),
          args: z.array(z.string()).default([]),
          model: z.string().default("auto"),
          reasoning_effort: z.enum(["low", "medium", "high"]).default("medium"),
          timeout_seconds: z.number().int().min(10).max(3600).default(240),
        })
        .default({}),
      batch: z
        .object({
          max_items: z.number().int().min(1).max(200).default(25),
          max_chars: z.number().int().min(1000).max(400000).default(60000),
        })
        .default({}),
    })
    .default({}),
  data_requests: z
    .object({
      endpoint_url: z.string().default(""),          // optional intake endpoint (POST JSON); empty = store locally only
      method: z.enum(["POST", "PUT"]).default("POST"),
      headers: z.record(z.string(), z.string()).default({}),
      timeout_seconds: z.number().int().min(1).max(120).default(15),
      default_owner: z.string().default(""),         // e.g. the data & analytics lead
    })
    .default({}),
  server: z
    .object({
      port: z.number().int().min(1024).max(65535).default(47810),
      open_window: z.boolean().default(true),
    })
    .default({}),
  logging: z.object({ level: z.enum(["error", "warn", "info", "debug"]).default("info") }).default({}),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const ProviderConfigSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    type: z.literal("mcp"),
    transport: z.enum(["stdio", "http"]).default("stdio"),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).default({}),
    adapter: z.enum(["auto", "workiq", "generic"]).default("auto"),
    scopes: z.array(z.string()).default([]),
    timeout_ms: z.number().int().min(1000).default(120000),
  }),
  z.object({
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    type: z.literal("local_docs"),
    directory: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    enabled: z.boolean().default(false),
    type: z.literal("mock"),
    scenario: z.string().default("northwind"),
  }),
]);
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const McpConfigSchema = z.object({ providers: z.array(ProviderConfigSchema).default([]) });
export type McpConfig = z.infer<typeof McpConfigSchema>;
