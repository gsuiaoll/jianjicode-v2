/**
 * set_edit_phase 工具 — 切换视频剪辑阶段
 *
 * 模型在完成粗剪后调用此工具切换到精剪阶段。
 * 阶段切换会改变可用工具集（权限门禁）。
 */

import z from "zod"
// clearToolSetCache: v2 stub — 旧版从 ai-stream.ts 导入，该文件依赖 Vercel AI SDK。
// 新版由 OpenCode 工具生命周期管理缓存，此函数为 no-op。
function clearToolSetCache(): void {}
import {
  getCurrentPhase,
  setCurrentPhase,
} from "../../lib/video-phase.js"
import { Tool } from "../../lib/tool.js"

export const SetEditPhaseTool = Tool.define("set_edit_phase", {
  description: `切换到指定的视频剪辑阶段。阶段决定可用工具集：
- "rough_cut"（粗剪）：裁剪、拼接、场景检测 — 锁定时间轴
- "fine_cut"（精剪）：BGM、字幕、调色、转场、特效 — 装饰润色

必须在粗剪完成、时间轴锁定后才能切换到精剪。`,
  parameters: z.object({
    phase: z.enum(["rough_cut", "fine_cut"]).describe("目标剪辑阶段"),
  }),
  usageTemplate: {
    json: {
      phase: "rough_cut",
    },
    constraints: [
      "phase 支持 rough_cut(粗剪)/fine_cut(精剪)",
      "切换阶段会触发 clearToolSetCache()，下次 buildToolSet() 重新注入模板",
      "粗剪阶段允许大段裁剪和拼接",
      "精剪阶段限制 trim<=2秒且禁止 concat",
      "各阶段的编辑能力和约束见 video-phase.ts",
    ],
  },
  execute: async (args, ctx) => {
    const prevPhase = getCurrentPhase()
    setCurrentPhase(args.phase)

    // 清除 ToolSet 缓存，下次 buildToolSet() 会按新阶段过滤工具
    try {
      clearToolSetCache()
    } catch {
      /* ignore */
    }

    return {
      title: `切换到${args.phase === "rough_cut" ? "粗剪" : "精剪"}阶段`,
      output: `剪辑阶段已从 "${prevPhase}" 切换到 "${args.phase}"。${args.phase === "fine_cut" ? "精剪工具（BGM、字幕、调色、转场等）现已可用。粗剪专用工具已禁用。" : "粗剪工具（裁剪、拼接等）现已可用。精剪工具已禁用。"}`,
      metadata: {
        operation: "set_edit_phase",
        previousPhase: prevPhase,
        currentPhase: args.phase,
        success: true,
      },
    }
  },
})
