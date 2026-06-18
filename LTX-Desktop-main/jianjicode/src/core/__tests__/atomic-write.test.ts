/**
 * Atomic Write 测试 — 防崩溃原子文件写入
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { after, before, describe, it } from "node:test"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let aw: any
const testDir = path.join(os.tmpdir(), "jianjicode-atomic-test-" + Date.now())

before(async () => {
  aw = await import("../atomic-write.js")
  fs.mkdirSync(testDir, { recursive: true })
})

after(() => {
  // 清理测试目录
  try {
    fs.rmSync(testDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe("atomicWriteText — 原子文本写入", () => {
  it("writes file successfully", () => {
    const filePath = path.join(testDir, "hello.txt")
    aw.atomicWriteText(filePath, "hello world")
    const content = fs.readFileSync(filePath, "utf-8")
    assert.equal(content, "hello world")
  })

  it("overwrites existing file", () => {
    const filePath = path.join(testDir, "overwrite.txt")
    aw.atomicWriteText(filePath, "first")
    aw.atomicWriteText(filePath, "second")
    const content = fs.readFileSync(filePath, "utf-8")
    assert.equal(content, "second")
  })

  it("creates intermediate directories", () => {
    const filePath = path.join(testDir, "nested", "dir", "deep.txt")
    aw.atomicWriteText(filePath, "nested content")
    assert.ok(fs.existsSync(filePath))
    assert.equal(fs.readFileSync(filePath, "utf-8"), "nested content")
  })

  it("writes with custom encoding", () => {
    const filePath = path.join(testDir, "encoded.txt")
    aw.atomicWriteText(filePath, "hello", "utf-8")
    assert.equal(fs.readFileSync(filePath, "utf-8"), "hello")
  })
})

describe("atomicWriteJson — 原子 JSON 写入", () => {
  it("writes JSON with pretty formatting", () => {
    const filePath = path.join(testDir, "data.json")
    aw.atomicWriteJson(filePath, { name: "test", count: 42 })
    const content = fs.readFileSync(filePath, "utf-8")
    assert.ok(content.includes('"name"'))
    assert.ok(content.includes('"count"'))
    assert.ok(content.includes("\n")) // pretty = true
    const parsed = JSON.parse(content)
    assert.equal(parsed.name, "test")
    assert.equal(parsed.count, 42)
  })

  it("writes JSON without pretty (compact)", () => {
    const filePath = path.join(testDir, "compact.json")
    aw.atomicWriteJson(filePath, { a: 1 }, false)
    const content = fs.readFileSync(filePath, "utf-8")
    assert.equal(content, '{"a":1}')
  })

  it("writes array as JSON", () => {
    const filePath = path.join(testDir, "array.json")
    aw.atomicWriteJson(filePath, [1, 2, 3])
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    assert.deepEqual(parsed, [1, 2, 3])
  })
})

describe("atomicWriteText — 内容验证", () => {
  it("writes large content correctly", () => {
    const filePath = path.join(testDir, "large.txt")
    const largeContent = "x".repeat(100000)
    aw.atomicWriteText(filePath, largeContent)
    const content = fs.readFileSync(filePath, "utf-8")
    assert.equal(content.length, 100000)
    assert.equal(content[0], "x")
    assert.equal(content[99999], "x")
  })

  it("writes empty content", () => {
    const filePath = path.join(testDir, "empty.txt")
    aw.atomicWriteText(filePath, "")
    const content = fs.readFileSync(filePath, "utf-8")
    assert.equal(content, "")
  })

  it("writes Chinese text correctly", () => {
    const filePath = path.join(testDir, "chinese.txt")
    aw.atomicWriteText(filePath, "你好，世界！")
    assert.equal(fs.readFileSync(filePath, "utf-8"), "你好，世界！")
  })
})
