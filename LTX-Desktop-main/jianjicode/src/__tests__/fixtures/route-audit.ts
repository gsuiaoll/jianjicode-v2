/**
 * 路由审计工具
 *
 * 定义规范路由表，提供校验函数 — 确保 test-server 的路由集合
 * 与 server.ts 的路由集合完全一致。
 */

// ============================================================================
// 规范路由表 — server.ts 的全部路由定义
// ============================================================================

export interface RouteEntry {
  method: "GET" | "POST"
  path: string
  /** 需要认证（false 仅 /health） */
  auth: boolean
  /** 代表性请求体（POST 路由） */
  sampleBody?: Record<string, unknown>
  /** 预期的成功状态码 */
  successStatus: number
}

export const CANONICAL_ROUTES: RouteEntry[] = [
  // 公开路由
  { method: "GET", path: "/health", auth: false, successStatus: 200 },
  // 认证路由
  { method: "POST", path: "/auth/refresh", auth: true, successStatus: 200 },
  // API 路由
  { method: "GET", path: "/api/runtime-policy", auth: true, successStatus: 200 },
  { method: "GET", path: "/api/settings", auth: true, successStatus: 200 },
  { method: "POST", path: "/api/settings", auth: true, successStatus: 200 },
  { method: "GET", path: "/api/models/status", auth: true, successStatus: 200 },
  { method: "GET", path: "/api/models", auth: true, successStatus: 200 },
  // Chat 路由
  { method: "POST", path: "/chat", auth: true, sampleBody: { message: "test" }, successStatus: 200 },
  { method: "POST", path: "/chat/stream", auth: true, sampleBody: { message: "test" }, successStatus: 200 },
  { method: "POST", path: "/api/jianjicode/chat", auth: true, sampleBody: { message: "test" }, successStatus: 200 },
  { method: "POST", path: "/api/jianjicode/chat/stream", auth: true, sampleBody: { message: "test" }, successStatus: 200 },
  // 权限
  { method: "POST", path: "/permission/reply", auth: true, successStatus: 410 }, // 无 pending 请求时返回 410
  // Nudge
  { method: "GET", path: "/nudges", auth: true, successStatus: 200 },
  { method: "POST", path: "/nudges/clear", auth: true, successStatus: 200 },
  { method: "GET", path: "/nudges/stream", auth: true, successStatus: 200 },
  // Curator
  { method: "GET", path: "/curator/report", auth: true, successStatus: 200 },
  // LTX 健康检查
  { method: "GET", path: "/api/ltx/health", auth: true, successStatus: 200 },
  // LTX 编辑代理（通配符路由）
  { method: "POST", path: "/api/edit/trim", auth: true, sampleBody: { input_file: "test.mp4" }, successStatus: 200 },
  { method: "GET", path: "/api/edit/video_info", auth: true, successStatus: 200 },
]

// ============================================================================
// 校验函数
// ============================================================================

export interface TestServerOps {
  app: { request: (path: string, init?: RequestInit) => Promise<Response> }
  token: string
}

/**
 * 对每个规范路由发请求，验证：
 *   1. 状态码在预期范围内（不是 404）
 *   2. 无 token 时返回 401（除了 /health）
 */
export async function auditRoutes(
  ops: TestServerOps,
): Promise<{ route: RouteEntry; error?: string }[]> {
  const errors: { route: RouteEntry; error?: string }[] = []

  for (const route of CANONICAL_ROUTES) {
    const { method, path, auth, sampleBody } = route

    // 验证路由存在（带 token 发请求）
    const headers: Record<string, string> = auth
      ? { Authorization: `Bearer ${ops.token}` }
      : {}
    if (sampleBody) {
      headers["Content-Type"] = "application/json"
    }

    try {
      const res = await ops.app.request(path, {
        method,
        headers,
        body: sampleBody ? JSON.stringify(sampleBody) : undefined,
      })

      // 不应该返回 404（路由缺失）
      if (res.status === 404) {
        errors.push({ route, error: `Route ${method} ${path} returned 404 — missing` })
      }
    } catch (err: any) {
      errors.push({ route, error: `Request failed: ${err.message}` })
    }

    // 验证 401 行为（公开路由除外）
    if (auth) {
      try {
        const unauthRes = await ops.app.request(path, {
          method,
          headers: sampleBody ? { "Content-Type": "application/json" } : {},
          body: sampleBody ? JSON.stringify(sampleBody) : undefined,
        })
        if (unauthRes.status !== 401 && unauthRes.status !== 429) {
          errors.push({
            route,
            error: `Route ${method} ${path} without token returned ${unauthRes.status} (expected 401 or 429)`,
          })
        }
      } catch (err: any) {
        errors.push({ route, error: `Unauth request failed: ${err.message}` })
      }
    }
  }

  return errors
}
