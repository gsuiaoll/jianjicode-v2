import z from "zod"
import { Tool } from "./tool.js"

export const TestTool = Tool.define("test_tool", {
  description: "A test tool",
  parameters: z.object({
    message: z.string().describe("Test message"),
  }),
  execute: async (args, ctx) => {
    return {
      title: "Test Tool",
      metadata: { operation: "test_tool", error: false },
      output: `Test tool executed with message: ${args.message}`,
    }
  },
})
