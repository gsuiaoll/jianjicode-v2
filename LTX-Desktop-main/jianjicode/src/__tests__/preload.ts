/**
 * 测试环境隔离 — 对标 opencode-dev test/preload.ts
 *
 * 在所有测试之前：
 *   - 清除 AI provider 环境变量，防止测试依赖外部 API
 *   - 设置隔离的 nudge/curator 目录，防止污染真实用户数据
 *   - 设置测试 nonce，禁用真实 stdout 握手
 */

import { afterAll } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const testDataDir = path.join(os.tmpdir(), "jianjicode-test-" + process.pid)

await fs.mkdir(testDataDir, { recursive: true })
await fs.mkdir(path.join(testDataDir, "nudges"), { recursive: true })
await fs.mkdir(path.join(testDataDir, "curator"), { recursive: true })
await fs.mkdir(path.join(testDataDir, "sessions"), { recursive: true })

// 隔离数据目录
process.env.JIANGJICODE_NUDGE_DIR = path.join(testDataDir, "nudges")
process.env.JIANGJICODE_CURATOR_DIR = path.join(testDataDir, "curator")
process.env.JIANJICODE_SESSION_DIR = path.join(testDataDir, "sessions")

// 防止 stdout 握手输出
process.env.JIANJICODE_NONCE = "test-nonce"

// 清除所有 AI provider 环境变量，确保测试零外部依赖
delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_BASE_URL
delete process.env.ANTHROPIC_MODEL
delete process.env.OPENAI_API_KEY
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
delete process.env.AZURE_OPENAI_API_KEY
delete process.env.AWS_ACCESS_KEY_ID
delete process.env.OPENROUTER_API_KEY
delete process.env.GROQ_API_KEY
delete process.env.MISTRAL_API_KEY
delete process.env.DEEPSEEK_API_KEY
delete process.env.DASHSCOPE_API_KEY
delete process.env.LTX_API_KEY

// 限流窗口设为 1 秒，方便测试快速验证恢复
process.env.AUTH_RATE_LIMIT_WINDOW_MS = "1000"
process.env.AUTH_RATE_LIMIT_MAX_FAILURES = "5"

afterAll(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {})
})
