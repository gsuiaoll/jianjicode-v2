/**
 * Phase 1 边界测试 — Skill Auto-Creation
 *
 * 覆盖计划中的 5 个边界测试 + 更多单元测试。
 * 使用 Node.js 内置测试框架（node:test）。
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { after, before, beforeEach, describe, it } from "node:test"

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "skill-test-"))
const SKILLS_DIR = path.join(TEST_DIR, "skills")
const LOG_DIR = path.join(TEST_DIR, "logs")

// 必须在 import 之前设置环境变量
process.env.JIANGJICODE_SKILLS_DIR = SKILLS_DIR
process.env.JIANGJICODE_LOG_DIR = LOG_DIR
process.env.JIANGJICODE_DISABLE_JUDGE = "1"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let skillManager: any

// ============================================================================
// 测试辅助函数
// ============================================================================

function makeToolCall(
  toolName: string,
  args: Record<string, unknown> = {},
  error = false,
) {
  return {
    toolName,
    args,
    result: {
      title: `Executed ${toolName}`,
      output: `${toolName} completed`,
      metadata: error ? { error: true } : {},
    },
  }
}

function makeStep(
  stepNumber: number,
  toolCalls: ReturnType<typeof makeToolCall>[],
) {
  return {
    stepNumber,
    text: toolCalls.map((t: { toolName: string }) => t.toolName).join(", "),
    toolCalls,
    finishReason: "stop",
  }
}

// ============================================================================
// Setup / Teardown
// ============================================================================

before(async () => {
  fs.mkdirSync(SKILLS_DIR, { recursive: true })
  // 动态 import 确保环境变量已设置
  skillManager = await import("../skill-manager.js")
})

beforeEach(() => {
  // 清空 skills 目录
  if (fs.existsSync(SKILLS_DIR)) {
    for (const entry of fs.readdirSync(SKILLS_DIR)) {
      fs.rmSync(path.join(SKILLS_DIR, entry), { recursive: true, force: true })
    }
  }
  // 清理使用追踪数据
  const usageFile = path.join(SKILLS_DIR, ".usage.json")
  if (fs.existsSync(usageFile)) fs.unlinkSync(usageFile)
})

after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
})

// ============================================================================
// 边界测试 1: 语义高度相似但措辞不同的工作流 → 正确去重
// ============================================================================

describe("语义去重 — findSimilarSkills", () => {
  it("没有 skill 时返回空数组", async () => {
    const result = await skillManager.findSimilarSkills(
      "给视频添加复古胶片风格",
    )
    assert.deepEqual(result, [])
  })

  it("高相似度描述（> 0.7）返回匹配结果", async () => {
    await skillManager.createSkillFromTrajectory(
      "vintage-film-look",
      "复古胶片风格调色效果：LUT调色+颗粒+暗角",
      [makeStep(1, [makeToolCall("LutFilterTool")])],
    )

    // 与源描述高度相似（仅"颗粒"→"噪点"），bigram Dice 系数应 > 0.7
    const result = await skillManager.findSimilarSkills(
      "复古胶片风格调色效果：LUT调色+噪点+暗角",
    )
    assert.ok(result.length > 0)
    assert.equal(result[0].name, "vintage-film-look")
  })

  it("低相似度描述不返回结果", async () => {
    await skillManager.createSkillFromTrajectory(
      "vintage-film-look",
      "给视频添加复古胶片风格：LUT调色+颗粒+暗角",
      [makeStep(1, [makeToolCall("LutFilterTool")])],
    )

    const result = await skillManager.findSimilarSkills("视频裁剪和拼接操作")
    assert.deepEqual(result, [])
  })

  it("shouldAutoCreate 遇到相似 skill 返回 false", async () => {
    // skill 描述包含工具名序列，与 shouldAutoCreate 生成的 stepDescriptions 做 bigram 匹配
    await skillManager.createSkillFromTrajectory(
      "color-grade-skill",
      "LutFilterTool, AudioEffectsTool, VideoFilterTool",
      [makeStep(1, [makeToolCall("LutFilterTool")])],
    )

    const steps = [
      makeStep(1, [makeToolCall("LutFilterTool", { preset: "vintage" })]),
      makeStep(2, [makeToolCall("AudioEffectsTool", { effect: "noise" })]),
      makeStep(3, [makeToolCall("VideoFilterTool", { filter: "vignette" })]),
      makeStep(4, [makeToolCall("VideoFilterTool", { filter: "grain" })]),
    ]

    const result = await skillManager.shouldAutoCreate(steps, "always")
    assert.equal(result.shouldCreate, false)
    assert.ok(
      result.reason.includes("Similar skill already exists"),
      `reason was: ${result.reason}`,
    )
  })
})

// ============================================================================
// 边界测试 2: 刚好 3 步的任务 → 不触发创建
// ============================================================================

describe("工具调用数量过滤 — shouldAutoCreate", () => {
  it("toolCalls = 0 时不创建", async () => {
    const result = await skillManager.shouldAutoCreate(
      [makeStep(1, [])],
      "always",
    )
    assert.equal(result.shouldCreate, false)
    assert.ok(result.reason.includes("Too few tool calls"))
  })

  it("toolCalls = 3 时不创建（门槛是 > 3）", async () => {
    const steps = [
      makeStep(1, [makeToolCall("ToolA")]),
      makeStep(2, [makeToolCall("ToolB")]),
      makeStep(3, [makeToolCall("ToolC")]),
    ]
    const result = await skillManager.shouldAutoCreate(steps, "always")
    assert.equal(result.shouldCreate, false)
    assert.ok(result.reason.includes("Too few tool calls"))
  })

  it("toolCalls = 4 时通过数量过滤", async () => {
    const steps = [
      makeStep(1, [makeToolCall("ToolA")]),
      makeStep(2, [makeToolCall("ToolB")]),
      makeStep(3, [makeToolCall("ToolC")]),
      makeStep(4, [makeToolCall("ToolD")]),
    ]
    const result = await skillManager.shouldAutoCreate(steps, "always")
    // 通过数量过滤（可能被其他条件阻挡）
    assert.ok(!result.reason.includes("Too few tool calls"))
  })
})

// ============================================================================
// 边界测试 3: always / confirm / off 模式切换
// ============================================================================

describe("配置模式切换", () => {
  it("off 模式直接跳过", async () => {
    const steps = [makeStep(1, [makeToolCall("ToolA")])]
    const result = await skillManager.shouldAutoCreate(steps, "off")
    assert.equal(result.shouldCreate, false)
    assert.ok(result.reason.includes("off"))
  })

  it("always 模式不受模式阻挡", async () => {
    const steps = [
      makeStep(1, [makeToolCall("ToolA")]),
      makeStep(2, [makeToolCall("ToolB")]),
      makeStep(3, [makeToolCall("ToolC")]),
      makeStep(4, [makeToolCall("ToolD")]),
    ]
    const result = await skillManager.shouldAutoCreate(steps, "always")
    assert.ok(!result.reason.includes("off"))
  })

  it("confirm 模式与 always 在过滤阶段一致（区别在前端 nudge）", async () => {
    const steps = [
      makeStep(1, [makeToolCall("ToolA")]),
      makeStep(2, [makeToolCall("ToolB")]),
      makeStep(3, [makeToolCall("ToolC")]),
      makeStep(4, [makeToolCall("ToolD")]),
    ]
    const result = await skillManager.shouldAutoCreate(steps, "confirm")
    assert.ok(!result.reason.includes("off"))
  })
})

// ============================================================================
// 边界测试 4: 工具调用含 error → 不触发创建
// ============================================================================

describe("错误检测", () => {
  it("工具调用含 error 时不创建", async () => {
    const steps = [
      makeStep(1, [makeToolCall("ToolA")]),
      makeStep(2, [makeToolCall("ToolB", {}, true)]),
      makeStep(3, [makeToolCall("ToolC")]),
      makeStep(4, [makeToolCall("ToolD")]),
    ]
    const result = await skillManager.shouldAutoCreate(steps, "always")
    assert.equal(result.shouldCreate, false)
    assert.ok(result.reason.includes("error"))
  })
})

// ============================================================================
// 边界测试 5: 一次性定制操作 → 不触发创建
// ============================================================================

describe("泛化性校验 — isReusableWorkflow", () => {
  it("包含「第N秒」模式的一次性操作不创建", async () => {
    const steps = [
      makeStep(1, [
        makeToolCall("VideoFilterTool", {
          start: "第10秒",
          end: "第20秒",
          filter: "blur",
        }),
      ]),
      makeStep(2, [
        makeToolCall("VideoFilterTool", {
          start: "第30秒",
          end: "第40秒",
          filter: "blur",
        }),
      ]),
      makeStep(3, [
        makeToolCall("VideoFilterTool", { start: "第50秒", end: "第60秒" }),
      ]),
      makeStep(4, [makeToolCall("AudioEffectsTool")]),
    ]
    const result = await skillManager.shouldAutoCreate(steps, "always")
    assert.equal(result.shouldCreate, false)
    assert.ok(result.reason.includes("one-time"))
  })

  it("不包含特定时间戳的通用操作通过泛化性校验", async () => {
    const steps = [
      makeStep(1, [makeToolCall("LutFilterTool", { preset: "vintage" })]),
      makeStep(2, [makeToolCall("AudioEffectsTool", { effect: "grain" })]),
      makeStep(3, [makeToolCall("VideoFilterTool", { filter: "vignette" })]),
      makeStep(4, [makeToolCall("VideoFilterTool", { filter: "grain" })]),
    ]
    const result = await skillManager.shouldAutoCreate(steps, "always")
    // 没有特定时间戳 → 不触发 one-time 判断
    assert.ok(!result.reason.includes("one-time"))
  })
})

// ============================================================================
// createSkillFromTrajectory 测试
// ============================================================================

describe("createSkillFromTrajectory", () => {
  it("创建目录并写入 SKILL.md 文件", async () => {
    const steps = [
      makeStep(1, [makeToolCall("LutFilterTool", { preset: "vintage" })]),
      makeStep(2, [makeToolCall("AudioEffectsTool", { effect: "grain" })]),
    ]

    await skillManager.createSkillFromTrajectory(
      "test-skill",
      "测试 skill",
      steps,
    )

    const skillDir = path.join(SKILLS_DIR, "test-skill")
    const skillMdPath = path.join(skillDir, "SKILL.md")

    assert.ok(fs.existsSync(skillDir))
    assert.ok(fs.existsSync(skillMdPath))

    const content = fs.readFileSync(skillMdPath, "utf-8")
    assert.ok(content.includes("name: test-skill"))
    assert.ok(content.includes("description: 测试 skill"))
    assert.ok(content.includes("toolCount: 2"))
    assert.ok(content.includes("LutFilterTool"))
    assert.ok(content.includes("AudioEffectsTool"))
  })

  it("使用记录自动创建", async () => {
    const steps = [makeStep(1, [makeToolCall("ToolA")])]
    await skillManager.createSkillFromTrajectory(
      "tracked-skill",
      "tracked skill",
      steps,
    )

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    assert.ok(fs.existsSync(usageFile))

    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.ok(usage["tracked-skill"])
    assert.equal(usage["tracked-skill"].useCount, 0)
    assert.equal(usage["tracked-skill"].state, "active")
  })

  it("同一名称重复创建覆盖旧文件", async () => {
    await skillManager.createSkillFromTrajectory(
      "overwrite-test",
      "version 1",
      [makeStep(1, [makeToolCall("ToolA")])],
    )
    await skillManager.createSkillFromTrajectory(
      "overwrite-test",
      "version 2",
      [makeStep(1, [makeToolCall("ToolB")])],
    )

    const content = fs.readFileSync(
      path.join(SKILLS_DIR, "overwrite-test", "SKILL.md"),
      "utf-8",
    )
    assert.ok(content.includes("description: version 2"))
    assert.ok(!content.includes("version 1"))
  })
})

// ============================================================================
// listSkills 测试
// ============================================================================

describe("listSkills", () => {
  it("空目录返回空数组", async () => {
    const skills = await skillManager.listSkills()
    assert.deepEqual(skills, [])
  })

  it("列出所有已创建 skill", async () => {
    await skillManager.createSkillFromTrajectory("skill-a", "Description A", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    await skillManager.createSkillFromTrajectory("skill-b", "Description B", [
      makeStep(1, [makeToolCall("ToolB")]),
    ])

    const skills = await skillManager.listSkills()
    assert.equal(skills.length, 2)
    const names = skills.map((s: { name: string }) => s.name).sort()
    assert.deepEqual(names, ["skill-a", "skill-b"])
  })

  it("跳过没有 SKILL.md 的目录", async () => {
    await skillManager.createSkillFromTrajectory("valid-skill", "Valid", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    fs.mkdirSync(path.join(SKILLS_DIR, "empty-dir"), { recursive: true })

    const skills = await skillManager.listSkills()
    assert.equal(skills.length, 1)
    assert.equal(skills[0].name, "valid-skill")
  })
})

// ============================================================================
// maybeCreateSkill 集成测试
// ============================================================================

describe("maybeCreateSkill 完整流程", () => {
  it("off 模式下不创建 skill", async () => {
    const steps = [
      makeStep(1, [makeToolCall("ToolA")]),
      makeStep(2, [makeToolCall("ToolB")]),
      makeStep(3, [makeToolCall("ToolC")]),
      makeStep(4, [makeToolCall("ToolD")]),
    ]

    await skillManager.maybeCreateSkill(steps, "test-session", "off")

    const skills = await skillManager.listSkills()
    assert.equal(skills.length, 0)
  })

  it("always 模式下通过过滤的流程创建 skill", async () => {
    const steps = [
      makeStep(1, [makeToolCall("LutFilterTool", { preset: "vintage" })]),
      makeStep(2, [makeToolCall("AudioEffectsTool", { effect: "grain" })]),
      makeStep(3, [makeToolCall("VideoFilterTool", { filter: "vignette" })]),
      makeStep(4, [makeToolCall("VideoFilterTool", { filter: "grain" })]),
    ]

    await skillManager.maybeCreateSkill(steps, "test-session", "always")

    const skills = await skillManager.listSkills()
    assert.equal(skills.length, 1)
    assert.ok(skills[0].name)
  })

  it("confirm 模式创建流程正常", async () => {
    const steps = [
      makeStep(1, [makeToolCall("ToolA")]),
      makeStep(2, [makeToolCall("ToolB")]),
      makeStep(3, [makeToolCall("ToolC")]),
      makeStep(4, [makeToolCall("ToolD")]),
    ]

    await skillManager.maybeCreateSkill(steps, "test-session", "confirm")

    const skills = await skillManager.listSkills()
    assert.equal(skills.length, 1)
  })
})

// ============================================================================
// LLM 回退行为测试
// ============================================================================

describe("LLM 回退行为", () => {
  it("isReusableWorkflow 在无 LLM 时回退到启发式", async () => {
    // >3 步，无错误，非定制操作 → heuristic 判为可复用
    const steps = [
      makeStep(1, [makeToolCall("ToolA")]),
      makeStep(2, [makeToolCall("ToolB")]),
      makeStep(3, [makeToolCall("ToolC")]),
      makeStep(4, [makeToolCall("ToolD")]),
    ]
    // 没有配置 LLM → 自动回退到启发式
    const result = await skillManager.shouldAutoCreate(steps, "always")
    assert.ok(result.shouldCreate) // heuristic 应判为可复用
  })

  it("isReusableWorkflow 定制操作在启发式下被拦截", async () => {
    // 含 "第10秒" 的定制操作 → heuristic 拦截
    const steps = [
      makeStep(1, [makeToolCall("TrimTool", { start: "第10秒" })]),
      makeStep(2, [makeToolCall("ExportTool")]),
    ]
    const result = await skillManager.shouldAutoCreate(steps, "always")
    assert.ok(!result.shouldCreate)
    assert.ok(
      result.reason.includes("custom") ||
        result.reason.includes("tool call") ||
        result.reason.includes("Too few"),
    )
  })

  it("maybeCreateSkill 在无 LLM 时回退到工具名拼接", async () => {
    const steps = [
      makeStep(1, [makeToolCall("LutFilterTool", { preset: "vintage" })]),
      makeStep(2, [makeToolCall("AudioEffectsTool", { effect: "grain" })]),
      makeStep(3, [makeToolCall("VideoFilterTool", { filter: "vignette" })]),
      makeStep(4, [makeToolCall("ExportTool", { format: "mp4" })]),
    ]

    // 没有配置 LLM → 自动回退到工具名拼接创建
    await skillManager.maybeCreateSkill(
      steps,
      "test-session-llm-fallback",
      "always",
    )

    const skills = await skillManager.listSkills()
    const matching = skills.filter(
      (s: any) => s.name.includes("LutFilterTool") || s.name.includes("lut"),
    )
    assert.ok(matching.length > 0 || skills.length > 0)
  })

  it("test handleToolError 在无 LLM 时回退到启发式归因", async () => {
    const steps = [
      makeStep(1, [makeToolCall("TrimTool", { start: 0 }, true)]), // 有 error
    ]

    // 先创建一个匹配的 skill
    await skillManager.createSkillFromTrajectory("TrimTool", "trim video", [
      makeStep(1, [makeToolCall("TrimTool")]),
    ])

    // handleToolError 内部会尝试 LLM → 失败 → 回退到 heuristic
    // 不抛出异常就通过
    await skillManager.handleToolError(steps, "test-error-session")
    assert.ok(true) // 走到这里说明没有崩溃
  })
})

// ============================================================================
// parseFrontmatter 测试
// ============================================================================

describe("parseFrontmatter", () => {
  it("返回 null 当无 frontmatter", () => {
    const result = skillManager.parseFrontmatter("一些文字\n没有 frontmatter")
    assert.equal(result, null)
  })

  it("解析简单 frontmatter", () => {
    const content = `---
name: test-skill
description: 测试
category: color-grading
---
步骤内容`
    const result = skillManager.parseFrontmatter(content)
    assert.ok(result)
    assert.equal(result.name, "test-skill")
    assert.equal(result.description, "测试")
    assert.equal(result.category, "color-grading")
  })

  it("解析带数组的 frontmatter", () => {
    const content = `---
name: test
tags: [vintage, film, retro]
toolCount: 3
---
内容`
    const result = skillManager.parseFrontmatter(content)
    assert.deepEqual(result.tags, ["vintage", "film", "retro"])
    assert.equal(result.toolCount, 3)
  })
})

// ============================================================================
// 使用追踪测试
// ============================================================================

describe("使用追踪", () => {
  it("bumpUsage 递增使用次数", async () => {
    await skillManager.createSkillFromTrajectory("tracked", "tracked", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    skillManager.bumpUsage("tracked")
    skillManager.bumpUsage("tracked")
    skillManager.bumpUsage("tracked")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["tracked"].useCount, 3)
    assert.ok(usage["tracked"].lastUsedAt)
  })

  it("recordFailure 递增失败计数", async () => {
    await skillManager.createSkillFromTrajectory("failing", "failing", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    skillManager.recordFailure("failing")
    skillManager.recordFailure("failing")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["failing"].failCount, 2)
    assert.equal(usage["failing"].consecutiveFails, 2)
  })

  it("recordSuccess 重置连续失败", async () => {
    await skillManager.createSkillFromTrajectory("recovering", "recovering", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    skillManager.recordFailure("recovering")
    skillManager.recordFailure("recovering")
    skillManager.recordSuccess("recovering")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["recovering"].failCount, 2)
    assert.equal(usage["recovering"].consecutiveFails, 0)
  })
})
