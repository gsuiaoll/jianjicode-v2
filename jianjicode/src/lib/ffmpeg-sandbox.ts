/**
 * FFmpeg 安全沙箱 — 统一路径校验 + 新工具开发规范。
 *
 * ============================================================================
 * 新工具开发规范（写新 video/*.ts 时必须遵守）
 * ============================================================================
 *
 * ## 1. 路径安全沙箱
 *      const sandbox = validatePath(args.input, outputPath)
 *      if (!sandbox.ok) {
 *        return { title: "安全拦截", metadata: { error: true }, output: sandbox.error }
 *      }
 *      const safeOutput = sandbox.outputPath  // 使用沙箱返回的路径
 *
 * ## 2. ctx.abort 取消信号
 *      // execute 的参数要接收 ctx:
 *      execute: async (args, ctx) => { ... }
 *      // 所有 FFmpeg 调用必须传入 ctx.abort:
 *      await runFfmpeg([...], ctx.abort)
 *      await trimVideo(input, output, ss, to, ctx.abort)
 *      // 长时间操作前检查:
 *      if (ctx.abort.aborted) return { title: "已取消", ... }
 *
 * ## 3. 工具返回三类（工具分为三类，返回内容不同）
 *
 *      一个工具返回三样东西：
 *      - output          (必须) 给用户在聊天窗口看的文字描述
 *      - metadata        (必须) 给程序消费的结构化数据：operation/success/error/outputPath
 *      - editOperations  (按需) 时间轴可视化协议，不是通用返回值
 *
 *      工具按「是否产生可独立操作的新素材条」分为三类：
 *
 *      A 类 — 产生新素材/新轨道  →  output + metadata + editOperations
 *        加 BGM、画中画、智能裁剪、素材搜索、字幕轨道、视频生成(Seedance)……
 *        共同点：时间轴上多了一条用户可见、可拖拽、可删除的素材条。
 *        必须生成 editOperations 描述这条新素材。
 *        撤销：editOperations 里每条 op 自带 undoable 字段，前端按 op 反向还原。
 *
 *      B 类 — 原地修改  →  output + metadata（不需要 editOperations）
 *        裁剪(trim)、变速(speed)、旋转(rotate)、调色(lut_filter)、
 *        格式转换(convert)、音频提取(extract-audio)……
 *        共同点：素材内容变了，但时间轴上没有新增任何东西。
 *        前端通过 metadata 里的 outputPath 自动更新显示即可。
 *        撤销：metadata.undoable=true + metadata.undo 描述如何还原（替换文件路径等）。
 *
 *      C 类 — 纯查询  →  output + metadata（不需要 editOperations / undo）
 *        获取视频信息、硬件加速检测、探测元数据……
 *        不产生文件，不修改素材。
 *
 *      ⚠️ 判断标准：操作完成后，时间轴上是否多了一条用户可独立操作的素材条？
 *        是 → A 类，生成 editOperations。否 → B 或 C。
 *
 * ## 4. 撤销协议（A vs B 的关键差异）
 *      A 类：编辑操作粒度由 editOperations 描述。前端逐条反向（add_clip → remove_clip 等）。
 *      B 类：metadata 描述如何回滚单个文件，例如：
 *        metadata: {
 *          operation: "trim",
 *          success: true,
 *          undoable: true,
 *          outputPath: safeOutput,
 *          undo: { kind: "replace_file", originalPath: args.input, label: "撤销裁剪" },
 *        }
 *      C 类：纯读取，不需要 undoable / undo。
 *
 * ## 5. 错误返回格式
 *      return { title: "操作失败", metadata: { operation: "xxx", error: true }, output: "错误描述" }
 *      // metadata.operation 用工具 id
 *
 * ============================================================================
 * 三层保护：
 * 1. 原文件保护 — input = output → 自动改名
 * 2. 白名单沙箱 — output 必须在 CWD 或 input 父目录范围内
 * 3. 重复调用检测 — 同 input→output 已处理过 → skip
 *
 * 用法：
 *   const s = validatePath(inputPath, outputPath)
 *   if (!s.ok) return { title: "Blocked", metadata: { error: true }, output: s.error }
 *   await trimVideo(inputPath, s.outputPath, ...)
 */

import { existsSync, realpathSync } from "fs"
import { dirname, isAbsolute, relative, resolve, sep } from "path"
import { isDuplicateCall } from "./output-tracker.js"

export interface SandboxOptions {
  /** 是否保护原文件（input=output 时自动改名），默认 true */
  protectOriginals?: boolean
  /** 是否允许覆盖已存在的输出文件，默认 false */
  allowOverwrite?: boolean
  /** 限制输出目录（空=不限制） */
  outputDir?: string
  /** 额外的安全白名单目录（请求级注入，如 benchmark 输出目录） */
  extraSafeRoots?: string[]
}

export type SandboxResult =
  | { ok: true; outputPath: string; warning?: string }
  | { ok: false; error: string; skipped?: boolean }

/**
 * 校验输出路径安全性，返回安全/合法的绝对输出路径。
 *
 * @param inputPath 输入文件路径（或多个，如 concat），取第一个作为主输入
 * @param outputPath 期望的输出路径
 * @param options 可选：protectOriginals / allowOverwrite / outputDir
 */
export function validatePath(
  inputPath: string | string[],
  outputPath: string,
  options?: SandboxOptions,
): SandboxResult {
  const primaryInput = Array.isArray(inputPath) ? inputPath[0] : inputPath
  const protect = options?.protectOriginals ?? true
  const allowOverwrite = options?.allowOverwrite ?? false
  const outputDir = options?.outputDir

  const inputResolved = resolve(primaryInput)
  let outputResolved = resolve(outputPath)

  // ── Layer 1a: original file protection ──
  if (protect && inputResolved === outputResolved) {
    const dotIdx = outputPath.lastIndexOf(".")
    const base = dotIdx > 0 ? outputPath.slice(0, dotIdx) : outputPath
    const ext = dotIdx > 0 ? outputPath.slice(dotIdx) : ".mp4"
    outputResolved = resolve(`${base}_edited${ext}`)
    return {
      ok: true,
      outputPath: outputResolved,
      warning: `原文件保护：输出路径已自动调整为 ${outputResolved}`,
    }
  }

  // ── Layer 1b: output directory restriction ──
  if (outputDir) {
    const restricted = resolve(outputDir)
    const rel = relative(restricted, outputResolved)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return {
        ok: false,
        error: `输出路径必须在限定目录内: ${restricted}\n当前路径: ${outputResolved}`,
      }
    }
  }

  // ── Layer 2: white-list sandbox — realpath 防符号链接绕行 ──
  const safeRoots = [
    process.cwd(),
    dirname(inputResolved),
    ...(options?.extraSafeRoots || []),
  ]
  const withinSafe = safeRoots.some((root) => {
    let resolvedRoot: string
    try {
      resolvedRoot = realpathSync(root)
    } catch {
      resolvedRoot = resolve(root)
    }
    const rel = relative(resolvedRoot, outputResolved)
    return rel !== "" && !rel.startsWith(".." + sep) && !isAbsolute(rel)
  })
  if (!withinSafe) {
    return {
      ok: false,
      error: `输出路径 "${outputResolved}" 逃逸了安全目录。\n允许的输出范围:\n${safeRoots.map((r) => `  - ${r}`).join("\n")}`,
    }
  }

  // ── Layer 3: duplicate call detection ──
  if (!allowOverwrite && existsSync(outputResolved)) {
    if (isDuplicateCall(primaryInput, outputResolved)) {
      return {
        ok: false,
        skipped: true,
        error: `输出文件已存在，跳过: ${outputResolved}`,
      }
    }
    // 不同输入 → 同一输出 = 管线串联步骤，允许覆盖
  }

  return { ok: true, outputPath: outputResolved }
}
