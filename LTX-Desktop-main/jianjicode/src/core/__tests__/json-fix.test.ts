import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { fixJson, parseFixedJson } from "../json-fix.js"

describe("fixJson", () => {
  it("fixes trailing comma in object", () => {
    assert.equal(fixJson('{"a":1,"b":2,}'), '{"a":1,"b":2}')
  })

  it("fixes trailing comma in array", () => {
    assert.equal(fixJson("[1,2,3,]"), "[1,2,3]")
  })

  it("replaces Python None with null", () => {
    assert.equal(fixJson('{"a": None}'), '{"a": null}')
  })

  it("replaces Python True/False", () => {
    assert.equal(fixJson('{"a": True, "b": False}'), '{"a": true, "b": false}')
  })

  it("unquotes keys", () => {
    assert.equal(fixJson('{name: "test"}'), '{"name": "test"}')
  })

  it("removes markdown code fences", () => {
    assert.equal(fixJson('```json\n{"a":1}\n```'), '{"a":1}')
  })

  it("converts single quotes to double quotes", () => {
    assert.equal(fixJson("{\"a\": 'hello'}"), '{"a": "hello"}')
  })

  it("handles mixed complex input", () => {
    const input = "{result: True, items: [1, 2, 3,], message: 'success',}"
    const result = fixJson(input)
    const parsed = JSON.parse(result)
    assert.equal(parsed.result, true)
    assert.deepEqual(parsed.items, [1, 2, 3])
    assert.equal(parsed.message, "success")
  })
})

describe("parseFixedJson", () => {
  it("parses normal JSON", () => {
    const result = parseFixedJson('{"a": 1}')
    assert.deepEqual(result, { a: 1 })
  })

  it("returns null for empty input", () => {
    assert.equal(parseFixedJson(""), null)
  })

  it("parses Python-style JSON", () => {
    const result = parseFixedJson<{ name: string; active: boolean }>(
      '{name: "test", active: True}',
    )
    assert.equal(result?.name, "test")
    assert.equal(result?.active, true)
  })

  it("handles markdown-wrapped JSON with unquoted keys", () => {
    const result = parseFixedJson<{ reusable: boolean }>(
      '```json\n{reusable: true, reason: "all good"}\n```',
    )
    assert.equal(result?.reusable, true)
  })

  it("recovers from severely malformed JSON by extracting outer object", () => {
    const result = parseFixedJson<{ a: number }>(
      "some text before {a: 1} and after",
    )
    assert.equal(result?.a, 1)
  })
})
