/**
 * Error Classifier 测试
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import { describe, it, before } from "node:test"
import { ErrorCode } from "../../types/errors.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ec: any

before(async () => {
  ec = await import("../error-classifier.js")
})

describe("classifyErrorDetailed — 错误分类", () => {
  it("classifies network error", () => {
    const r = ec.classifyErrorDetailed(
      new Error("fetch failed: connection refused"),
    )
    assert.equal(r.type, "network")
    assert.equal(r.recoveryAction, "fallback_provider")
    assert.equal(r.retryable, true)
  })

  it("classifies rate limit as API error", () => {
    const r = ec.classifyErrorDetailed(
      new Error("rate limit exceeded: 429 Too Many Requests"),
    )
    assert.equal(r.type, "api")
    assert.equal(r.recoveryAction, "retry_with_backoff")
    assert.equal(r.retryable, true)
  })

  it("classifies context overflow as model error", () => {
    const r = ec.classifyErrorDetailed(
      new Error("context_length_exceeded: maximum context length is 128000"),
    )
    assert.equal(r.type, "model")
    assert.equal(r.recoveryAction, "compact_context")
    assert.equal(r.retryable, false)
  })

  it("classifies auth error as permission", () => {
    const r = ec.classifyErrorDetailed(
      new Error("401 unauthorized: invalid API key"),
    )
    assert.equal(r.type, "permission")
    assert.equal(r.recoveryAction, "report_to_user")
    assert.equal(r.retryable, false)
  })

  it("classifies tool error", () => {
    const r = ec.classifyErrorDetailed(
      new Error("tool execution failed: invalid arguments"),
    )
    assert.equal(r.type, "tool")
    assert.equal(r.recoveryAction, "fix_tool_args")
  })

  it("classifies input error", () => {
    const r = ec.classifyErrorDetailed(
      new Error("ENOENT: no such file or directory"),
    )
    assert.equal(r.type, "input")
    assert.equal(r.recoveryAction, "report_to_user")
  })

  it("classifies system error", () => {
    const r = ec.classifyErrorDetailed(
      new Error("Cannot read property of undefined"),
    )
    assert.equal(r.type, "system")
    assert.equal(r.severity, "critical")
  })

  it("classifies unknown error as unknown type", () => {
    const r = ec.classifyErrorDetailed(new Error("some weird error"))
    assert.equal(r.type, "unknown")
  })

  it("handles empty error message", () => {
    const r = ec.classifyErrorDetailed(new Error(""))
    assert.ok(r.message !== undefined)
  })

  it("handles non-Error objects", () => {
    const r = ec.classifyErrorDetailed("string error")
    assert.equal(r.type, "unknown")
  })

  it("likelySkillProblem is true for tool errors", () => {
    const r = ec.classifyErrorDetailed(
      new Error("tool execution failed: invalid args for ffmpeg"),
    )
    assert.equal(r.likelySkillProblem, true)
  })

  it("likelySkillProblem is false for network errors", () => {
    const r = ec.classifyErrorDetailed(new Error("ECONNREFUSED"))
    assert.equal(r.likelySkillProblem, false)
  })
})

describe("analyzeErrors — 错误统计分析", () => {
  it("analyzes a single error", () => {
    const r = ec.analyzeErrors([new Error("rate limit")])
    assert.equal(r.total, 1)
    assert.equal(r.byType.api, 1)
    assert.equal(r.retryableCount, 1)
    assert.equal(r.permanentCount, 0)
  })

  it("analyzes multiple errors of different types", () => {
    const r = ec.analyzeErrors([
      new Error("rate limit"),
      new Error("connection refused"),
      new Error("tool execution failed"),
    ])
    assert.equal(r.total, 3)
    assert.ok(r.byType.api >= 1)
    assert.ok(r.byType.network >= 1)
    assert.ok(r.byType.tool >= 1)
    assert.equal(r.mostCommonType, "api") // rate limit matches both api and network patterns, api checked first
  })

  it("preserves first and last classifications", () => {
    const r = ec.analyzeErrors([
      new Error("first error"),
      new Error("rate limit"),
      new Error("last error"),
    ])
    assert.ok(r.firstClassification.message.includes("first"))
    assert.ok(r.lastClassification.message.includes("last"))
  })

  it("handles empty error array", () => {
    const r = ec.analyzeErrors([])
    assert.equal(r.total, 0)
  })
})

describe("shouldTriggerSkillPatch — 自修复触发判断", () => {
  it("triggers when enough tool errors", () => {
    const r = ec.shouldTriggerSkillPatch(
      [
        new Error("tool execution failed: invalid arguments"),
        new Error("tool call error: missing required parameter"),
      ],
      2,
    )
    assert.equal(r, true)
  })

  it("does not trigger for network errors", () => {
    const r = ec.shouldTriggerSkillPatch(
      [new Error("connection refused"), new Error("rate limit")],
      2,
    )
    assert.equal(r, false)
  })

  it("does not trigger with insufficient errors", () => {
    const r = ec.shouldTriggerSkillPatch([new Error("tool error")], 2)
    assert.equal(r, false)
  })

  it("respects custom threshold", () => {
    const r = ec.shouldTriggerSkillPatch(
      [new Error("tool call invalid arguments")],
      1,
    )
    assert.equal(r, true)
  })
})
