import z from "zod"
import { Tool } from "./tool.js"

/**
 * 假视频处理工具 - 用于测试批处理队列
 *
 * 模拟视频处理操作，支持成功/失败测试
 */
export const FakeVideoTool = Tool.define("fake_video", {
  description: "模拟视频处理工具，用于测试批处理队列",
  parameters: z.object({
    input_file: z.string().describe("输入文件路径"),
    output_file: z.string().optional().describe("输出文件路径"),
    operation: z
      .enum(["convert", "trim", "filter", "watermark"])
      .optional()
      .default("convert")
      .describe("模拟的操作类型"),
    simulate_success: z
      .boolean()
      .optional()
      .default(true)
      .describe("模拟成功还是失败"),
    delay_ms: z
      .number()
      .min(0)
      .max(10000)
      .optional()
      .default(1000)
      .describe("模拟处理延迟 (毫秒)"),
    fail_message: z
      .string()
      .optional()
      .default("模拟失败")
      .describe("失败时的错误消息"),
  }),

  execute: async (args: any, ctx: any) => {
    try {
      console.log(`[FakeVideoTool] 开始处理: ${args.input_file}`)
      console.log(
        `[FakeVideoTool] 操作: ${args.operation}, 延迟: ${args.delay_ms}ms`,
      )

      // 模拟处理延迟
      await new Promise((resolve) => setTimeout(resolve, args.delay_ms))

      if (args.simulate_success) {
        const outputPath =
          args.output_file || `${args.input_file}.processed.mp4`
        console.log(`[FakeVideoTool] 处理成功: ${outputPath}`)

        return {
          title: "假视频处理成功",
          metadata: {
            operation: "fake_video",
            success: true,
            error: false,
            outputPath,
            parameters: args,
            simulated: true,
            processingTime: args.delay_ms,
          },
          output: `✅ 模拟处理完成\n输入: ${args.input_file}\n输出: ${outputPath}\n操作: ${args.operation}\n耗时: ${args.delay_ms}ms`,
        }
      } else {
        console.log(`[FakeVideoTool] 模拟失败: ${args.fail_message}`)
        return {
          title: "假视频处理失败",
          metadata: {
            operation: "fake_video",
            error: true,
            success: false,
            parameters: args,
            simulated: true,
            failMessage: args.fail_message,
          },
          output: `❌ 模拟处理失败: ${args.fail_message}\n输入: ${args.input_file}\n操作: ${args.operation}`,
        }
      }
    } catch (error: any) {
      console.error(`[FakeVideoTool] 处理失败: ${error.message}`)
      return {
        title: "假视频处理失败",
        metadata: {
          operation: "fake_video",
          error: true,
          success: false,
          parameters: args,
          simulated: true,
          exception: error.message,
        },
        output: `❌ 模拟处理失败: ${error.message}\n输入: ${args.input_file}\n操作: ${args.operation}`,
      }
    }
  },
} as any)

/**
 * 工具别名
 */
export const TestTool = FakeVideoTool
