/**
 * Context References 测试 — @file/@folder/@url/@git 引用语法
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { after, before, describe, it } from "node:test"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cr: any
const testDir = path.join(os.tmpdir(), "jianjicode-cr-test-" + Date.now())

before(async () => {
  cr = await import("../context-references.js")
  fs.mkdirSync(testDir, { recursive: true })
})

after(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// ============================================================================
// parseReference
// ============================================================================

describe("parseReference — 引用解析", () => {
  it("parses @file:path", () => {
    const r = cr.parseReference("@file:src/index.ts")
    assert.notEqual(r, null)
    assert.equal(r.kind, "file")
    assert.equal(r.target, "src/index.ts")
    assert.equal(r.startLine, undefined)
    assert.equal(r.endLine, undefined)
  })

  it("parses @file:path:10-20 with line range", () => {
    const r = cr.parseReference("@file:src/index.ts:10-20")
    assert.notEqual(r, null)
    assert.equal(r.kind, "file")
    assert.equal(r.target, "src/index.ts")
    assert.equal(r.startLine, 10)
    assert.equal(r.endLine, 20)
  })

  it("parses @folder:path", () => {
    const r = cr.parseReference("@folder:src/")
    assert.notEqual(r, null)
    assert.equal(r.kind, "folder")
    assert.equal(r.target, "src/")
  })

  it("parses @url:url", () => {
    const r = cr.parseReference("@url:https://example.com/doc")
    assert.notEqual(r, null)
    assert.equal(r.kind, "url")
    assert.equal(r.target, "https://example.com/doc")
  })

  it("rejects non-http url", () => {
    const r = cr.parseReference("@url:ftp://example.com")
    assert.equal(r, null)
  })

  it("parses @git:N", () => {
    const r = cr.parseReference("@git:3")
    assert.notEqual(r, null)
    assert.equal(r.kind, "git")
    assert.equal(r.target, "3")
  })

  it("returns null for invalid syntax", () => {
    assert.equal(cr.parseReference("not a reference"), null)
    assert.equal(cr.parseReference("@unknown:path"), null)
    assert.equal(cr.parseReference("@file:"), null)
  })
})

// ============================================================================
// extractReferences
// ============================================================================

describe("extractReferences — 从文本中提取引用", () => {
  it("extracts single reference", () => {
    const refs = cr.extractReferences("Check @file:src/index.ts for details")
    assert.equal(refs.length, 1)
    assert.equal(refs[0].raw, "@file:src/index.ts")
  })

  it("extracts multiple references", () => {
    const refs = cr.extractReferences(
      "See @file:a.ts and @file:b.ts and @folder:lib/",
    )
    assert.equal(refs.length, 3)
  })

  it("extracts no references from plain text", () => {
    const refs = cr.extractReferences("This is a plain text without references")
    assert.equal(refs.length, 0)
  })

  it("extracts from text with mixed content", () => {
    const refs = cr.extractReferences(
      "Look at @url:https://example.com and @git:5",
    )
    assert.equal(refs.length, 2)
    assert.equal(refs[0].kind, "url")
    assert.equal(refs[1].kind, "git")
  })

  it("extracts reference with line range", () => {
    const refs = cr.extractReferences("Fix in @file:src/main.ts:30-45")
    assert.equal(refs.length, 1)
    assert.equal(refs[0].startLine, 30)
    assert.equal(refs[0].endLine, 45)
  })
})

// ============================================================================
// isSensitivePath
// ============================================================================

describe("isSensitivePath — 敏感路径检测", () => {
  it("detects .ssh in path", () => {
    assert.equal(cr.isSensitivePath("/home/user/.ssh/id_rsa"), true)
  })

  it("detects .aws in path", () => {
    assert.equal(cr.isSensitivePath("/home/user/.aws/credentials"), true)
  })

  it("detects .env file", () => {
    assert.equal(cr.isSensitivePath("/home/user/project/.env"), true)
  })

  it("detects node_modules", () => {
    assert.equal(
      cr.isSensitivePath("/home/user/project/node_modules/foo"),
      true,
    )
  })

  it("allows normal project path", () => {
    assert.equal(cr.isSensitivePath("/home/user/project/src/index.ts"), false)
  })

  it("allows dotfiles that are not sensitive", () => {
    assert.equal(cr.isSensitivePath("/home/user/project/.editorconfig"), false)
  })

  it("case-insensitive on Windows paths (forward slash)", () => {
    assert.equal(cr.isSensitivePath("C:/Users/user/.SSH/key"), true)
  })

  it("detects .git in path", () => {
    assert.equal(cr.isSensitivePath("/repo/.git/config"), true)
  })
})

// ============================================================================
// resolveFileRef — 文件引用解析
// ============================================================================

describe("resolveFileRef — 文件引用解析", () => {
  it("resolves existing file content", async () => {
    const filePath = path.join(testDir, "test.txt")
    fs.writeFileSync(filePath, "hello world", "utf-8")
    const ref = cr.parseReference(`@file:${filePath}`)
    const result = await cr.resolveAllReferences(`Read ${ref.raw}`, 8000)
    assert.equal(result.references.length, 1)
    assert.ok(result.references[0].content.includes("hello world"))
  })

  it("returns error for non-existent file", async () => {
    const ref = cr.parseReference(`@file:${testDir}/nonexistent.txt`)
    const result = await cr.resolveAllReferences(`Read ${ref.raw}`, 8000)
    assert.ok(result.references[0].error)
    assert.ok(result.references[0].error.includes("not found"))
  })

  it("returns error for sensitive path", async () => {
    const ref = cr.parseReference("@file:/home/user/.ssh/id_rsa")
    const result = await cr.resolveAllReferences(`Read ${ref.raw}`, 8000)
    assert.ok(result.references[0].error)
    assert.ok(result.references[0].error.includes("sensitive"))
  })

  it("respects line range", async () => {
    const filePath = path.join(testDir, "lines.txt")
    fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5", "utf-8")
    const ref = cr.parseReference(`@file:${filePath}:2-4`)
    const result = await cr.resolveAllReferences(`Read ${ref.raw}`, 8000)
    assert.ok(result.references[0].content.includes("line2"))
    assert.ok(result.references[0].content.includes("line3"))
    assert.ok(result.references[0].content.includes("line4"))
    assert.ok(!result.references[0].content.includes("line1"))
    assert.ok(!result.references[0].content.includes("line5"))
  })
})

// ============================================================================
// resolveFolderRef — 目录引用解析
// ============================================================================

describe("resolveFolderRef — 目录引用解析", () => {
  it("resolves folder listing", async () => {
    fs.writeFileSync(path.join(testDir, "a.txt"), "a")
    fs.writeFileSync(path.join(testDir, "b.txt"), "b")
    const ref = cr.parseReference(`@folder:${testDir}`)
    const result = await cr.resolveAllReferences(`List ${ref.raw}`, 8000)
    assert.ok(result.references.length === 1)
    assert.ok(result.references[0].content.includes("a.txt"))
    assert.ok(result.references[0].content.includes("b.txt"))
  })

  it("returns error for non-existent folder", async () => {
    const ref = cr.parseReference(`@folder:${testDir}/nonexistent/`)
    const result = await cr.resolveAllReferences(`List ${ref.raw}`, 8000)
    assert.ok(result.references[0].error)
  })
})

// ============================================================================
// resolveAllReferences — 批量解析
// ============================================================================

describe("resolveAllReferences — 批量引用解析", () => {
  it("returns empty result for text without references", async () => {
    const result = await cr.resolveAllReferences("plain text", 8000)
    assert.equal(result.references.length, 0)
    assert.equal(result.injectedTokens, 0)
    assert.equal(result.blocked, false)
  })

  it("returns message with resolved count", async () => {
    const filePath = path.join(testDir, "batch.txt")
    fs.writeFileSync(filePath, "content", "utf-8")
    const result = await cr.resolveAllReferences(`Read @file:${filePath}`, 8000)
    assert.ok(result.message.length > 0)
    assert.ok(result.injectedTokens > 0)
  })

  it("handles empty text", async () => {
    const result = await cr.resolveAllReferences("", 8000)
    assert.equal(result.references.length, 0)
  })
})

// ============================================================================
// resolveContextReferences — 消息级替换
// ============================================================================

describe("resolveContextReferences — 消息级引用替换", () => {
  it("replaces reference with content and returns notification", async () => {
    const filePath = path.join(testDir, "msg-test.txt")
    fs.writeFileSync(filePath, "file content here", "utf-8")
    const result = await cr.resolveContextReferences(
      `分析文件 @file:${filePath}`,
      8000,
    )
    assert.ok(result.resolvedMessage.includes("file content here"))
    assert.ok(!result.resolvedMessage.includes("@file:"))
    assert.ok(result.notification.length > 0)
  })

  it("returns original message when no references", async () => {
    const result = await cr.resolveContextReferences("plain message", 8000)
    assert.equal(result.resolvedMessage, "plain message")
    assert.equal(result.notification, "")
  })

  it("replaces error references with error message", async () => {
    const result = await cr.resolveContextReferences(
      "Read @file:/nonexistent/path/file.txt",
      8000,
    )
    assert.ok(!result.resolvedMessage.includes("@file:"))
  })
})
