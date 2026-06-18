/**
 * skill-manager-tool.ts 测试
 *
 * 覆盖 list / create / view 三个操作 + 边界情况。
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { after, before, beforeEach, describe, it } from "node:test"
import type { Tool } from "./tool.js"

/** create a minimal mock context for tool.execute() calls */
function mockCtx(): Tool.Context {
  return {
    sessionID: "test-session",
    messageID: "test-msg",
    agent: "test-agent",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "skill-tool-test-"))
const SKILLS_DIR = path.join(TEST_DIR, "skills")

process.env.JIANGJICODE_SKILLS_DIR = SKILLS_DIR

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tool: any

before(async () => {
  fs.mkdirSync(SKILLS_DIR, { recursive: true })
  const { SkillManageTool } = await import("./skill-manager-tool.js")
  tool = await SkillManageTool.init()
})

beforeEach(() => {
  if (fs.existsSync(SKILLS_DIR)) {
    for (const entry of fs.readdirSync(SKILLS_DIR)) {
      const full = path.join(SKILLS_DIR, entry)
      if (entry !== ".usage.json")
        fs.rmSync(full, { recursive: true, force: true })
    }
  }
  const usageFile = path.join(SKILLS_DIR, ".usage.json")
  if (fs.existsSync(usageFile)) fs.unlinkSync(usageFile)
})

after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
})

// ============================================================================
// list
// ============================================================================

describe("action: list", () => {
  it("空列表时返回提示信息", async () => {
    const result = await tool.execute({ action: "list" }, mockCtx())
    assert.ok(result.metadata.success)
    assert.ok(result.output.includes("No auto-created skills"))
  })

  it("有 skill 时返回列表", async () => {
    // 直接写一个 skill 到测试目录
    const skillDir = path.join(SKILLS_DIR, "test-skill")
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: test-skill
description: 测试用 skill
category: other
toolCount: 1
---
# test`,
      "utf-8",
    )

    const result = await tool.execute({ action: "list" }, mockCtx())
    assert.ok(result.metadata.success)
    assert.ok(result.output.includes("test-skill"))
    assert.ok(result.output.includes("测试用 skill"))
  })
})

// ============================================================================
// create
// ============================================================================

describe("action: create", () => {
  const validContent = `---
name: test-skill
description: test
---
# test`

  it("缺少 name 时报错", async () => {
    const result = await tool.execute(
      { action: "create", content: validContent },
      mockCtx(),
    )
    assert.ok(!result.metadata.success)
    assert.ok(result.output.includes("Both name and content"))
  })

  it("缺少 content 时报错", async () => {
    const result = await tool.execute(
      { action: "create", name: "test" },
      mockCtx(),
    )
    assert.ok(!result.metadata.success)
    assert.ok(result.output.includes("Both name and content"))
  })

  it("不合法的 name 格式报错", async () => {
    const mod = await import("./skill-manager-tool.js")
    const tool2 = await mod.SkillManageTool.init()
    const result = await tool2.execute(
      { action: "create", name: "Invalid Name!!", content: validContent },
      mockCtx(),
    )
    assert.ok(!result.metadata.success)
    // 验证 result.title 而不是 output — Tool.define 的截断逻辑可能清空 output
    assert.ok(
      result.title === "Invalid name",
      `Expected title "Invalid name", got ${JSON.stringify(result.title)}`,
    )
  })

  it("创建成功", async () => {
    const result = await tool.execute(
      { action: "create", name: "my-skill", content: validContent },
      mockCtx(),
    )
    assert.ok(result.metadata.success)
    assert.ok(result.title.includes("my-skill"))

    // 验证文件已创建
    const skillMdPath = path.join(SKILLS_DIR, "my-skill", "SKILL.md")
    assert.ok(fs.existsSync(skillMdPath))

    const content = fs.readFileSync(skillMdPath, "utf-8")
    assert.equal(content, validContent)
  })

  it("创建后 bumpUsage 递增", async () => {
    await tool.execute(
      { action: "create", name: "tracked-skill", content: validContent },
      mockCtx(),
    )

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    assert.ok(fs.existsSync(usageFile))

    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["tracked-skill"].useCount, 1)
  })
})

// ============================================================================
// view
// ============================================================================

describe("action: view", () => {
  it("不存在的 skill 报错", async () => {
    const result = await tool.execute(
      { action: "view", name: "nonexistent" },
      mockCtx(),
    )
    assert.ok(!result.metadata.success)
    assert.ok(result.output.includes("not found"))
  })

  it("查看已有 skill", async () => {
    // 先创建一个 skill
    await tool.execute(
      {
        action: "create",
        name: "viewable-skill",
        content:
          "---\nname: viewable-skill\ndescription: a test\n---\n# Content",
      },
      mockCtx(),
    )

    const result = await tool.execute(
      { action: "view", name: "viewable-skill" },
      mockCtx(),
    )
    assert.ok(result.metadata.success)
    assert.ok(result.title.includes("viewable-skill"))
    assert.ok(result.output.includes("viewable-skill"))
  })
})

// ============================================================================
// 未知 action
// ============================================================================

describe("未知 action", () => {
  it("Zod 校验拦截并抛出错误", async () => {
    await assert.rejects(
      () => tool.execute({ action: "unknown" }, mockCtx()),
      /invalid arguments/,
    )
  })
})

// ============================================================================
// validate
// ============================================================================

/** 带 inputSchema 的 skill 内容 */
const SKILL_WITH_SCHEMA = `---
name: test-filter
description: 测试滤镜技能
category: effect
toolCount: 2
inputSchema:
  type: object
  required: [videoPath]
  properties:
    videoPath:
      type: string
      description: 视频路径
    intensity:
      type: number
      default: 0.7
      minimum: 0
      maximum: 1
      description: 效果强度
    preset:
      type: string
      enum: [vintage, modern, retro]
      default: vintage
      description: 滤镜预设
---
# 步骤
1. 应用滤镜
`

describe("action: validate", () => {
  it("不存在的 skill 返回错误", async () => {
    const result = await tool.execute(
      { action: "validate", name: "nonexistent" },
      mockCtx(),
    )
    assert.ok(!result.metadata.success)
    assert.ok(result.output.includes("not found"))
  })

  it("无 inputSchema 的 skill 直接通过", async () => {
    await tool.execute(
      {
        action: "create",
        name: "no-schema-skill",
        content:
          "---\nname: no-schema-skill\ndescription: no schema\n---\n# Content",
      },
      mockCtx(),
    )

    const result = await tool.execute(
      {
        action: "validate",
        name: "no-schema-skill",
        params: { something: 123 },
      },
      mockCtx(),
    )
    assert.ok(result.metadata.success)
  })

  it("通过校验 + 默认值填充", async () => {
    await tool.execute(
      {
        action: "create",
        name: "test-filter",
        content: SKILL_WITH_SCHEMA,
      },
      mockCtx(),
    )

    const result = await tool.execute(
      {
        action: "validate",
        name: "test-filter",
        params: { videoPath: "/videos/test.mp4" },
      },
      mockCtx(),
    )

    assert.ok(result.metadata.success)
    // 默认值应该被填充
    assert.ok(result.output.includes("0.7")) // intensity default
    assert.ok(result.output.includes("vintage")) // preset default
  })

  it("缺少必填参数时失败", async () => {
    await tool.execute(
      {
        action: "create",
        name: "test-filter",
        content: SKILL_WITH_SCHEMA,
      },
      mockCtx(),
    )

    const result = await tool.execute(
      {
        action: "validate",
        name: "test-filter",
        params: { intensity: 0.5 },
      },
      mockCtx(),
    )

    assert.ok(!result.metadata.success)
    assert.ok(result.output.includes("Missing required"))
    assert.ok(result.output.includes("videoPath"))
  })

  it("类型不匹配时失败", async () => {
    await tool.execute(
      {
        action: "create",
        name: "test-filter",
        content: SKILL_WITH_SCHEMA,
      },
      mockCtx(),
    )

    const result = await tool.execute(
      {
        action: "validate",
        name: "test-filter",
        params: { videoPath: "/v/test.mp4", intensity: "strong" },
      },
      mockCtx(),
    )

    assert.ok(!result.metadata.success)
    assert.ok(result.output.includes("expected type number"))
  })

  it("超出范围时失败", async () => {
    await tool.execute(
      {
        action: "create",
        name: "test-filter",
        content: SKILL_WITH_SCHEMA,
      },
      mockCtx(),
    )

    const result = await tool.execute(
      {
        action: "validate",
        name: "test-filter",
        params: { videoPath: "/v/test.mp4", intensity: 999 },
      },
      mockCtx(),
    )

    assert.ok(!result.metadata.success)
    assert.ok(result.output.includes("greater than maximum"))
  })

  it("枚举值不匹配时失败", async () => {
    await tool.execute(
      {
        action: "create",
        name: "test-filter",
        content: SKILL_WITH_SCHEMA,
      },
      mockCtx(),
    )

    const result = await tool.execute(
      {
        action: "validate",
        name: "test-filter",
        params: { videoPath: "/v/test.mp4", preset: "invalid-value" },
      },
      mockCtx(),
    )

    assert.ok(!result.metadata.success)
    assert.ok(result.output.includes("not in allowed values"))
  })
})
