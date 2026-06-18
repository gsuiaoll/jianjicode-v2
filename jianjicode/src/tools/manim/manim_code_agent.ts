// Claude Code Manim 代码生成 Agent — 子 Agent 形态的 AI 工具
//
// 虽然是 Tool.define() 注册，但本质是一个子 Agent：
//   - 有自己的 system prompt（ManimGL 专家）
//   - 有内部工具集（plan 模式只读文件）
//   - 输入目标 → 自主推理 → 输出完整 Python 代码
//
// CC 分发：独立 claude.exe 二进制文件（~225MB），打包进 Electron extraResources。
// 用户无需安装 Node.js 或单独下载 CC。鉴权支持三种方式：
//   1. OAuth 登录（claude.exe auth login，浏览器授权，免 API Key）
//   2. cc-switch 等工具预配置的 ~/.claude/settings.json
//   3. 手动填写 API Key + Base URL（通过工具参数或环境变量传入）
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { platform } from "node:os"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { execManimRender } from "../../lib/manim_client.js"
import type { ManimResult } from "../../lib/manim_client.js"

// ================================================================
// Claude Code 可执行文件定位
//
// 优先级：
//   1. 参数显式传入的路径
//   2. Electron 打包后的 resourcesPath（process.resourcesPath/claude/claude.exe）
//   3. 项目 resources 目录（dev 模式）
//   4. 上级目录 open/claude/（手动下载的独立 exe）
//   5. node_modules/.bin（npm 包安装的 claude）
//   6. PATH 中的 claude（fallback）
// ================================================================

function findClaudeBinary(explicitPath?: string): string | null {
  if (explicitPath && existsSync(explicitPath)) return explicitPath

  const isWin = platform() === "win32"
  const binName = isWin ? "claude.exe" : "claude"
  const cwd = process.cwd()

  // 候选路径列表，按优先级排列
  const candidates: string[] = []

  // 1. Electron 打包后的 resourcesPath
  //    process.resourcesPath 在 Electron 环境指向 app.asar 同级的 resources/ 目录
  //    e.g. C:\Program Files\LTX Desktop\resources\claude\claude.exe
  const resourcesPath = (process as unknown as Record<string, unknown>).resourcesPath as string | undefined
  if (resourcesPath) {
    candidates.push(join(resourcesPath, "claude", binName))
  }

  // 2. 项目 resources 目录（dev 模式，bun 启动）
  //    cwd = jianjicode/ → ../LTX-Desktop-main/resources/claude/claude.exe
  for (const base of [cwd, resolve(cwd, ".."), resolve(cwd, "..", "..")]) {
    candidates.push(join(base, "resources", "claude", binName))
    candidates.push(join(base, "LTX-Desktop-main", "resources", "claude", binName))
  }

  // 3. 独立下载的 exe（开发者手动放到 open/claude/ 目录）
  for (const base of [cwd, resolve(cwd, ".."), resolve(cwd, "..", "..")]) {
    candidates.push(join(base, "open", "claude", binName))
  }

  // 4. node_modules/.bin（npm 包 @anthropic-ai/claude-code）
  for (const base of [cwd, resolve(cwd, ".."), resolve(cwd, "..", "..")]) {
    candidates.push(join(base, "node_modules", ".bin", isWin ? "claude.cmd" : "claude"))
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  // 5. PATH fallback — 返回 null，spawn 时直接用 "claude"，由 OS 从 PATH 解析
  return null
}

// ================================================================
// CC 鉴权 — 从 ~/.claude/settings.json 提取 env 块
// ================================================================

function loadCcSettingsEnv(): Record<string, string> {
  const settingsPath = join(homedir(), ".claude", "settings.json")
  try {
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
      if (settings.env && typeof settings.env === "object") {
        const env: Record<string, string> = {}
        for (const [k, v] of Object.entries(settings.env)) {
          if (typeof v === "string") env[k] = v
        }
        return env
      }
    }
  } catch { /* settings.json 不存在或解析失败 — 忽略 */ }
  return {}
}

// ================================================================
// System Prompt
// ================================================================

function buildSystemPrompt(description: string, styleHints?: string[]): string {
  const hintsText = styleHints?.length
    ? `\n风格偏好: ${styleHints.join(", ")}`
    : ""

  return `你是一个专业的 ManimGL Python 动画工程师。根据用户的需求描述，生成完整可运行的 ManimGL Python 脚本。

## 关键经验（踩过的坑，请注意）
- 使用 ManimGL (v1.7.2)，import 用 manimlib，不是 manim
- 继承 Scene，不是 ThreeDScene
- 文件头必须有 #!/usr/bin/env python3，所有 import 写在文件头
- 不要使用 emoji（Windows GBK 编码会崩溃）
- LaTeX 用 Tex()（不支持中文），中文用 Text()
- 用 config.pixel_height/pixel_width 设置分辨率
- 横屏 1920x1080 + camera.set_width(9)，竖屏 1080x1920 + camera.set_width(7)

## 中英文混排
- LaTeX (Tex()) 不支持中文，CJK 字符会导致 LaTeX 编译失败
- 中文用 Text()，数学公式用 Tex()，用 VGroup() 组合
- fix_in_frame() 的混排文字每个组件单独调用
- fix_in_frame() 相机缩放时产生视觉撕裂，缩放前提前 FadeOut 固定文字

## 数学公式排版
- 长公式必须拆分为清晰的多行（独立 Tex 对象 + VGroup），不依赖 Manim 自动换行
- 标题和公式至少 28-32px，关键定理公式至少 36-38px
- 分行的两个 Tex 之间用 buff=0.35 行间距
- LaTeX 命令：\\mathrm / \\operatorname / \\text 后紧跟数学语法时，优先用 \\mathrm{Word}

## 开场钩子
- 视频前 3 秒展示最终效果预览帧（teaser），让观众立刻知道要看什么，避免开场无画面

## 镜头感
- 缓动: rush_into, rush_from, running_start, overshoot
- 3D 视角: self.camera.frame.reorient(theta_degrees=-15, phi_degrees=65)
- fix_in_frame() 相机大幅缩放前先 FadeOut，避免纹理退化

## 镜头感与相机
- 圆形场景完整可见公式: cam_width >= radius * 3.0~3.6 留边距
- GlowDot 点大小随相机动态调整: dot_radius = cam_width * (24 + cam_width * 0.02) / 1920
- glow_factor = 8 + cam_width * 0.04，固定值会导致拉远后点消失或凑近时点过大

## 常用 API
- 动画: ShowCreation()（不是 Create），FadeIn/Out(), Transform(), Write(), GrowFromCenter()
- 对象: Tex(), Text(), Circle(), Square(), VGroup(), Axes(), Dot(), Line()
- 着色: set_color(), set_fill(), set_stroke(), set_color_by_gradient()
- 特效: Broadcast(mob, distance=5, vector=UP), FlashyFadeIn(mob), ApplyWave(mob, direction, amplitude)
- 拖尾: TracedPath(mob.get_center), TracingTail(mob, time_traced=0.8)
- 色彩: get_colormap_list(n, "viridis"), set_color_by_gradient(*colors), interpolate_color_by_hsl()
- 渲染: tex.anti_alias_width = 2.0 文字更锐利, fix_in_frame() 固定屏幕空间元素

## 能力边界（不存在，勿尝试）
- 无 motion blur、无音频 API、无粒子物理
- glow_factor 是 static uniform，不支持 per-frame 动画
- TracedPath 只跟踪单个点，不能跟踪整个点云

## 字幕
不要在 ManimGL 中用 Text() 渲染字幕，后期用 FFmpeg ASS 合成。

## 代码模板
\`\`\`python
#!/usr/bin/env python3
from manimlib import *

class DemoScene(Scene):
    def construct(self):
        config.pixel_width = 1920
        config.pixel_height = 1080
        self.camera.frame.set_width(9)
        # ...

if __name__ == "__main__":
    from manimlib import main
    main()
\`\`\`

同目录下有 MANIM_GUIDE.md，包含完整 API 文档和常见错误速查，必要时可参考。

## 输出格式
输出一个 JSON 对象：
{"code": "完整Python代码", "explanation": "动画设计说明", "warnings": ["注意事项"]}

## 用户需求
${description}${hintsText}`
}

// ================================================================
// CC 输出解析
// ================================================================

interface CcOutput {
  code: string
  explanation: string
  warnings: string[]
}

function parseCcOutput(stdout: string): CcOutput | null {
  // CC --output-format json 返回的是 Claude Code 的外层 JSON
  // 先尝试解析外层，提取 result 字段
  try {
    const ccJson = JSON.parse(stdout.trim())
    // CC JSON 格式: { result: "...", ... }
    const inner = ccJson.result || ccJson.output || ccJson.message || stdout
    return extractCodeJson(typeof inner === "string" ? inner : JSON.stringify(inner))
  } catch {
    // 不是 JSON 包装，直接解析文本
    return extractCodeJson(stdout)
  }
}

function extractCodeJson(text: string): CcOutput | null {
  // 尝试找 JSON 对象
  const jsonMatch = text.match(/\{[\s\S]*"code"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.code && typeof parsed.code === "string") {
        return {
          code: parsed.code,
          explanation: parsed.explanation || "",
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        }
      }
    } catch {
      // JSON 解析失败，尝试从代码块提取
    }
  }

  // 从 markdown 代码块提取 Python 代码
  const codeMatch = text.match(/```python\s*([\s\S]*?)```/)
  if (codeMatch) {
    return {
      code: codeMatch[1].trim(),
      explanation: "",
      warnings: [],
    }
  }

  return null
}

// ================================================================
// Manim 渲染封装（绕过 custom 权限检查）
// ================================================================

async function renderCustomScript(
  script: string,
  quality: "480p" | "720p" | "1080p",
): Promise<ManimResult> {
  const outputDir = join(process.cwd(), "outputs", "manim")
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const outputFile = join(outputDir, `cc_custom_${randomUUID().slice(0, 8)}.mp4`)

  return execManimRender({
    template: "custom",
    params: { script },
    outputFile,
    quality,
  })
}

// ================================================================
// Tool 定义
// ================================================================

export const ManimCodeAgentTool = Tool.define("manim_code_agent", {
  description:
    "Claude Code AI 代码生成 Agent。当 12 个内置 Manim 模板无法满足复杂需求时，" +
    "由 Claude Code 自主编写自定义 ManimGL Python 动画脚本。" +
    "适用于：复刻参考视频效果、复杂数学可视化、自定义动画序列、特殊视觉效果。" +
    "生成后自动渲染（默认 480p 预览），也可仅生成代码不渲染。" +
    "鉴权：优先使用 OAuth（claude login）、cc-switch 配置或手动填写 API Key。",
  parameters: z.object({
    description: z
      .string()
      .min(10)
      .max(5000)
      .describe(
        "详细描述需要生成的 Manim 动画效果。包含：数学概念、视觉风格、动画节奏、颜色偏好、画面结构等",
      ),
    reference_video: z
      .string()
      .optional()
      .describe(
        "参考视频路径。如果提供，jianjicode 的多模态模型会先解析视频内容，将描述附加到 prompt 中",
      ),
    style_hints: z
      .array(z.string())
      .max(10)
      .optional()
      .describe(
        "3Blue1Brown 风格提示（可选）：dark_background, morphing_transitions, formula_highlight, camera_pans",
      ),
    auto_render: z
      .boolean()
      .default(true)
      .describe("代码生成后是否自动渲染。false=只生成代码不渲染"),
    quality: z
      .enum(["480p", "720p", "1080p"])
      .default("480p")
      .describe("渲染质量。auto_render=false 时忽略"),
    cc_path: z
      .string()
      .optional()
      .describe(
        "Claude Code 可执行文件路径。默认自动查找：打包版从 resources/claude/ 查找，" +
        "开发版从 open/claude/ 或 node_modules/.bin/ 查找，最后 fallback 到 PATH",
      ),
    api_key: z
      .string()
      .optional()
      .describe(
        "API Key。可选 — 如果已通过 claude login 登录（OAuth）或 cc-switch 配置，" +
        "则无需填写。如果填写，将以环境变量 ANTHROPIC_API_KEY 传入",
      ),
    base_url: z
      .string()
      .optional()
      .describe(
        "API Base URL。可选 — 用于非 Anthropic 提供商（如 DeepSeek、千问等）。" +
        "如果填写，将以环境变量 ANTHROPIC_BASE_URL 传入。" +
        "示例: https://api.deepseek.com/anthropic",
      ),
  }),
  execute: async (args, ctx) => {
    // 1. 解析鉴权 — 优先级：工具参数 > 环境变量 > ~/.claude/settings.json
    const ccSettingsEnv = loadCcSettingsEnv()
    const apiKey = args.api_key
      || process.env.ANTHROPIC_API_KEY
      || ccSettingsEnv.ANTHROPIC_AUTH_TOKEN
      || undefined
    const baseUrl = args.base_url
      || process.env.ANTHROPIC_BASE_URL
      || ccSettingsEnv.ANTHROPIC_BASE_URL
      || undefined

    // 2. 构建 prompt
    const prompt = buildSystemPrompt(args.description, args.style_hints)

    // 3. 定位 CC 可执行文件
    const ccBin = findClaudeBinary(args.cc_path)
    const ccCommand = ccBin || "claude"

    console.log(`[manim_code_agent] cc_bin=${ccBin || "PATH:claude"} desc_len=${args.description.length} has_key=${!!apiKey} has_base_url=${!!baseUrl}`)

    // 4. spawn CC — 同时注入 settings.json 里的 env 块和显式参数
    const spawnCc = (promptText: string): Promise<CcOutput | null> => {
      return new Promise((resolve) => {
        const env: Record<string, string> = {
          ...process.env as Record<string, string>,
          ...ccSettingsEnv, // cc-switch 等工具预配置的 env（ANTHROPIC_AUTH_TOKEN/ANTHROPIC_BASE_URL...）
        }

        // 显式参数优先级最高，覆盖 settings.json
        if (apiKey) env.ANTHROPIC_API_KEY = apiKey
        if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl

        const child = spawn(ccCommand, [
          "-p",
          "--output-format", "json",
          promptText,
        ], {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        })

        let stdout = ""
        let stderr = ""

        child.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
        child.stderr.on("data", (d: Buffer) => { stderr += d.toString() })

        child.on("error", (err) => {
          console.error(`[manim_code_agent] spawn error: ${err.message}`)
          resolve(null)
        })

        child.on("close", (code, signal) => {
          if (code !== 0) {
            const reason = code === null ? `killed by ${signal}` : `exit code ${code}`
            console.error(`[manim_code_agent] CC ${reason}: ${stderr.slice(0, 2000)}`)
            // Even if CC exited non-zero, try parsing — it may have produced usable output
            const parsed = parseCcOutput(stdout)
            if (parsed) {
              console.log(`[manim_code_agent] extracted code despite non-zero exit`)
              resolve(parsed)
            } else {
              resolve(null)
            }
            return
          }
          const parsed = parseCcOutput(stdout)
          if (!parsed) {
            console.error(`[manim_code_agent] parse failed. stdout preview: ${stdout.slice(0, 500)}`)
          }
          resolve(parsed)
        })
      })
    }

    // 4. 第一次生成
    let ccResult = await spawnCc(prompt)

    // 5. 如果生成失败，给出含调试信息的提示
    if (!ccResult && !apiKey) {
      console.log("[manim_code_agent] CC failed — check that claude.exe can authenticate (OAuth login or settings.json)")
    }

    // 6. 保存代码到 custom 目录
    const customDir = join(process.cwd(), "python", "manim_templates", "custom")
    if (!existsSync(customDir)) mkdirSync(customDir, { recursive: true })
    const scriptId = randomUUID().slice(0, 8)
    const scriptPath = join(customDir, `${scriptId}.py`)

    if (ccResult) {
      // 修复 CC JSON 中转义的换行符（JSON.parse 对嵌套 JSON 可能残留字面量 \n）
      ccResult.code = ccResult.code.replace(/\\n/g, "\n").replace(/\\t/g, "    ")
      writeFileSync(scriptPath, ccResult.code, "utf-8")
      console.log(`[manim_code_agent] code saved: ${scriptPath} (${ccResult.code.length} chars)`)
    }

    // 7. 如果只生成代码不渲染
    if (!args.auto_render || !ccResult) {
      if (!ccResult) {
        return {
          title: "Claude Code 代码生成失败",
          metadata: { operation: "manim_code_agent", success: false, error: true },
          output:
            "Claude Code 未能生成有效的代码。可能的原因：\n" +
            "- CC 鉴权失败：请运行 claude.exe auth login 或在设置中配置 API Key\n" +
            "- 网络问题：请检查是否能访问 API 端点\n" +
            "- 描述不够清晰：请提供更详细的动画描述\n\n" +
            "提示：也可以尝试简化需求后重试。",
        }
      }
      return {
        title: `Manim 代码已生成 — ${scriptId}`,
        metadata: {
          operation: "manim_code_agent",
          success: true,
          codePath: scriptPath,
          codeLength: ccResult.code.length,
        },
        output:
          `代码已生成并保存到: ${scriptPath}\n\n` +
          `## 设计说明\n${ccResult.explanation}\n\n` +
          (ccResult.warnings.length > 0
            ? `## 注意事项\n${ccResult.warnings.map((w) => `- ${w}`).join("\n")}\n`
            : "") +
          `设置 auto_render=true 可自动渲染此代码。`,
      }
    }

    // 8. 渲染（含错误重试）
    const maxRetries = 2
    let lastResult: ManimResult | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const quality = args.quality as "480p" | "720p" | "1080p"
      const result = await renderCustomScript(ccResult.code, quality)
      lastResult = result

      if (result.success) {
        return {
          title: `Manim 动画完成 — ${scriptId}`,
          metadata: {
            operation: "manim_code_agent",
            success: true,
            codePath: scriptPath,
            outputPath: result.outputPath,
            explanation: ccResult.explanation,
            attempts: attempt + 1,
          },
          output:
            `Claude Code 生成的 Manim 动画渲染完成\n\n` +
            `代码: ${scriptPath}\n` +
            `输出: ${result.outputPath}\n` +
            `尝试次数: ${attempt + 1}\n\n` +
            `## 设计说明\n${ccResult.explanation}\n\n` +
            (ccResult.warnings.length > 0
              ? `## 注意事项\n${ccResult.warnings.map((w) => `- ${w}`).join("\n")}\n`
              : ""),
        }
      }

      // 错误重试
      if (attempt < maxRetries && result.error) {
        const errorMsg = result.error.message
        console.log(`[manim_code_agent] render error (attempt ${attempt + 1}): ${errorMsg}`)

        const fixPrompt =
          `之前的代码渲染时出现错误：${errorMsg}\n` +
          `错误类型：${result.error.type}\n` +
          `请修复代码中的问题，重新输出完整 JSON：{"code": "...", "explanation": "...", "warnings": [...]}`

        const fixed = await spawnCc(fixPrompt)
        if (fixed) {
          ccResult = fixed
          ccResult.code = ccResult.code.replace(/\\n/g, "\n").replace(/\\t/g, "    ")
          writeFileSync(scriptPath, fixed.code, "utf-8")
        }
      }
    }

    // 所有重试都失败
    const error = lastResult?.error!
    return {
      title: "Manim 代码渲染失败（已重试）",
      metadata: {
        operation: "manim_code_agent",
        success: false,
        error: true,
        codePath: scriptPath,
        errorType: error?.type,
        errorMessage: error?.message,
      },
      output:
        `代码已生成但渲染失败（已自动重试 ${maxRetries} 次）\n\n` +
        `代码: ${scriptPath}\n` +
        `错误类型: ${error?.type}\n` +
        `错误信息: ${error?.message}\n` +
        `建议: ${error?.suggestion}\n\n` +
        `可以手动修改代码后重新渲染。`,
    }
  },
})
