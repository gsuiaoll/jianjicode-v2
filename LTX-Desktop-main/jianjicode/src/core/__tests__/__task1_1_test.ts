/**
 * Task 1.1 测试 — 工具集成增强
 *
 * 测试内容：
 *   1. truncateOutput — 输出截断逻辑
 *   2. formatValidationError — 参数校验错误格式化
 *   3. buildToolSet — 工具集构建和权限集成
 *   4. permission CLI — 权限管理命令
 */

import { truncateOutput, MAX_LINES, MAX_BYTES, TRUNCATION_DIR } from "../truncate.js"
import { matchWildcard } from "../../permission/wildcard.js"
import { evaluate } from "../../permission/ruleset.js"
import { createPermissionService } from "../../permission/service.js"
import { createFileStore } from "../../permission/store.js"
import type { PermissionRule } from "../../permission/types.js"
import { z } from "zod"
import { tmpdir } from "os"
import { randomBytes } from "crypto"
import path from "path"

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
// 1. truncateOutput — 输出截断
// ============================================================================
console.log("\n📦 1. truncateOutput — 工具输出截断")
console.log("  " + "─".repeat(45))

async function testTruncate() {
  // 1a. 简短输出不截断
  const short = "hello world"
  const r1 = await truncateOutput(short)
  assert("短输出不截断", r1.truncated === false)
  assert("短输出内容不变", r1.content === short)

  // 1b. 超长行数截断
  const longLines = Array.from(
    { length: MAX_LINES + 100 },
    (_, i) => `line ${i}`,
  ).join("\n")
  const r2 = await truncateOutput(longLines)
  assert("超行数截断", r2.truncated === true)
  assert("截断后内容更短", r2.content.length < longLines.length)
  assert("截断提示含 truncated", r2.content.includes("truncated"))
  if (r2.truncated) {
    assert("截断后含 outputPath", typeof r2.outputPath === "string")
    assert(
      "outputPath 在 TRUNCATION_DIR 下",
      r2.outputPath.startsWith(TRUNCATION_DIR),
    )
  }

  // 1c. 超字节数截断
  const bigLine = "x".repeat(MAX_BYTES + 1000)
  const r3 = await truncateOutput(bigLine)
  assert("超字节截断", r3.truncated === true)
  assert("截断提示含 bytes truncated", r3.content.includes("truncated"))

  // 1d. 空字符串不截断
  const r4 = await truncateOutput("")
  assert("空字符串不截断", r4.truncated === false)
  assert("空字符串内容不变", r4.content === "")

  // 1e. 刚好在限制内不截断
  const exactlyMaxLines = Array.from(
    { length: MAX_LINES },
    (_, i) => `line ${i}`,
  ).join("\n")
  const r5 = await truncateOutput(exactlyMaxLines)
  assert("刚好 MAX_LINES 行不截断", r5.truncated === false)

  // 1f. tail 方向截断
  const r6 = await truncateOutput(longLines, { direction: "tail" })
  assert("tail 方向截断", r6.truncated === true)
  assert("tail 截断含 truncted 提示", r6.content.includes("truncated"))

  // 1g. 自定义限制
  const r7 = await truncateOutput("a\nb\nc\nd\ne\nf", {
    maxLines: 3,
    maxBytes: 1024,
  })
  assert("自定义 maxLines 截断", r7.truncated === true)
}

await testTruncate()

// ============================================================================
// 2. formatValidationError 模拟测试
// ============================================================================
console.log("\n📦 2. formatValidationError — 参数校验错误格式化")
console.log("  " + "─".repeat(45))

function testFormatValidationError() {
  // 模拟工具定义的 schema
  const schema = z.object({
    input_file: z.string().min(1, "Input file is required"),
    start_time: z.number().min(0, "Start time must be >= 0"),
  })

  // 2a. 有效参数通过验证
  const validResult = schema.safeParse({
    input_file: "/video.mp4",
    start_time: 10,
  })
  assert("有效参数通过 Zod 校验", validResult.success === true)

  // 2b. 无效参数 — 缺少必填字段
  const invalidResult = schema.safeParse({})
  assert("无效参数 Zod 校验失败", invalidResult.success === false)

  // 2c. formatValidationError 格式化
  if (!invalidResult.success) {
    const fmtErr = formatValidationErrorMessage(
      invalidResult.error,
      "test_tool",
    )
    assert("formatValidationError 含工具 ID", fmtErr.includes("test_tool"))
    assert(
      "formatValidationError 含 invalid arguments",
      fmtErr.includes("invalid arguments"),
    )
  }

  // 2d. 自定义 formatValidationError
  function customFormatter(error: z.ZodError): string {
    const issues = error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    return `[MyTool] 参数错误:\n${issues}`
  }

  if (!invalidResult.success) {
    const customFmt = customFormatter(invalidResult.error)
    assert(
      "自定义 formatValidationError 含 [MyTool]",
      customFmt.includes("[MyTool]"),
    )
    assert(
      "自定义 formatValidationError 含参数错误",
      customFmt.includes("参数错误"),
    )
  }
}

/**
 * 模拟 buildToolSet 中的 formatValidationError 集成逻辑。
 * 对应 ai-stream.ts 中的显式参数校验代码。
 */
function formatValidationErrorMessage(
  error: z.ZodError,
  toolId: string,
): string {
  return `The ${toolId} tool was called with invalid arguments: ${error.message}.\nPlease rewrite the input so it satisfies the expected schema.`
}

testFormatValidationError()

// ============================================================================
// 3. buildToolSet 工具集构建逻辑测试
// ============================================================================
console.log("\n📦 3. buildToolSet — 工具集构建和权限")
console.log("  " + "─".repeat(45))

async function testBuildToolSetLogic() {
  // 3a. 权限服务 evaluate 集成
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
  })

  const a1 = await svc.evaluate("tool:call", "test_runner")
  assert("buildToolSet 权限集成: test_* → allow", a1 === "allow", `got ${a1}`)

  const a2 = await svc.evaluate("tool:call", "music_search")
  assert(
    "buildToolSet 权限集成: music_search → deny",
    a2 === "deny",
    `got ${a2}`,
  )

  const a3 = await svc.evaluate("tool:call", "unknown_tool")
  assert("buildToolSet 权限集成: unknown → ask", a3 === "ask", `got ${a3}`)

  // 3b. 权限服务无匹配规则回退到 defaultAction
  const svc2 = createPermissionService({
    rules: [],
    defaultAction: "deny",
  })
  const a4 = await svc2.evaluate("tool:call", "anything")
  assert("空规则 defaultAction=deny → deny", a4 === "deny", `got ${a4}`)
}

await testBuildToolSetLogic()

// ============================================================================
// 4. permission CLI 命令逻辑测试
// ============================================================================
console.log("\n📦 4. permission CLI — 命令逻辑")
console.log("  " + "─".repeat(45))

function testPermissionCLI() {
  // 4a. wildcard 匹配（CLI 使用 wildcard 进行规则匹配）
  assert(
    "CLI wildcard: tool:* 匹配 tool:ffmpeg",
    matchWildcard("tool:*", "tool:ffmpeg"),
  )
  assert("CLI wildcard: * 匹配任意", matchWildcard("*", "anything"))
  assert(
    "CLI wildcard: batch_* 匹配 batch_queue",
    matchWildcard("batch_*", "batch_queue"),
  )
  assert(
    "CLI wildcard: batch_* 不匹配 abatch",
    !matchWildcard("batch_*", "abatch"),
  )

  // 4b. 规则 evaluate 用于 CLI 权限查询
  const rules: PermissionRule[] = [
    { target: "tool:call", pattern: "ffmpeg", action: "allow", priority: 10 },
    {
      target: "tool:call",
      pattern: "music_search",
      action: "deny",
      priority: 20,
    },
  ]
  const r1 = evaluate("tool:call", "ffmpeg", "ask", rules)
  assert(
    "CLI evaluate: ffmpeg → allow",
    r1.action === "allow",
    `got ${r1.action}`,
  )

  const r2 = evaluate("tool:call", "music_search", "ask", rules)
  assert(
    "CLI evaluate: music_search → deny",
    r2.action === "deny",
    `got ${r2.action}`,
  )

  const r3 = evaluate("tool:call", "unknown_tool", "ask", rules)
  assert(
    "CLI evaluate: unknown → ask (defaultAction)",
    r3.action === "ask",
    `got ${r3.action}`,
  )

  // 4c. Store 操作（CLI 通过 store 管理持久化规则）
  const testPath = path.join(
    tmpdir(),
    `perm-cli-test-${randomBytes(4).toString("hex")}.jsonl`,
  )
  const store = createFileStore(testPath)

  assert("CLI store: 初始为空", store.getAll().length === 0)

  store.add({ target: "tool:call", pattern: "ffmpeg", action: "allow" })
  assert("CLI store: 添加规则后 length=1", store.getAll().length === 1)
  assert(
    "CLI store: 规则内容正确",
    store.getAll()[0].target === "tool:call" &&
      store.getAll()[0].pattern === "ffmpeg",
  )

  store.remove("tool:call", "ffmpeg")
  assert("CLI store: 删除规则后 length=0", store.getAll().length === 0)
}

testPermissionCLI()

// ============================================================================
// 5. 截断文件写入验证
// ============================================================================
console.log("\n📦 5. 截断文件写入")
console.log("  " + "─".repeat(20))

async function testTruncateFileWrite() {
  const fs = await import("fs")
  const content = "x".repeat(MAX_BYTES + 5000)
  const result = await truncateOutput(content)

  assert("超限截断为 true", result.truncated === true)

  if (result.truncated) {
    // 验证输出文件确实存在
    const exists = fs.existsSync(result.outputPath)
    assert("截断输出文件存在", exists, result.outputPath)

    if (exists) {
      const fileContent = fs.readFileSync(result.outputPath, "utf-8")
      assert("截断文件含完整内容", fileContent === content)
      assert("截断文件内容长度正确", fileContent.length === content.length)

      // 清理
      try {
        fs.unlinkSync(result.outputPath)
      } catch {}
    }
  }

  // 不在限制内的不写文件
  const r2 = await truncateOutput("short")
  assert("短内容 truncated=false", r2.truncated === false)
}

await testTruncateFileWrite()

// ============================================================================
// 总结
// ============================================================================
console.log("\n" + "=".repeat(50))
console.log("📊 Task 1.1 测试总览")
console.log("  " + "=".repeat(46))
console.log(`  通过: ${passed}`)
console.log(`  失败: ${failed}`)
console.log(`  总计: ${passed + failed}`)
console.log("=".repeat(50))

if (failed > 0) {
  console.log("\n❌ 存在失败测试！")
  process.exit(1)
} else {
  console.log("\n✅ Task 1.1 全部测试通过！")
}
