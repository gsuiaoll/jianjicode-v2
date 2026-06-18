// ManimGL 全局统一配置 — 所有常量环境变量化，改配置不动业务代码
import { existsSync } from "node:fs"
import { join } from "node:path"
import { platform } from "node:os"

// server/ → jianjicode/ → python/manim_templates
const TEMPLATE_DIR =
  process.env.MANIM_TEMPLATE_DIR ||
  join(import.meta.dirname, "..", "python", "manim_templates")

const IS_WIN = platform() === "win32"

// Python 路径查找优先级：
//   1. MANIM_PYTHON / MANIM_BIN 环境变量（Electron bridge 传入，指向打包的 python-embed）
//   2. 自动发现 — 查找 python-embed/（开发或打包场景）
//   3. 系统 PATH 中的 python / manimgl（fallback）
function discoverPythonBin(): string {
  if (process.env.MANIM_PYTHON) return process.env.MANIM_PYTHON

  // 在项目树中查找 python-embed/
  const candidates = [
    join(import.meta.dirname, "..", "..", "python-embed"),
    join(import.meta.dirname, "..", "..", "LTX-Desktop-main", "python-embed"),
    join(import.meta.dirname, "..", "python-embed"),
  ]
  for (const dir of candidates) {
    const exe = join(dir, IS_WIN ? "python.exe" : "bin/python3")
    if (existsSync(exe)) return exe
  }

  // fallback — 系统 PATH
  return IS_WIN ? "python" : "python3"
}

function discoverManimBin(pythonBin: string): string {
  if (process.env.MANIM_BIN) return process.env.MANIM_BIN

  // python-embed 中 manimgl 在 Scripts/ 或 bin/ 目录
  const pythonBinPath = pythonBin.replace(/[/\\]/g, "/")
  if (pythonBinPath.includes("python-embed")) {
    const embedDir = pythonBinPath.slice(0, pythonBinPath.lastIndexOf("/"))
    // Windows: python-embed/Scripts/manimgl.exe
    // macOS/Linux: python-embed/bin/manimgl
    const scriptExe = join(embedDir, IS_WIN ? "Scripts" : "bin",
      IS_WIN ? "manimgl.exe" : "manimgl")
    if (existsSync(scriptExe)) return scriptExe
  }

  // fallback — 系统 PATH 或同目录
  const binName = IS_WIN ? "manimgl.exe" : "manimgl"
  return join(pythonBin, "..", IS_WIN ? "Scripts" : "bin", binName)
}

const _pythonBin = discoverPythonBin()
const _manimBin = discoverManimBin(_pythonBin)

export const MANIM_CONFIG = {
  // 可执行文件路径（自动发现，不要硬编码）
  manimBin: _manimBin,
  pythonBin: _pythonBin,

  // 模板引擎
  engineScript: join(TEMPLATE_DIR, "engine.py"),
  templateDir: TEMPLATE_DIR,
  manimConfigFile:
    process.env.MANIM_CONFIG_FILE ||
    join(TEMPLATE_DIR, "custom_config.yml"),

  // 默认画质
  defaultQuality: (
    process.env.MANIM_DEFAULT_QUALITY || "720p"
  ) as "480p" | "720p" | "1080p",

  // 安全与超时
  renderTimeout: parseInt(process.env.MANIM_RENDER_TIMEOUT || "300", 10),
  allowCustom: process.env.ALLOW_CUSTOM_MANIM === "true",

  // 并发限制
  maxConcurrency: parseInt(process.env.MANIM_MAX_CONCURRENCY || "2", 10),
} as const
