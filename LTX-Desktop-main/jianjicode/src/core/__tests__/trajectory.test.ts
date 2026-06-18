/**
 * Trajectory Recording 测试
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { before, beforeEach, describe, it } from "node:test"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tr: any

const TRAJ_DIR = path.join(os.homedir(), ".jianjicode", "trajectories")

before(async () => {
  tr = await import("../trajectory.js")
})

beforeEach(() => {
  tr.resetTrajectoryRecorder()
  // 清理磁盘上的持久化数据，防止测试间泄漏
  try {
    if (fs.existsSync(TRAJ_DIR)) {
      for (const f of fs.readdirSync(TRAJ_DIR)) {
        fs.unlinkSync(path.join(TRAJ_DIR, f))
      }
    }
  } catch {
    /* ignore cleanup errors */
  }
})

describe("TrajectoryRecorder — 基础记录功能", () => {
  it("starts and finishes recording", () => {
    const recorder = new tr.TrajectoryRecorder()
    recorder.startRecording("session-1", "hello")
    recorder.finishRecording("session-1", true, { totalTokens: 100 })

    const t = recorder.getTrajectory("session-1")
    assert.notEqual(t, undefined)
    assert.equal(t.sessionId, "session-1")
    assert.equal(t.message, "hello")
    assert.equal(t.success, true)
    assert.equal(t.totalTokens, 100)
    assert.ok(t.startedAt)
    assert.ok(t.completedAt)
  })

  it("records steps in order", () => {
    const recorder = new tr.TrajectoryRecorder()
    recorder.startRecording("session-2", "test")

    recorder.recordStep("session-2", { type: "text", summary: "step 1" })
    recorder.recordStep("session-2", {
      type: "tool_call",
      summary: "ffmpeg execute",
      toolName: "ffmpeg",
    })
    recorder.recordStep("session-2", {
      type: "tool_result",
      summary: "success",
      toolName: "ffmpeg",
    })

    recorder.finishRecording("session-2", true)

    const t = recorder.getTrajectory("session-2")
    assert.equal(t.steps.length, 3)
    assert.equal(t.steps[0].stepNumber, 1)
    assert.equal(t.steps[0].type, "text")
    assert.equal(t.steps[1].toolName, "ffmpeg")
    assert.equal(t.steps[2].type, "tool_result")
  })

  it("does not record steps for unknown session", () => {
    const recorder = new tr.TrajectoryRecorder()
    // No startRecording called
    recorder.recordStep("unknown", {
      type: "text",
      summary: "should not appear",
    })
    recorder.finishRecording("unknown", true)

    assert.equal(recorder.getTrajectory("unknown"), undefined)
  })

  it("returns undefined for non-existent session", () => {
    const recorder = new tr.TrajectoryRecorder()
    assert.equal(recorder.getTrajectory("nonexistent"), undefined)
  })
})

describe("TrajectoryRecorder — 查询功能", () => {
  it("getRecentTrajectories returns most recent first", async () => {
    const recorder = new tr.TrajectoryRecorder()

    recorder.startRecording("s1", "first")
    recorder.finishRecording("s1", true)

    // 确保时间戳不同
    await new Promise((r) => setTimeout(r, 10))

    recorder.startRecording("s2", "second")
    recorder.finishRecording("s2", true)

    const recent = recorder.getRecentTrajectories(5)
    assert.equal(recent.length, 2)
    assert.equal(recent[0].message, "second") // most recent first
    assert.equal(recent[1].message, "first")
  })

  it("getRecentSuccessfulTrajectories filters by success", () => {
    const recorder = new tr.TrajectoryRecorder()

    recorder.startRecording("s1", "success")
    recorder.finishRecording("s1", true)

    recorder.startRecording("s2", "fail")
    recorder.finishRecording("s2", false)

    const good = recorder.getRecentSuccessfulTrajectories(10)
    assert.equal(good.length, 1)
    assert.equal(good[0].message, "success")
  })

  it("searchTrajectories finds by message text", () => {
    const recorder = new tr.TrajectoryRecorder()

    recorder.startRecording("s1", "apply vintage film look")
    recorder.recordStep("s1", {
      type: "tool_call",
      summary: "run ffmpeg with lut",
      toolName: "ffmpeg",
    })
    recorder.finishRecording("s1", true)

    recorder.startRecording("s2", "trim video")
    recorder.finishRecording("s2", true)

    const results = recorder.searchTrajectories("vintage")
    assert.equal(results.length, 1)
    assert.equal(results[0].sessionId, "s1")
  })

  it("searchTrajectories finds by step content", () => {
    const recorder = new tr.TrajectoryRecorder()

    recorder.startRecording("s1", "do something")
    recorder.recordStep("s1", {
      type: "tool_call",
      summary: "run custom filter",
      toolName: "custom_tool",
    })
    recorder.finishRecording("s1", true)

    const results = recorder.searchTrajectories("custom_tool")
    assert.equal(results.length, 1)
  })

  it("getTrajectoriesSince filters by time", () => {
    const recorder = new tr.TrajectoryRecorder()
    const early = new Date(Date.now() + 86400000).toISOString() // tomorrow

    recorder.startRecording("now", "current")
    recorder.finishRecording("now", true)

    // 明天之前的所有轨迹
    const recent = recorder.getTrajectoriesSince(early)
    assert.equal(recent.length, 0)

    // 昨天开始的轨迹
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    const all = recorder.getTrajectoriesSince(yesterday)
    assert.ok(all.length >= 1)
  })
})

describe("TrajectoryRecorder — 容量管理", () => {
  it("clearOldTrajectories removes excess", () => {
    const recorder = new tr.TrajectoryRecorder(5) // max 5

    for (let i = 0; i < 10; i++) {
      recorder.startRecording(`s${i}`, `message ${i}`)
      recorder.finishRecording(`s${i}`, true)
    }

    assert.ok(recorder.size <= 5)
  })

  it("clearOldTrajectories keeps specified number", () => {
    const recorder = new tr.TrajectoryRecorder(100)

    for (let i = 0; i < 20; i++) {
      recorder.startRecording(`s${i}`, `message ${i}`)
      recorder.finishRecording(`s${i}`, true)
    }

    recorder.clearOldTrajectories(10)
    assert.ok(recorder.size <= 10)
  })
})

describe("Global singleton — getTrajectoryRecorder", () => {
  it("returns the same instance on repeated calls", () => {
    const r1 = tr.getTrajectoryRecorder()
    const r2 = tr.getTrajectoryRecorder()
    assert.equal(r1, r2)
  })

  it("resetTrajectoryRecorder creates new instance", () => {
    const r1 = tr.getTrajectoryRecorder()
    tr.resetTrajectoryRecorder()
    const r2 = tr.getTrajectoryRecorder()
    assert.notEqual(r1, r2)
  })
})

describe("TrajectoryStep — 字段验证", () => {
  it("auto-assigns timestamp and stepNumber", () => {
    const recorder = new tr.TrajectoryRecorder()
    recorder.startRecording("s", "test")
    recorder.recordStep("s", { type: "text", summary: "auto fields" })
    recorder.finishRecording("s", true)

    const t = recorder.getTrajectory("s")
    assert.ok(t.steps[0].timestamp)
    assert.equal(t.steps[0].stepNumber, 1)
  })

  it("records tool details", () => {
    const recorder = new tr.TrajectoryRecorder()
    recorder.startRecording("s", "test")
    recorder.recordStep("s", {
      type: "tool_call",
      summary: "ffmpeg with args",
      toolName: "ffmpeg",
      toolArgs: { input: "video.mp4" },
      toolResult: { output: "success", error: false },
    })
    recorder.finishRecording("s", true)

    const step = recorder.getTrajectory("s").steps[0]
    assert.equal(step.toolName, "ffmpeg")
    assert.deepEqual(step.toolArgs, { input: "video.mp4" })
    assert.equal(step.toolResult?.output, "success")
  })
})
