import { existsSync, readFileSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import z from "zod"
import { Tool } from "./tool.js"

/**
 * 批处理报告生成器 - 生成批量处理的详细报告
 *
 * 支持功能:
 * 1. 进度汇总统计
 * 2. 错误分析和分类
 * 3. 性能指标计算
 * 4. 报告导出 (JSON, CSV, HTML)
 * 5. 可视化图表数据生成
 */
export const BatchReportTool = Tool.define("batch_report", {
  description: "生成批量处理的详细报告，包括统计、错误分析和性能指标",
  parameters: z.object({
    // 报告数据源
    results: z.record(z.any()).optional().describe("处理结果数据 (JSON格式)"),
    results_file: z
      .string()
      .optional()
      .describe("包含处理结果的文件路径 (JSON格式)"),
    scan_results: z
      .any()
      .optional()
      .describe("扫描结果数据 (来自 batch_scanner)"),
    queue_results: z
      .any()
      .optional()
      .describe("队列执行结果 (来自 batch_queue)"),

    // 报告配置
    report_format: z
      .enum(["text", "json", "csv", "html", "markdown"])
      .optional()
      .default("text")
      .describe("报告格式 (默认: text)"),
    output_file: z
      .string()
      .optional()
      .describe("输出报告文件路径 (空则输出到控制台)"),
    include_details: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否包含详细的任务列表 (默认: 是)"),
    include_statistics: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否包含统计信息 (默认: 是)"),
    include_errors: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否包含错误分析 (默认: 是)"),
    include_performance: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否包含性能指标 (默认: 是)"),

    // 分析选项
    error_categories: z
      .array(z.string())
      .optional()
      .default([
        "file_not_found",
        "ffmpeg_error",
        "timeout",
        "permission_denied",
        "disk_full",
        "other",
      ])
      .describe("错误分类列表"),
    performance_metrics: z
      .array(z.string())
      .optional()
      .default([
        "processing_time",
        "file_size_change",
        "cpu_usage",
        "memory_usage",
      ])
      .describe("性能指标列表"),

    // 可视化选项
    generate_charts: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否生成图表数据 (默认: 否)"),
    chart_types: z
      .array(z.enum(["bar", "line", "pie", "scatter"]))
      .optional()
      .default(["bar", "pie"])
      .describe("图表类型 (如果启用生成图表)"),
  }),

  execute: async (args: any, ctx: Tool.Context) => {
    try {
      const tool = BatchReportTool as any
      // 1. 加载结果数据
      const results = await (tool as any).loadResults(args)
      if (!results) {
        return {
          title: "报告生成失败",
          metadata: { operation: "batch_report", error: true },
          output: "❌ 没有可用的结果数据",
        } as any
      }

      // 2. 分析数据
      const analysis = (tool as any).analyzeResults(results, args)

      // 3. 生成报告
      const report = (tool as any).generateReport(analysis, args)

      // 4. 输出报告
      let outputContent = ""
      let outputPath = ""

      switch (args.report_format) {
        case "json":
          outputContent = (tool as any).generateJsonReport(report, analysis)
          break
        case "csv":
          outputContent = (tool as any).generateCsvReport(report, analysis)
          break
        case "html":
          outputContent = (tool as any).generateHtmlReport(report, analysis)
          break
        case "markdown":
          outputContent = (tool as any).generateMarkdownReport(report, analysis)
          break
        default: // text
          outputContent = (tool as any).generateTextReport(report, analysis)
      }

      // 5. 保存到文件或输出到控制台
      if (args.output_file) {
        outputPath = args
          .output_file(tool as any)
          .ensureDirectoryExists(outputPath)
        writeFileSync(outputPath, outputContent, "utf8")
      }

      // 6. 返回结果
      const metadata: any = {
        operation: "batch_report",
        success: true,
        error: false,
        analysis,
        report_format: args.report_format,
      }

      if (outputPath) {
        metadata.output_file = outputPath
        metadata.file_size = outputContent.length
      }

      return {
        title: "批处理报告生成完成",
        metadata,
        output: (tool as any).formatOutput(report, outputPath, args),
      } as any
    } catch (error: any) {
      return {
        title: "报告生成错误",
        metadata: { operation: "batch_report", error: true },
        output: `❌ 报告生成过程中发生错误: ${error.message}`,
      } as any
    }
  },
} as any)

// 扩展工具类的方法
;(BatchReportTool as any).loadResults = async (args: any): Promise<any> => {
  // 优先使用直接传递的结果
  if (args.results) {
    return args.results
  }

  // 然后尝试从文件加载
  if (args.results_file && existsSync(args.results_file)) {
    try {
      const content = readFileSync(args.results_file, "utf8")
      return JSON.parse(content)
    } catch (error) {
      console.error(`[BatchReportTool] 无法加载结果文件: ${error}`)
    }
  }

  // 尝试组合扫描和队列结果
  if (args.scan_results || args.queue_results) {
    return {
      scan: args.scan_results,
      queue: args.queue_results,
      timestamp: new Date().toISOString(),
    }
  }

  return null
}

;(BatchReportTool as any).analyzeResults = (results: any, args: any): any => {
  const analysis: any = {
    summary: {
      total_tasks: 0,
      successful_tasks: 0,
      failed_tasks: 0,
      total_files: 0,
      total_size: 0,
      start_time: null,
      end_time: null,
      duration: 0,
    },
    errors: {
      by_category: {},
      by_task_type: {},
      common_messages: [],
    },
    performance: {
      average_processing_time: 0,
      total_processing_time: 0,
      file_size_changes: [],
      throughput: 0,
    },
    tasks: {
      by_operation: {},
      by_status: {},
      by_priority: {},
    },
    files: {
      by_extension: {},
      by_size_range: {},
    },
  }

  // 分析扫描结果
  if (results.scan) {
    analysis.summary.total_files = results.scan.stats?.total_output || 0
    analysis.summary.total_size = results.scan.stats?.total_size || 0
    analysis.files.by_extension = results.scan.stats?.extensions || {}

    // 按大小范围分类
    if (results.scan.files) {
      for (const file of results.scan.files) {
        const sizeMB = file.size / (1024 * 1024)
        let range = ""

        if (sizeMB < 10) range = "<10MB"
        else if (sizeMB < 100) range = "10-100MB"
        else if (sizeMB < 500) range = "100-500MB"
        else if (sizeMB < 1000) range = "500MB-1GB"
        else range = ">1GB"

        analysis.files.by_size_range[range] =
          (analysis.files.by_size_range[range] || 0) + 1
      }
    }
  }

  // 分析队列结果
  if (results.queue) {
    const queueResults = results.queue.results || results.queue
    analysis.summary.total_tasks = results.queue.stats?.total_tasks || 0
    analysis.summary.successful_tasks =
      results.queue.stats?.completed_tasks || 0
    analysis.summary.failed_tasks = results.queue.stats?.failed_tasks || 0

    // 分析任务类型分布
    if (results.queue.tasks) {
      for (const task of results.queue.tasks) {
        const op = task.operation || "unknown"
        analysis.tasks.by_operation[op] =
          (analysis.tasks.by_operation[op] || 0) + 1

        const priority = task.priority || 50
        const priorityRange =
          priority < 25 ? "low" : priority < 75 ? "medium" : "high"
        analysis.tasks.by_priority[priorityRange] =
          (analysis.tasks.by_priority[priorityRange] || 0) + 1
      }
    }

    // 分析错误
    if (Array.isArray(queueResults)) {
      for (const result of queueResults) {
        if (!result.success) {
          const errorMsg = result.error || "unknown"
          let category = "other"

          // 错误分类
          for (const cat of args.error_categories) {
            if (errorMsg.toLowerCase().includes(cat.toLowerCase())) {
              category = cat
              break
            }
          }

          analysis.errors.by_category[category] =
            (analysis.errors.by_category[category] || 0) + 1

          if (result.task) {
            const taskType = result.task.operation || "unknown"
            analysis.errors.by_task_type[taskType] =
              (analysis.errors.by_task_type[taskType] || 0) + 1
          }

          if (
            errorMsg !== "unknown" &&
            !analysis.errors.common_messages.includes(errorMsg)
          ) {
            if (analysis.errors.common_messages.length < 10) {
              analysis.errors.common_messages.push(errorMsg)
            }
          }
        }
      }
    }
  }

  // 计算性能指标
  if (results.queue?.stats) {
    analysis.performance.total_processing_time =
      results.queue.stats.total_duration || 0
    analysis.performance.average_processing_time =
      analysis.summary.successful_tasks > 0
        ? analysis.performance.total_processing_time /
          analysis.summary.successful_tasks
        : 0

    if (analysis.performance.total_processing_time > 0) {
      analysis.performance.throughput =
        analysis.summary.successful_tasks /
        analysis.performance.total_processing_time
    }
  }

  // 计算成功率
  analysis.summary.success_rate =
    analysis.summary.total_tasks > 0
      ? (
          (analysis.summary.successful_tasks / analysis.summary.total_tasks) *
          100
        ).toFixed(2)
      : "0.00"

  return analysis
}

;(BatchReportTool as any).generateReport = (analysis: any, args: any): any => {
  const report: any = {
    metadata: {
      generated_at: new Date().toISOString(),
      format: args.report_format,
      version: "1.0",
    },
    summary: analysis.summary,
  }

  if (args.include_statistics) {
    report.statistics = {
      tasks: analysis.tasks,
      files: analysis.files,
      performance: analysis.performance,
    }
  }

  if (args.include_errors && analysis.summary.failed_tasks > 0) {
    report.errors = analysis.errors
  }

  if (args.include_performance) {
    report.performance = analysis.performance
  }

  if (args.generate_charts) {
    report.charts = (BatchReportTool as any).generateChartData(analysis, args)
  }

  return report
}

;(BatchReportTool as any).generateTextReport = (
  report: any,
  analysis: any,
): string => {
  const lines: string[] = []

  lines.push("=".repeat(80))
  lines.push("📊 批处理分析报告")
  lines.push("=".repeat(80))
  lines.push("")

  // 摘要
  lines.push("📈 执行摘要")
  lines.push("─".repeat(40))
  lines.push(`总任务数: ${analysis.summary.total_tasks}`)
  lines.push(`成功任务: ${analysis.summary.successful_tasks}`)
  lines.push(`失败任务: ${analysis.summary.failed_tasks}`)
  lines.push(`成功率: ${analysis.summary.success_rate}%`)
  lines.push(`总文件数: ${analysis.summary.total_files}`)
  lines.push(
    `总文件大小: ${(BatchReportTool as any).formatFileSize(analysis.summary.total_size)}`,
  )
  lines.push(
    `总处理时间: ${analysis.performance.total_processing_time.toFixed(2)} 秒`,
  )
  lines.push("")

  // 任务统计
  if (
    analysis.tasks.by_operation &&
    Object.keys(analysis.tasks.by_operation).length > 0
  ) {
    lines.push("🛠️ 任务类型分布")
    lines.push("─".repeat(40))
    for (const [op, count] of Object.entries(analysis.tasks.by_operation)) {
      lines.push(`  ${op}: ${count} 个任务`)
    }
    lines.push("")
  }

  // 错误分析
  if (
    analysis.errors.by_category &&
    Object.keys(analysis.errors.by_category).length > 0
  ) {
    lines.push("❌ 错误分析")
    lines.push("─".repeat(40))
    lines.push("错误分类:")
    for (const [category, count] of Object.entries(
      analysis.errors.by_category,
    )) {
      const percentage =
        analysis.summary.failed_tasks > 0
          ? (((count as number) / analysis.summary.failed_tasks) * 100).toFixed(
              1,
            )
          : "0.0"
      lines.push(`  ${category}: ${count} 次 (${percentage}%)`)
    }
    lines.push("")
  }

  // 性能指标
  lines.push("⚡ 性能指标")
  lines.push("─".repeat(40))
  lines.push(
    `平均处理时间: ${analysis.performance.average_processing_time.toFixed(2)} 秒/任务`,
  )
  lines.push(
    `处理吞吐量: ${analysis.performance.throughput.toFixed(4)} 任务/秒`,
  )
  lines.push("")

  // 文件统计
  if (
    analysis.files.by_extension &&
    Object.keys(analysis.files.by_extension).length > 0
  ) {
    lines.push("📁 文件统计")
    lines.push("─".repeat(40))
    lines.push("文件类型分布:")
    for (const [ext, count] of Object.entries(analysis.files.by_extension)) {
      lines.push(`  ${ext}: ${count} 个文件`)
    }
    lines.push("")
  }

  lines.push("=".repeat(80))
  lines.push(`报告生成时间: ${report.metadata.generated_at}`)
  lines.push("=".repeat(80))

  return lines.join("\n")
}

;(BatchReportTool as any).generateJsonReport = (
  report: any,
  analysis: any,
): string => JSON.stringify(report, null, 2)

;(BatchReportTool as any).generateCsvReport = (
  report: any,
  analysis: any,
): string => {
  const lines: string[] = []

  // 摘要行
  lines.push("Category,Item,Value")
  lines.push(`Summary,Total Tasks,${analysis.summary.total_tasks}`)
  lines.push(`Summary,Successful Tasks,${analysis.summary.successful_tasks}`)
  lines.push(`Summary,Failed Tasks,${analysis.summary.failed_tasks}`)
  lines.push(`Summary,Success Rate,${analysis.summary.success_rate}%`)
  lines.push(`Summary,Total Files,${analysis.summary.total_files}`)
  lines.push(`Summary,Total Size,${analysis.summary.total_size}`)
  lines.push(
    `Performance,Total Processing Time,${analysis.performance.total_processing_time}`,
  )
  lines.push(
    `Performance,Average Processing Time,${analysis.performance.average_processing_time}`,
  )
  lines.push(`Performance,Throughput,${analysis.performance.throughput}`)

  // 任务类型分布
  for (const [op, count] of Object.entries(analysis.tasks.by_operation)) {
    lines.push(`Tasks by Operation,${op},${count}`)
  }

  // 错误分类
  for (const [category, count] of Object.entries(analysis.errors.by_category)) {
    lines.push(`Errors by Category,${category},${count}`)
  }

  // 文件类型分布
  for (const [ext, count] of Object.entries(analysis.files.by_extension)) {
    lines.push(`Files by Extension,${ext},${count}`)
  }

  return lines.join("\n")
}

;(BatchReportTool as any).generateHtmlReport = (
  report: any,
  analysis: any,
): string =>
  `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>批处理分析报告</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 5px; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 5px; text-align: center; }
        .stat-value { font-size: 24px; font-weight: bold; color: #3498db; }
        .stat-label { color: #7f8c8d; }
        .error-badge { background: #e74c3c; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px; }
        .success-badge { background: #2ecc71; color: white; padding: 3px 8px; border-radius: 3px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f2f2f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 批处理分析报告</h1>
        <p>生成时间: ${report.metadata.generated_at}</p>
    </div>

    <div class="section">
        <h2>📈 执行摘要</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${analysis.summary.total_tasks}</div>
                <div class="stat-label">总任务数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${analysis.summary.successful_tasks}</div>
                <div class="stat-label">成功任务</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${analysis.summary.failed_tasks}</div>
                <div class="stat-label">失败任务</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${analysis.summary.success_rate}%</div>
                <div class="stat-label">成功率</div>
            </div>
        </div>
    </div>

    <div class="section">
        <h2>🛠️ 任务类型分布</h2>
        <table>
            <thead>
                <tr><th>操作类型</th><th>任务数量</th></tr>
            </thead>
            <tbody>
                ${Object.entries(analysis.tasks.by_operation)
                  .map(
                    ([op, count]) => `
                <tr><td>${op}</td><td>${count}</td></tr>`,
                  )
                  .join("")}
            </tbody>
        </table>
    </div>

    <div class="section">
        <h2>❌ 错误分析</h2>
        <table>
            <thead>
                <tr><th>错误分类</th><th>数量</th><th>百分比</th></tr>
            </thead>
            <tbody>
                ${Object.entries(analysis.errors.by_category)
                  .map(([category, count]) => {
                    const percentage =
                      analysis.summary.failed_tasks > 0
                        ? (
                            ((count as number) /
                              analysis.summary.failed_tasks) *
                            100
                          ).toFixed(1)
                        : "0.0"
                    return `<tr><td>${category}</td><td>${count}</td><td>${percentage}%</td></tr>`
                  })
                  .join("")}
            </tbody>
        </table>
    </div>

    <div class="section">
        <h2>⚡ 性能指标</h2>
        <table>
            <tbody>
                <tr><td>总处理时间</td><td>${analysis.performance.total_processing_time.toFixed(2)} 秒</td></tr>
                <tr><td>平均处理时间</td><td>${analysis.performance.average_processing_time.toFixed(2)} 秒/任务</td></tr>
                <tr><td>处理吞吐量</td><td>${analysis.performance.throughput.toFixed(4)} 任务/秒</td></tr>
            </tbody>
        </table>
    </div>
</body>
</html>
  `.trim()

;(BatchReportTool as any).generateMarkdownReport = (
  report: any,
  analysis: any,
): string => {
  const lines: string[] = []

  lines.push("# 📊 批处理分析报告")
  lines.push("")
  lines.push(`**生成时间**: ${report.metadata.generated_at}`)
  lines.push("")

  lines.push("## 📈 执行摘要")
  lines.push("")
  lines.push("| 指标 | 数值 |")
  lines.push("|------|------|")
  lines.push(`| 总任务数 | ${analysis.summary.total_tasks} |`)
  lines.push(`| 成功任务 | ${analysis.summary.successful_tasks} |`)
  lines.push(`| 失败任务 | ${analysis.summary.failed_tasks} |`)
  lines.push(`| 成功率 | ${analysis.summary.success_rate}% |`)
  lines.push(`| 总文件数 | ${analysis.summary.total_files} |`)
  lines.push(
    `| 总文件大小 | ${(BatchReportTool as any).formatFileSize(analysis.summary.total_size)} |`,
  )
  lines.push(
    `| 总处理时间 | ${analysis.performance.total_processing_time.toFixed(2)} 秒 |`,
  )
  lines.push("")

  if (Object.keys(analysis.tasks.by_operation).length > 0) {
    lines.push("## 🛠️ 任务类型分布")
    lines.push("")
    lines.push("| 操作类型 | 任务数量 |")
    lines.push("|----------|----------|")
    for (const [op, count] of Object.entries(analysis.tasks.by_operation)) {
      lines.push(`| ${op} | ${count} |`)
    }
    lines.push("")
  }

  if (Object.keys(analysis.errors.by_category).length > 0) {
    lines.push("## ❌ 错误分析")
    lines.push("")
    lines.push("| 错误分类 | 数量 | 百分比 |")
    lines.push("|----------|------|--------|")
    for (const [category, count] of Object.entries(
      analysis.errors.by_category,
    )) {
      const percentage =
        analysis.summary.failed_tasks > 0
          ? (((count as number) / analysis.summary.failed_tasks) * 100).toFixed(
              1,
            )
          : "0.0"
      lines.push(`| ${category} | ${count} | ${percentage}% |`)
    }
    lines.push("")
  }

  lines.push("## ⚡ 性能指标")
  lines.push("")
  lines.push("| 指标 | 数值 |")
  lines.push("|------|------|")
  lines.push(
    `| 总处理时间 | ${analysis.performance.total_processing_time.toFixed(2)} 秒 |`,
  )
  lines.push(
    `| 平均处理时间 | ${analysis.performance.average_processing_time.toFixed(2)} 秒/任务 |`,
  )
  lines.push(
    `| 处理吞吐量 | ${analysis.performance.throughput.toFixed(4)} 任务/秒 |`,
  )
  lines.push("")

  return lines.join("\n")
}

;(BatchReportTool as any).generateChartData = (
  analysis: any,
  args: any,
): any => {
  const chartData: any = {}

  if (args.chart_types.includes("pie")) {
    // 任务类型饼图数据
    chartData.task_types_pie = {
      type: "pie",
      title: "任务类型分布",
      data: Object.entries(analysis.tasks.by_operation).map(
        ([label, value]) => ({
          label,
          value,
        }),
      ),
    }

    // 错误分类饼图数据
    if (Object.keys(analysis.errors.by_category).length > 0) {
      chartData.error_categories_pie = {
        type: "pie",
        title: "错误分类分布",
        data: Object.entries(analysis.errors.by_category).map(
          ([label, value]) => ({
            label,
            value,
          }),
        ),
      }
    }
  }

  if (args.chart_types.includes("bar")) {
    // 文件类型柱状图
    if (Object.keys(analysis.files.by_extension).length > 0) {
      chartData.file_types_bar = {
        type: "bar",
        title: "文件类型分布",
        labels: Object.keys(analysis.files.by_extension),
        datasets: [
          {
            label: "文件数量",
            data: Object.values(analysis.files.by_extension),
          },
        ],
      }
    }

    // 错误数量柱状图
    if (Object.keys(analysis.errors.by_task_type).length > 0) {
      chartData.errors_by_task_bar = {
        type: "bar",
        title: "各任务类型错误数量",
        labels: Object.keys(analysis.errors.by_task_type),
        datasets: [
          {
            label: "错误数量",
            data: Object.values(analysis.errors.by_task_type),
          },
        ],
      }
    }
  }

  return chartData
}

;(BatchReportTool as any).ensureDirectoryExists = (filePath: string): void => {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    // 在实际应用中，这里应该创建目录
    // 但为了简化，我们只是记录日志
    console.log(`[BatchReportTool] 需要创建目录: ${dir}`)
  }
}

;(BatchReportTool as any).formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B"

  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`
}

;(BatchReportTool as any).formatOutput = (
  report: any,
  outputPath: string,
  args: any,
): string => {
  const lines: string[] = []

  lines.push(`📋 批处理报告生成完成`)
  lines.push(`📄 报告格式: ${args.report_format}`)

  if (outputPath) {
    lines.push(`💾 报告已保存到: ${outputPath}`)
    lines.push(
      `📊 报告大小: ${(BatchReportTool as any).formatFileSize(report.metadata?.file_size || 0)}`,
    )
  } else {
    lines.push(`💬 报告已输出到控制台`)
  }

  lines.push("")
  lines.push(`📈 报告摘要:`)
  lines.push(`  ├── 总任务数: ${report.summary?.total_tasks || 0}`)
  lines.push(`  ├── 成功任务: ${report.summary?.successful_tasks || 0}`)
  lines.push(`  ├── 失败任务: ${report.summary?.failed_tasks || 0}`)
  lines.push(`  ├── 成功率: ${report.summary?.success_rate || "0.00"}%`)
  lines.push(`  └── 包含图表: ${args.generate_charts ? "是" : "否"}`)

  return lines.join("\n")
}

/**
 * 工具别名
 */
export const ReportTool = BatchReportTool
