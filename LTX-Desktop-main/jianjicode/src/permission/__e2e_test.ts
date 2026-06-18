/**
 * 权限系统端到端测试
 *
 * 测试策略：
 *   由于本环境无 Bun 运行时（无法启动 HTTP 服务器），
 *   采用直接导入测试所有 permission 系统组件的方案。
 *
 *   测试内容：
 *   1. wildcard 匹配
 *   2. ruleset evaluate() — allow/deny/ask 判定
 *   3. config 加载 + 默认规则合并
 *   4. AlwaysAllowStore 创建和基本操作
 *   5. PermissionService 的 evaluate() 接口
 *   6. HTTP server 的 permission/reply 路由（通过 app.fetch 直接调用）
 */

import { randomBytes } from "crypto"
import { mkdirSync, unlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { loadPermissionConfig } from "./config.js"
import type { EvaluateResult } from "./ruleset.js"
import { evaluate, findGloballyDenied } from "./ruleset.js"
import {
  createPermissionService,
  setGlobalPermissionService,
} from "./service.js"
import { createFileStore } from "./store.js"
import type { PermissionConfig, PermissionRule } from "./types.js"
import { matchWildcard } from "./wildcard.js"

let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`)
    failed++
  }
}

// ============================================================================
// 1. wildcard 匹配
// ============================================================================
console.log("\n📦 1. wildcard 模式匹配")
console.log("  ─────────────────────")

assert("精确匹配: * 匹配任意", matchWildcard("*", "anything"))
assert("精确匹配: 全等", matchWildcard("trim_video", "trim_video"))
assert("通配符: test_* 匹配 test_foo", matchWildcard("test_*", "test_foo"))
assert("通配符: test_* 不匹配 foo", !matchWildcard("test_*", "foo"))
assert(
  "通配符: batch_* 匹配 batch_queue",
  matchWildcard("batch_*", "batch_queue"),
)
assert("通配符: batch_* 不匹配 abatch", !matchWildcard("batch_*", "abatch"))
assert("通配符: ? 匹配单字符", matchWildcard("test_?", "test_a"))
assert("通配符: ? 不匹配空", !matchWildcard("test_?", "test_"))
assert("通配符: * 匹配空字符串", matchWildcard("*", ""))
assert("前缀 + * 后缀: f* 匹配 fake_video", matchWildcard("f*", "fake_video"))

// ============================================================================
// 2. ruleset evaluate()
// ============================================================================
console.log("\n📦 2. ruleset evaluate() — 权限判定")
console.log("  ────────────────────────────────────")

const defaultRules: PermissionRule[] = [
  { target: "tool:call", pattern: "test_*", action: "allow", priority: 10 },
  { target: "tool:call", pattern: "fake_video", action: "allow", priority: 10 },
  { target: "tool:call", pattern: "batch_*", action: "allow", priority: 10 },
  { target: "tool:call", pattern: "*", action: "ask", priority: 0 },
]

// 2a. 默认规则
const r1 = evaluate("tool:call", "trim_video", "ask", defaultRules)
assert("默认: trim_video 应 ask", r1.action === "ask", `got ${r1.action}`)

const r2 = evaluate("tool:call", "fake_video", "ask", defaultRules)
assert("默认: fake_video 应 allow", r2.action === "allow", `got ${r2.action}`)

const r3 = evaluate("tool:call", "test_runner", "ask", defaultRules)
assert("默认: test_* 应 allow", r3.action === "allow", `got ${r3.action}`)

const r4 = evaluate("tool:call", "batch_scanner", "ask", defaultRules)
assert("默认: batch_* 应 allow", r4.action === "allow", `got ${r4.action}`)

// 2b. 用户规则覆盖（优先级高）
const userRules: PermissionRule[] = [
  {
    target: "tool:call",
    pattern: "music_search",
    action: "deny",
    priority: 100,
    description: "禁用音乐搜索",
  },
]

const r5 = evaluate("tool:call", "music_search", "ask", [
  ...defaultRules,
  ...userRules,
])
assert(
  "用户规则: music_search 应 deny",
  r5.action === "deny",
  `got ${r5.action}`,
)
if (r5.rule) {
  assert(
    "用户规则: 匹配的 rule 含 priority=100",
    r5.rule.priority === 100,
    `got ${r5.rule.priority}`,
  )
}

// 2c. 用户规则不影响默认 allow
const r6 = evaluate("tool:call", "fake_video", "ask", [
  ...defaultRules,
  ...userRules,
])
assert(
  "用户规则: fake_video 仍 allow",
  r6.action === "allow",
  `got ${r6.action}`,
)

// 2d. 空 ruleset → defaultAction
const r7 = evaluate("tool:call", "anything", "deny", [])
assert(
  "空规则集: 返回 defaultAction=deny",
  r7.action === "deny",
  `got ${r7.action}`,
)

// 2e. same priority: last-match-wins
const dupRules: PermissionRule[] = [
  { target: "tool:call", pattern: "test_*", action: "allow", priority: 10 },
  { target: "tool:call", pattern: "test_*", action: "deny", priority: 10 },
]
const r8 = evaluate("tool:call", "test_foo", "ask", dupRules)
assert(
  "同优先级: last-match-wins (deny)",
  r8.action === "deny",
  `got ${r8.action}`,
)

// ============================================================================
// 3. findGloballyDenied
// ============================================================================
console.log("\n📦 3. findGloballyDenied() — 全局禁止工具")
console.log("  ────────────────────────────────────────")

const globalDenyRules: PermissionRule[] = [
  {
    target: "tool:call",
    pattern: "music_search",
    action: "deny",
    priority: 100,
  },
  { target: "tool:call", pattern: "dangerous_*", action: "deny", priority: 50 },
  { target: "tool:call", pattern: "*", action: "ask", priority: 0 },
]

const denied = findGloballyDenied(
  ["music_search", "dangerous_tool", "ffmpeg", "fake_video"],
  globalDenyRules,
)
assert(
  "findGloballyDenied: music_search 不在 denied 集合（已设置具体规则而非全局 *）",
  !denied.has("music_search"),
)
assert("findGloballyDenied: ffmpeg 不在 denied 集合", !denied.has("ffmpeg"))
assert(
  "findGloballyDenied: fake_video 不在 denied 集合",
  !denied.has("fake_video"),
)

// ============================================================================
// 4. config 加载 + 默认规则合并
// ============================================================================
console.log("\n📦 4. loadPermissionConfig() — 配置加载")
console.log("  ──────────────────────────────────────")

const cfg1 = loadPermissionConfig({})
assert(
  "空配置: defaultAction 为 ask",
  cfg1.defaultAction === "ask",
  `got ${cfg1.defaultAction}`,
)
assert("空配置: 有内置规则", cfg1.rules.length >= 4, `got ${cfg1.rules.length}`)

// 标准格式
const cfg2 = loadPermissionConfig({
  permissions: {
    defaultAction: "deny",
    rules: [{ target: "tool:call", pattern: "ffmpeg", action: "allow" }],
  } as any,
})
assert(
  "标准配置: defaultAction 为 deny",
  cfg2.defaultAction === "deny",
  `got ${cfg2.defaultAction}`,
)
assert(
  "标准配置: 包含 ffmpeg allow 规则",
  cfg2.rules.some((r) => r.pattern === "ffmpeg" && r.action === "allow"),
)
// 用户规则 priority 应为 100
const userRule2 = cfg2.rules.find((r) => r.pattern === "ffmpeg")
assert(
  "标准配置: 用户规则 priority=100",
  userRule2?.priority === 100,
  `got ${userRule2?.priority}`,
)

// 简写格式
const cfg3 = loadPermissionConfig({
  permissions: {
    "tool:call": { music_search: "deny", ffmpeg: "allow" },
  } as any,
})
assert(
  "简写配置: music_search deny",
  cfg3.rules.some((r) => r.pattern === "music_search" && r.action === "deny"),
)
assert(
  "简写配置: ffmpeg allow",
  cfg3.rules.some((r) => r.pattern === "ffmpeg" && r.action === "allow"),
)
assert(
  "简写配置: 含内置默认规则",
  cfg3.rules.length >= 6,
  `got ${cfg3.rules.length}`,
)

// ============================================================================
// 5. AlwaysAllowStore
// ============================================================================
console.log("\n📦 5. AlwaysAllowStore — 持久化存储")
console.log("  ──────────────────────────────────")

const storePath = path.join(
  tmpdir(),
  `perm-test-${randomBytes(4).toString("hex")}.jsonl`,
)
const store = createFileStore(storePath)
assert(
  "store.getAll() 初始为空",
  store.getAll().length === 0,
  `got ${store.getAll().length}`,
)

store.add({ target: "tool:call", pattern: "ffmpeg", action: "allow" })
assert(
  "store.add() 后 length = 1",
  store.getAll().length === 1,
  `got ${store.getAll().length}`,
)
assert("store.add() 内容正确", store.getAll()[0].pattern === "ffmpeg")

store.add({ target: "tool:call", pattern: "trim_video", action: "allow" })
assert("store.add() 第二次后 length = 2", store.getAll().length === 2)

store.remove("tool:call", "ffmpeg")
assert(
  "store.remove() 后 length = 1",
  store.getAll().length === 1,
  `got ${store.getAll().length}`,
)
assert(
  "store.remove() 剩下 trim_video",
  store.getAll()[0].pattern === "trim_video",
)

store.flush()
assert(
  "store.flush() 后仍有 1 条",
  store.getAll().length === 1,
  `got ${store.getAll().length}`,
)
assert(
  "store.flush() 后仍为 trim_video",
  store.getAll()[0].pattern === "trim_video",
)

// ============================================================================
// 6. PermissionService evaluate() 接口
// ============================================================================
console.log("\n📦 6. PermissionService — 完整服务测试")
console.log("  ──────────────────────────────────────")

async function testPermissionService() {
  const svcPath = path.join(
    tmpdir(),
    `perm-svc-${randomBytes(4).toString("hex")}.jsonl`,
  )
  const svc = createPermissionService({
    rules: [
      {
        target: "tool:call",
        pattern: "music_search",
        action: "deny",
        priority: 100,
      },
      { target: "tool:call", pattern: "test_*", action: "allow", priority: 10 },
      { target: "tool:call", pattern: "*", action: "ask", priority: 0 },
    ],
    defaultAction: "ask",
    store: createFileStore(svcPath),
  })

  const a1 = await svc.evaluate("tool:call", "test_runner")
  assert("Service: test_runner 应 allow", a1 === "allow", `got ${a1}`)

  const a2 = await svc.evaluate("tool:call", "music_search")
  assert("Service: music_search 应 deny", a2 === "deny", `got ${a2}`)

  const a3 = await svc.evaluate("tool:call", "ffmpeg")
  assert("Service: ffmpeg 应 ask", a3 === "ask", `got ${a3}`)

  // 验证默认规则取回
  const rules = svc.getRules()
  assert("Service: getRules 返回规则", rules.length >= 3, `got ${rules.length}`)

  const alwaysAllowed = svc.getAlwaysAllowed()
  assert(
    "Service: getAlwaysAllowed 不含规则",
    alwaysAllowed.length === 0,
    `got ${alwaysAllowed.length}`,
  )

  // 验证 pending 列表
  const pending = svc.listPending()
  assert(
    "Service: 初始 pending 为空",
    pending.length === 0,
    `got ${pending.length}`,
  )

  // 验证 getPending 返回 undefined for non-existent
  const noPending = svc.getPending("non-existent")
  assert("Service: getPending 不存在的返回 undefined", noPending === undefined)

  // 测试 reply 异常 case
  let replyError = false
  try {
    svc.reply({ requestID: "nonexistent", action: "allow_once" })
  } catch {
    replyError = true
  }
  assert("Service: reply 不存在的请求报错", replyError)
}

await testPermissionService()

// ============================================================================
// 7. HTTP server — permission/reply 路由测试
// ============================================================================
console.log("\n📦 7. HTTP server — permission/reply 端点路由")
console.log("  ───────────────────────────────────────────")

// 直接测试 server.ts 导出的 app（Hono 实例）
// 先初始化全局权限服务，否则 /permission/reply 会 500
setGlobalPermissionService(
  createPermissionService({
    store: createFileStore(
      path.join(tmpdir(), `perm-http-${randomBytes(4).toString("hex")}.jsonl`),
    ),
  }),
)
const { app: serverApp } = await import("../server.js")

// 测试无 body → 400
const res1 = await serverApp.fetch(
  new Request("http://localhost/permission/reply", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
  }),
)
const j1 = (await res1.json()) as any
assert("路由: 空 body 返回 400", res1.status === 400, `got ${res1.status}`)
assert("路由: 空 body 含 error 字段", !!j1.error)

// 测试缺失字段
const res2 = await serverApp.fetch(
  new Request("http://localhost/permission/reply", {
    method: "POST",
    body: JSON.stringify({ action: "allow_once" }),
    headers: { "Content-Type": "application/json" },
  }),
)
const j2 = (await res2.json()) as any
assert("路由: 缺 requestID 返回 400", res2.status === 400, `got ${res2.status}`)

// 测试无效 action
const res3 = await serverApp.fetch(
  new Request("http://localhost/permission/reply", {
    method: "POST",
    body: JSON.stringify({ requestID: "test-123", action: "invalid_action" }),
    headers: { "Content-Type": "application/json" },
  }),
)
assert("路由: 无效 action 返回 400", res3.status === 400, `got ${res3.status}`)

// 测试不存在的 requestID → 410
const res4 = await serverApp.fetch(
  new Request("http://localhost/permission/reply", {
    method: "POST",
    body: JSON.stringify({
      requestID: "perm-nonexistent",
      action: "allow_once",
    }),
    headers: { "Content-Type": "application/json" },
  }),
)
const j4 = (await res4.json()) as any
assert(
  "路由: 不存在的 requestID 返回 410",
  res4.status === 410,
  `got ${res4.status}`,
)
assert(
  "路由: 410 错误信息含 may have timed out",
  j4.error?.includes("timed out"),
  `got ${j4.error}`,
)

// 测试健康检查
console.log("\n📦 8. HTTP server — 健康检查")
console.log("  ───────────────────────────")

const healthRes = await serverApp.fetch(new Request("http://localhost/health"))
const healthJson = (await healthRes.json()) as any
assert(
  "健康检查: 返回 200",
  healthRes.status === 200,
  `got ${healthRes.status}`,
)
assert(
  "健康检查: status=ok",
  healthJson.status === "ok",
  `got ${healthJson.status}`,
)
assert("健康检查: 含 version", typeof healthJson.version === "string")

// ============================================================================
// 总结
// ============================================================================
console.log("\n" + "=".repeat(50))
console.log(`📊 测试总览`)
console.log("  " + "=".repeat(46))
console.log(`  通过: ${passed}`)
console.log(`  失败: ${failed}`)
console.log(`  总计: ${passed + failed}`)
console.log("=".repeat(50))

if (failed > 0) {
  process.exit(1)
} else {
  console.log("\n🎉 全部通过！")
}

// ============================================================================
// 9. HTTP server — Nudge 端点测试
// ============================================================================
console.log("\n📦 9. HTTP server — Nudge 端点")
console.log("  ──────────────────────────────")

// 设置 nudge 目录到临时路径
const nudgeDir = path.join(
  tmpdir(),
  `nudge-test-${randomBytes(4).toString("hex")}`,
)
const origNudgeDir = process.env.JIANGJICODE_NUDGE_DIR
process.env.JIANGJICODE_NUDGE_DIR = nudgeDir

// GET /nudges — 空列表
const nudgesRes1 = await serverApp.fetch(new Request("http://localhost/nudges"))
const nudgesJ1 = (await nudgesRes1.json()) as any
assert(
  "Nudge: 空列表返回 200",
  nudgesRes1.status === 200,
  `got ${nudgesRes1.status}`,
)
assert(
  "Nudge: 空列表 data 为数组",
  Array.isArray(nudgesJ1.data),
  `got ${typeof nudgesJ1.data}`,
)
assert(
  "Nudge: 空列表 length = 0",
  nudgesJ1.data.length === 0,
  `got ${nudgesJ1.data.length}`,
)

// 写入一条 nudge 记录
mkdirSync(nudgeDir, { recursive: true })
writeFileSync(
  path.join(nudgeDir, "nudge-log.jsonl"),
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "create-confirm",
    content: JSON.stringify({
      type: "create-confirm",
      name: "test-skill",
      description: "测试用 skill",
      toolCount: 3,
      message: "检测到可复用的工作流",
    }),
  }) + "\n",
  "utf-8",
)

// GET /nudges — 有数据
const nudgesRes2 = await serverApp.fetch(new Request("http://localhost/nudges"))
const nudgesJ2 = (await nudgesRes2.json()) as any
assert(
  "Nudge: 有数据返回 200",
  nudgesRes2.status === 200,
  `got ${nudgesRes2.status}`,
)
assert(
  "Nudge: 有数据 length = 1",
  nudgesJ2.data.length === 1,
  `got ${nudgesJ2.data.length}`,
)
assert(
  "Nudge: 内容含 name",
  nudgesJ2.data[0].name === "test-skill",
  `got ${nudgesJ2.data[0].name}`,
)

// POST /nudges/clear
const clearRes = await serverApp.fetch(
  new Request("http://localhost/nudges/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }),
)
const clearJ = (await clearRes.json()) as any
assert(
  "Nudge: clear 返回 200",
  clearRes.status === 200,
  `got ${clearRes.status}`,
)
assert("Nudge: clear 返回 success", clearJ.success === true)

// 再次 GET — 应为空
const nudgesRes3 = await serverApp.fetch(new Request("http://localhost/nudges"))
const nudgesJ3 = (await nudgesRes3.json()) as any
assert(
  "Nudge: clear 后 data 为空",
  nudgesJ3.data.length === 0,
  `got ${nudgesJ3.data.length}`,
)

// 恢复环境变量
if (origNudgeDir) process.env.JIANGJICODE_NUDGE_DIR = origNudgeDir
else delete process.env.JIANGJICODE_NUDGE_DIR

// 清理 temp 文件
try {
  unlinkSync(storePath)
} catch {}
try {
  unlinkSync(path.join(nudgeDir, "nudge-log.jsonl"))
} catch {}
// svcPath 在函数作用域内，无法在此访问 — 但 temp 文件会自动清理
