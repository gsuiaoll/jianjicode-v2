import type { Argv } from "yargs"
import {
  agentRegistry,
  createVideoTask,
  initializeAgents,
} from "../../agent/index.js"
import { initializeTools } from "../../registry/tool_registry.js"
import { UI } from "../ui.js"
import { cmd } from "./cmd.js"

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run jianjicode with a video editing command using AI agents",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "video editing command to execute (natural language)",
        type: "string",
        array: true,
        default: [],
      })
      .option("agent", {
        type: "string",
        describe: "agent to use (video_editor, video_quick, video_batch, auto)",
        default: "auto",
      })
      .option("input", {
        type: "string",
        describe: "input video file path",
        alias: "i",
      })
      .option("output", {
        type: "string",
        describe: "output video file path",
        alias: "o",
      })
      .option("params", {
        type: "string",
        describe: "additional parameters as JSON string",
      })
      .option("allow-overwrite", {
        type: "boolean",
        describe: "allow overwriting existing files",
        default: false,
      })
      .option("protect-originals", {
        type: "boolean",
        describe: "protect original files by creating new copies",
        default: true,
      })
      .option("output-dir", {
        type: "string",
        describe: "restrict output to specific directory",
      })
      .option("verbose", {
        type: "boolean",
        describe: "show detailed execution logs",
        default: false,
      })
  },
  handler: async (args: any) => {
    const message = args.message.join(" ")

    if (!message) {
      UI.error("You must provide a video editing command")
      process.exit(1)
    }

    UI.empty()
    UI.println(`> Running jianjicode video editing AI agent`)
    UI.println(`> Command: ${message}`)
    if (args.input) UI.println(`> Input: ${args.input}`)
    if (args.output) UI.println(`> Output: ${args.output}`)
    if (args.agent && args.agent !== "auto")
      UI.println(`> Agent: ${args.agent}`)
    UI.empty()

    try {
      // 1. 初始化工具和代理系统
      UI.println(`> Initializing tool system...`)
      await initializeTools()
      UI.println(`> Initializing agent system...`)
      await initializeAgents()

      // 2. 解析参数
      const parameters: Record<string, any> = {
        input_file: args.input,
        output_file: args.output,
        allow_overwrite: args.allow_overwrite,
        protect_originals: args.protect_originals,
        output_dir: args.output_dir,
      }

      // 解析额外的JSON参数
      if (args.params) {
        try {
          const extraParams = JSON.parse(args.params)
          Object.assign(parameters, extraParams)
        } catch (error) {
          UI.warn(`Failed to parse JSON parameters: ${args.params}`)
        }
      }

      // 3. 创建视频任务
      UI.println(`> Creating video editing task...`)
      const task = createVideoTask(message, parameters)

      UI.println(`> Task created: ${task.id}`)
      UI.println(`> Task type: ${task.type}`)
      UI.println(
        `> Input files: ${task.inputFiles.length > 0 ? task.inputFiles.join(", ") : "None"}`,
      )
      if (args.verbose) {
        UI.println(
          `> Task parameters: ${JSON.stringify(task.parameters, null, 2)}`,
        )
      }

      // 4. 选择代理
      let selectedAgent
      if (args.agent === "auto") {
        UI.println(`> Selecting best agent for the task...`)
        selectedAgent = agentRegistry.selectAgent(task)
        if (!selectedAgent) {
          UI.error("No suitable agent found for this task")
          process.exit(1)
        }
        UI.println(`> Selected agent: ${selectedAgent.name}`)
      } else {
        selectedAgent = agentRegistry.getAgent(args.agent)
        if (!selectedAgent) {
          UI.error(
            `Agent "${args.agent}" not found. Available agents: ${agentRegistry
              .getAllAgents()
              .map((a) => a.id)
              .join(", ")}`,
          )
          process.exit(1)
        }

        // 检查代理是否能处理该任务
        if (!selectedAgent.canHandle(task)) {
          UI.error(
            `Agent "${args.agent}" cannot handle this task. Try another agent or use "auto".`,
          )
          process.exit(1)
        }
      }

      // 5. 制定执行计划
      UI.println(`> Planning execution...`)
      const plan = selectedAgent.planExecution(task)

      UI.println(`> Execution plan created: ${plan.id}`)
      UI.println(`> Steps: ${plan.steps.length}`)
      UI.println(
        `> Estimated duration: ${Math.round(plan.estimatedDuration / 60)} minutes`,
      )
      UI.println(`> Required tools: ${plan.requiredTools.join(", ")}`)
      if (plan.hasDangerousOperations) {
        UI.warn(`> ⚠️  This plan contains dangerous operations!`)
      }

      // 6. 执行计划
      UI.println(`\n> Starting execution...`)
      UI.println(`> ${"=".repeat(50)}`)

      const result = await selectedAgent.execute(plan)

      UI.println(`> ${"=".repeat(50)}`)

      // 7. 显示结果
      UI.println(`\n> Execution completed!`)
      UI.println(`> Task ID: ${result.id}`)
      UI.println(`> Success: ${result.success ? "✅ Yes" : "❌ No"}`)
      UI.println(`> Duration: ${result.duration}ms`)

      if (result.success) {
        if (result.outputFiles.length > 0) {
          UI.println(`> Output files:`)
          result.outputFiles.forEach((file) => {
            UI.println(`  - ${file}`)
          })
        }
        UI.success(`\n✅ Video editing completed successfully!`)
      } else {
        UI.error(`\n❌ Video editing failed!`)
        if (result.error) {
          UI.println(`> Error: ${result.error.message}`)
          if (args.verbose && result.error.details) {
            UI.println(
              `> Details: ${JSON.stringify(result.error.details, null, 2)}`,
            )
          }
        }

        // 显示日志中的错误
        const errorLogs = result.logs.filter((log) => log.level === "error")
        if (errorLogs.length > 0) {
          UI.println(`> Error logs:`)
          errorLogs.slice(0, 3).forEach((log) => {
            UI.println(`  - ${log.message}`)
          })
        }

        process.exit(1)
      }
    } catch (error: any) {
      UI.error(`Failed to execute video editing command: ${error.message}`)
      if (args.verbose) {
        console.error(error)
      }
      process.exit(1)
    }
  },
})
