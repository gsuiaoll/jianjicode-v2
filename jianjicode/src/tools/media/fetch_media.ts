import z from "zod"
import { Tool } from "../../lib/tool.js"

export const FetchMediaTool = Tool.define("fetch_media", {
  description:
    "调用此工具后，下一轮对话中素材视频的多模态数据会自动注入，你可以直接观看画面。" +
    "**重要**：调用后不要先说「正在加载」「请稍等」，工具执行完毕后在下一轮直接观察并回答即可。" +
    "仅在需要视觉理解时调用，素材名称和路径可从系统提示词中的「可用素材文件」列表获取。",
  parameters: z.object({
    name: z
      .string()
      .optional()
      .describe("素材文件名（从「可用素材文件」列表获取），支持模糊匹配"),
    path: z
      .string()
      .optional()
      .describe("直接指定文件路径。name 和 path 至少填一个"),
  }),
  execute: async (args) => {
    const target = args.name || args.path || "(未指定)"
    return {
      title: `加载素材: ${target}`,
      output: `素材「${target}」已就绪。下一轮对话中视频画面会自动出现，届时直接观察并回答用户问题。`,
      metadata: {
        operation: "fetch_media",
        success: true,
        requestedName: args.name || null,
        requestedPath: args.path || null,
      },
    }
  },
})
