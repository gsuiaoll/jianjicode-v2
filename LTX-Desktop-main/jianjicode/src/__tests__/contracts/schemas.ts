/**
 * 端点响应 Zod 契约
 *
 * 每个端点定义 success + error 两种响应 schema。
 * 新增路由时，在此追加对应 schema 即可触发契约覆盖。
 */

import { z } from "zod"

// ============================================================================
// 通用错误信封
// ============================================================================

export const Auth401 = z.object({
  success: z.literal(false),
  error: z.string(),
})

export const Auth429 = z.object({
  success: z.literal(false),
  error: z.literal("Too many requests"),
})

export const Server500 = z.object({
  success: z.literal(false),
  error: z.string(),
})

// ============================================================================
// GET /health
// ============================================================================

export const Health200 = z.object({
  status: z.literal("ok"),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
  models_loaded: z.boolean().optional(),
  gpu_info: z.object({
    name: z.string(),
    vram: z.number(),
    vram_used: z.number(),
  }).optional(),
})

// ============================================================================
// POST /auth/refresh
// ============================================================================

export const AuthRefresh200 = z.object({
  success: z.literal(true),
  token: z.string(),
})

// ============================================================================
// POST /chat
// ============================================================================

export const Chat200 = z.object({
  success: z.literal(true),
  output: z.string(),
  title: z.string(),
  operation: z.string(),
  sessionId: z.string(),
  data: z.object({
    analysis: z.string(),
    operation: z.string(),
    output: z.string(),
    title: z.string(),
    sessionId: z.string(),
  }),
})

export const Chat400 = z.object({
  success: z.literal(false),
  error: z.string(),
})

// ============================================================================
// POST /chat/stream (SSE — 验证 result 事件负载)
// ============================================================================

export const SseResultEvent = z.object({
  success: z.literal(true),
  output: z.string(),
  title: z.string(),
  operation: z.string(),
  sessionId: z.string(),
})

// ============================================================================
// POST /api/jianjicode/chat
// ============================================================================

export const JianjicodeChat200 = Chat200
export const JianjicodeChat400 = Chat400

// ============================================================================
// POST /api/jianjicode/chat/stream
// ============================================================================

export const JianjicodeSseResult = SseResultEvent

// ============================================================================
// POST /permission/reply
// ============================================================================

export const PermissionReply200 = z.object({
  success: z.literal(true),
})

export const PermissionReply400 = z.object({
  success: z.literal(false),
  error: z.string(),
})

export const PermissionReply410 = z.object({
  success: z.literal(false),
  error: z.string(),
})

// ============================================================================
// GET /nudges
// ============================================================================

export const Nudge200 = z.object({
  success: z.literal(true),
  data: z.array(
    z.object({
      id: z.string().optional(),
      type: z.string(),
      message: z.string().optional(),
      content: z.string().optional(),
    }),
  ),
})

// ============================================================================
// POST /nudges/clear
// ============================================================================

export const NudgeClear200 = z.object({
  success: z.literal(true),
})

// ============================================================================
// GET /nudges/stream (SSE connected event)
// ============================================================================

export const NudgeConnectedEvent = z.object({
  timestamp: z.string(),
})

// ============================================================================
// GET /curator/report
// ============================================================================

export const CuratorReport200 = z.object({
  success: z.literal(true),
  data: z.any(),
})

// ============================================================================
// GET /api/runtime-policy
// ============================================================================

export const RuntimePolicy200 = z.object({
  force_api_generations: z.boolean(),
})

// ============================================================================
// GET /api/settings / POST /api/settings
// ============================================================================

export const Settings200 = z.object({
  useTorchCompile: z.boolean(),
  loadOnStartup: z.boolean(),
  hasLtxApiKey: z.boolean(),
  userPrefersLtxApiVideoGenerations: z.boolean().optional(),
  hasFalApiKey: z.boolean().optional(),
  hasGeminiApiKey: z.boolean().optional(),
  useLocalTextEncoder: z.boolean().optional(),
  fastModel: z.object({ useUpscaler: z.boolean() }),
  proModel: z.object({ steps: z.number(), useUpscaler: z.boolean() }),
  promptCacheSize: z.number().optional(),
  promptEnhancerEnabledT2V: z.boolean().optional(),
  promptEnhancerEnabledI2V: z.boolean().optional(),
  seedLocked: z.boolean().optional(),
  lockedSeed: z.number().optional(),
  modelsDir: z.string().optional(),
})

export const SettingsPost200 = z.object({
  success: z.literal(true),
})

// ============================================================================
// GET /api/models/status
// ============================================================================

export const ModelsStatus200 = z.object({
  all_downloaded: z.boolean(),
})

// ============================================================================
// GET /api/models
// ============================================================================

export const Models200 = z.object({
  models: z.array(z.any()),
})

// ============================================================================
// GET /api/ltx/health
// ============================================================================

export const LtxHealthOk = z.object({
  status: z.literal("ok"),
  ltx: z.any(),
  proxy: z.literal("jianjicode"),
  timestamp: z.string(),
})

export const LtxHealthUnhealthy = z.object({
  status: z.literal("unhealthy"),
  ltx_url: z.string(),
  error: z.string(),
})

export const LtxHealthUnreachable = z.object({
  status: z.literal("unreachable"),
  ltx_url: z.string(),
  error: z.string(),
})

export const LtxHealthResponse = z.discriminatedUnion("status", [
  LtxHealthOk,
  LtxHealthUnhealthy,
  LtxHealthUnreachable,
])

// ============================================================================
// POST /api/edit/*  &  GET /api/edit/*
// ============================================================================

export const LtxEditProxy502 = z.object({
  success: z.literal(false),
  error: z.string(),
})

// 契约集 — 按端点索引
export const contracts = {
  health: { ok: Health200 },
  "auth/refresh": { ok: AuthRefresh200, auth401: Auth401 },
  chat: { ok: Chat200, bad400: Chat400, auth401: Auth401 },
  "chat/stream": { sseResult: SseResultEvent, bad400: Chat400, auth401: Auth401 },
  "api/jianjicode/chat": { ok: JianjicodeChat200, bad400: JianjicodeChat400, auth401: Auth401 },
  "api/jianjicode/chat/stream": { sseResult: JianjicodeSseResult, bad400: Chat400, auth401: Auth401 },
  "permission/reply": { ok: PermissionReply200, bad400: PermissionReply400, gone410: PermissionReply410, auth401: Auth401 },
  nudges: { ok: Nudge200, auth401: Auth401 },
  "nudges/clear": { ok: NudgeClear200, auth401: Auth401 },
  "nudges/stream": { sseConnected: NudgeConnectedEvent, auth401: Auth401 },
  "curator/report": { ok: CuratorReport200, auth401: Auth401 },
  "api/runtime-policy": { ok: RuntimePolicy200 },
  "api/settings": { ok: Settings200 },
  "api/settings#post": { ok: SettingsPost200 },
  "api/models/status": { ok: ModelsStatus200 },
  "api/models": { ok: Models200 },
  "api/ltx/health": { ok: LtxHealthResponse },
  "api/edit/*": { proxy502: LtxEditProxy502, auth401: Auth401 },
} as const
