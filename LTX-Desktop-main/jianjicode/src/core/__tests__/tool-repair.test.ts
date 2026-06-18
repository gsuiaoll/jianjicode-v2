/**
 * Tool Arg Repair 测试
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isLikelyArgError, parseRepairResponse } from "../tool-repair.js"

describe("isLikelyArgError — 参数错误快速过滤", () => {
  it("detects invalid args pattern", () => {
    assert.equal(isLikelyArgError("invalid args: ffmpeg"), true)
  })

  it("detects invalid arguments pattern", () => {
    assert.equal(isLikelyArgError("invalid arguments: missing required"), true)
  })

  it("detects validation error", () => {
    assert.equal(isLikelyArgError("validation failed: must be a number"), true)
  })

  it("detects required parameter", () => {
    assert.equal(
      isLikelyArgError("required parameter 'input' is missing"),
      true,
    )
  })

  it("detects invalid input", () => {
    assert.equal(isLikelyArgError("invalid input: file not found"), true)
  })

  it("detects not found (still an arg issue)", () => {
    assert.equal(isLikelyArgError("ffprobe not found: No such file"), true)
  })

  it("detects must be pattern", () => {
    assert.equal(isLikelyArgError("intensity must be between 0 and 1"), true)
  })

  it("rejects network errors", () => {
    assert.equal(isLikelyArgError("ECONNREFUSED: connection refused"), false)
  })

  it("rejects rate limit errors", () => {
    assert.equal(isLikelyArgError("rate limit exceeded: 429"), false)
  })

  it("rejects auth errors", () => {
    assert.equal(isLikelyArgError("401 unauthorized: invalid API key"), false)
  })

  it("rejects empty string", () => {
    assert.equal(isLikelyArgError(""), false)
  })

  it("rejects context overflow", () => {
    assert.equal(
      isLikelyArgError(
        "context_length_exceeded: maximum context length is 128000",
      ),
      false,
    )
  })

  it("rejects system errors", () => {
    assert.equal(isLikelyArgError("Cannot read property of undefined"), false)
  })
})

describe("parseRepairResponse — LLM 响应解析", () => {
  it("parses pure JSON response", () => {
    const result = parseRepairResponse(
      '{"correctedArgs": {"input": "video.mp4"}, "explanation": "fixed path"}',
    )
    assert.notEqual(result, null)
    assert.deepEqual(result!.correctedArgs, { input: "video.mp4" })
    assert.equal(result!.explanation, "fixed path")
  })

  it("parses JSON code block", () => {
    const result = parseRepairResponse(
      '```json\n{"correctedArgs": {"output": "result.mp4"}}\n```',
    )
    assert.notEqual(result, null)
    assert.deepEqual(result!.correctedArgs, { output: "result.mp4" })
  })

  it("parses JSON code block without language", () => {
    const result = parseRepairResponse('```\n{"correctedArgs": {"x": 1}}\n```')
    assert.notEqual(result, null)
    assert.deepEqual(result!.correctedArgs, { x: 1 })
  })

  it("extracts from text with preamble", () => {
    const result = parseRepairResponse(
      'I fixed the args:\n{"correctedArgs": {"path": "/tmp/test.mp4"}, "explanation": "fixed"}',
    )
    assert.notEqual(result, null)
    // Should find the brace-wrapped JSON
    assert.deepEqual(result!.correctedArgs, { path: "/tmp/test.mp4" })
  })

  it("returns null for empty string", () => {
    const result = parseRepairResponse("")
    assert.equal(result, null)
  })

  it("returns null for invalid text", () => {
    const result = parseRepairResponse("Sorry, I couldn't fix the args.")
    assert.equal(result, null)
  })

  it("returns null for nonsense", () => {
    const result = parseRepairResponse("!@#$%^&*()")
    assert.equal(result, null)
  })

  it("handles nested objects in correctedArgs", () => {
    const result = parseRepairResponse(
      JSON.stringify({
        correctedArgs: {
          filters: [{ name: "lut", args: { file: "lookup.cube" } }],
          output: "out.mp4",
        },
        explanation: "fixed filter chain",
      }),
    )
    assert.notEqual(result, null)
    assert.equal(Array.isArray(result!.correctedArgs!.filters), true)
    assert.equal(result!.explanation, "fixed filter chain")
  })
})
