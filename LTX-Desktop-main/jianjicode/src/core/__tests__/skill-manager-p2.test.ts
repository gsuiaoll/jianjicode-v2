/**
 * Phase 2 测试 — Self-Patching（灰度 patch 流程）
 *
 * 覆盖：backupSkill, promotePatch, rollbackPatch,
 *       writePatch, loadSkillContent, checkBroken,
 *       hasPatch, getSkillFiles, handleToolError
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { after, before, beforeEach, describe, it } from "node:test"

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "skill-p2-test-"))
const SKILLS_DIR = path.join(TEST_DIR, "skills")

process.env.JIANGJICODE_SKILLS_DIR = SKILLS_DIR
process.env.JIANGJICODE_DISABLE_JUDGE = "1"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sm: any

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
  sm = await import("../skill-manager.js")
})

beforeEach(() => {
  if (fs.existsSync(SKILLS_DIR)) {
    for (const entry of fs.readdirSync(SKILLS_DIR)) {
      fs.rmSync(path.join(SKILLS_DIR, entry), { recursive: true, force: true })
    }
  }
})

after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
})

// ============================================================================
// 辅助：创建一个测试 skill
// ============================================================================

async function createTestSkill(
  name = "test-skill",
  desc = "Test skill for phase 2",
) {
  await sm.createSkillFromTrajectory(name, desc, [
    makeStep(1, [makeToolCall("ToolA")]),
    makeStep(2, [makeToolCall("ToolB")]),
  ])
  return name
}

// ============================================================================
// loadSkillContent
// ============================================================================

describe("loadSkillContent", () => {
  it("加载已有 SKILL.md", async () => {
    const name = await createTestSkill()
    const content = sm.loadSkillContent(name)
    assert.ok(content)
    assert.ok(content.includes("name: test-skill"))
    assert.ok(content.includes("ToolA"))
  })

  it("不存在的 skill 返回 null", () => {
    const content = sm.loadSkillContent("nonexistent")
    assert.equal(content, null)
  })

  it("优先加载 .patch 文件（灰度版本）", async () => {
    const name = await createTestSkill()

    // 写入 patch 文件
    const patchContent = "PATCH VERSION"
    sm.writePatch(name, patchContent)

    const loaded = sm.loadSkillContent(name)
    assert.ok(loaded)
    assert.ok(loaded.includes("PATCH VERSION"))
  })
})

// ============================================================================
// backupSkill
// ============================================================================

describe("backupSkill", () => {
  it("备份当前 SKILL.md 为 .v1", async () => {
    const name = await createTestSkill()
    sm.backupSkill(name)

    const backupPath = path.join(SKILLS_DIR, name, "SKILL.md.v1")
    assert.ok(fs.existsSync(backupPath))

    const backupContent = fs.readFileSync(backupPath, "utf-8")
    assert.ok(backupContent.includes("name: test-skill"))
  })

  it("多次备份递增版本号", async () => {
    const name = await createTestSkill()
    sm.backupSkill(name)
    sm.backupSkill(name)
    sm.backupSkill(name)

    assert.ok(fs.existsSync(path.join(SKILLS_DIR, name, "SKILL.md.v1")))
    assert.ok(fs.existsSync(path.join(SKILLS_DIR, name, "SKILL.md.v2")))
    assert.ok(fs.existsSync(path.join(SKILLS_DIR, name, "SKILL.md.v3")))
  })

  it("保留最近 3 个备份", async () => {
    const name = await createTestSkill()
    sm.backupSkill(name) // v1
    sm.backupSkill(name) // v2
    sm.backupSkill(name) // v3
    sm.backupSkill(name) // v4 应该删除 v1

    assert.ok(!fs.existsSync(path.join(SKILLS_DIR, name, "SKILL.md.v1")))
    assert.ok(fs.existsSync(path.join(SKILLS_DIR, name, "SKILL.md.v4")))
  })
})

// ============================================================================
// writePatch / promotePatch / rollbackPatch
// ============================================================================

describe("灰度 patch 生命周期", () => {
  it("writePatch 写入 .patch 文件", async () => {
    const name = await createTestSkill()
    sm.writePatch(name, "PATCH CONTENT")

    const patchPath = path.join(SKILLS_DIR, name, "SKILL.md.patch")
    assert.ok(fs.existsSync(patchPath))
    assert.equal(fs.readFileSync(patchPath, "utf-8"), "PATCH CONTENT")
  })

  it("writePatch 递增 patchCount", async () => {
    const name = await createTestSkill()
    sm.writePatch(name, "patch1")
    sm.writePatch(name, "patch2")

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage[name].patchCount, 2)
  })

  it("promotePatch 覆盖 SKILL.md 并删除 .patch", async () => {
    const name = await createTestSkill()
    const originalContent = fs.readFileSync(
      path.join(SKILLS_DIR, name, "SKILL.md"),
      "utf-8",
    )

    sm.writePatch(name, "NEW STABLE CONTENT")
    sm.promotePatch(name)

    // .patch 已删除
    assert.ok(!fs.existsSync(path.join(SKILLS_DIR, name, "SKILL.md.patch")))
    // SKILL.md 已被覆盖
    const newContent = fs.readFileSync(
      path.join(SKILLS_DIR, name, "SKILL.md"),
      "utf-8",
    )
    assert.equal(newContent, "NEW STABLE CONTENT")
    assert.notEqual(newContent, originalContent)
  })

  it("rollbackPatch 删除 .patch，保留原 SKILL.md", async () => {
    const name = await createTestSkill()
    const originalContent = fs.readFileSync(
      path.join(SKILLS_DIR, name, "SKILL.md"),
      "utf-8",
    )

    sm.writePatch(name, "FAILED PATCH")
    sm.rollbackPatch(name)

    // .patch 已删除
    assert.ok(!fs.existsSync(path.join(SKILLS_DIR, name, "SKILL.md.patch")))
    // SKILL.md 不变
    const content = fs.readFileSync(
      path.join(SKILLS_DIR, name, "SKILL.md"),
      "utf-8",
    )
    assert.equal(content, originalContent)
  })
})

// ============================================================================
// checkBroken
// ============================================================================

describe("checkBroken", () => {
  it("patchCount < 3 不标记 broken", async () => {
    const name = await createTestSkill()
    sm.writePatch(name, "p1")
    sm.writePatch(name, "p2")

    const isBroken = sm.checkBroken(name)
    assert.equal(isBroken, false)

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage[name].state, "active")
  })

  it("patchCount >= 3 标记 broken", async () => {
    const name = await createTestSkill()
    sm.writePatch(name, "p1")
    sm.writePatch(name, "p2")
    sm.writePatch(name, "p3")

    const isBroken = sm.checkBroken(name)
    assert.equal(isBroken, true)

    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage[name].state, "broken")
  })
})

// ============================================================================
// hasPatch / getSkillFiles
// ============================================================================

describe("便捷查询", () => {
  it("hasPatch 检测是否有灰度 patch", async () => {
    const name = await createTestSkill()
    assert.equal(sm.hasPatch(name), false)

    sm.writePatch(name, "test")
    assert.equal(sm.hasPatch(name), true)
  })

  it("getSkillFiles 返回文件列表", async () => {
    const name = await createTestSkill()
    sm.backupSkill(name)
    const files = sm.getSkillFiles(name)
    assert.ok(files.length >= 2) // SKILL.md + SKILL.md.v1
  })
})

// ============================================================================
// handleToolError 集成测试
// ============================================================================

describe("handleToolError", () => {
  it("无匹配 skill 时跳过", async () => {
    await sm.handleToolError(
      [makeStep(1, [makeToolCall("UnknownTool", {}, true)])],
      "test-session",
    )
    // 没有 crash 就通过
    assert.ok(true)
  })

  it("非 Skill 错误不生成 patch", async () => {
    const name = await createTestSkill()
    // 模拟权限错误
    const steps = [
      makeStep(1, [makeToolCall("ToolA", {})]),
      makeStep(2, [makeToolCall("ToolB", {}, true)]),
    ]
    // 覆盖 metadata 来模拟权限错误
    steps[1].toolCalls[0].result.output =
      "Permission denied: access not allowed"
    steps[1].toolCalls[0].result.metadata = {
      error: true,
      error_message: "Permission denied",
    } as any

    await sm.handleToolError(steps, "test-session")

    // 不生成 patch
    assert.equal(sm.hasPatch(name), false)
  })

  it("Skill 问题错误生成灰度 patch", async () => {
    const name = await createTestSkill()
    // 模拟参数错误（Skill 问题）
    const steps = [
      makeStep(1, [makeToolCall("ToolA", {})]),
      makeStep(2, [makeToolCall("ToolB", {}, true)]),
    ]
    // 修改 output 来模拟无效参数错误 — 这会被启发式归因匹配
    steps[1].toolCalls[0].result.output = "Invalid parameter: scale=invalid"
    steps[1].toolCalls[0].result.metadata = { error: true }

    // 此时 findMatchingSkill 需要能匹配到 "test-skill"
    // 因为 skill 内容包含 "ToolA","ToolB" 等工具名
    await sm.handleToolError(steps, "test-session")

    // 应该生成 patch
    assert.ok(
      sm.hasPatch(name),
      "patch should be created for skill-related error",
    )
  })

  it("broken 状态的 skill 跳过修复", async () => {
    const name = await createTestSkill()
    sm.writePatch(name, "p1")
    sm.writePatch(name, "p2")
    sm.writePatch(name, "p3")
    sm.checkBroken(name) // 标记 broken

    const steps = [
      makeStep(1, [makeToolCall("ToolA", {})]),
      makeStep(2, [makeToolCall("ToolB", {}, true)]),
    ]
    steps[1].toolCalls[0].result.metadata = { error: true }

    await sm.handleToolError(steps, "test-session")

    // broken 后不再生成新 patch
    const usageFile = path.join(SKILLS_DIR, ".usage.json")
    const usage = JSON.parse(fs.readFileSync(usageFile, "utf-8"))
    assert.equal(usage[name].patchCount, 3) // 仍是 3
  })
})
