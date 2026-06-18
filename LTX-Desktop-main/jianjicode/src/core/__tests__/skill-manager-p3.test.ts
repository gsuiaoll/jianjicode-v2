/**
 * Phase 3 测试 — Curator + 生命周期管理 + Nudge
 *
 * 覆盖：
 * - 技能生命周期（stale/archive/pin/rate）
 * - 增量 Review（curator）
 * - 定时/事件调度（scheduler）
 * - Nudge 交互
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { after, before, beforeEach, describe, it } from "node:test"

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "skill-p3-test-"))
const SKILLS_DIR = path.join(TEST_DIR, "skills")
const CURATOR_DIR = path.join(TEST_DIR, "curator")
const NUDGE_DIR = path.join(TEST_DIR, "nudges")
const SESSIONS_DIR = path.join(TEST_DIR, "sessions")

process.env.JIANGJICODE_SKILLS_DIR = SKILLS_DIR
process.env.JIANGJICODE_CURATOR_DIR = CURATOR_DIR
process.env.JIANGJICODE_NUDGE_DIR = NUDGE_DIR
process.env.JIANGJICODE_SESSIONS_DIR = SESSIONS_DIR

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sm: any
let curator: any
let nudge: any

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

before(async () => {
  fs.mkdirSync(SKILLS_DIR, { recursive: true })
  fs.mkdirSync(CURATOR_DIR, { recursive: true })
  fs.mkdirSync(NUDGE_DIR, { recursive: true })
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })

  sm = await import("../skill-manager.js")
  curator = await import("../curator.js")
  nudge = await import("../nudge-service.js")
})

beforeEach(() => {
  // 清空 skills
  if (fs.existsSync(SKILLS_DIR)) {
    for (const entry of fs.readdirSync(SKILLS_DIR)) {
      fs.rmSync(path.join(SKILLS_DIR, entry), { recursive: true, force: true })
    }
  }
  // 清空 curator
  if (fs.existsSync(CURATOR_DIR)) {
    for (const entry of fs.readdirSync(CURATOR_DIR)) {
      fs.rmSync(path.join(CURATOR_DIR, entry), { recursive: true, force: true })
    }
  }
  // 清空 nudge
  if (fs.existsSync(NUDGE_DIR)) {
    for (const entry of fs.readdirSync(NUDGE_DIR)) {
      fs.rmSync(path.join(NUDGE_DIR, entry), { recursive: true, force: true })
    }
  }
  // 清空 sessions
  if (fs.existsSync(SESSIONS_DIR)) {
    for (const entry of fs.readdirSync(SESSIONS_DIR)) {
      fs.rmSync(path.join(SESSIONS_DIR, entry), {
        recursive: true,
        force: true,
      })
    }
  }
  // 清空 .usage.json
  const usageFile = path.join(SKILLS_DIR, ".usage.json")
  if (fs.existsSync(usageFile)) fs.unlinkSync(usageFile)

  // 重置 nudge
  nudge.clearNudges()

  // 重置 curator 状态
  curator.setLastReviewedAt(new Date(Date.now() - 100000).toISOString())
  while (curator.getConsecutiveNoMatch() > 0) curator.resetConsecutiveNoMatch()
})

after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
})

// ============================================================================
// 生命周期管理
// ============================================================================

describe("生命周期 — staleSkill", () => {
  it("标记 skill 为 stale", async () => {
    await sm.createSkillFromTrajectory("test-skill", "test", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.staleSkill("test-skill")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["test-skill"].state, "stale")
  })

  it("pinned skill 跳过 stale", async () => {
    await sm.createSkillFromTrajectory("pinned-skill", "pinned", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.pinSkill("pinned-skill")
    sm.staleSkill("pinned-skill")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["pinned-skill"].state, "active")
  })
})

describe("生命周期 — archiveSkill", () => {
  it("标记 skill 为 archived", async () => {
    await sm.createSkillFromTrajectory("old-skill", "old", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.archiveSkill("old-skill")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["old-skill"].state, "archived")
  })

  it("pinned skill 跳过 archive", async () => {
    await sm.createSkillFromTrajectory("pinned2", "pinned", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.pinSkill("pinned2")
    sm.archiveSkill("pinned2")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["pinned2"].state, "active")
  })
})

describe("生命周期 — pin/unpin", () => {
  it("pinned skill 标记为 pinned=true", async () => {
    await sm.createSkillFromTrajectory("pin-test", "test", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.pinSkill("pin-test")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["pin-test"].pinned, true)
  })

  it("unpinned 恢复 pinned=false", async () => {
    await sm.createSkillFromTrajectory("unpin-test", "test", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.pinSkill("unpin-test")
    sm.unpinSkill("unpin-test")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["unpin-test"].pinned, false)
  })
})

describe("生命周期 — rateSkill", () => {
  it("设置评分", async () => {
    await sm.createSkillFromTrajectory("rated-skill", "test", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.rateSkill("rated-skill", 4)

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["rated-skill"].userRating, 4)
  })

  it("评分 < 3 自动标记 stale", async () => {
    await sm.createSkillFromTrajectory("low-rated", "test", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.rateSkill("low-rated", 2)

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["low-rated"].userRating, 2)
    assert.equal(usage["low-rated"].state, "stale")
  })

  it("评分 ≥ 3 不触发 stale", async () => {
    await sm.createSkillFromTrajectory("good-rated", "test", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.rateSkill("good-rated", 4)

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage["good-rated"].userRating, 4)
    assert.equal(usage["good-rated"].state, "active")
  })
})

describe("生命周期 — runLifecycleCheck", () => {
  it("返回空列表当所有 skill 正常", () => {
    const actions = sm.runLifecycleCheck()
    assert.deepEqual(actions, [])
  })

  it("活跃但最近使用的 skill 不触发 stale", async () => {
    await sm.createSkillFromTrajectory("recent-skill", "recent", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    // bumpUsage 设置 lastUsedAt 为现在
    sm.bumpUsage("recent-skill")

    const actions = sm.runLifecycleCheck()
    const staleAction = actions.find(
      (a: { name: string }) => a.name === "recent-skill",
    )
    assert.equal(staleAction, undefined)
  })

  it("pinned skill 跳过生命周期检查", async () => {
    await sm.createSkillFromTrajectory("pinned-skill", "pinned", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.pinSkill("pinned-skill")
    // 手动设置 lastUsedAt 为很久以前
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILLS_DIR, ".usage.json"), "utf-8"),
    )
    data["pinned-skill"].pinned = true
    data["pinned-skill"].lastUsedAt = new Date(
      Date.now() - 100 * 86400000,
    ).toISOString()
    fs.writeFileSync(
      path.join(SKILLS_DIR, ".usage.json"),
      JSON.stringify(data),
      "utf-8",
    )

    const actions = sm.runLifecycleCheck()
    const pinnedAction = actions.find(
      (a: { name: string }) => a.name === "pinned-skill",
    )
    assert.equal(pinnedAction, undefined)
  })
})

describe("生命周期 — applyTemplateVars", () => {
  it("无变量时返回原内容", () => {
    const content = "这是普通文本，没有变量"
    assert.equal(sm.applyTemplateVars(content), content)
  })

  it("替换已知变量", () => {
    const content = "处理视频：${INPUT_PATH}，输出到：${OUTPUT_DIR}"
    const result = sm.applyTemplateVars(content, {
      INPUT_PATH: "/videos/test.mp4",
      OUTPUT_DIR: "/videos/output",
    })
    assert.ok(result.includes("/videos/test.mp4"))
    assert.ok(result.includes("/videos/output"))
    assert.ok(!result.includes("${INPUT_PATH}"))
    assert.ok(!result.includes("${OUTPUT_DIR}"))
  })

  it("未提供的变量保留原样", () => {
    const content = "路径：${INPUT_PATH}，未知：${UNKNOWN_VAR}"
    const result = sm.applyTemplateVars(content, { INPUT_PATH: "/video.mp4" })
    assert.ok(result.includes("/video.mp4"))
    assert.ok(result.includes("${UNKNOWN_VAR}"))
  })

  it("空 vars 对象不修改变量", () => {
    const content = "路径：${INPUT_PATH}"
    const result = sm.applyTemplateVars(content, {})
    assert.ok(result.includes("${INPUT_PATH}"))
  })

  it("loadSkillContent 支持模板变量", async () => {
    await sm.createSkillFromTrajectory("template-test", "test", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    const content = sm.loadSkillContent("template-test", {
      INPUT_DIR: "/my/videos",
    })
    assert.ok(content)
    // 原本创建的内容里没有模板变量，所以 vars 不影响
    assert.ok(content.includes("name: template-test"))
  })
})

describe("生命周期 — getReviewCandidates", () => {
  it("没有候选时返回空列表", () => {
    const candidates = sm.getReviewCandidates()
    assert.deepEqual(candidates, [])
  })

  it("broken skill 是候选", async () => {
    await sm.createSkillFromTrajectory("broken-skill", "broken", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    // 模拟 broken 状态
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILLS_DIR, ".usage.json"), "utf-8"),
    )
    data["broken-skill"].state = "broken"
    fs.writeFileSync(
      path.join(SKILLS_DIR, ".usage.json"),
      JSON.stringify(data),
      "utf-8",
    )

    const candidates = sm.getReviewCandidates()
    assert.ok(candidates.length > 0)
    assert.equal(candidates[0].name, "broken-skill")
  })

  it("high-patch skill 是候选", async () => {
    await sm.createSkillFromTrajectory("patchy", "patchy", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILLS_DIR, ".usage.json"), "utf-8"),
    )
    data["patchy"].patchCount = 2
    fs.writeFileSync(
      path.join(SKILLS_DIR, ".usage.json"),
      JSON.stringify(data),
      "utf-8",
    )

    const candidates = sm.getReviewCandidates()
    assert.ok(candidates.some((c: { name: string }) => c.name === "patchy"))
  })

  it("pinned skill 不是候选", async () => {
    await sm.createSkillFromTrajectory("pinned", "pinned", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    sm.pinSkill("pinned")
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILLS_DIR, ".usage.json"), "utf-8"),
    )
    data["pinned"].state = "broken"
    data["pinned"].patchCount = 5
    fs.writeFileSync(
      path.join(SKILLS_DIR, ".usage.json"),
      JSON.stringify(data),
      "utf-8",
    )

    const candidates = sm.getReviewCandidates()
    assert.equal(
      candidates.filter((c: { name: string }) => c.name === "pinned").length,
      0,
    )
  })
})

// ============================================================================
// Curator
// ============================================================================

describe("Curator — 状态管理", () => {
  it("setLastReviewedAt 设置并读取有效时间", () => {
    const testTime = "2026-01-15T10:00:00.000Z"
    curator.setLastReviewedAt(testTime)
    assert.equal(curator.getLastReviewedAt(), testTime)
  })

  it("setLastReviewedAt 设置时间", () => {
    const now = new Date().toISOString()
    curator.setLastReviewedAt(now)
    // 因为 beforeEach 中设置了为 -100000，所以这里 getLastReviewedAt 会返回新值
    const retrieved = curator.getLastReviewedAt()
    // 验证格式（ISO 时间戳含 T 字符）
    assert.ok(retrieved)
    assert.ok(retrieved.includes("T"))
  })

  it("nudge 计数管理", () => {
    assert.equal(curator.getNudgeCount("test-skill"), 0)
    curator.bumpNudgeCount("test-skill")
    curator.bumpNudgeCount("test-skill")
    assert.equal(curator.getNudgeCount("test-skill"), 2)
  })

  it("连续无匹配计数管理", () => {
    assert.equal(curator.getConsecutiveNoMatch(), 0)
    curator.bumpConsecutiveNoMatch()
    curator.bumpConsecutiveNoMatch()
    assert.equal(curator.getConsecutiveNoMatch(), 2)
    curator.resetConsecutiveNoMatch()
    assert.equal(curator.getConsecutiveNoMatch(), 0)
  })
})

describe("Curator — shouldRunReview", () => {
  it("无上次 review 时触发", () => {
    // 先设置 lastReviewedAt 为 null
    curator.setLastReviewedAt("")
    assert.ok(curator.shouldRunReview())
  })

  it("连续无匹配 >= 3 时触发", () => {
    curator.bumpConsecutiveNoMatch()
    curator.bumpConsecutiveNoMatch()
    curator.bumpConsecutiveNoMatch()
    assert.ok(curator.shouldRunReview())
  })
})

describe("Curator — needsLightReview", () => {
  it("skill 数 <= 10 时不触发", () => {
    assert.ok(!curator.needsLightReview(10))
    assert.ok(!curator.needsLightReview(5))
  })

  it("skill 数 > 10 时触发", () => {
    assert.ok(curator.needsLightReview(11))
    assert.ok(curator.needsLightReview(20))
  })
})

describe("Curator — runIncrementalReview", () => {
  it("返回报告包含基本字段", async () => {
    const report = await curator.runIncrementalReview()
    assert.ok(report)
    assert.ok(report.reviewedAt)
    assert.ok(typeof report.sessionsAnalyzed === "number")
    assert.ok(Array.isArray(report.suggestions))
    assert.ok(Array.isArray(report.lifecycleActions))
    assert.ok(typeof report.skillCount === "number")
  })

  it("有 broken skill 时生成建议", async () => {
    await sm.createSkillFromTrajectory("broken-for-review", "broken", [
      makeStep(1, [makeToolCall("ToolA")]),
    ])
    const data = JSON.parse(
      fs.readFileSync(path.join(SKILLS_DIR, ".usage.json"), "utf-8"),
    )
    data["broken-for-review"].state = "broken"
    data["broken-for-review"].patchCount = 3
    fs.writeFileSync(
      path.join(SKILLS_DIR, ".usage.json"),
      JSON.stringify(data),
      "utf-8",
    )

    const report = await curator.runIncrementalReview()
    const brokenSuggestions = report.suggestions.filter(
      (s: { skillName?: string }) => s.skillName === "broken-for-review",
    )
    assert.ok(brokenSuggestions.length > 0)
  })
})

// ============================================================================
// Curator Scheduler
// ============================================================================

describe("Curator Scheduler", () => {
  let scheduler: any

  before(async () => {
    scheduler = await import("../curator-scheduler.js")
  })

  beforeEach(() => {
    scheduler.stopReviewScheduler()
  })

  it("初始状态下未运行", () => {
    assert.ok(!scheduler.isSchedulerRunning())
  })

  it("start/stop 控制运行状态", () => {
    scheduler.startReviewScheduler(60000) // 60s interval
    assert.ok(scheduler.isSchedulerRunning())
    scheduler.stopReviewScheduler()
    assert.ok(!scheduler.isSchedulerRunning())
  })

  it("多次 start 不重复启动", () => {
    scheduler.startReviewScheduler(60000)
    scheduler.startReviewScheduler(60000)
    scheduler.startReviewScheduler(60000)
    // 没有 crash 就通过
    assert.ok(scheduler.isSchedulerRunning())
    scheduler.stopReviewScheduler()
  })

  it("triggerEvent 不抛出异常", async () => {
    await scheduler.triggerEvent("skill-created")
    await scheduler.triggerEvent("skill-failed", "test-skill")
    await scheduler.triggerEvent("repeated-no-match")
    assert.ok(true)
  })

  it("onCuratorEvent 注册不抛异常", () => {
    const handler = () => {}
    scheduler.onCuratorEvent(handler)
    assert.ok(true)
  })
})

// ============================================================================
// Nudge Service
// ============================================================================

describe("Nudge — nudgeCreateSkill", () => {
  it("返回创建确认 nudge", () => {
    const result = nudge.nudgeCreateSkill("test-skill", "测试用 skill", 3)
    assert.equal(result.type, "create-confirm")
    assert.equal(result.name, "test-skill")
    assert.equal(result.description, "测试用 skill")
    assert.equal(result.toolCount, 3)
    assert.ok(result.message)
    assert.ok(result.message.includes("测试用 skill"))
  })

  it("nudge 记录写入日志", () => {
    nudge.nudgeCreateSkill("logged-skill", "logged", 2)
    const recent = nudge.getRecentNudges()
    assert.ok(recent.length > 0)
    assert.equal(recent[0].type, "create-confirm")
  })
})

describe("Nudge — nudgeOptimizationReport", () => {
  it("返回优化报告 nudge", async () => {
    const report = await curator.runIncrementalReview()
    const result = nudge.nudgeOptimizationReport(report)
    assert.equal(result.type, "optimization-report")
    assert.ok(result.message)
    assert.ok(result.message.includes("技能优化报告"))
  })

  it("包含建议内容", () => {
    const fakeReport = {
      reviewedAt: new Date().toISOString(),
      sessionsAnalyzed: 3,
      suggestions: [
        {
          type: "optimize" as const,
          skillName: "test",
          reason: "test reason",
          confidence: "high" as const,
        },
      ],
      lifecycleActions: [],
      skillCount: 1,
    }
    const result = nudge.nudgeOptimizationReport(fakeReport)
    assert.equal(result.suggestions.length, 1)
    assert.ok(result.message.includes("test reason"))
  })
})

describe("Nudge — nudgeSkillSuggestion", () => {
  it("返回技能建议 nudge", () => {
    const result = nudge.nudgeSkillSuggestion(["ToolA", "ToolB", "ToolC"], 3)
    assert.equal(result.type, "skill-suggestion")
    assert.equal(result.frequency, 3)
    assert.deepEqual(result.toolPattern, ["ToolA", "ToolB", "ToolC"])
    assert.ok(result.message)
  })
})

describe("Nudge — getRecentNudges / clearNudges", () => {
  it("空日志返回空数组", () => {
    nudge.clearNudges()
    const recent = nudge.getRecentNudges()
    assert.deepEqual(recent, [])
  })

  it("多次 nudge 后返回最近条目", () => {
    nudge.clearNudges()
    nudge.nudgeCreateSkill("s1", "d1", 1)
    nudge.nudgeCreateSkill("s2", "d2", 2)
    nudge.nudgeCreateSkill("s3", "d3", 3)

    const recent = nudge.getRecentNudges(2)
    assert.equal(recent.length, 2)
    assert.equal(recent[1].name, "s3")
  })
})

// ============================================================================
// 向后兼容：runReview
// ============================================================================

describe("runReview 向后兼容", () => {
  it("返回 LifecycleAction 数组", async () => {
    const actions = await sm.runReview()
    assert.ok(Array.isArray(actions))
  })
})
