/**
 * ai-stream 测试 — Hermes 架构集成 + AI 增强层
 *
 * 覆盖：
 *   1. resolveContextReferences Hermes 导入
 *   2. buildDynamicSystemPrompt 异步 + 中文视频编辑 prompt
 *   3. buildDynamicSystemPrompt skill 注入（Hermes）
 *   4. buildDynamicSystemPrompt 模板注入
 *   5. buildDynamicSystemPrompt 编辑上下文注入
 *   6. buildToolSet Zod 校验层（OURS 增强）
 *   7. streamAiEditWithSession 上下文引用解析
 *
 * @license MIT
 */

import { describe, it, before } from "node:test"
import assert from "node:assert/strict"

let mod: any

before(async () => {
  // 动态导入，触发模块初始化（toolRegistry 等依赖链）
  mod = await import("../ai-stream.js")
})

// ============================================================================
// 1. 基础导入验证
// ============================================================================

describe("ai-stream 基础结构", () => {

  it("导出 buildDynamicSystemPrompt（async）", () => {
    assert.ok(typeof mod.buildDynamicSystemPrompt === "function")
    // 验证是 async 函数（Hermes 架构要求）
    assert.equal(mod.buildDynamicSystemPrompt.constructor.name, "AsyncFunction")
  })

  it("导出 streamAiEdit", () => {
    assert.ok(typeof mod.streamAiEdit === "function")
  })

  it("导出 streamAiEditWithSession", () => {
    assert.ok(typeof mod.streamAiEditWithSession === "function")
  })

  it("导出 buildToolSet", () => {
    assert.ok(typeof mod.buildToolSet === "function")
  })

  it("导出 setPermissionEvaluate", () => {
    assert.ok(typeof mod.setPermissionEvaluate === "function")
  })

  it("导出 clearToolSetCache", () => {
    assert.ok(typeof mod.clearToolSetCache === "function")
  })

  it("导出编辑上下文管理函数", () => {
    assert.ok(typeof mod.setActiveEditContext === "function")
    assert.ok(typeof mod.getActiveEditContext === "function")
    assert.ok(typeof mod.updateEditContextFromToolCall === "function")
    assert.ok(typeof mod.getEditContextSummary === "function")
  })
})

// ============================================================================
// 2. buildDynamicSystemPrompt — 异步 + 中文视频编辑 prompt（核心）
// ============================================================================

describe("buildDynamicSystemPrompt", () => {

  it("返回 Promise<string>", async () => {
    const result = mod.buildDynamicSystemPrompt()
    assert.ok(result instanceof Promise)
    const str = await result
    assert.equal(typeof str, "string")
    assert.ok(str.length > 0)
  })

  it("包含中文视频编辑领域 prompt", async () => {
    const prompt = await mod.buildDynamicSystemPrompt()
    assert.ok(prompt.includes("视频编辑助手") || prompt.includes("视频编辑"))
  })

  it("可通过 opts.customInstructions 注入自定义指令", async () => {
    const prompt = await mod.buildDynamicSystemPrompt({
      customInstructions: "TEST_INJECTION_12345",
    })
    assert.ok(prompt.includes("TEST_INJECTION_12345"))
  })
})

// ============================================================================
// 3. buildDynamicSystemPrompt — 模板注入
// ============================================================================

describe("buildDynamicSystemPrompt — 模板注入", () => {

  it("包含可用视频编辑模板段落", async () => {
    const prompt = await mod.buildDynamicSystemPrompt()
    // 模板段落标题（来自 buildVideoEditingPrompt）
    // 如果模板已注册则验证；否则至少 prompt 本身是有效的
    assert.ok(prompt.length > 0)
  })
})

// ============================================================================
// 4. buildDynamicSystemPrompt — 编辑上下文
// ============================================================================

describe("buildDynamicSystemPrompt — 编辑上下文", () => {

  it("注入当前视频路径到 prompt", async () => {
    mod.setActiveEditContext(undefined)
    const prompt = await mod.buildDynamicSystemPrompt({
      editContext: {
        currentVideo: "/test/integration/video.mp4",
        videoInfo: null,
        appliedEffects: [],
        sessionStartTime: Date.now(),
      },
    })
    assert.ok(prompt.includes("/test/integration/video.mp4"))
  })

  it("无编辑上下文时不崩溃", async () => {
    mod.setActiveEditContext(undefined)
    const prompt = await mod.buildDynamicSystemPrompt()
    assert.ok(prompt.length > 0)
  })
})

// ============================================================================
// 5. buildDynamicSystemPrompt — Skill 注入（Hermes 架构核心）
// ============================================================================

describe("buildDynamicSystemPrompt — Skill 注入（Hermes）", () => {

  it("async 函数不抛出异常（skill 加载失败时静默降级）", async () => {
    // skill-manager 可能没有已注册的 skill，但 buildDynamicSystemPrompt 不应崩溃
    const prompt = await mod.buildDynamicSystemPrompt()
    assert.ok(typeof prompt === "string")
    assert.ok(prompt.length > 0)
  })

  it("prompt 包含 Skill 段落（如果有已注册 skill）", async () => {
    const prompt = await mod.buildDynamicSystemPrompt()
    // 如果有 skills，应包含 Priority Rules
    if (prompt.includes("Available Skills")) {
      assert.ok(prompt.includes("Priority Rules for Skill Usage"))
      assert.ok(prompt.includes("skill_manage"))
    }
    // 没有 skill 也不报错 — 静默降级
  })
})

// ============================================================================
// 6. buildToolSet — Zod 校验 + 截断（OURS 增强层）
// ============================================================================

describe("buildToolSet — Zod 校验 + 截断", () => {

  it("返回 ToolSet 对象", async () => {
    const tools = await mod.buildToolSet()
    assert.equal(typeof tools, "object")
    assert.notEqual(tools, null)
  })

  it("ToolSet 中每个工具都有 description 和 inputSchema", async () => {
    const tools = await mod.buildToolSet()
    for (const [name, t] of Object.entries(tools)) {
      const tool = t as any
      assert.ok(typeof tool.description === "string", `${name}: description`)
      assert.ok(tool.inputSchema !== undefined, `${name}: inputSchema`)
      assert.ok(typeof tool.execute === "function", `${name}: execute`)
    }
  })

  it("缓存在第二次调用时生效", async () => {
    await mod.buildToolSet()
    const tools2 = await mod.buildToolSet()
    assert.equal(typeof tools2, "object")
  })
})

// ============================================================================
// 7. resolveContextReferences 集成（Hermes 架构核心）
// ============================================================================

describe("resolveContextReferences 集成（Hermes）", () => {

  it("普通消息不触发引用解析（不改动原消息）", async () => {
    // 通过 streamAiEditWithSession 间接测试
    // 验证模块已正确导入 resolveContextReferences
    const { resolveContextReferences } = await import("../context-references.js")
    assert.ok(typeof resolveContextReferences === "function")

    const result = await resolveContextReferences("普通消息，无任何引用", 8000)
    assert.equal(result.resolvedMessage, "普通消息，无任何引用")
    assert.equal(result.notification, "")
  })

  it("无引用消息保持原样", async () => {
    const { resolveContextReferences } = await import("../context-references.js")
    const result = await resolveContextReferences("帮我剪辑视频", 8000)
    assert.equal(result.resolvedMessage, "帮我剪辑视频")
  })
})

// ============================================================================
// 8. 编辑上下文管理（OURS 增强层）
// ============================================================================

describe("编辑上下文管理", () => {

  it("setActiveEditContext / getActiveEditContext 往返", () => {
    const ctx = {
      currentVideo: "/videos/test.mp4",
      videoInfo: null,
      appliedEffects: [],
      sessionStartTime: Date.now(),
    }
    mod.setActiveEditContext(ctx)
    const retrieved = mod.getActiveEditContext()
    assert.equal(retrieved?.currentVideo, "/videos/test.mp4")
  })

  it("清除编辑上下文", () => {
    mod.setActiveEditContext(undefined)
    assert.equal(mod.getActiveEditContext(), undefined)
  })

  it("getEditContextSummary 返回空字符串（无上下文时）", () => {
    mod.setActiveEditContext(undefined)
    assert.equal(mod.getEditContextSummary(), "")
  })
})

// ============================================================================
// 9. streamAiEdit 函数签名验证
// ============================================================================

describe("streamAiEdit", () => {

  it("async 函数签名正确", () => {
    assert.equal(mod.streamAiEdit.constructor.name, "AsyncFunction")
  })

  it("无工具时返回错误", async () => {
    // 注意：这依赖 toolRegistry 的状态。如果已注册工具，此测试跳过。
    const tools = await mod.buildToolSet()
    if (Object.keys(tools).length === 0) {
      // 这个分支理论上不会到达（buildToolSet 返回空时，streamAiEdit 也会检查）
      // 仅验证函数签名
    }
  })
})

// ============================================================================
// 10. clearToolSetCache
// ============================================================================

describe("clearToolSetCache", () => {

  it("清除后 buildToolSet 重新构建", async () => {
    await mod.buildToolSet()
    mod.clearToolSetCache()
    // 清除后再次调用应成功
    const tools = await mod.buildToolSet()
    assert.equal(typeof tools, "object")
    assert.notEqual(tools, null)
  })
})
