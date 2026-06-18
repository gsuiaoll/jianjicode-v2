/**
 * Path Security 测试 — 目录遍历防护
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import * as path from "node:path"
import { before, describe, it } from "node:test"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ps: any

before(async () => {
  ps = await import("../path-security.js")
})

describe("hasTraversalComponent — 路径遍历检测", () => {
  it("detects simple parent dir traversal", () => {
    assert.equal(ps.hasTraversalComponent("../etc/passwd"), true)
  })

  it("detects nested traversal", () => {
    assert.equal(ps.hasTraversalComponent("foo/../../etc/passwd"), true)
  })

  it("detects Windows-style traversal", () => {
    assert.equal(ps.hasTraversalComponent("..\\..\\etc\\passwd"), true)
  })

  it("allows safe paths with dots", () => {
    assert.equal(ps.hasTraversalComponent("./file.txt"), false)
  })

  it("allows normal paths without dots", () => {
    assert.equal(ps.hasTraversalComponent("src/file.txt"), false)
  })

  it("empty string returns false", () => {
    assert.equal(ps.hasTraversalComponent(""), false)
  })

  it("detects multiple consecutive traversals", () => {
    assert.equal(ps.hasTraversalComponent("../../../etc"), true)
  })
})

describe("validateWithinDir — 路径包含验证", () => {
  it("accepts path within base directory", () => {
    const base = "/home/user/project"
    const target = "/home/user/project/src/file.ts"
    assert.equal(ps.validateWithinDir(target, base), true)
  })

  it("rejects path outside base directory", () => {
    const base = "/home/user/project"
    const target = "/home/user/other/file.ts"
    assert.equal(ps.validateWithinDir(target, base), false)
  })

  it("accepts base directory itself", () => {
    const base = "/home/user/project"
    assert.equal(ps.validateWithinDir(base, base), true)
  })

  it("rejects traversal outside base", () => {
    const base = "/home/user/project"
    const target = "/home/user/project/../outside/file.ts"
    assert.equal(ps.validateWithinDir(target, base), false)
  })

  it("handles empty base gracefully", () => {
    assert.equal(ps.validateWithinDir("/some/path", ""), false)
  })
})

describe("safeJoin — 安全路径拼接", () => {
  const baseDir = path.resolve("/home/user/project")

  it("joins safe relative path", () => {
    const result = ps.safeJoin(baseDir, "src", "file.ts")
    assert.notEqual(result, null)
    if (result) {
      assert.ok(
        result.endsWith("src/file.ts") || result.endsWith("src\\file.ts"),
      )
    }
  })

  it("rejects traversal in part", () => {
    const result = ps.safeJoin(baseDir, "..", "file.ts")
    assert.equal(result, null)
  })

  it("rejects nested traversal", () => {
    const result = ps.safeJoin(baseDir, "src", "..", "..", "outside")
    assert.equal(result, null)
  })

  it("rejects absolute part bypass", () => {
    // path.join behavior differs by platform: use runtime's path.resolve
    // for a platform-appropriate absolute path outside the base dir
    const absPath = path.resolve("/etc/passwd")
    const result = ps.safeJoin(baseDir, absPath)
    // Must either reject (null) or the result must be within baseDir
    if (result !== null) {
      assert.ok(
        ps.validateWithinDir(result, baseDir),
        `result "${result}" must be within base "${baseDir}"`,
      )
    }
  })

  it("empty parts returns base itself", () => {
    const result = ps.safeJoin(baseDir)
    assert.notEqual(result, null)
    if (result) {
      assert.equal(path.resolve(result), path.resolve(baseDir))
    }
  })
})
